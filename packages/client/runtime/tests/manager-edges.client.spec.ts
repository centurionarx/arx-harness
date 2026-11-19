/**
 * SessionManager edge behavior: disposal, subagent catalog failures and
 * selection, debounced catalog refetch cancellation, answerable-frame
 * buffering across disconnects and re-subscription, and list-row
 * reconciliation (enrichment, blank flips, engagement).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@arx-ai/arx-llm'
import type { HostFrame, MuxFrame, SessionId, SubagentAddress } from '@arx-ai/arx-api-remotes/client'
import { SessionManager } from '../src/client/sessions/manager.ts'
import { FakeApiClient, deferred, err, fakeRemote, ok } from './fake-api.client.ts'

const S1 = 'fk-e1' as SessionId
const S2 = 'fk-e2' as SessionId
const S3 = 'fk-e3' as SessionId
const D = 'fk-diag' as SessionId
const CHILD: SubagentAddress = { parentSessionId: S1, childSessionId: S2, mode: 'continuable' }

afterEach(() => {
  vi.useRealTimers()
})

type ListRow = { sessionId: SessionId; updatedAt: number; running: boolean; blank: boolean }
const row = (sessionId: SessionId, over: Partial<ListRow> = {}): ListRow =>
  ({ sessionId, updatedAt: 1, running: false, blank: false, ...over })

const child = (id: SessionId, over: Record<string, unknown> = {}) => ({
  kind: 'child', id, mode: 'continuable', label: 'worker', activity: 'inactive', hasChildren: false, ...over,
})

const host = (manager: SessionManager, payload: HostFrame, rpcId = 'h'): void => {
  manager.handleHostEnvelope({ rpcId: rpcId as never, payload })
}
const mux = (manager: SessionManager, payload: MuxFrame, rpcId = 'm'): void => {
  manager.handleMuxEnvelope({ rpcId: rpcId as never, payload })
}

async function withList(...rows: ListRow[]): Promise<{ api: FakeApiClient; manager: SessionManager }> {
  const api = new FakeApiClient()
  api.onList = () => Promise.resolve(ok({ items: rows as never[] }))
  const manager = new SessionManager(api, fakeRemote())
  await manager.refreshList()
  return { api, manager }
}

const approval = (sessionId: SessionId, approvalId: string): MuxFrame =>
  ({ type: 'approval/requested', sessionId, approvalId: approvalId as never, toolName: 'rm' })
const queueOf = (sessionId: SessionId): MuxFrame => ({
  type: 'session/queue',
  sessionId,
  items: [{
    id: 'q1' as never,
    placement: 'queued',
    message: createUserMessage({ content: [{ type: 'text', text: 'later' }], source: { kind: 'user' } }),
  }],
})

describe('plan-review question without options', () => {
  it('stays an ordinary question', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    host(manager, { type: 'host/session-added', sessionId: S1, blank: false })
    mux(manager, {
      type: 'question/requested', sessionId: S1,
      questions: [{ id: 'plan', question: 'Approve?', detail: '# Plan', intent: { kind: 'plan-review', approve: 'Approve' } }],
    })
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBe('question')
  })
})

describe('disposal', () => {
  it('ignores every entry point after a repeated dispose', async () => {
    const { api, manager } = await withList(row(S1))
    manager.dispose()
    manager.dispose()
    const calls = api.calls.length

    manager.rebuildConversationRegistry()
    mux(manager, approval(S1, 'a1'))
    host(manager, { type: 'host/session-added', sessionId: S2, blank: false })
    manager.handleDisconnected()
    manager.handleConnected()
    manager.noteAgentPreset(S1, 'p')
    await manager.refreshSubagents(S1)
    await manager.refreshList()

    expect(api.calls.length).toBe(calls)
    expect(manager.getListSnapshot()).toMatchObject({ items: [], phase: 'pending' })
  })

  it('cancels a pending catalog refetch when the manager is disposed', async () => {
    vi.useFakeTimers()
    const { api, manager } = await withList(row(S1))
    manager.select(S1)
    await manager.refreshSubagents(S1)
    host(manager, { type: 'host/session-added', sessionId: S2, blank: false, parentSessionId: S1, origin: 'subagent' })
    manager.dispose()
    vi.advanceTimersByTime(100)
    expect(api.callsOf('subagent.list')).toHaveLength(1)
  })

  it('drops a catalog response and a catalog failure that land after dispose', async () => {
    const api = new FakeApiClient()
    const manager = new SessionManager(api, fakeRemote())
    const late = deferred<Awaited<ReturnType<FakeApiClient['onSubagentList']>>>()
    api.onSubagentList = () => late.promise
    const success = manager.refreshSubagents(S1)
    manager.dispose()
    late.resolve(ok({ entries: [], parentAvailable: true }))
    await success

    const failing = new SessionManager(api, fakeRemote())
    const failure = deferred<Awaited<ReturnType<FakeApiClient['onSubagentList']>>>()
    api.onSubagentList = () => failure.promise
    const pending = failing.refreshSubagents(S1)
    failing.dispose()
    failure.reject(new Error('late catalog wire'))
    await pending

    expect(manager.getListSnapshot().subagentsByParent).toEqual({})
    expect(failing.getListSnapshot().subagentsByParent).toEqual({})
  })

  it('drops a list transport failure that lands after dispose', async () => {
    const api = new FakeApiClient()
    const late = deferred<Awaited<ReturnType<FakeApiClient['onList']>>>()
    api.onList = () => late.promise
    const manager = new SessionManager(api, fakeRemote())
    const pending = manager.refreshList()
    manager.dispose()
    late.reject(new Error('late list wire'))
    await pending
    expect(manager.getListSnapshot()).toMatchObject({ state: 'idle', error: null })
  })
})

describe('catalog failures', () => {
  it('records a first-pull failure with an empty catalog, and keeps the last good rows on a later failure', async () => {
    const api = new FakeApiClient()
    const manager = new SessionManager(api, fakeRemote())
    api.onSubagentList = () => Promise.reject(new Error('catalog wire'))
    await manager.refreshSubagents(S1)
    expect(manager.getListSnapshot().subagentsByParent[S1]).toMatchObject({
      state: 'error', entries: [], parentAvailable: false, error: { message: 'catalog wire' },
    })

    api.onSubagentList = () => Promise.resolve(ok({ entries: [child(S2)] as never[], parentAvailable: true }))
    await manager.refreshSubagents(S1)
    api.onSubagentList = () => Promise.reject(new Error('catalog wire again'))
    await manager.refreshSubagents(S1)
    expect(manager.getListSnapshot().subagentsByParent[S1]).toMatchObject({
      state: 'error', parentAvailable: true, entries: [{ id: S2 }], error: { message: 'catalog wire again' },
    })
  })

  it('records a first-pull Host rejection with an empty, unavailable catalog', async () => {
    const api = new FakeApiClient()
    api.onSubagentList = () => Promise.resolve(err({ code: 'internal', message: 'refused', details: {} }))
    const manager = new SessionManager(api, fakeRemote())
    await manager.refreshSubagents(S1)
    expect(manager.getListSnapshot().subagentsByParent[S1]).toMatchObject({
      state: 'error', entries: [], parentAvailable: false, error: { message: 'refused' },
    })
  })
})

describe('subagent selection', () => {
  it('configures a restored child from its retained address when no catalog is loaded', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote(), undefined, CHILD)
    const session = manager.get(S2)
    expect(session.getSnapshot().subagent).toEqual({ address: CHILD, parentAvailable: false })
    manager.select(S2)
    expect(session.getSnapshot().subagent).toEqual({ address: CHILD, parentAvailable: false })
    expect(manager.getListSnapshot().current).toBe(S2)
  })

  it('refuses a child the catalog lists as a diagnostic, as another mode, or not at all', async () => {
    const api = new FakeApiClient()
    api.onSubagentList = () => Promise.resolve(ok({
      entries: [{ kind: 'diagnostic', id: S2, reason: 'corrupt' }, child(S3, { mode: 'one-shot' })] as never[],
      parentAvailable: true,
    }))
    const manager = new SessionManager(api, fakeRemote())
    expect(() => { manager.selectSubagent(CHILD) }).toThrow(`${S2} is not a healthy catalog child`)
    await manager.refreshSubagents(S1)
    expect(() => { manager.selectSubagent(CHILD) }).toThrow(`${S2} is not a healthy catalog child`)
    expect(() => { manager.selectSubagent({ ...CHILD, childSessionId: S3 }) }).toThrow(`${S3} is not a healthy catalog child`)
  })

  it('treats a catalog without an availability hint as an unavailable parent', async () => {
    const api = new FakeApiClient()
    api.onSubagentList = () => Promise.resolve(ok({ entries: [child(S2)] } as never))
    const manager = new SessionManager(api, fakeRemote())
    const session = manager.get(S2)
    await manager.refreshSubagents(S1)
    manager.selectSubagent(CHILD)
    expect(session.getSnapshot().subagent).toEqual({ address: CHILD, parentAvailable: false })
  })
})

describe('catalog refetch debounce', () => {
  it('cancels a pending refetch when the menu closes', async () => {
    vi.useFakeTimers()
    const { api, manager } = await withList(row(S1))
    manager.setSubagentCatalogOpen(S1, true)
    await manager.refreshSubagents(S1)
    host(manager, { type: 'host/session-added', sessionId: S2, blank: false, parentSessionId: S1 })
    manager.setSubagentCatalogOpen(S1, false)
    vi.advanceTimersByTime(100)
    expect(api.callsOf('subagent.list')).toHaveLength(1)
  })

  it('re-pulls every open catalog after a connection generation', async () => {
    const { api, manager } = await withList(row(S1))
    manager.setSubagentCatalogOpen(S1, true)
    await manager.refreshSubagents(S1)
    manager.handleConnected()
    expect(api.callsOf('subagent.list')).toEqual([{ parentSessionId: S1 }, { parentSessionId: S1 }])
  })
})

describe('catalog rows that are not children', () => {
  it('keeps diagnostics and unrelated children untouched while activity moves one child', async () => {
    const api = new FakeApiClient()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onSubagentList']>>>()
    api.onSubagentList = () => gate.promise
    const manager = new SessionManager(api, fakeRemote())
    const pending = manager.refreshSubagents(S1)
    host(manager, { type: 'host/session-status', sessionId: S2, running: true })
    gate.resolve(ok({
      entries: [{ kind: 'diagnostic', id: D, reason: 'corrupt' }, child(S2), child(S3)] as never[],
      parentAvailable: true,
    }))
    await pending
    const activities = () => manager.getListSnapshot().subagentsByParent[S1]?.entries
      .map(entry => entry.kind === 'child' ? `${entry.id}:${entry.activity}` : entry.kind)
    expect(activities()).toEqual(['diagnostic', `${S2}:running`, `${S3}:inactive`])

    host(manager, { type: 'host/session-status', sessionId: S2, running: false })
    expect(activities()).toEqual(['diagnostic', `${S2}:inactive`, `${S3}:inactive`])
  })
})

describe('answerable-frame buffering', () => {
  it('keeps the queue snapshot but drops buffered approvals when a generation dies', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    mux(manager, queueOf(S1))
    manager.handleDisconnected()
    expect(manager.get(S1).getSnapshot().queue).toHaveLength(1)

    mux(manager, approval(S2, 'a1'))
    mux(manager, queueOf(S2))
    manager.handleDisconnected()
    const second = manager.get(S2).getSnapshot()
    expect(second.pending).toEqual([])
    expect(second.queue).toHaveLength(1)
  })

  it('tolerates a generation death with nothing tracked', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    expect(() => { manager.handleDisconnected() }).not.toThrow()
  })

  it('discards a buffered queue on re-subscription but keeps buffered approvals', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    mux(manager, queueOf(S1))
    mux(manager, { type: 'session/subscribed', sessionId: S1, lastSeq: 0 })
    expect(manager.get(S1).getSnapshot().queue).toEqual([])

    mux(manager, approval(S2, 'a1'))
    mux(manager, { type: 'session/subscribed', sessionId: S2, lastSeq: 0 })
    expect(manager.get(S2).getSnapshot().pending).toHaveLength(1)
  })

  it('ignores resolutions that match nothing tracked or buffered', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    host(manager, { type: 'host/session-added', sessionId: S1, blank: false })
    mux(manager, { type: 'approval/resolved', sessionId: S3, approvalId: 'ghost' as never, outcome: 'approved' as never })
    mux(manager, { type: 'question/resolved', sessionId: S3, questionRpcId: 'ghost' as never, outcome: 'answered' })

    mux(manager, approval(S1, 'a1'))
    mux(manager, { type: 'approval/resolved', sessionId: S1, approvalId: 'a2' as never, outcome: 'approved' as never })
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBe('approval')
    expect(manager.get(S1).getSnapshot().pending).toHaveLength(1)
  })
})

describe('list-row reconciliation', () => {
  it('carries an agent preset from create and session-added into the rows', async () => {
    const api = new FakeApiClient()
    api.onCreate = () => Promise.resolve(ok({ sessionId: S1, agentPreset: 'standard' } as never))
    const manager = new SessionManager(api, fakeRemote())
    await manager.create({})
    host(manager, { type: 'host/session-added', sessionId: S2, blank: true, agentPreset: 'minimal' })
    const byId = Object.fromEntries(manager.getListSnapshot().items.map(item => [item.sessionId, item.agentPreset]))
    expect(byId).toEqual({ [S1]: 'standard', [S2]: 'minimal' })
  })

  it('fills the missing cwd, parent, and origin of an existing row without touching its neighbours', async () => {
    const { manager } = await withList(row(S1), row(S2))
    host(manager, {
      type: 'host/session-added', sessionId: S1, blank: false,
      cwd: '/w', parentSessionId: S2, origin: 'subagent',
    })
    const items = manager.getListSnapshot().items
    expect(items.find(item => item.sessionId === S1)).toMatchObject({ cwd: '/w', parentSessionId: S2, origin: 'subagent' })
    expect(items.find(item => item.sessionId === S2)?.cwd).toBeUndefined()
  })

  it('clears blank when an already-running blank row reports running again', async () => {
    const { manager } = await withList(row(S1, { running: true, blank: true }))
    host(manager, { type: 'host/session-status', sessionId: S1, running: true })
    expect(manager.getListSnapshot().items[0]).toMatchObject({ running: true, blank: false })
  })

  it('surfaces only the engaged session after its first accepted prompt', async () => {
    const { manager } = await withList(row(S1, { blank: true }), row(S2, { blank: true }))
    await manager.get(S1).prompt([{ type: 'text', text: 'hello' }], 'queue')
    const blank = Object.fromEntries(manager.getListSnapshot().items.map(item => [item.sessionId, item.blank]))
    expect(blank).toEqual({ [S1]: false, [S2]: true })
  })
})
