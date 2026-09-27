/** Native account state for the Models settings card; credential material never enters the store. */
import type {
  IApiClient, NativeAccountAttempt, NativeAccountModel, NativeAccountProvider, NativeAccountView, NativeLoginMode,
  SettingsNamespaceView,
} from '@arx-ai/arx-api-remotes/client'
import { createSnapshotStore } from '@arx-ai/arx-client-runtime/client'
import type { SettingsDescribeFace } from '@arx-ai/arx-client-ui-settings/client'
import {
  CHAT_ROUTES, claudeRouteEntries, codexRouteEntries, pinnedCatalog, reconciledModels, staleOverrides, storedModels,
  storedRoute, type ChatRouteState,
} from './chat-roster.ts'
import { answered, messageOf } from './store.ts'

type Api = IApiClient['nativeAccounts']

interface State {
  accounts: NativeAccountView[]
  attempt: NativeAccountAttempt | null
  /** Per native product with a chat roster, how its chat route serves that roster. */
  routes: Partial<Record<NativeAccountProvider, ChatRouteState>>
  loading: boolean
  busy: boolean
  error: string | null
}

/** The ordered settings path edits that bring a chat route up to its account's roster. */
type RouteWrite = Parameters<IApiClient['settings']['mutate']>[0]['ops']

const pending = (attempt: NativeAccountAttempt | null): attempt is NativeAccountAttempt =>
  attempt?.state === 'starting' || attempt?.state === 'waiting'

/**
 * The roster that may feed a product's chat route: the models of a connected
 * subscription account, when it lists any.
 * @param accounts - the loaded accounts.
 * @param provider - the native product.
 * @returns the roster, or `undefined` when the account cannot feed a chat route.
 */
function rosterOf(accounts: readonly NativeAccountView[], provider: NativeAccountProvider): readonly NativeAccountModel[] | undefined {
  const account = accounts.find(row => row.provider === provider)
  return account?.status === 'connected' && account.authMode === 'subscription' && account.models !== undefined
    && account.models.length > 0 ? account.models : undefined
}

/** Controller lifetime follows the plugin, while login polling follows the mounted card. */
export class NativeAccountsStore {
  /** The card's snapshot: accounts, this card's attempt, route state, and the last failure. */
  readonly store = createSnapshotStore<State>({
    accounts: [], attempt: null, routes: {}, loading: false, busy: false, error: null,
  })
  private generation = 0
  private loadGeneration = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  /**
   * Model ids pi-ai's installed `openai-codex` catalog describes, as the last
   * load read them; `undefined` when that read failed, so no Codex write can
   * mistake an unread catalog for an empty one.
   */
  private codexCatalog: ReadonlySet<string> | undefined = new Set()

  constructor(
    private readonly api: Pick<IApiClient, 'nativeAccounts' | 'settings' | 'llm'>,
    private readonly settings: SettingsDescribeFace,
    private readonly onEnabled: () => void,
  ) {}

  /**
   * Load on mount; leaving the card cancels its own attempt only.
   * @returns the unmount step that cancels this card's attempt.
   */
  watch(): () => void {
    void this.load()
    return () => { void this.cancel() }
  }

  /** Refresh sanitized account status and how each chat route serves its account's roster. */
  async load(): Promise<void> {
    const generation = ++this.loadGeneration
    this.store.update((state) => { state.loading = true; state.error = null })
    try {
      const [{ accounts }] = await Promise.all([answered(this.api.nativeAccounts.describe({})), this.settings.ensure()])
      let catalog: ReadonlySet<string> | undefined
      let catalogFailure: unknown
      try {
        catalog = await this.readCodexCatalog(accounts)
      } catch (error) {
        catalogFailure = error
      }
      if (this.disposed || generation !== this.loadGeneration) return
      this.codexCatalog = catalog
      const routes: State['routes'] = {}
      for (const provider of Object.keys(CHAT_ROUTES) as NativeAccountProvider[]) {
        const roster = rosterOf(accounts, provider)
        if (roster === undefined || (provider === 'codex' && catalog === undefined)) continue
        const namespace = this.namespaceOf(provider)
        routes[provider] = storedRoute(namespace?.value, CHAT_ROUTES[provider].route) === undefined ? 'absent'
          : this.routeWrite(provider, roster, namespace) === undefined ? 'current' : 'stale'
      }
      this.store.update((state) => {
        state.accounts = accounts
        state.routes = routes
      })
      if (catalogFailure !== undefined) this.error(catalogFailure)
    } catch (error) {
      if (!this.disposed && generation === this.loadGeneration) this.error(error)
    } finally {
      if (!this.disposed && generation === this.loadGeneration) this.store.update((state) => { state.loading = false })
    }
  }

  /**
   * Begin one native sign-in; the Host supplies the link, code, expiry, and polling cadence.
   * @param provider - the native tool to sign in.
   * @param mode - browser or device-code sign-in, as the tool offers.
   */
  async begin(provider: NativeAccountProvider, mode: NativeLoginMode): Promise<void> {
    this.store.update((state) => { state.attempt = null })
    await this.advance(() => this.api.nativeAccounts.begin({ provider, mode }), true)
  }

  /**
   * Answer the line the attempt requested, a code or the browser's return
   * address; the store never retains it.
   * @param code - the one line the person pasted.
   */
  async submit(code: string): Promise<void> {
    const attempt = this.store.getSnapshot().attempt
    if (!pending(attempt) || attempt.input === undefined) return
    await this.advance(() => this.api.nativeAccounts.submit({ attemptId: attempt.id, code }))
  }

  /** Stop polling and cancel only the login capability this controller owns. */
  async cancel(): Promise<void> {
    const generation = ++this.generation
    this.clearTimer()
    const attempt = this.store.getSnapshot().attempt
    if (!this.disposed) this.store.update((state) => { state.busy = false })
    if (!pending(attempt)) return
    try {
      const { attempt: outcome } = await answered(this.api.nativeAccounts.cancel({ attemptId: attempt.id }))
      if (!this.disposed && generation === this.generation) this.store.update((state) => { state.attempt = outcome })
    } catch (error) {
      if (!this.disposed) this.error(error)
    }
  }

  /**
   * Bring one product's chat route up to the signed-in account's roster. A
   * missing Claude route is created with the whole roster under its preset
   * name. An existing route keeps every model it lists and every field an
   * operator wrote, except that a roster model's effort levels follow the
   * roster, and gains the roster models it lacks. A Codex route must already
   * exist, because its credential is the separate OpenAI chat authorization,
   * not the native Codex sign-in.
   * @param provider - the native product whose roster feeds the route.
   */
  async enable(provider: NativeAccountProvider): Promise<void> {
    const roster = rosterOf(this.store.getSnapshot().accounts, provider)
    if (roster === undefined) return
    this.store.update((state) => { state.busy = true; state.error = null })
    try {
      await this.settings.ensure()
      const mirror = this.settings.getSnapshot()
      const namespace = this.namespaceOf(provider)
      if (!mirror.view?.writable || namespace === undefined) throw new Error('Native model settings are unavailable or read-only')
      const ops = this.routeWrite(provider, roster, namespace)
      if (ops === undefined) return
      const view = await answered(this.api.settings.mutate({ ns: namespace.ns, expectedRevision: namespace.revision, ops }))
      if (this.disposed) return
      this.settings.acceptView(view)
      await this.load()
      this.onEnabled()
    } catch (error) {
      if (!this.disposed) this.error(error)
    } finally {
      if (!this.disposed) this.store.update((state) => { state.busy = false })
    }
  }

  /**
   * The settings namespace that holds one product's chat route.
   * @param provider - the native product.
   * @returns the namespace view, or `undefined` when the mirror carries none.
   */
  private namespaceOf(provider: NativeAccountProvider): SettingsNamespaceView | undefined {
    return this.settings.getSnapshot().view?.namespaces.find(row => row.ns === CHAT_ROUTES[provider].ns)
  }

  /**
   * The path edits that bring an account's chat route up to its roster:
   * missing roster models are added, and a model the roster names takes the
   * effort levels the roster reports for it. The edits name only the fields
   * they change, because the settings view omits secret fields. A Codex route
   * that lists no models serves pi-ai's installed catalog and takes the
   * levels as `modelOverrides`; only a roster model outside the catalog makes
   * the edits list the catalog explicitly, with the overrides folded into the
   * list, because the route refuses overrides beside a list.
   * @param provider - the native product.
   * @param models - its connected subscription account's roster.
   * @param namespace - the namespace holding the route, when the mirror carries it.
   * @returns the edits, or `undefined` when the route already serves the roster
   *   or, for Codex, does not exist or the last load could not read the catalog.
   */
  private routeWrite(
    provider: NativeAccountProvider, models: readonly NativeAccountModel[], namespace: SettingsNamespaceView | undefined,
  ): RouteWrite | undefined {
    const { route } = CHAT_ROUTES[provider]
    const stored = storedRoute(namespace?.value, route)
    if (provider === 'claude-code') {
      const entries = claudeRouteEntries(models)
      if (stored === undefined) return [{ op: 'set', path: ['providers', route], value: { models: entries } }]
      const listed = storedModels(stored)
      return listWrite(listed, reconciledModels(listed, entries, 'efforts'), route)
    }
    const catalog = this.codexCatalog
    if (stored === undefined || catalog === undefined) return undefined
    const entries = codexRouteEntries(models, catalog)
    const listed = storedModels(stored)
    if (listed.length > 0) return listWrite(listed, reconciledModels(listed, entries, 'reasoningEfforts'), route)
    if (entries.every(entry => catalog.has(entry.id))) {
      const stale = staleOverrides(stored.modelOverrides, entries)
      return stale.length === 0 ? undefined : stale.map(entry => ({
        op: 'set', path: ['providers', route, 'modelOverrides', entry.id, 'reasoningEfforts'], value: entry.reasoningEfforts,
      }))
    }
    const pin: RouteWrite = [{
      op: 'set', path: ['providers', route, 'models'],
      value: reconciledModels(pinnedCatalog(catalog, stored.modelOverrides), entries, 'reasoningEfforts'),
    }]
    return stored.modelOverrides === undefined ? pin : [{ op: 'unset', path: ['providers', route, 'modelOverrides'] }, ...pin]
  }

  /**
   * Model ids pi-ai's installed catalog describes for the Codex chat route,
   * read only when a connected Codex subscription could feed that route.
   * @param accounts - the accounts this load read.
   * @returns the catalog ids; empty when no Codex roster needs them.
   */
  private async readCodexCatalog(accounts: readonly NativeAccountView[]): Promise<ReadonlySet<string>> {
    const { ns, route } = CHAT_ROUTES.codex
    if (rosterOf(accounts, 'codex') === undefined) return new Set()
    if (storedRoute(this.settings.getSnapshot().view?.namespaces.find(row => row.ns === ns)?.value, route) === undefined) return new Set()
    const { models } = await answered(this.api.llm.discoverModels({ settingsNs: ns, provider: route }))
    return new Set(models.map(model => model.id))
  }

  /** Unload the plugin and revoke its owned login attempt. */
  dispose(): void {
    this.disposed = true
    ++this.loadGeneration
    void this.cancel()
  }

  /**
   * Apply one attempt-changing call if no later call superseded it. A start
   * that answers after it was superseded or the plugin unloaded is cancelled,
   * because nothing else holds its capability.
   */
  private async advance(request: () => ReturnType<Api['begin']>, cancelLateStart = false): Promise<void> {
    const generation = ++this.generation
    this.clearTimer()
    this.store.update((state) => { state.busy = true; state.error = null })
    try {
      const { attempt } = await answered(request())
      if (this.disposed || generation !== this.generation) {
        if (cancelLateStart && pending(attempt)) await this.api.nativeAccounts.cancel({ attemptId: attempt.id })
        return
      }
      this.accept(attempt, generation)
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.error(error)
    } finally {
      if (!this.disposed && generation === this.generation) this.store.update((state) => { state.busy = false })
    }
  }

  private accept(attempt: NativeAccountAttempt, generation: number): void {
    this.store.update((state) => { state.attempt = attempt })
    if (pending(attempt)) {
      this.timer = setTimeout(() => { void this.poll(attempt, generation) }, attempt.pollAfterMs)
    } else {
      void this.load()
    }
  }

  private async poll(attempt: NativeAccountAttempt, generation: number): Promise<void> {
    try {
      const { attempt: progress } = await answered(this.api.nativeAccounts.poll({ attemptId: attempt.id }))
      if (!this.disposed && generation === this.generation) this.accept(progress, generation)
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.error(error)
    }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private error(error: unknown): void { this.store.update((state) => { state.error = messageOf(error) }) }
}

/**
 * The edit that stores a route's reconciled model list.
 * @param listed - the list the route stores.
 * @param list - the reconciled list, holding each unchanged entry as the stored object.
 * @param route - the route id.
 * @returns the edit, or `undefined` when the reconciled list holds exactly the stored entries.
 */
function listWrite(listed: readonly unknown[], list: readonly unknown[], route: string): RouteWrite | undefined {
  const unchanged = list.length === listed.length && list.every((entry, index) => entry === listed[index])
  return unchanged ? undefined : [{ op: 'set', path: ['providers', route, 'models'], value: list }]
}
