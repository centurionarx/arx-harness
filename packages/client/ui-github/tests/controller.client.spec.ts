import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GithubAccountResult } from '@arx-ai/arx-github/types'
import type { AuthorizationAttemptView, RpcResponse, RpcId } from '@arx-ai/arx-api-remotes/client'
import { GithubController } from '../src/client/controller.ts'
import { createGithubViewStore } from '../src/client/store.ts'
import { account, attempt, auth, deferred, flow, gid, reads, reply, repository } from './fixtures.client.ts'
const controllers: GithubController[] = []
afterEach(async () => { vi.useRealTimers(); for (const controller of controllers.splice(0)) await controller.dispose() })
function setup(overrides: Parameters<typeof reads>[0] = {}) {
  const carrier = auth()
  const controller = new GithubController(reads(overrides), carrier)
  controllers.push(controller)
  return { controller, carrier }
}
describe('GitHub metadata', () => {
  it('keeps snapshot/source identities stable until facts change', async () => {
    const { controller } = setup()
    const before = controller.getSnapshot()
    expect(controller.getSnapshot()).toBe(before)
    const listener = vi.fn(); const unsubscribe = controller.subscribe(listener)
    await controller.refresh()
    expect(controller.getSnapshot()).not.toBe(before)
    expect(controller.getSnapshot().account).toEqual(account)
    unsubscribe()
  })
  it('does not query during mount', () => {
    const read = vi.fn(reads().account); const { controller } = setup({ account: read })
    controller.watch()(); expect(read).not.toHaveBeenCalled()
  })
  it.each(['unconfigured', 'disconnected'] as const)('shows %s without repository reads', async (state) => {
    const repoRead = vi.fn(reads().repositories)
    const { controller, carrier } = setup({ account: async () => ({ state, writable: false }), repositories: repoRead })
    await controller.refresh(); expect(controller.getSnapshot().account?.state).toBe(state)
    expect(repoRead).not.toHaveBeenCalled(); expect(carrier.describe).not.toHaveBeenCalled()
    controller.watch(); await controller.begin(); expect(carrier.begin).not.toHaveBeenCalled()
  })
  it('requires a registered PAT method', async () => {
    const { controller, carrier } = setup()
    carrier.describe.mockResolvedValue(reply({ flows: [{ ...flow, methods: [{ id: 'oauth', label: 'OAuth' }] }] }))
    controller.watch(); await controller.refresh(); await controller.begin()
    expect(carrier.begin).not.toHaveBeenCalled()
  })
  it('requires a writable registered flow', async () => {
    const { controller, carrier } = setup(); carrier.describe.mockResolvedValue(reply({ flows: [{ ...flow, writable: false }] }))
    await controller.refresh(); expect(controller.getSnapshot().flow).toBeNull()
  })
  it('never offers auth for readonly reference credentials', async () => {
    const { controller, carrier } = setup({ account: async () => ({ ...account, writable: false }) })
    controller.watch(); await controller.refresh(); await controller.begin(); expect(carrier.describe).not.toHaveBeenCalled()
  })
  it('bounds pagination to the server numeric continuation', async () => {
    const fetch = vi.fn(reads().repositories).mockResolvedValueOnce({ repositories: [repository], nextPage: 3 }).mockResolvedValueOnce({ repositories: [{ ...repository, id: gid('10') }] })
    const { controller } = setup({ repositories: fetch })
    await controller.more(); expect(fetch).not.toHaveBeenCalled()
    await controller.refresh(); await controller.more(); await controller.more()
    expect(fetch.mock.calls.map(call => call[0].page)).toEqual([1, 3]); expect(controller.getSnapshot().repositories).toHaveLength(2)
  })
  it('retains metadata when pagination fails', async () => {
    const fetch = vi.fn(reads().repositories).mockResolvedValueOnce({ repositories: [repository], nextPage: 2 }).mockRejectedValueOnce(new Error('external'))
    const { controller } = setup({ repositories: fetch }); await controller.refresh(); await controller.more()
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', error: 'read', repositories: [repository] })
  })
  it('clears connected facts when the next account read fails', async () => {
    const fetch = vi.fn(reads().account).mockResolvedValueOnce(account).mockRejectedValueOnce(new Error('bad credential'))
    const { controller } = setup({ account: fetch }); await controller.refresh(); await controller.refresh()
    expect(controller.getSnapshot()).toMatchObject({ phase: 'error', account: null, repositories: [], error: 'read' })
  })
  it('does not publish old account replies after reconnect', async () => {
    const old = deferred<GithubAccountResult>(); const { controller } = setup({ account: () => old.promise })
    const pending = controller.refresh(); controller.invalidate(); old.resolve(account); await pending
    expect(controller.getSnapshot()).toMatchObject({ phase: 'stale', account: null })
  })
  it('does not publish aborted read failures', async () => {
    const old = deferred<GithubAccountResult>(); const { controller } = setup({ account: () => old.promise })
    const pending = controller.refresh(); controller.invalidate(); old.reject(new Error('late')); await pending
    expect(controller.getSnapshot().error).toBeNull()
  })
  it('fresh refresh wins over superseded work', async () => {
    const old = deferred<GithubAccountResult>(); const fetch = vi.fn(reads().account).mockImplementationOnce(() => old.promise)
    const { controller } = setup({ account: fetch })
    const pending = controller.refresh()
    await controller.refresh()
    old.resolve({ state: 'disconnected', writable: false })
    await pending
    expect(controller.getSnapshot().account?.state).toBe('connected')
  })
  it('joins ignored aborts before dispose returns and never late-publishes', async () => {
    const old = deferred<GithubAccountResult>(); const { controller } = setup({ account: () => old.promise })
    const pending = controller.refresh(); let done = false; const disposing = controller.dispose().then(() => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)
    const before = controller.getSnapshot()
    old.resolve(account)
    await disposing
    await pending
    expect(controller.getSnapshot()).toBe(before); await controller.refresh(); await controller.more()
  })
  it('keeps only explicit IDs in isolated viewing stores', () => {
    const one = createGithubViewStore().create(); const two = createGithubViewStore().create()
    one.actions.selectRepository(gid('9'))
    expect(one.getSnapshot()).toEqual({ repositoryId: '9' })
    expect(two.getSnapshot()).toEqual({ repositoryId: null })
    one.actions.selectRepository(null); expect(one.getSnapshot().repositoryId).toBeNull()
  })
})
describe('remaining lifecycle paths', () => {
  it('aborts an already-running cancellation, retries its private ID with a live signal, and joins both carriers', async () => {
    const { controller, carrier } = setup(); controller.watch(); await controller.refresh(); await controller.begin()
    const old = deferred<RpcResponse<{ attempt: AuthorizationAttemptView }>>()
    const fresh = deferred<RpcResponse<{ attempt: AuthorizationAttemptView }>>()
    carrier.cancel.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const canceling = controller.cancel()
    expect(carrier.cancel.mock.calls[0]![1]?.aborted).toBe(false)
    let done = false
    const disposal = controller.dispose().then(() => { done = true })
    expect(carrier.cancel.mock.calls[0]![1]?.aborted).toBe(true)
    expect(carrier.cancel.mock.calls[1]![1]?.aborted).toBe(false)
    expect(carrier.cancel.mock.calls[1]![0]).toEqual({ attemptId: attempt.id })
    old.resolve(reply({ attempt: { ...attempt, state: 'cancelled' } })); await canceling
    expect(done).toBe(false)
    fresh.resolve(reply({ attempt: { ...attempt, state: 'cancelled' } })); await disposal
    expect(controller.authorizationView.getSnapshot().attempt).toBeNull()
  })
  it.each(['resolve', 'reject'] as const)('aborts in-flight pagination before its %s reply', async (outcome) => {
    const late = deferred<Awaited<ReturnType<ReturnType<typeof reads>['repositories']>>>()
    const fetch = vi.fn(reads().repositories).mockImplementationOnce(async () => ({ repositories: [repository], nextPage: 2 }))
      .mockImplementationOnce(() => late.promise)
    const { controller } = setup({ repositories: fetch })
    await controller.refresh(); const pending = controller.more(); controller.invalidate()
    if (outcome === 'resolve') late.resolve({ repositories: [repository] })
    else late.reject(new Error('late pagination'))
    await pending; expect(controller.getSnapshot()).toMatchObject({ phase: 'stale', repositories: [], error: null })
  })
  it('rejects duplicate start gestures while busy or while an owned attempt waits', async () => {
    const { controller, carrier } = setup(); controller.watch(); await controller.refresh()
    const pending = controller.begin(); await controller.begin(); await pending; await controller.begin()
    expect(carrier.begin).toHaveBeenCalledTimes(1)
  })
  it('does not cancel a terminal late authorization response', async () => {
    const { controller, carrier } = setup(); controller.watch(); await controller.refresh()
    const late = deferred<RpcResponse<{ attempt: AuthorizationAttemptView }>>()
    carrier.begin.mockReturnValue(late.promise); const pending = controller.begin(); await controller.cancel()
    late.resolve(reply({ attempt: { ...attempt, state: 'authorized' } })); await pending
    expect(carrier.cancel).not.toHaveBeenCalled(); expect(controller.authorizationView.getSnapshot().attempt).toBeNull()
  })
  it('never publishes a late submitted prompt after caller cancellation', async () => {
    const { controller, carrier } = setup(); controller.watch(); await controller.refresh(); await controller.begin()
    const late = deferred<RpcResponse<{ attempt: AuthorizationAttemptView }>>()
    carrier.submit.mockReturnValue(late.promise); const pending = controller.submit('local answer'); await controller.cancel()
    late.resolve(reply({ attempt })); await pending; expect(controller.authorizationView.getSnapshot().attempt).toBeNull()
    expect(carrier.cancel).toHaveBeenCalledTimes(1)
  })
})
describe('owned authorization', () => {
  async function ready() { const fixture = setup(); fixture.controller.watch(); await fixture.controller.refresh(); return fixture }
  it('requires mounted ownership', async () => {
    const { controller, carrier } = setup(); await controller.refresh(); await controller.begin(); await controller.submit('not accepted')
    expect(carrier.begin).not.toHaveBeenCalled(); expect(carrier.submit).not.toHaveBeenCalled()
  })
  it('submits the valid private prompt ID without retaining the draft', async () => {
    const { controller, carrier } = await ready(); await controller.begin(); await controller.submit('human-only')
    expect(carrier.begin.mock.calls[0]![0]).toEqual({ key: flow.key, method: 'pat' })
    expect(carrier.submit.mock.calls[0]![0]).toEqual({ attemptId: attempt.id, promptId: attempt.prompt!.id, answer: 'human-only' })
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('human-only')
    expect(controller.getSnapshot().account?.state).toBe('connected')
  })
  it('authorization completion does not invent a connected account', async () => {
    const { controller, carrier } = setup({ account: async () => ({ state: 'disconnected', writable: true, authFlowKey: account.authFlowKey! }) })
    controller.watch(); await controller.refresh(); await controller.begin(); await controller.submit('draft')
    expect(controller.getSnapshot().account?.state).toBe('disconnected'); expect(carrier.submit).toHaveBeenCalled()
  })
  it('polls only the owned attempt while mounted', async () => {
    vi.useFakeTimers(); const { controller, carrier } = await ready(); await controller.begin()
    await vi.advanceTimersByTimeAsync(1000); expect(carrier.poll.mock.calls[0]![0]).toEqual({ attemptId: attempt.id })
    await controller.cancel(); await vi.advanceTimersByTimeAsync(5000); expect(carrier.poll).toHaveBeenCalledTimes(1)
    expect(carrier.cancel.mock.calls[0]![0]).toEqual({ attemptId: attempt.id })
  })
  it('cancels a late start and joins that carrier cancellation', async () => {
    const { controller, carrier } = await ready()
    const late = deferred<RpcResponse<{ attempt: AuthorizationAttemptView }>>()
    const cancellation = deferred<RpcResponse<{ attempt: AuthorizationAttemptView }>>()
    carrier.begin.mockReturnValue(late.promise); carrier.cancel.mockReturnValue(cancellation.promise)
    const beginning = controller.begin()
    await controller.cancel()
    let done = false
    const disposal = controller.dispose().then(() => { done = true })
    late.resolve(reply({ attempt })); await Promise.resolve(); await Promise.resolve(); expect(done).toBe(false)
    expect(carrier.cancel.mock.calls[0]![1]?.aborted).toBe(false)
    cancellation.resolve(reply({ attempt: { ...attempt, state: 'cancelled' } })); await beginning; await disposal
    expect(carrier.cancel.mock.calls[0]![0]).toEqual({ attemptId: attempt.id })
    expect(controller.authorizationView.getSnapshot().attempt).toBeNull()
  })
  it('swallows transport cancellation failures without fallback authority', async () => {
    const { controller, carrier } = await ready()
    await controller.begin()
    carrier.cancel.mockRejectedValue(new Error('offline'))
    await controller.cancel()
    expect(controller.authorizationView.getSnapshot().attempt).toBeNull()
  })
  it('contains failed authorization responses and offers explicit retry', async () => {
    const { controller, carrier } = await ready()
    carrier.begin.mockResolvedValue({ rpcId: 'fixture' as RpcId, result: { ok: false, error: { code: 'internal', message: 'failure', details: {} } } })
    await controller.begin(); expect(controller.authorizationView.getSnapshot()).toMatchObject({ busy: false, error: 'authorization' })
  })
  it('suppresses stale authorization failures after invalidation', async () => {
    const { controller, carrier } = await ready(); const late = deferred<RpcResponse<{ attempt: AuthorizationAttemptView }>>()
    carrier.begin.mockReturnValue(late.promise)
    const pending = controller.begin()
    controller.invalidate()
    late.reject(new Error('offline'))
    await pending
    expect(controller.getSnapshot()).toMatchObject({ phase: 'stale', error: null }); expect(controller.authorizationView.getSnapshot().attempt).toBeNull()
  })
  it('unmount cancels the owned attempt and clears its polling timer', async () => {
    vi.useFakeTimers()
    const { controller, carrier } = await ready()
    const unmount = controller.watch()
    await controller.begin()
    unmount()
    await vi.advanceTimersByTimeAsync(2000); expect(carrier.cancel).toHaveBeenCalledTimes(1); expect(carrier.poll).not.toHaveBeenCalled()
  })
})

describe('settings page ownership regressions', () => {
  it('an older page cleanup cannot cancel the current mounted page', async () => {
    const { controller, carrier } = setup()
    const oldPage = controller.watch()
    await controller.refresh()
    const currentPage = controller.watch()
    await controller.begin()
    oldPage()
    expect(carrier.cancel).not.toHaveBeenCalled()
    expect(controller.authorizationView.getSnapshot().attempt?.id).toBe(attempt.id)
    currentPage()
  })
})

it('settings refresh never queries repositories and publishes the same account facts to both entries', async () => {
  const repoRead = vi.fn(reads().repositories)
  const { controller } = setup({ repositories: repoRead })
  await controller.refreshAccount()
  expect(repoRead).not.toHaveBeenCalled()
  expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', account, repositories: [] })
  expect(controller.getSnapshot()).not.toHaveProperty('attempt')
  expect(controller.getSnapshot()).not.toHaveProperty('busy')
  const first = controller.authorizationView.getSnapshot()
  expect(controller.authorizationView.getSnapshot()).toBe(first)
  const listener = vi.fn(); const unsubscribe = controller.authorizationView.subscribe(listener)
  controller.watch(); await controller.begin()
  expect(listener).toHaveBeenCalled()
  expect(JSON.stringify(controller.getSnapshot())).not.toContain(attempt.id)
  unsubscribe()
})
it('page exit cancels a late begin after a new page has mounted without publishing it there', async () => {
  const { controller, carrier } = setup()
  const leave = controller.watch(); await controller.refreshAccount()
  const late = deferred<RpcResponse<{ attempt: AuthorizationAttemptView }>>()
  carrier.begin.mockReturnValueOnce(late.promise)
  const pending = controller.begin()
  leave()
  const currentPage = controller.watch()
  const current = { ...attempt, id: '88888888-8888-4888-8888-888888888888' as typeof attempt.id }
  carrier.begin.mockResolvedValueOnce(reply({ attempt: current }))
  await controller.begin()
  late.resolve(reply({ attempt })); await pending
  expect(controller.authorizationView.getSnapshot().attempt?.id).toBe(current.id)
  expect(carrier.cancel).toHaveBeenCalledWith({ attemptId: attempt.id }, expect.any(AbortSignal))
  currentPage()
})
it('late cancellation completion cannot clear a replacement page attempt', async () => {
  const { controller, carrier } = setup()
  controller.watch(); await controller.refreshAccount(); await controller.begin()
  const late = deferred<RpcResponse<{ attempt: AuthorizationAttemptView }>>()
  carrier.cancel.mockReturnValueOnce(late.promise)
  const leaving = controller.leave()
  controller.watch()
  const current = { ...attempt, id: '88888888-8888-4888-8888-888888888888' as typeof attempt.id }
  carrier.begin.mockResolvedValueOnce(reply({ attempt: current }))
  await controller.begin()
  late.resolve(reply({ attempt: { ...attempt, state: 'cancelled' } })); await leaving
  expect(controller.authorizationView.getSnapshot().attempt?.id).toBe(current.id)
})

it('account refresh retains repository pages only for the same concrete connected account', async () => {
  const fetch = vi.fn(reads().account).mockResolvedValueOnce(account).mockResolvedValueOnce(account)
    .mockResolvedValueOnce({ ...account, account: { ...account.account!, id: gid('another-human') } })
  const repoRead = vi.fn(reads().repositories)
  const { controller } = setup({ account: fetch, repositories: repoRead })
  await controller.refresh()
  await controller.refreshAccount()
  expect(controller.getSnapshot().repositories).toEqual([repository])
  expect(controller.getSnapshot().nextPage).toBe(2)
  expect(repoRead).toHaveBeenCalledOnce()
  await controller.refreshAccount()
  expect(controller.getSnapshot().repositories).toEqual([])
  expect(controller.getSnapshot().nextPage).toBeNull()
})
it('account refresh retains the completed same-account page without inventing a continuation', async () => {
  const { controller } = setup({ repositories: async () => ({ repositories: [repository] }) })
  await controller.refresh(); await controller.refreshAccount()
  expect(controller.getSnapshot()).toMatchObject({ repositories: [repository], nextPage: null })
})

it('disposed callbacks cannot publish new public or private snapshots', async () => {
  const { controller } = setup()
  await controller.dispose()
  const publicSnapshot = controller.getSnapshot()
  const privateSnapshot = controller.authorizationView.getSnapshot()
  controller.invalidate(); await controller.cancel()
  expect(controller.getSnapshot()).toBe(publicSnapshot)
  expect(controller.authorizationView.getSnapshot()).toBe(privateSnapshot)
})
