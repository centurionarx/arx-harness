/** Native account state for the Models settings card; credential material never enters the store. */
import type {
  IApiClient, NativeAccountAttempt, NativeAccountProvider, NativeAccountView, NativeLoginMode,
} from '@arx-ai/arx-api-remotes/client'
import { createSnapshotStore } from '@arx-ai/arx-client-runtime/client'
import type { SettingsDescribeFace } from '@arx-ai/arx-client-ui-settings/client'
import { messageOf } from './store.ts'

interface State {
  accounts: NativeAccountView[]
  attempt: NativeAccountAttempt | null
  enabled: NativeAccountProvider[]
  loading: boolean
  busy: boolean
  error: string | null
}

const routeOf = (provider: NativeAccountProvider): string => provider === 'claude-code' ? 'claude-subscription' : 'codex-subscription'
const pending = (attempt: NativeAccountAttempt | null): attempt is NativeAccountAttempt =>
  attempt?.state === 'starting' || attempt?.state === 'waiting'

function providers(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || !('providers' in value)) return {}
  const rows = value.providers
  return typeof rows === 'object' && rows !== null && !Array.isArray(rows) ? rows as Record<string, unknown> : {}
}

/** Controller lifetime follows the plugin, while login polling follows the mounted card. */
export class NativeAccountsStore {
  readonly store = createSnapshotStore<State>({ accounts: [], attempt: null, enabled: [], loading: false, busy: false, error: null })
  private generation = 0
  private loadGeneration = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(
    private readonly api: Pick<IApiClient, 'nativeAccounts' | 'settings'>,
    private readonly settings: SettingsDescribeFace,
    private readonly onEnabled: () => void,
  ) {}

  /** Load on entry and cancel only this card's private attempt when it leaves. */
  watch(): () => void {
    void this.load()
    return () => { void this.cancel() }
  }

  /** Refresh sanitized account status and the current route configuration. */
  async load(): Promise<void> {
    const generation = ++this.loadGeneration
    this.store.update((state) => { state.loading = true; state.error = null })
    try {
      const [response] = await Promise.all([this.api.nativeAccounts.describe({}), this.settings.ensure()])
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (this.disposed || generation !== this.loadGeneration) return
      const configured = providers(this.settings.getSnapshot().view?.namespaces.find(row => row.ns === 'llm-agent-cli')?.value)
      const accounts = response.result.value.accounts
      this.store.update((state) => {
        state.accounts = accounts
        state.enabled = accounts.filter(account => configured[routeOf(account.provider)] !== undefined).map(account => account.provider)
      })
    } catch (error) {
      if (!this.disposed && generation === this.loadGeneration) this.error(error)
    } finally {
      if (!this.disposed && generation === this.loadGeneration) this.store.update((state) => { state.loading = false })
    }
  }

  /** Begin one native login; the backend supplies the browser link, code, expiry, and polling cadence. */
  async begin(provider: NativeAccountProvider, mode: NativeLoginMode): Promise<void> {
    const generation = ++this.generation
    this.clearTimer()
    this.store.update((state) => { state.busy = true; state.error = null; state.attempt = null })
    try {
      const response = await this.api.nativeAccounts.begin({ provider, mode })
      if (!response.result.ok) throw new Error(response.result.error.message)
      const attempt = response.result.value.attempt
      if (this.disposed || generation !== this.generation) {
        if (pending(attempt)) await this.api.nativeAccounts.cancel({ attemptId: attempt.id })
        return
      }
      this.accept(attempt, generation)
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.error(error)
    } finally {
      if (!this.disposed && generation === this.generation) this.store.update((state) => { state.busy = false })
    }
  }

  /** Submit an explicitly requested one-time CLI login code without retaining it. */
  async submit(code: string): Promise<void> {
    const attempt = this.store.getSnapshot().attempt
    if (!pending(attempt) || attempt.input !== 'code') return
    const generation = ++this.generation
    this.clearTimer()
    this.store.update((state) => { state.busy = true; state.error = null })
    try {
      const response = await this.api.nativeAccounts.submit({ attemptId: attempt.id, code })
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (!this.disposed && generation === this.generation) this.accept(response.result.value.attempt, generation)
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.error(error)
    } finally {
      if (!this.disposed && generation === this.generation) this.store.update((state) => { state.busy = false })
    }
  }

  /** Stop polling and cancel only the login capability this controller owns. */
  async cancel(): Promise<void> {
    const generation = ++this.generation
    this.clearTimer()
    const attempt = this.store.getSnapshot().attempt
    if (!this.disposed) this.store.update((state) => { state.busy = false })
    if (!pending(attempt)) return
    try {
      const response = await this.api.nativeAccounts.cancel({ attemptId: attempt.id })
      if (!response.result.ok) throw new Error(response.result.error.message)
      const outcome = response.result.value.attempt
      if (!this.disposed && generation === this.generation) this.store.update((state) => { state.attempt = outcome })
    } catch (error) {
      if (!this.disposed) this.error(error)
    }
  }

  /** Enable an authenticated native route without overwriting any existing explicit profile. */
  async enable(provider: NativeAccountProvider): Promise<void> {
    if (provider !== 'claude-code') return
    const account = this.store.getSnapshot().accounts.find(row => row.provider === provider)
    if (account?.status !== 'connected' || account.authMode !== 'subscription' || !account.models?.length) return
    this.store.update((state) => { state.busy = true; state.error = null })
    try {
      await this.settings.ensure()
      const mirror = this.settings.getSnapshot()
      const namespace = mirror.view?.namespaces.find(row => row.ns === 'llm-agent-cli')
      if (!mirror.view?.writable || namespace === undefined) throw new Error('Native model settings are unavailable or read-only')
      const route = routeOf(provider)
      if (providers(namespace.value)[route] !== undefined) return
      const response = await this.api.settings.mutate({
        ns: 'llm-agent-cli', expectedRevision: namespace.revision,
        ops: [{ op: 'set', path: ['providers', route], value: {
          displayName: account.label,
          models: account.models.map(model => ({
            id: model.resolvedModel ?? model.id, name: model.name,
            ...model.efforts === undefined ? {} : {
              efforts: model.efforts.filter(effort => ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)),
            },
          })),
        } }],
      })
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (this.disposed) return
      this.settings.acceptView(response.result.value)
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
      const response = await this.api.nativeAccounts.poll({ attemptId: attempt.id })
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (!this.disposed && generation === this.generation) this.accept(response.result.value.attempt, generation)
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
