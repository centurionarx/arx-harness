import { describe, expect, it, vi } from 'vitest'
import type { RepositoryDiff, RepositoryDiffRequest, RepositoryInspection, RepositoryStatus } from '@arx-ai/arx-repository/types'
import { RepositoryController } from '../src/client/controller.ts'
import { deferred, inspection, reads, status, wid } from './fixtures.client.ts'

describe('repository read generations', () => {
  it('contains subscriber errors and honors unsubscribe and disposed commands', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const controller = new RepositoryController(reads())
    const bad = controller.subscribe(() => { throw new Error('subscriber') })
    const good = vi.fn()
    const unsubscribe = controller.subscribe(good)
    await controller.refresh()
    await controller.show({ workspaceId: wid('one'), path: 'same.ts', side: 'staged' })
    controller.select(wid('one'))
    await controller.refresh()
    expect(log).toHaveBeenCalled()
    expect(good).toHaveBeenCalled()
    bad()
    unsubscribe()
    await controller.dispose()
    controller.invalidate()
    controller.close()
    await controller.show({ workspaceId: wid('one'), path: 'same.ts', side: 'staged' })
    log.mockRestore()
  })
  it('contains status rejection and non-Error failures as retryable diagnostics', async () => {
    const getStatus = vi.fn().mockRejectedValueOnce('status failed').mockResolvedValue(status)
    const diff = vi.fn().mockRejectedValueOnce('comparison failed').mockRejectedValueOnce(new Error('patch failed'))
    const controller = new RepositoryController(reads({ status: getStatus, diff }))
    controller.select(wid('one'))
    await controller.refresh()
    expect(controller.getSnapshot()).toMatchObject({ phase: 'error', error: 'status failed' })
    await controller.refresh()
    await controller.show({ workspaceId: wid('one'), path: 'same.ts', side: 'staged' })
    expect(controller.getSnapshot().comparison).toMatchObject({ phase: 'error', error: 'comparison failed' })
    await controller.show({ workspaceId: wid('one'), path: 'same.ts', side: 'staged' })
    expect(controller.getSnapshot().comparison).toMatchObject({ phase: 'error', error: 'patch failed' })
    await controller.dispose()
  })
  it('does not publish a rejected diff after close or a rejected inspection after selection', async () => {
    const old = deferred<RepositoryInspection>()
    const patch = deferred<RepositoryDiff>()
    const controller = new RepositoryController(reads({
      inspect: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(inspection), diff: () => patch.promise,
    }))
    controller.select(wid('one'))
    const pending = controller.refresh()
    controller.select(wid('two'))
    old.reject(new Error('late inspect'))
    await pending
    await controller.refresh()
    const comparing = controller.show({ workspaceId: wid('two'), path: 'same.ts', side: 'staged' })
    controller.close()
    patch.reject(new Error('late patch'))
    await comparing
    expect(controller.getSnapshot()).toMatchObject({ workspaceId: 'two', comparison: null })
    await controller.dispose()
  })
  it('publishes complete identity and independent groups only after explicit refresh', async () => {
    const inspect = vi.fn(async () => inspection)
    const controller = new RepositoryController(reads({ inspect }))
    controller.select(wid('one'))
    expect(inspect).not.toHaveBeenCalled()
    const initial = controller.getSnapshot()
    expect(controller.getSnapshot()).toBe(initial)
    await controller.refresh()
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', inspection, status })
    await controller.dispose()
  })
  it('does not publish an old workspace response after the carrier ignores abort', async () => {
    const old = deferred<RepositoryInspection>()
    const signals: AbortSignal[] = []
    const controller = new RepositoryController(reads({ inspect: (request, signal) => {
      signals.push(signal)
      return request.workspaceId === wid('old') ? old.promise : Promise.resolve({ ...inspection, branch: 'new' })
    } }))
    controller.select(wid('old'))
    const pending = controller.refresh()
    controller.select(wid('new'))
    await controller.refresh()
    expect(signals[0]?.aborted).toBe(true)
    old.resolve(inspection)
    await pending
    expect(controller.getSnapshot()).toMatchObject({ workspaceId: 'new', inspection: { branch: 'new' } })
    await controller.dispose()
  })
  it('refresh supersedes pending reads and reset clears facts without another read', async () => {
    const first = deferred<RepositoryStatus>()
    const getStatus = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(status)
    const controller = new RepositoryController(reads({ status: getStatus }))
    controller.select(wid('one'))
    const pending = controller.refresh()
    await controller.refresh()
    first.resolve({ ...status, staged: [] })
    await pending
    expect(controller.getSnapshot().status?.staged).toHaveLength(1)
    controller.invalidate()
    expect(controller.getSnapshot()).toMatchObject({ phase: 'stale', status: null, inspection: null })
    expect(getStatus).toHaveBeenCalledTimes(2)
    await controller.dispose()
  })
  it('keeps same-path sides separate and suppresses late patches after modal close', async () => {
    const patch = deferred<RepositoryDiff>()
    const diff = vi.fn().mockReturnValueOnce(patch.promise).mockImplementation(async (request: RepositoryDiffRequest) => ({ ...request, binary: false, text: 'working tree' }))
    const controller = new RepositoryController(reads({ diff }))
    controller.select(wid('one'))
    await controller.refresh()
    const pending = controller.show({ workspaceId: wid('one'), path: 'same.ts', side: 'staged' })
    await controller.show({ workspaceId: wid('one'), path: 'same.ts', side: 'unstaged' })
    patch.resolve({ path: 'same.ts', side: 'staged', binary: false, text: 'index' })
    await pending
    expect(controller.getSnapshot().comparison?.value?.text).toBe('working tree')
    controller.close()
    expect(controller.getSnapshot().comparison).toBeNull()
    await controller.dispose()
  })
  it('never requests conflicts, wrong sides, submodules or a different workspace', async () => {
    const diff = vi.fn()
    const controller = new RepositoryController(reads({ diff, status: async () => ({ ...status, staged: [...status.staged, { path: 'submodule', submodule: 'SC..', xy: 'M.' }] }) }))
    controller.select(wid('one'))
    await controller.refresh()
    for (const [workspaceId, path, side] of [
      [wid('one'), 'conflict.ts', 'unstaged'], [wid('one'), 'new.ts', 'staged'],
      [wid('other'), 'same.ts', 'staged'], [wid('one'), 'submodule', 'staged'],
    ] as const) await controller.show({ workspaceId, path, side })
    expect(diff).not.toHaveBeenCalled()
    await controller.dispose()
  })
  it('classifies non-repositories and makes other failures retryable', async () => {
    const inspect = vi.fn().mockRejectedValueOnce(new Error('REPOSITORY_NOT_FOUND')).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(inspection)
    const controller = new RepositoryController(reads({ inspect }))
    controller.select(wid('one'))
    await controller.refresh()
    expect(controller.getSnapshot().phase).toBe('not-repository')
    await controller.refresh()
    expect(controller.getSnapshot()).toMatchObject({ phase: 'error', error: 'offline' })
    await controller.refresh()
    expect(controller.getSnapshot().phase).toBe('ready')
    await controller.dispose()
  })
  it('disposal aborts, waits for both carriers, and silences queued notifications', async () => {
    const inspect = deferred<RepositoryInspection>()
    const getStatus = deferred<RepositoryStatus>()
    const signals: AbortSignal[] = []
    const controller = new RepositoryController(reads({
      inspect: (_request, signal) => { signals.push(signal); return inspect.promise },
      status: (_request, signal) => { signals.push(signal); return getStatus.promise },
    }))
    const notify = vi.fn()
    controller.subscribe(notify)
    controller.select(wid('one'))
    const pending = controller.refresh()
    let disposed = false
    const disposal = controller.dispose().then(() => { disposed = true })
    expect(signals.every(signal => signal.aborted)).toBe(true)
    inspect.reject(new Error('aborted'))
    await Promise.resolve()
    expect(disposed).toBe(false)
    getStatus.resolve(status)
    await disposal
    await pending
    expect(notify).not.toHaveBeenCalled()
    await controller.refresh()
    controller.select(wid('two'))
    expect(controller.getSnapshot().workspaceId).toBe(wid('one'))
  })
})
