/** Native account state for the Models settings card; credential material never enters the store. */
import type {
  IApiClient, NativeAccountAttempt, NativeAccountProvider, NativeAccountView, NativeLoginMode,
} from '@arx-ai/arx-api-remotes/client'
import { createSnapshotStore } from '@arx-ai/arx-client-runtime/client'
import type { SettingsDescribeFace } from '@arx-ai/arx-client-ui-settings/client'
import { answered, configuresProvider, messageOf } from './store.ts'

type Api = IApiClient['nativeAccounts']

interface State {
  accounts: NativeAccountView[]
  attempt: NativeAccountAttempt | null
  /** Whether `llm-agent-cli` already configures the Claude subscription route. */
  routeEnabled: boolean
  loading: boolean
  busy: boolean
  error: string | null
}

/** Settings namespace of the command-line model routes. */
const AGENT_CLI_NS = 'llm-agent-cli'
/** The `llm-agent-cli` preset route that runs chat through the signed-in Claude Code account. */
const CLAUDE_ROUTE = 'claude-subscription'
/** Effort levels the `llm-agent-cli` route accepts; the product may report others. */
const ROUTE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const pending = (attempt: NativeAccountAttempt | null): attempt is NativeAccountAttempt =>
  attempt?.state === 'starting' || attempt?.state === 'waiting'

/** Controller lifetime follows the plugin, while login polling follows the mounted card. */
export class NativeAccountsStore {
  /** The card's snapshot: accounts, this card's attempt, route state, and the last failure. */
  readonly store = createSnapshotStore<State>({
    accounts: [], attempt: null, routeEnabled: false, loading: false, busy: false, error: null,
  })
  private generation = 0
  private loadGeneration = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(
    private readonly api: Pick<IApiClient, 'nativeAccounts' | 'settings'>,
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

  /** Refresh sanitized account status and the current route configuration. */
  async load(): Promise<void> {
    const generation = ++this.loadGeneration
    this.store.update((state) => { state.loading = true; state.error = null })
    try {
      const [{ accounts }] = await Promise.all([answered(this.api.nativeAccounts.describe({})), this.settings.ensure()])
      if (this.disposed || generation !== this.loadGeneration) return
      const namespace = this.settings.getSnapshot().view?.namespaces.find(row => row.ns === AGENT_CLI_NS)
      this.store.update((state) => {
        state.accounts = accounts
        state.routeEnabled = configuresProvider(namespace?.value, CLAUDE_ROUTE)
      })
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
   * Answer the code the tool requested; the store never retains it.
   * @param code - the one-line code the person pasted.
   */
  async submit(code: string): Promise<void> {
    const attempt = this.store.getSnapshot().attempt
    if (!pending(attempt) || attempt.input !== 'code') return
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
   * Configure the Claude subscription route from the signed-in account's
   * models, keeping any profile an operator already wrote. The route keeps
   * its preset display name; capacities come from the route's catalog.
   */
  async enable(): Promise<void> {
    const account = this.store.getSnapshot().accounts.find(row => row.provider === 'claude-code')
    if (account?.status !== 'connected' || account.authMode !== 'subscription' || !account.models?.length) return
    this.store.update((state) => { state.busy = true; state.error = null })
    try {
      await this.settings.ensure()
      const mirror = this.settings.getSnapshot()
      const namespace = mirror.view?.namespaces.find(row => row.ns === AGENT_CLI_NS)
      if (!mirror.view?.writable || namespace === undefined) throw new Error('Native model settings are unavailable or read-only')
      if (configuresProvider(namespace.value, CLAUDE_ROUTE)) return
      const view = await answered(this.api.settings.mutate({
        ns: AGENT_CLI_NS, expectedRevision: namespace.revision,
        ops: [{ op: 'set', path: ['providers', CLAUDE_ROUTE], value: {
          models: account.models.map(model => ({
            id: model.resolvedModel ?? model.id, name: model.name,
            ...model.efforts === undefined ? {} : { efforts: model.efforts.filter(effort => ROUTE_EFFORTS.includes(effort)) },
          })),
        } }],
      }))
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
