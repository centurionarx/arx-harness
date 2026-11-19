/**
 * WorkspaceRuntime edge behavior: context teardown, connect coalescing and
 * late completion, New Session outcomes, rename/move results, reconnect
 * refresh, native-user classification, and recency with unlisted sessions.
 */
import { Context } from '@arx-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId, WorkspaceId, WorkspaceView } from '@arx-ai/arx-api-remotes/client'
import { SessionRuntime } from '../src/client/sessions/service.ts'
import { WorkspaceRuntime } from '../src/client/workspaces/service.ts'
import { FakeApiClient, deferred, err, fakeRemote, ok } from './fake-api.client.ts'

const sid = (id: string): SessionId => id as SessionId
const wid = (id: string): WorkspaceId => id as WorkspaceId

function view(id: string, sessionIds: SessionId[] = [], createdAt = '2026-01-01T00:00:00.000Z'): WorkspaceView {
  return { workspaceId: wid(id), path: `/w/${id}`, title: id, sessionIds, createdAt, updatedAt: createdAt }
}

const flush = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve()
}

function bench(ctx = new Context()) {
  const api = new FakeApiClient()
  const sessions = new SessionRuntime(ctx, api, fakeRemote())
  const workspaces = new WorkspaceRuntime(ctx, api, sessions)
  return { ctx, api, sessions, workspaces }
}

/** Both baselines landed: workspace `w1` plus the listed sessions. */
async function ready(b: ReturnType<typeof bench>, workspace = view('w1'), sessionIds: string[] = []): Promise<void> {
  b.api.onWorkspaceList = () => Promise.resolve(ok({ items: [workspace] as never[] }))
  b.api.onList = () => Promise.resolve(ok({
    items: sessionIds.map(id => ({ sessionId: sid(id), updatedAt: 1, running: false, blank: false })) as never[],
  }))
  await Promise.all([b.workspaces.refresh(), b.sessions.refresh()])
  await flush()
}

describe('WorkspaceRuntime lifetime', () => {
  it('resets its projection and rejects connect once the owning fiber is disposed', async () => {
    const ctx = new Context()
    let built!: ReturnType<typeof bench>
    await ctx.plugin({ name: 'owner', apply: (inner: Context) => { built = bench(inner) } }).await()
    await ready(built)
    expect(built.workspaces.list.getSnapshot().items).toHaveLength(1)

    await ctx.fiber.dispose()

    expect(built.workspaces.list.getSnapshot()).toMatchObject({ items: [], phase: 'pending', baselinesReady: false })
    await expect(built.workspaces.connectWorkspace(wid('w1'))).rejects.toThrow('disposed')
  })
})

describe('connectWorkspace', () => {
  it('coalesces concurrent connects for one workspace into a single create', async () => {
    const b = bench()
    await ready(b)
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onCreate']>>>()
    b.api.onCreate = () => gate.promise
    const first = b.workspaces.connectWorkspace(wid('w1'))
    const second = b.workspaces.connectWorkspace(wid('w1'))
    gate.resolve(ok({ sessionId: sid('s-new') }))
    await expect(Promise.all([first, second])).resolves.toEqual(['s-new', 's-new'])
    expect(b.api.callsOf('session.create')).toEqual([{ workspaceId: 'w1' }])
  })

  it('treats only a project-scoped user composition as a native user', async () => {
    for (const composition of [
      { kind: 'user', audience: 'owner', scope: 'project', generation: 1 },
      { kind: 'user', audience: 'user', scope: 'global', generation: 1 },
    ]) {
      const ctx = new Context()
      ctx.reflect.provide('clientComposition', Object.freeze(composition))
      const b = bench(ctx)
      await expect(b.workspaces.connectWorkspace(wid('unlisted'))).rejects.toThrow('unknown workspace unlisted')
    }
  })
})

describe('startInitialSelection late completion', () => {
  function pendingConnect() {
    const b = bench()
    const gate = deferred<SessionId>()
    vi.spyOn(b.workspaces, 'connectWorkspace').mockReturnValue(gate.promise)
    const open = vi.spyOn(b.sessions, 'open')
    return { b, gate, open }
  }

  it('does not open the connected session after the caller stopped following', async () => {
    const { b, gate, open } = pendingConnect()
    const stop = b.workspaces.startInitialSelection()
    await ready(b)
    stop()
    gate.resolve(sid('s-late'))
    await flush()
    expect(open).not.toHaveBeenCalled()
  })

  it('does not warn about a connect failure after the caller stopped following', async () => {
    const { b, gate } = pendingConnect()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stop = b.workspaces.startInitialSelection()
    await ready(b)
    stop()
    gate.reject(new Error('late failure'))
    await flush()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('keeps a selection made while connecting instead of opening the connected session', async () => {
    const { b, gate, open } = pendingConnect()
    const stop = b.workspaces.startInitialSelection()
    await ready(b, view('w1'), ['other'])
    b.sessions.open(sid('other'))
    open.mockClear()
    gate.resolve(sid('s-new'))
    await flush()
    expect(open).not.toHaveBeenCalled()
    expect(b.sessions.list.getSnapshot().current).toBe('other')
    stop()
  })
})

describe('startSession', () => {
  it('opens the connected session, and warns without navigating when connect fails', async () => {
    const b = bench()
    await ready(b)
    const connect = vi.spyOn(b.workspaces, 'connectWorkspace')
    const open = vi.spyOn(b.sessions, 'open').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    connect.mockResolvedValueOnce(sid('s-new'))
    b.workspaces.startSession(wid('w1'))
    await flush()
    expect(open).toHaveBeenCalledWith('s-new')

    open.mockClear()
    connect.mockRejectedValueOnce(new Error('connect failed'))
    b.workspaces.startSession(wid('w1'))
    await flush()
    expect(open).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('new session failed:', expect.objectContaining({ message: 'connect failed' }))
    warn.mockRestore()
  })
})

describe('Workspace actions and projection', () => {
  it('renames a workspace and surfaces the Host rejection', async () => {
    const b = bench()
    await ready(b)
    b.api.onWorkspaceRename = () => Promise.resolve(ok({ workspace: { ...view('w1'), title: 'renamed', updatedAt: '2026-02-01T00:00:00.000Z' } }))
    await expect(b.workspaces.rename(wid('w1'), 'renamed')).resolves.toMatchObject({ title: 'renamed' })

    b.api.onWorkspaceRename = () => Promise.resolve(err({ code: 'internal', message: 'busy', details: {} }))
    await expect(b.workspaces.rename(wid('w1'), 'x')).rejects.toThrow('workspace rename failed: internal: busy')
  })

  it('moves a session within its workspace and surfaces the Host rejection', async () => {
    const b = bench()
    await ready(b)
    const moved = { ...view('w1', [sid('s2'), sid('s1')]), updatedAt: '2026-02-01T00:00:00.000Z' }
    b.api.onWorkspaceInsertSessionBefore = () => Promise.resolve(ok({ workspace: moved }))
    await expect(b.workspaces.insertSessionBefore(wid('w1'), sid('s2'), sid('s1'))).resolves.toEqual(moved)
    expect(b.api.callsOf('workspace.insertSessionBefore')).toEqual([
      { workspaceId: 'w1', sessionId: 's2', beforeSessionId: 's1' },
    ])

    b.api.onWorkspaceInsertSessionBefore = () => Promise.resolve(err({ code: 'internal', message: 'stuck', details: {} }))
    await expect(b.workspaces.insertSessionBefore(wid('w1'), sid('s1'))).rejects.toThrow('workspace move failed: internal: stuck')
  })

  it('re-pulls the workspace baseline on connection', async () => {
    const b = bench()
    b.workspaces.handleConnected()
    await b.workspaces.refresh()
    expect(b.api.callsOf('workspace.list')).toHaveLength(1)
  })

  it('ignores workspace sessions missing from the session list when ranking recency', async () => {
    const b = bench()
    await ready(b, view('w1', [sid('ghost')], '2026-01-05T00:00:00.000Z'), [])
    expect(b.workspaces.list.getSnapshot()).toMatchObject({ baselinesReady: true, recentWorkspaceId: 'w1' })
  })
})
