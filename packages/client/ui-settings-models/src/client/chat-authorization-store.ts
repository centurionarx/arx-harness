/** OpenAI Codex chat authorization is independent of the Codex native-agent account. */
import type { AuthorizationAttemptView, AuthorizationFlowView, IApiClient } from '@arx-ai/arx-api-remotes/client'
import { createSnapshotStore } from '@arx-ai/arx-client-runtime/client'
import type { SettingsDescribeFace } from '@arx-ai/arx-client-ui-settings/client'
import { messageOf } from './store.ts'

interface State {
  flow: AuthorizationFlowView | null
  attempt: AuthorizationAttemptView | null
  enabled: boolean
  busy: boolean
  error: string | null
}
const active = (attempt: AuthorizationAttemptView): boolean => attempt.state === 'starting' || attempt.state === 'waiting'

/** One owned chat-authorization capability, polling only while its settings card is mounted. */
export class ChatAuthorizationStore {
  readonly store = createSnapshotStore<State>({ flow: null, attempt: null, enabled: false, busy: false, error: null })
  private epoch = 0
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly api: Pick<IApiClient, 'authorization' | 'settings'>,
    private readonly settings: SettingsDescribeFace,
    private readonly onEnabled: () => void,
  ) {}

  /** Fetch the registered flow; no hardcoded token or account storage path is consulted. */
  async load(): Promise<boolean> {
    try {
      const response = await this.api.authorization.describe({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      await this.settings.ensure()
      if (this.disposed) return false
      const flow = response.result.value.flows.find(candidate => candidate.key === 'llm-pi-ai/openai-codex') ?? null
      const namespace = this.settings.getSnapshot().view?.namespaces.find(row => row.ns === 'llm-pi-ai')
      this.store.update((state) => { state.flow = flow; state.enabled = this.hasRoute(namespace?.value) })
      return true
    } catch (error) { this.fail(error); return false }
  }

  /** Mount-time observation; leaving the card cancels its own attempt only. */
  watch(): () => void { void this.load(); return () => { void this.cancel() } }

  /** Start the installed provider's OAuth flow for chat. */
  begin(): void {
    const flow = this.store.getSnapshot().flow
    if (flow === null || !flow.writable || !flow.methods.some(method => method.id === 'oauth')) return
    void this.advance(() => this.api.authorization.begin({ key: flow.key, method: 'oauth' }), true)
  }

  /** Submit the current prompt revision, clearing the answer at the component boundary. */
  submit(answer: string): void {
    const attempt = this.store.getSnapshot().attempt
    const prompt = attempt?.prompt
    if (attempt === null || prompt === undefined) return
    void this.advance(() => this.api.authorization.submit({ attemptId: attempt.id, promptId: prompt.id, answer }))
  }

  /** Explicitly enable the OAuth-backed provider, preserving any existing model overrides. */
  async enable(): Promise<void> {
    try {
      if (!await this.load()) return
      const flow = this.store.getSnapshot().flow
      if (flow?.configured !== true || flow.kind !== 'grant') throw new Error('Connect your OpenAI subscription account first')
      const mirror = this.settings.getSnapshot()
      const namespace = mirror.view?.namespaces.find(row => row.ns === 'llm-pi-ai')
      if (!mirror.view?.writable || namespace === undefined) throw new Error('Chat model settings are unavailable or read-only')
      if (this.hasRoute(namespace.value)) return
      const response = await this.api.settings.mutate({ ns: 'llm-pi-ai', expectedRevision: namespace.revision,
        ops: [{ op: 'set', path: ['providers', 'openai-codex'], value: {} }],
      })
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (this.disposed) return
      this.settings.acceptView(response.result.value)
      this.store.update((state) => { state.enabled = true })
      this.onEnabled()
    } catch (error) { this.fail(error) }
  }

  /** Cancel the caller-owned interaction and its timer. */
  async cancel(): Promise<void> {
    const epoch = ++this.epoch
    clearTimeout(this.timer)
    const attempt = this.store.getSnapshot().attempt
    if (!this.disposed) this.store.update((state) => { state.busy = false })
    if (attempt === null || !active(attempt)) return
    try {
      const response = await this.api.authorization.cancel({ attemptId: attempt.id })
      if (!response.result.ok) throw new Error(response.result.error.message)
      const outcome = response.result.value.attempt
      if (!this.disposed && epoch === this.epoch) this.store.update((state) => { state.attempt = outcome })
    } catch (error) { this.fail(error) }
  }

  /** Stop owned work on plugin disposal. */
  dispose(): void { this.disposed = true; void this.cancel() }

  private async advance(request: () => ReturnType<IApiClient['authorization']['begin']>, cancelLateStart = false): Promise<void> {
    const epoch = ++this.epoch
    clearTimeout(this.timer)
    this.store.update((state) => { state.busy = true; state.error = null })
    try {
      const response = await request()
      if (!response.result.ok) throw new Error(response.result.error.message)
      const attempt = response.result.value.attempt
      if (this.disposed || epoch !== this.epoch) {
        if (cancelLateStart && active(attempt)) await this.api.authorization.cancel({ attemptId: attempt.id })
        return
      }
      this.store.update((state) => { state.attempt = attempt })
      if (active(attempt)) {
        this.timer = setTimeout(() => {
          void this.advance(() => this.api.authorization.poll({ attemptId: attempt.id }))
        }, attempt.pollAfterMs)
      } else if (attempt.state === 'authorized') {
        await this.enable()
      }
    } catch (error) { if (epoch === this.epoch) this.fail(error) }
    finally { if (!this.disposed && epoch === this.epoch) this.store.update((state) => { state.busy = false }) }
  }

  private hasRoute(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || !('providers' in value)) return false
    return typeof value.providers === 'object' && value.providers !== null && 'openai-codex' in value.providers
  }

  private fail(error: unknown): void { if (!this.disposed) this.store.update((state) => { state.error = messageOf(error) }) }
}
