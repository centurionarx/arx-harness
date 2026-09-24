/** Global model selection before a Workspace has created a session. */
import type { IApiClient, ModelSelection } from '@arx-ai/arx-api-remotes/client'
import { createSnapshotStore } from '@arx-ai/arx-client-runtime/client'
import type { SettingsDescribeFace } from '@arx-ai/arx-client-ui-settings/client'
import type { ModelDirectoryState } from './directory.ts'

const NAMESPACE = 'agent-default-model'

/** Plugin-owned controller; uses the existing catalog and settings document contracts. */
export class DefaultModelDirectory {
  readonly store = createSnapshotStore<ModelDirectoryState>({
    current: null, routable: null, groups: [], failures: [], status: 'idle', error: null,
  })
  private generation = 0
  private disposed = false

  constructor(
    private readonly api: Pick<IApiClient, 'llm' | 'settings'>,
    private readonly settings: SettingsDescribeFace,
  ) {}

  /** Refresh the global catalog and the current default without creating a session. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    try {
      const [response] = await Promise.all([this.api.llm.models({}), this.settings.ensure()])
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (this.disposed || generation !== this.generation) return
      const value = this.settings.getSnapshot().view?.namespaces.find(row => row.ns === NAMESPACE)?.value
      const current = typeof value === 'object' && value !== null
        && 'provider' in value && typeof value.provider === 'string'
        && 'model' in value && typeof value.model === 'string'
        ? { provider: value.provider, model: value.model,
          ...'reasoningEffort' in value && typeof value.reasoningEffort === 'string' ? { reasoningEffort: value.reasoningEffort } : {} }
        : null
      const { groups, failures } = response.result.value
      this.store.update((state) => {
        state.current = current
        state.groups = groups
        state.failures = failures
        state.status = 'ready'
      })
    } catch (error) {
      this.fail(generation, error)
      throw error
    }
  }

  /** Save a complete default, clearing any reasoning effort belonging to the previous model. */
  async select(selection: ModelSelection): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'selecting'; state.error = null })
    try {
      await this.settings.ensure()
      const snapshot = this.settings.getSnapshot()
      const namespace = snapshot.view?.namespaces.find(row => row.ns === NAMESPACE)
      if (!snapshot.view?.writable || namespace === undefined) throw new Error('Default model settings are unavailable or read-only')
      const response = await this.api.settings.replace({
        ns: NAMESPACE, expectedRevision: namespace.revision, section: { ...selection },
      })
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (this.disposed || generation !== this.generation) return
      this.settings.acceptView(response.result.value)
      this.store.update((state) => { state.current = selection; state.status = 'ready' })
    } catch (error) {
      this.fail(generation, error)
      throw error
    }
  }

  /** Ignore late settlements after the owning plugin unloads. */
  dispose(): void { this.disposed = true }

  private fail(generation: number, error: unknown): void {
    if (this.disposed || generation !== this.generation) return
    this.store.update((state) => {
      state.status = 'error'
      state.error = error instanceof Error ? error.message : String(error)
    })
  }
}
