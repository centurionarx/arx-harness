/** Ended object owners reject late commits and pending publications. */
import { Context } from '@arx-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { Notifier } from '../src/client/sessions/notifier.ts'
import { ProjectionValueStore } from '../src/client/sessions/projection-store.ts'
import { SessionRuntime } from '../src/client/sessions/service.ts'
import { WorkspaceRuntime } from '../src/client/workspaces/service.ts'
import { deferred, FakeApiClient, fakeRemote, ok } from './fake-api.client.ts'

describe('runtime owner disposal', () => {
  it('invalidates queued notifications and contains a throwing subscriber', async () => {
    const order: string[] = []
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const notifier = new Notifier(() => { order.push('rebuild') })
    notifier.subscribe(() => { throw new Error('fixture subscriber') })
    notifier.subscribe(() => { order.push('notify') })
    notifier.notifyNow()
    expect(order).toEqual(['rebuild', 'notify'])
    expect(error).toHaveBeenCalledOnce()
    notifier.markDirty()
    notifier.dispose()
    notifier.markDirty(); notifier.notifyNow(); notifier.ensureFresh()
    notifier.subscribe(() => { order.push('late') })()
    await Promise.resolve()
    expect(order).toEqual(['rebuild', 'notify'])
    error.mockRestore()
  })

  it('drops pending frame publications when the notifier owner ends', () => {
    let callback: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => { callback = next; return 1 })
    const seen = vi.fn(), notifier = new Notifier(seen)
    notifier.subscribe(seen); notifier.markFrameDirty(); notifier.dispose()
    callback?.(0)
    expect(seen).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('releases projection values and suppresses existing and late faces after disposal', async () => {
    const projections = new ProjectionValueStore(), seen = vi.fn()
    const existing = projections.faceOf('title')
    existing.subscribe(seen)
    projections.apply('title', 'private fixture title', 1)
    projections.dispose()
    const late = projections.faceOf('title')
    late.subscribe(seen); projections.subscribeAny(seen)
    projections.apply('title', 'late private fixture title', 2)
    await Promise.resolve()
    expect(existing.getSnapshot()).toBeUndefined()
    expect(late.getSnapshot()).toBeUndefined()
    expect(projections.values()).toEqual({})
    expect(seen).not.toHaveBeenCalled()
  })

  it('does not refill session or workspace mirrors from delayed baselines after context disposal', async () => {
    const ctx = new Context(), api = new FakeApiClient()
    const sessions = new SessionRuntime(ctx, api, fakeRemote())
    const workspaces = new WorkspaceRuntime(ctx, api, sessions)
    const list = deferred<Awaited<ReturnType<typeof api.onList>>>()
    const workspaceList = deferred<Awaited<ReturnType<typeof api.onWorkspaceList>>>()
    api.onList = () => list.promise; api.onWorkspaceList = () => workspaceList.promise
    const pending = [sessions.refresh(), workspaces.refresh()]
    await ctx.fiber.dispose()
    const seen = vi.fn()
    sessions.list.subscribe(seen); workspaces.list.subscribe(seen)
    list.resolve(ok({ items: [{ sessionId: 'late-session' as never, updatedAt: 1, running: false, blank: true }] as never[] }))
    workspaceList.resolve(ok({ items: [{ workspaceId: 'late-workspace' as never, title: 'late', path: '/late',
      sessionIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] as never[] }))
    await Promise.all(pending); await Promise.resolve()
    expect(sessions.list.getSnapshot().ids).toEqual([])
    expect(workspaces.list.getSnapshot().items).toEqual([])
    expect(seen).not.toHaveBeenCalled()
    expect(sessions.binding('late-session' as never)).toBeUndefined()
    await sessions.refresh(); await workspaces.refresh()
    expect(api.callsOf('session.list')).toHaveLength(1)
    expect(api.callsOf('workspace.list')).toHaveLength(1)
  })

  it('rejects delayed create and fork receipts and later mutation starts', async () => {
    const ctx = new Context(), api = new FakeApiClient()
    const sessions = new SessionRuntime(ctx, api, fakeRemote())
    const create = deferred<Awaited<ReturnType<typeof api.sessions.create>>>()
    const fork = deferred<Awaited<ReturnType<typeof api.sessions.fork>>>()
    api.onCreate = () => create.promise; api.onFork = () => fork.promise
    const pendingCreate = sessions.create({ cwd: '/fixture' })
    const pendingFork = sessions.fork({ sessionId: 'source' as never })
    const rejectedCreate = expect(pendingCreate).rejects.toThrow('disposed')
    const rejectedFork = expect(pendingFork).rejects.toThrow('disposed')
    await ctx.fiber.dispose()
    create.resolve(ok({ sessionId: 'late-created' as never })); fork.resolve(ok({ sessionId: 'late-forked' as never }))
    await rejectedCreate; await rejectedFork
    expect(sessions.list.getSnapshot().ids).toEqual([])
    await expect(sessions.create({ cwd: '/fixture' })).rejects.toThrow('disposed')
    await expect(sessions.fork({ sessionId: 'source' as never })).rejects.toThrow('disposed')
    expect(api.callsOf('session.create')).toHaveLength(1)
    expect(api.callsOf('session.fork')).toHaveLength(1)
  })
})
