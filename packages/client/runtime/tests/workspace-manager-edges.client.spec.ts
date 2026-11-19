/**
 * WorkspaceManager edge behavior: disposal, mutation echoes (rename, session
 * move), stale-snapshot rejection, refresh replay of changed/removed/order
 * frames, and tombstone-driven removal paths.
 */
import { describe, expect, it } from 'vitest'
import type { SessionId, WorkspaceId, WorkspaceView } from '@arx-ai/arx-api-remotes/client'
import { WorkspaceManager } from '../src/client/workspaces/manager.ts'
import { FakeApiClient, deferred, err, ok } from './fake-api.client.ts'

const sid = (id: string): SessionId => id as SessionId
const wid = (id: string): WorkspaceId => id as WorkspaceId

function ws(id: string, updatedAt = '2026-01-01T00:00:00.000Z', title = id): WorkspaceView {
  return { workspaceId: wid(id), path: `/w/${id}`, title, sessionIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt }
}

const changed = (workspace: WorkspaceView) =>
  ({ rpcId: 'c' as never, payload: { type: 'host/workspace-changed', workspace } }) as const
const removed = (workspaceId: WorkspaceId) =>
  ({ rpcId: 'r' as never, payload: { type: 'host/workspace-removed', workspaceId } }) as const
const ordered = (workspaceIds: WorkspaceId[]) =>
  ({ rpcId: 'o' as never, payload: { type: 'host/workspace-order-changed', workspaceIds } }) as const

const ids = (manager: WorkspaceManager): string[] => manager.getSnapshot().items.map(item => item.workspaceId)

async function seeded(...views: WorkspaceView[]): Promise<{ api: FakeApiClient; manager: WorkspaceManager }> {
  const api = new FakeApiClient()
  api.onWorkspaceList = () => Promise.resolve(ok({ items: views as never[] }))
  const manager = new WorkspaceManager(api)
  await manager.refresh()
  return { api, manager }
}

describe('WorkspaceManager disposal', () => {
  it('rejects actions and ignores frames after a repeated dispose', async () => {
    const { manager } = await seeded(ws('a'))
    manager.dispose()
    manager.dispose()
    expect(() => { manager.assertActive() }).toThrow('workspace manager is disposed')
    manager.handleHostEnvelope(changed(ws('late')))
    expect(manager.getSnapshot()).toMatchObject({ items: [], phase: 'pending' })
  })

  it('drops a transport failure that lands after dispose', async () => {
    const api = new FakeApiClient()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onWorkspaceList']>>>()
    api.onWorkspaceList = () => gate.promise
    const manager = new WorkspaceManager(api)
    const pending = manager.refresh()
    manager.dispose()
    gate.reject(new Error('late wire failure'))
    await pending
    expect(manager.getSnapshot()).toMatchObject({ state: 'idle', error: null })
  })

  it('rethrows a reorder transport failure without rolling back once disposed', async () => {
    const { api, manager } = await seeded(ws('a'), ws('b'))
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onWorkspaceInsertBefore']>>>()
    api.onWorkspaceInsertBefore = () => gate.promise
    const move = manager.insertBefore(wid('b'), wid('a'))
    manager.dispose()
    gate.reject(new Error('reorder wire down'))
    await expect(move).rejects.toThrow('reorder wire down')
    expect(manager.getSnapshot().items).toEqual([])
  })

  it('rejects creating from an input that is already a materialized Workspace', async () => {
    const { manager } = await seeded()
    await expect(manager.create({ path: '/w/x', workspaceId: wid('x') } as never))
      .rejects.toThrow('a local Workspace must be materializable')
  })
})

describe('WorkspaceManager mutation echoes', () => {
  it('publishes a renamed row from the unary echo and leaves the list on failure', async () => {
    const { api, manager } = await seeded(ws('a'))
    api.onWorkspaceRename = () => Promise.resolve(ok({ workspace: ws('a', '2026-02-01T00:00:00.000Z', 'renamed') }))
    await expect(manager.rename(wid('a'), 'renamed')).resolves.toMatchObject({ ok: true })
    expect(api.callsOf('workspace.rename')).toEqual([{ workspaceId: 'a', title: 'renamed' }])
    expect(manager.getSnapshot().items[0]?.title).toBe('renamed')

    api.onWorkspaceRename = () => Promise.resolve(err({ code: 'internal', message: 'nope', details: {} }))
    await expect(manager.rename(wid('a'), 'again')).resolves.toMatchObject({ ok: false })
    expect(manager.getSnapshot().items[0]?.title).toBe('renamed')
  })

  it('sends the anchor only when given and publishes the moved row on success only', async () => {
    const { api, manager } = await seeded(ws('a'))
    const moved = { ...ws('a', '2026-02-01T00:00:00.000Z'), sessionIds: [sid('s2'), sid('s1')] }
    api.onWorkspaceInsertSessionBefore = () => Promise.resolve(ok({ workspace: moved }))
    await manager.insertSessionBefore(wid('a'), sid('s2'), sid('s1'))
    await manager.insertSessionBefore(wid('a'), sid('s2'))
    expect(api.callsOf('workspace.insertSessionBefore')).toEqual([
      { workspaceId: 'a', sessionId: 's2', beforeSessionId: 's1' },
      { workspaceId: 'a', sessionId: 's2' },
    ])
    expect(manager.getSnapshot().items[0]?.sessionIds).toEqual(['s2', 's1'])

    api.onWorkspaceInsertSessionBefore = () => Promise.resolve(err({ code: 'internal', message: 'no', details: {} }))
    await expect(manager.insertSessionBefore(wid('a'), sid('s1'))).resolves.toMatchObject({ ok: false })
    expect(manager.getSnapshot().items[0]?.sessionIds).toEqual(['s2', 's1'])
  })

  it('adopts a newer frame in place, ignores an older echo, and keeps an existing row on re-create', async () => {
    const { api, manager } = await seeded(ws('a', '2026-01-01T00:00:00.000Z'), ws('b', '2026-01-01T00:00:00.000Z'))
    manager.handleHostEnvelope(changed(ws('a', '2026-03-01T00:00:00.000Z', 'newer')))
    expect(ids(manager)).toEqual(['a', 'b'])
    expect(manager.getSnapshot().items[0]?.title).toBe('newer')

    manager.handleHostEnvelope(changed(ws('a', '2026-02-01T00:00:00.000Z', 'older')))
    expect(manager.getSnapshot().items[0]?.title).toBe('newer')

    api.onWorkspaceCreate = () => Promise.resolve(ok({
      workspace: ws('b', '2026-04-01T00:00:00.000Z', 'recreated'), created: false,
    }))
    await manager.create({ path: '/w/b' })
    expect(manager.getSnapshot().items.map(item => item.title)).toEqual(['newer', 'recreated'])
  })
})

describe('WorkspaceManager removals', () => {
  it('drops a frame-removed row via the batched path and flushes an already-removed unary delete', async () => {
    const { api, manager } = await seeded(ws('a'), ws('b'))
    manager.handleHostEnvelope(removed(wid('a')))
    expect(ids(manager)).toEqual(['b'])

    let notified = 0
    manager.subscribe(() => { notified++ })
    await expect(manager.delete(wid('a'))).resolves.toMatchObject({ ok: true })
    expect(notified).toBeGreaterThanOrEqual(1)
    expect(api.callsOf('workspace.delete')).toEqual([{ workspaceId: 'a' }])
  })

  it('removes a row synchronously on a unary delete echo', async () => {
    const { manager } = await seeded(ws('a'), ws('b'))
    await manager.delete(wid('a'))
    expect(ids(manager)).toEqual(['b'])
  })
})

describe('WorkspaceManager refresh replay', () => {
  it('replays frames over the baseline: in-place upserts, removals, and partial orders', async () => {
    const api = new FakeApiClient()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onWorkspaceList']>>>()
    api.onWorkspaceList = () => gate.promise
    const manager = new WorkspaceManager(api)
    const pending = manager.refresh()
    manager.handleHostEnvelope(changed(ws('a', '2026-05-01T00:00:00.000Z', 'replayed')))
    manager.handleHostEnvelope(removed(wid('b')))
    manager.handleHostEnvelope(ordered([wid('c')]))
    gate.resolve(ok({
      items: [ws('a'), ws('b'), ws('c'), ws('d'), ws('e')] as never[],
    }))
    await pending
    expect(ids(manager)).toEqual(['c', 'a', 'd', 'e'])
    expect(manager.getSnapshot().items[1]?.title).toBe('replayed')
  })

  it('appends rows missing from a partial order frame after the ranked ones', async () => {
    const { manager } = await seeded(ws('a'), ws('b'), ws('c'))
    manager.handleHostEnvelope(ordered([wid('c')]))
    expect(ids(manager)).toEqual(['c', 'a', 'b'])
  })

  it('keeps a baseline that carries duplicate ids collapsed onto one object', async () => {
    const { manager } = await seeded(ws('a', '2026-01-01T00:00:00.000Z', 'first'), ws('a', '2026-01-02T00:00:00.000Z', 'second'))
    expect(manager.getSnapshot().items).toHaveLength(1)
    expect(manager.getSnapshot().items[0]?.title).toBe('second')
  })
})
