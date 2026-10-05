/** Private React-free account facts and caller-owned generic authorization attempts. */
import { createSnapshotStore } from '@arx-ai/arx-client-runtime/client'
import type { IApiClient, AuthorizationAttemptView, AuthorizationFlowView, RpcResponse } from '@arx-ai/arx-api-remotes/client'
import type { GithubAccountResult, GithubRepositoriesResult, GithubRepositoriesRequest, GithubRepository } from '@arx-ai/arx-github/types'

/** Read DTOs are supplied by the generated GitHub Remote, unwrapped in apply. */
export interface GithubReads {
  account: (request: {}, signal: AbortSignal) => Promise<GithubAccountResult>
  repositories: (request: GithubRepositoriesRequest, signal: AbortSignal) => Promise<GithubRepositoriesResult>
}
/** Shared account and repository metadata; private attempts and answers never enter this snapshot. */
export interface GithubView {
  phase: 'cold' | 'loading' | 'ready' | 'stale' | 'error'
  account: GithubAccountResult | null
  repositories: readonly GithubRepository[]
  nextPage: number | null
  flow: AuthorizationFlowView | null
  error: 'read' | null
}
/** Initiating settings-page metadata only; no answer is retained. */
export interface GithubAuthorizationView {
  attempt: AuthorizationAttemptView | null
  busy: boolean
  error: 'authorization' | null
}
const empty = (): GithubView => ({ phase: 'cold', account: null, repositories: [], nextPage: null, flow: null, error: null })
const active = (attempt: AuthorizationAttemptView): boolean => attempt.state === 'starting' || attempt.state === 'waiting'
async function answered<T>(pending: Promise<RpcResponse<T>>): Promise<T> {
  const { result } = await pending
  if (!result.ok) throw new Error('Authorization request failed')
  return result.value
}

/** One plugin owns shared reads; only its mounted settings page owns private authorization work. */
export class GithubController {
  private readonly source = createSnapshotStore<GithubView>(empty())
  private readonly authSource = createSnapshotStore<GithubAuthorizationView>({ attempt: null, busy: false, error: null })
  /** Stable private observable supplied only to the settings account page. */
  readonly authorizationView = {
    getSnapshot: (): GithubAuthorizationView => this.authSource.getSnapshot(),
    subscribe: (listener: () => void): (() => void) => this.authSource.subscribe(listener),
  }
  /** Stable observable reader; callers must not mutate the returned public-metadata snapshot.
   * @returns The same snapshot reference until a publication changes its state.
   */
  readonly getSnapshot = (): GithubView => this.source.getSnapshot()
  /** Stable subscription function; listeners run synchronously after a changed snapshot is committed.
   * @param listener - Framework callback notified of public-metadata changes, not called on subscription.
   * @returns A disposer that removes this listener without cancelling controller work.
   */
  readonly subscribe = (listener: () => void): (() => void) => this.source.subscribe(listener)
  private readonly pending = new Set<Promise<void>>()
  private readonly cancellations = new Map<AbortController, AuthorizationAttemptView>()
  private read: AbortController | null = null
  private auth: AbortController | null = null
  private epoch = 0
  private disposed = false
  private mounted: symbol | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(private readonly reads: GithubReads, private readonly authorization: IApiClient['authorization']) {}

  private publish(patch: Partial<GithubView>): void {
    if (!this.disposed) this.source.update((state) => { Object.assign(state, patch) })
  }
  private publishAuthorization(patch: Partial<GithubAuthorizationView>): void {
    if (!this.disposed) this.authSource.update((state) => { Object.assign(state, patch) })
  }
  private async track(work: Promise<void>): Promise<void> {
    this.pending.add(work)
    try { await work }
    finally { this.pending.delete(work) }
  }
  /** Give this mounted settings page exclusive attempt ownership, without querying account facts.
   * @returns Cleanup that releases only this mounting; older cleanup cannot cancel a replacement page.
   */
  watch(): () => void {
    const owner = Symbol()
    void this.cancel()
    this.mounted = owner
    return () => {
      if (this.mounted !== owner) return
      void this.leave()
    }
  }
  /** Revoke settings-page ownership when its declaration or mounting disappears.
   * @returns Completion of cancellation for the page's private attempt.
   */
  leave(): Promise<void> {
    this.mounted = null
    return this.cancel()
  }
  /** Clear all facts on reconnect or credential metadata invalidation; refresh stays explicit. */
  invalidate(): void {
    this.read?.abort()
    void this.cancel()
    this.publish({ ...empty(), phase: 'stale' })
  }
  /** Explicitly read account, registered PAT flow, and the first repository page.
   * @returns Completion of the shared metadata refresh.
   */
  refresh(): Promise<void> { return this.load(true) }
  /** Read account and registered PAT flow without querying repositories or requiring a workspace.
   * @returns Completion of the shared account refresh.
   */
  refreshAccount(): Promise<void> { return this.load(false) }
  private load(includeRepositories: boolean): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.read?.abort()
    void this.cancel()
    const operation = this.read = new AbortController()
    const previous = this.getSnapshot()
    this.publish({ ...empty(), phase: 'loading' })
    return this.track((async () => {
      try {
        const account = await this.reads.account({}, operation.signal)
        let flow: AuthorizationFlowView | null = null
        if (account.state !== 'unconfigured' && account.writable && account.authFlowKey !== undefined) {
          const directory = await answered(this.authorization.describe({}, operation.signal))
          flow = directory.flows.find(row => row.key === account.authFlowKey && row.writable && row.methods.some(method => method.id === 'pat')) ?? null
        }
        const page: GithubRepositoriesResult = includeRepositories && account.state === 'connected'
          ? await this.reads.repositories({ page: 1 }, operation.signal)
          : !includeRepositories && account.state === 'connected' && account.account?.id !== undefined
            && account.account.id === previous.account?.account?.id
            ? { repositories: previous.repositories, ...previous.nextPage === null ? {} : { nextPage: previous.nextPage } }
            : { repositories: [] }
        if (!operation.signal.aborted) this.publish({ phase: 'ready', account, flow, repositories: page.repositories, nextPage: page.nextPage ?? null })
      } catch {
        if (!operation.signal.aborted) this.publish({ ...empty(), phase: 'error', error: 'read' })
      }
    })())
  }
  /** Fetch only the server-provided numeric next page, preserving explicit choices. */
  more(): Promise<void> {
    const view = this.getSnapshot()
    const nextPage = view.nextPage
    if (this.disposed || view.phase !== 'ready' || view.account?.state !== 'connected' || nextPage === null) return Promise.resolve()
    this.read?.abort()
    const operation = this.read = new AbortController()
    this.publish({ phase: 'loading', error: null })
    return this.track((async () => {
      try {
        const page = await this.reads.repositories({ page: nextPage }, operation.signal)
        if (!operation.signal.aborted) this.publish({ phase: 'ready', repositories: [...view.repositories, ...page.repositories], nextPage: page.nextPage ?? null })
      } catch {
        if (!operation.signal.aborted) this.publish({ phase: 'ready', error: 'read' })
      }
    })())
  }
  /** Start PAT only when both account and registered method permit local record writes. */
  begin(): Promise<void> {
    const { account, flow } = this.getSnapshot()
    const { attempt, busy } = this.authorizationView.getSnapshot()
    if (!this.mounted || this.disposed || busy || (attempt !== null && active(attempt)) || account?.state === 'unconfigured' || !account?.writable || flow === null) return Promise.resolve()
    return this.advance(signal => this.authorization.begin({ key: flow.key, method: 'pat' }, signal), true)
  }
  /** Submit the owned prompt revision without retaining the answer.
   * @param answer - Component-local answer, cleared before this call.
   */
  submit(answer: string): Promise<void> {
    const { attempt, busy } = this.authorizationView.getSnapshot()
    const prompt = attempt?.prompt
    if (!this.mounted || this.disposed || busy || attempt?.state !== 'waiting' || prompt === undefined) return Promise.resolve()
    return this.advance(signal => this.authorization.submit({ attemptId: attempt.id, promptId: prompt.id, answer }, signal))
  }
  /** Cancel only the private attempt id minted for this entry; pending starts cancel on arrival. */
  cancel(): Promise<void> {
    ++this.epoch
    clearTimeout(this.timer)
    this.auth?.abort()
    const attempt = this.authorizationView.getSnapshot().attempt
    this.publishAuthorization({ attempt: null, busy: false, error: null })
    if (attempt === null || !active(attempt)) return Promise.resolve()
    return this.track(this.cancelOwned(attempt))
  }
  private async cancelOwned(attempt: AuthorizationAttemptView): Promise<void> {
    const operation = new AbortController()
    this.cancellations.set(operation, attempt)
    try { await this.authorization.cancel({ attemptId: attempt.id }, operation.signal) }
    catch { /* Transport teardown can reject cancellation; no secret or cross-tab fallback is retained. */ }
    finally { this.cancellations.delete(operation) }
  }
  private advance(request: (signal: AbortSignal) => ReturnType<IApiClient['authorization']['begin']>, lateStart = false): Promise<void> {
    const epoch = ++this.epoch
    clearTimeout(this.timer)
    const operation = this.auth = new AbortController()
    this.publishAuthorization({ busy: true, error: null })
    return this.track((async () => {
      try {
        const { attempt } = await answered(request(operation.signal))
        if (this.disposed || !this.mounted || epoch !== this.epoch) {
          if (lateStart && active(attempt)) await this.cancelOwned(attempt)
          return
        }
        this.publishAuthorization({ attempt })
        if (active(attempt)) this.timer = setTimeout(() => {
          void this.advance(signal => this.authorization.poll({ attemptId: attempt.id }, signal))
        }, attempt.pollAfterMs)
      } catch {
        if (epoch === this.epoch) this.publishAuthorization({ error: 'authorization' })
      } finally {
        if (epoch === this.epoch) this.publishAuthorization({ busy: false })
      }
    })())
  }
  /** Abort and join every carrier operation, including late-start cancellation, before returning. */
  async dispose(): Promise<void> {
    this.mounted = null
    this.read?.abort()
    const interrupted = [...this.cancellations.values()]
    for (const operation of this.cancellations.keys()) operation.abort()
    // Retry private IDs with fresh signals so disposal-owned and late-start cleanup can reach the server.
    const cancellation = this.cancel()
    this.disposed = true
    await Promise.all([cancellation, ...interrupted.map(attempt => this.cancelOwned(attempt))])
    while (this.pending.size !== 0) await Promise.allSettled([...this.pending])
  }
}
