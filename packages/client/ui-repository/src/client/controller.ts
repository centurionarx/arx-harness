/** React-free repository reads; aborted generations never publish late replies. */
import type { HostObservable } from '@arx-ai/arx-client-ui-slots'
import type { WorkspaceId } from '@arx-ai/arx-client-runtime/client'
import type { RepositoryRequest, RepositoryDiffRequest, RepositoryInspection, RepositoryStatus, RepositoryDiff } from '@arx-ai/arx-repository/types'

/** Private read port; the apply closure unwraps generated Remote envelopes. */
export interface RepositoryReads {
  inspect(request: RepositoryRequest, signal: AbortSignal): Promise<RepositoryInspection>
  status(request: RepositoryRequest, signal: AbortSignal): Promise<RepositoryStatus>
  diff(request: RepositoryDiffRequest, signal: AbortSignal): Promise<RepositoryDiff>
}
/** Immutable facts of the current workspace and comparison. */
export interface RepositoryView {
  workspaceId: WorkspaceId | null
  phase: 'cold' | 'loading' | 'ready' | 'error' | 'not-repository' | 'stale'
  inspection: RepositoryInspection | null
  status: RepositoryStatus | null
  error: string | null
  comparison: { request: RepositoryDiffRequest; phase: 'loading' | 'ready' | 'error'; value: RepositoryDiff | null; error: string | null } | null
}
const empty = (workspaceId: WorkspaceId | null): RepositoryView => ({
  workspaceId, phase: 'cold', inspection: null, status: null, error: null, comparison: null,
})

/** One mounted repository entry owns all pending reads and its stable source. */
export class RepositoryController implements HostObservable<RepositoryView> {
  private view = empty(null)
  private readonly listeners = new Set<() => void>()
  private readonly pending = new Set<Promise<void>>()
  private load: AbortController | null = null
  private comparison: AbortController | null = null
  private disposed = false
  private scheduled = false
  constructor(private readonly reads: RepositoryReads) {}
  /** Cached snapshot; identity changes only on publication. */
  getSnapshot = (): RepositoryView => this.view
  /** Framework binding owns this subscription. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(view: RepositoryView): void {
    this.view = view
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      for (const listener of this.listeners) {
        try { listener() }
        catch (error) { console.error('repository subscriber failed', error) }
      }
    })
  }
  private track(work: Promise<void>): Promise<void> {
    this.pending.add(work)
    void work.finally(() => { this.pending.delete(work) })
    return work
  }
  /** Select only a registered workspace supplied by the entry, without polling.
   * @param workspaceId - Registered workspace, or null to clear selection.
   */
  select(workspaceId: WorkspaceId | null): void {
    if (this.disposed) return
    this.cancel()
    this.publish(empty(workspaceId))
  }
  /** Abort on unmount, selection, provider reset, or a superseding refresh. */
  cancel(): void {
    this.load?.abort()
    this.comparison?.abort()
    this.load = null
    this.comparison = null
  }
  /** Reconnect invalidates the facts; the user explicitly refreshes them. */
  invalidate(): void {
    if (this.disposed) return
    this.cancel()
    this.publish({ ...empty(this.view.workspaceId), phase: 'stale' })
  }
  /** Read identity and status together; a partial result is never displayed. */
  refresh(): Promise<void> {
    const workspaceId = this.view.workspaceId
    if (this.disposed || workspaceId === null) return Promise.resolve()
    this.cancel()
    const operation = this.load = new AbortController()
    this.publish({ ...this.view, phase: 'loading', error: null, comparison: null })
    return this.track((async () => {
      try {
        const [inspection, status] = await Promise.allSettled([
          this.reads.inspect({ workspaceId }, operation.signal),
          this.reads.status({ workspaceId }, operation.signal),
        ])
        if (operation.signal.aborted) return
        if (inspection.status === 'rejected') throw inspection.reason
        if (status.status === 'rejected') throw status.reason
        this.publish({ workspaceId, phase: 'ready', inspection: inspection.value, status: status.value, error: null, comparison: null })
      } catch (error) {
        operation.abort()
        const message = error instanceof Error ? error.message : String(error)
        this.publish({ ...empty(workspaceId), phase: message.includes('REPOSITORY_NOT_FOUND') ? 'not-repository' : 'error', error: message })
      }
    })())
  }
  /** Read only the side whose current status group contains the selected file.
   * @param request - File and side from the current workspace status.
   * @returns Settlement of the comparison, including contained errors.
   */
  show(request: RepositoryDiffRequest): Promise<void> {
    const { status, phase, workspaceId } = this.view
    if (this.disposed || phase !== 'ready' || request.workspaceId !== workspaceId || !status
      || status.unmerged.some(entry => entry.path === request.path)
      || !status[request.side].some(entry => entry.path === request.path && entry.submodule === 'N...')) return Promise.resolve()
    this.comparison?.abort()
    const operation = this.comparison = new AbortController()
    this.publish({ ...this.view, comparison: { request, phase: 'loading', value: null, error: null } })
    return this.track((async () => {
      try {
        const value = await this.reads.diff(request, operation.signal)
        if (operation.signal.aborted) return
        this.publish({ ...this.view, comparison: { request, phase: 'ready', value, error: null } })
      } catch (error) {
        if (operation.signal.aborted) return
        this.publish({ ...this.view, comparison: { request, phase: 'error', value: null, error: error instanceof Error ? error.message : String(error) } })
      }
    })())
  }
  /** Closing the modal aborts its comparison and releases patch text. */
  close(): void {
    this.comparison?.abort()
    this.comparison = null
    if (!this.disposed) this.publish({ ...this.view, comparison: null })
  }
  /** Silence subscribers, abort every read, and wait for all carriers to settle. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.listeners.clear()
    this.cancel()
    await Promise.all(this.pending)
  }
}
