import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import { once } from 'node:events'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import type { ClientRequest } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import type { WorkspaceId } from '@arx-ai/arx-workspace'
import { WebIdentityError } from '@arx-ai/arx-web-identity'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import { WORKER_BROKER_PATH, WORKER_CAPABILITY_HEADER } from '../src/broker-contract.ts'
import { supervisorFixture } from './supervisor.ts'

const resources: { close(): Promise<void> }[] = []
afterEach(async () => { for (const item of resources.splice(0).reverse()) await item.close() })

// Identity bootstrap hashes several passwords, so it runs once; every test opens its own copy of that root.
const seed = { root: '', users: [] as Awaited<ReturnType<typeof storageHarness>>['users'], master: '',
  passwords: {} as Awaited<ReturnType<typeof storageHarness>>['passwords'] }
beforeAll(async () => {
  const harness = await storageHarness({ readyUsers: 2 })
  try {
    seed.root = harness.paths.root
    seed.users = harness.users
    seed.passwords = harness.passwords
    seed.master = (await harness.ctx.webIdentity.login('arxadmin', harness.passwords.master, 'admin')).token
  } finally { await harness.close(false) }
})
afterAll(() => rm(seed.root, { recursive: true, force: true }))
async function seededHarness(options: Omit<Parameters<typeof storageHarness>[0] & object, 'root' | 'readyUsers' | 'initialize'> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arx-project-fixture-'))
  const remove = () => rm(root, { recursive: true, force: true })
  const harness = await cp(seed.root, root, { recursive: true }).then(() => storageHarness({ ...options, root }))
    .catch(async (error: unknown) => { await remove(); throw error })
  try {
    const users = await Promise.all(seed.users.map(async user => ({ ...user,
      authority: await harness.ctx.webIdentity.authenticate(user.token, 'user') })))
    return { ...harness, users, passwords: seed.passwords,
      master: await harness.ctx.webIdentity.authenticate(seed.master, 'admin'),
      async close() { await harness.close(false); await remove() } }
  } catch (error) { await harness.close(false); await remove(); throw error }
}
async function setup() {
  const supervisor = await supervisorFixture(); resources.push(supervisor)
  const h = await seededHarness({ endpoint: supervisor.endpoint }); resources.push(h)
  const authority = h.users[0]!.authority
  const project = await h.ctx.projectStorage.createProject(authority, 'Owner')
  const first = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'First')
  const second = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Second')
  const register = (workspaceId: WorkspaceId) => h.ctx.projectStorage.register(authority, workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  const firstSession = await register(first.workspaceId)
  const secondSession = await register(second.workspaceId)
  const request = (method: string, payload: unknown = {}): ClientRequest => ({ type: 'client-request', method, payload, rpcId: RpcId(randomUUID()) })
  const scoped = (workspaceId: WorkspaceId) => h.ctx.isolatedProjectRuntime.invoke(authority, { kind: 'workspace', workspaceId },
    request('llm.providers'))
  return { supervisor, h, authority, project, first, second, firstSession, secondSession, request, scoped,
    runtime: h.ctx.isolatedProjectRuntime }
}
const status = (sessionId: string) => ({ type: 'server-request', rpcId: randomUUID(), method: 'events.host',
  payload: { type: 'host/session-status', sessionId, running: true } })

describe('control aggregates user-level operations across workspace workers', () => {
  it('answers host.describe itself without any supervisor request or host home path', async () => {
    const f = await setup()
    const result = await f.runtime.invoke(f.authority, undefined, f.request('host.describe'))
    expect(result).toEqual({ ok: true, value: { version: expect.any(String) as string, cwd: '', attachedSessions: 0,
      home: '', canOpenPath: false } })
    expect(f.supervisor.log).toEqual([])
  })

  it('opens a downlink with no live lease and attaches a workspace sub-stream before forwarding its first request', async () => {
    const f = await setup()
    f.supervisor.framesFor(f.first.workspaceId, [status(f.firstSession.id)])
    const controller = new AbortController()
    const downlink = f.runtime.streamHost(f.authority, controller.signal)[Symbol.asyncIterator]()
    const next = downlink.next()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(f.supervisor.log).toEqual([])
    expect(await f.scoped(f.first.workspaceId)).toEqual({ ok: true, value: {} })
    expect(f.supervisor.log).toEqual(['/api/events.host ' + f.first.workspaceId, '/api/llm.providers ' + f.first.workspaceId])
    const frame = await next
    expect(frame.done === true ? undefined : frame.value.payload).toEqual(status(f.firstSession.id).payload)
    await f.scoped(f.first.workspaceId)
    expect(f.supervisor.log.filter(line => line.startsWith('/api/events.'))).toHaveLength(1)
    controller.abort()
    await downlink.return?.()
    expect(f.supervisor.operations.size).toBe(0)
  })

  it('merges frames of two workspaces and drops a frame that names another workspace', async () => {
    const f = await setup()
    f.supervisor.framesFor(f.first.workspaceId, [status(f.secondSession.id), status(f.firstSession.id)])
    f.supervisor.framesFor(f.second.workspaceId, [status(f.secondSession.id)])
    f.supervisor.hold(true)
    const held = f.supervisor.acceptedSignal()
    void f.scoped(f.first.workspaceId).catch(() => {})
    await held
    f.supervisor.hold(false)
    const controller = new AbortController()
    const downlink = f.runtime.streamHost(f.authority, controller.signal)[Symbol.asyncIterator]()
    const seen: unknown[] = []
    const first = await downlink.next()
    if (first.done !== true) seen.push(first.value.payload)
    await f.scoped(f.second.workspaceId)
    const second = await downlink.next()
    if (second.done !== true) seen.push(second.value.payload)
    expect(seen).toEqual(expect.arrayContaining([status(f.firstSession.id).payload, status(f.secondSession.id).payload]))
    expect(seen).toHaveLength(2)
    controller.abort()
    await downlink.return?.()
  })

  it('ends the whole downlink when one sub-stream ends and cancels every sub-lease with its own receipt', async () => {
    const f = await setup()
    const controller = new AbortController()
    const downlink = f.runtime.streamMux(f.authority, controller.signal)[Symbol.asyncIterator]()
    const next = downlink.next()
    next.catch(() => {})
    await f.scoped(f.first.workspaceId)
    await f.scoped(f.second.workspaceId)
    const streams = [...f.supervisor.operations.values()].filter(operation => operation.workspaceId !== undefined)
    expect(streams.map(operation => operation.workspaceId).sort()).toEqual([f.first.workspaceId, f.second.workspaceId].sort())
    streams.find(operation => operation.workspaceId === f.first.workspaceId)!.response.end()
    expect((await next).done).toBe(true)
    expect(f.supervisor.cancelled).toEqual(expect.arrayContaining(streams.map(operation => operation.id)))
    expect(f.supervisor.operations.size).toBe(0)
  })

  it('closes an idle downlink without sub-streams when the user is quiesced', async () => {
    const f = await setup()
    const downlink = f.runtime.streamHost(f.authority, new AbortController().signal)[Symbol.asyncIterator]()
    const next = downlink.next()
    await new Promise(resolve => setTimeout(resolve, 20))
    await f.runtime.quiesce(f.authority.principal.userId)
    expect((await next).done).toBe(true)
  })

  it('refuses the capability of an unscoped lease at the broker and accepts a scoped one', async () => {
    const f = await setup()
    f.supervisor.hold(true)
    const unscoped = f.supervisor.acceptedSignal()
    const pending = f.runtime.invoke(f.authority, undefined, f.request('llm.providers')).catch(() => 'cancelled')
    await unscoped
    const lease = [...f.supervisor.operations.values()].find(operation => operation.workspaceId === undefined)!
    const broker = (capability: string) => f.runtime.broker(new Request('http://control' + WORKER_BROKER_PATH, {
      method: 'POST', headers: { 'content-type': 'application/json', [WORKER_CAPABILITY_HEADER]: capability },
      body: JSON.stringify({ operation: 'list', workerId: randomUUID(), workspaceId: f.first.workspaceId }) }))
    expect((await broker(lease.capability)).status).toBe(403)
    const scopedAccepted = f.supervisor.acceptedSignal()
    const scopedPending = f.scoped(f.first.workspaceId).catch(() => 'cancelled')
    await scopedAccepted
    const scoped = [...f.supervisor.operations.values()].find(operation => operation.workspaceId === f.first.workspaceId)!
    expect((await broker(scoped.capability)).status).toBe(200)
    await f.runtime.quiesce(f.authority.principal.userId)
    expect(await pending).toBe('cancelled')
    expect(await scopedPending).toBe('cancelled')
  })

  it('answers unscoped session.list with one scoped request per indexed workspace, in index order', async () => {
    const f = await setup()
    const item = (sessionId: string) => ({ sessionId, updatedAt: 1, running: false, blank: true })
    f.supervisor.resultFor(f.first.workspaceId, { items: [item(f.firstSession.id)] })
    f.supervisor.resultFor(f.second.workspaceId, { items: [item(f.secondSession.id)] })
    const result = await f.runtime.invoke(f.authority, undefined, f.request('session.list'))
    expect(result).toEqual({ ok: true, value: { items: [item(f.firstSession.id), item(f.secondSession.id)] } })
    expect(f.supervisor.log).toEqual(['/api/session.list ' + f.first.workspaceId, '/api/session.list ' + f.second.workspaceId])
  })

  it('refuses the whole listing when one workspace request fails', async () => {
    const f = await setup()
    f.supervisor.resultFor(f.first.workspaceId, { items: [] })
    f.supervisor.failFor(f.second.workspaceId)
    await expect(f.runtime.invoke(f.authority, undefined, f.request('session.list'))).rejects.toMatchObject({ status: 502 })
    await expect(f.runtime.invoke(f.authority, undefined, f.request('workspace.list'))).rejects.toMatchObject({ status: 502 })
  })

  it('stores workspace order in the control index, refuses foreign workspaces and notifies host downlinks', async () => {
    const f = await setup()
    const view = (workspaceId: string) => ({ workspaceId, path: 'workspace://' + workspaceId, title: workspaceId,
      sessionIds: [], createdAt: '1', updatedAt: '1' })
    f.supervisor.resultFor(f.first.workspaceId, { items: [view(f.first.workspaceId)], archivedSessionIds: [f.firstSession.id] })
    f.supervisor.resultFor(f.second.workspaceId, { items: [view(f.second.workspaceId)], archivedSessionIds: [] })
    const controller = new AbortController()
    const downlink = f.runtime.streamHost(f.authority, controller.signal)[Symbol.asyncIterator]()
    const next = downlink.next()
    const reordered = await f.runtime.invoke(f.authority, undefined, f.request('workspace.insertBefore',
      { workspaceId: f.second.workspaceId, beforeWorkspaceId: f.first.workspaceId }))
    expect(reordered).toEqual({ ok: true, value: { workspaceIds: [f.second.workspaceId, f.first.workspaceId] } })
    const frame = await next
    expect(frame.done === true ? undefined : frame.value.payload).toEqual({ type: 'host/workspace-order-changed',
      workspaceIds: [f.second.workspaceId, f.first.workspaceId] })
    expect(f.supervisor.log).toEqual([])
    const listed = await f.runtime.invoke(f.authority, undefined, f.request('workspace.list'))
    expect(listed).toEqual({ ok: true, value: { items: [view(f.second.workspaceId), view(f.first.workspaceId)],
      archivedSessionIds: [f.firstSession.id] } })
    const other = f.h.users[1]!.authority
    const foreign = await f.h.ctx.projectStorage.createProject(other, 'Other')
    const foreignWorkspace = await f.h.ctx.projectStorage.createWorkspace(other, foreign.projectId, 'Other')
    await expect(f.runtime.invoke(f.authority, undefined, f.request('workspace.insertBefore',
      { workspaceId: foreignWorkspace.workspaceId }))).rejects.toMatchObject({ status: 403 })
    await expect(f.runtime.invoke(f.authority, undefined, f.request('workspace.insertBefore',
      { workspaceId: f.first.workspaceId, beforeWorkspaceId: foreignWorkspace.workspaceId }))).rejects.toMatchObject({ status: 403 })
    expect(await f.runtime.invoke(f.authority, undefined, f.request('workspace.insertBefore',
      { workspaceId: f.second.workspaceId }))).toEqual({ ok: true, value: { workspaceIds: [f.first.workspaceId, f.second.workspaceId] } })
    controller.abort()
    await downlink.return?.()
  })
})

describe('control aggregation refusals and idle downlink closure', () => {
  it('refuses a listing when a workspace answers a business error', async () => {
    const f = await setup()
    f.supervisor.resultFor(f.first.workspaceId, { items: [] })
    f.supervisor.refuseFor(f.second.workspaceId)
    await expect(f.runtime.invoke(f.authority, undefined, f.request('session.list'))).rejects.toMatchObject({ status: 502 })
  })

  it('refuses a workspace listing whose worker answer lacks archived sessions or items', async () => {
    const g = await setup()
    g.supervisor.resultFor(g.first.workspaceId, { items: [] })
    g.supervisor.resultFor(g.second.workspaceId, { items: [] })
    await expect(g.runtime.invoke(g.authority, undefined, g.request('workspace.list'))).rejects.toMatchObject({ status: 502 })
    g.supervisor.resultFor(g.second.workspaceId, { items: 'invalid', archivedSessionIds: [] })
    g.supervisor.resultFor(g.first.workspaceId, { items: [], archivedSessionIds: [] })
    await expect(g.runtime.invoke(g.authority, undefined, g.request('workspace.list'))).rejects.toMatchObject({ status: 502 })
  })

  it('closes an idle downlink when its authentication session expires and leaves mux downlinks without order frames', async () => {
    const f = await setup()
    const mux = f.runtime.streamMux(f.authority, new AbortController().signal)[Symbol.asyncIterator]()
    const muxNext = mux.next()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(await f.runtime.invoke(f.authority, undefined, f.request('workspace.insertBefore',
      { workspaceId: f.second.workspaceId, beforeWorkspaceId: f.first.workspaceId }))).toMatchObject({ ok: true })
    await f.h.ctx.parallel('web-identity/session-expired', f.authority.principal.userId, f.authority.authSessionId)
    expect(await muxNext).toEqual({ done: true, value: undefined })
  })

  it('rejects the downlink close when a sub-lease cancellation is not confirmed', async () => {
    const f = await setup()
    const controller = new AbortController()
    const downlink = f.runtime.streamHost(f.authority, controller.signal)[Symbol.asyncIterator]()
    const next = downlink.next()
    next.catch(() => {})
    await f.scoped(f.first.workspaceId)
    f.supervisor.cancelStatus(500)
    controller.abort()
    await expect(next).rejects.toMatchObject({ status: 503 })
    const closed = f.h.ctx.logger.buffer.filter(message => message.type === 'error').map((message): unknown[] => message.args)
    expect(closed).toEqual([['isolated runtime adapter closed: operation %s has no quiescent receipt (trigger: %s, cause: %s)',
      f.supervisor.cancelled[0], 'downlink-closed', 'WebIdentityError']])
  })

  it('logs the adapter closure once when two sub-lease cancellations are not confirmed', async () => {
    const f = await setup()
    const controller = new AbortController()
    const downlink = f.runtime.streamHost(f.authority, controller.signal)[Symbol.asyncIterator]()
    const next = downlink.next()
    next.catch(() => {})
    await f.scoped(f.first.workspaceId)
    await f.scoped(f.second.workspaceId)
    f.supervisor.cancelStatus(500)
    controller.abort()
    await expect(next).rejects.toMatchObject({ status: 503 })
    expect(f.supervisor.cancelled).toHaveLength(2)
    const closed = f.h.ctx.logger.buffer.filter(message => message.type === 'error').map((message): unknown[] => message.args)
    expect(closed).toHaveLength(1)
    expect(f.supervisor.cancelled).toContain(closed[0]![1])
  })
})

describe('merged downlink exposure, deadlines and per-user state', () => {
  it('drops frames already queued by other sub-streams when the user is quiesced', async () => {
    const f = await setup()
    f.supervisor.framesFor(f.first.workspaceId, [status(f.firstSession.id)])
    f.supervisor.framesFor(f.second.workspaceId, [status(f.secondSession.id)])
    const downlink = f.runtime.streamHost(f.authority, new AbortController().signal)[Symbol.asyncIterator]()
    const first = downlink.next()
    await f.scoped(f.first.workspaceId)
    await f.scoped(f.second.workspaceId)
    expect((await first).done).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 50))
    await f.runtime.quiesce(f.authority.principal.userId)
    expect(await downlink.next().catch(() => ({ done: true, value: undefined }))).toEqual({ done: true, value: undefined })
  })

  it('does not expose a frame queued before quiescence once the sub-lease is cancelled', async () => {
    const f = await setup()
    f.supervisor.framesFor(f.first.workspaceId, [status(f.firstSession.id), status(f.firstSession.id)])
    const downlink = f.runtime.streamHost(f.authority, new AbortController().signal)[Symbol.asyncIterator]()
    const first = downlink.next()
    await f.scoped(f.first.workspaceId)
    expect((await first).done).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 50))
    await f.runtime.quiesce(f.authority.principal.userId)
    expect(await downlink.next().catch(() => ({ done: true, value: undefined }))).toEqual({ done: true, value: undefined })
  })

  it('answers unscoped session.search with one scoped request per workspace within the result limit', async () => {
    const f = await setup()
    const hit = (sessionId: string) => ({ sessionId, snippet: 'match' })
    f.supervisor.resultFor(f.first.workspaceId, { items: [hit(f.firstSession.id)], hasMore: false })
    f.supervisor.resultFor(f.second.workspaceId, { items: [hit(f.secondSession.id)], hasMore: true })
    expect(await f.runtime.invoke(f.authority, undefined, f.request('session.search', { query: 'match' })))
      .toEqual({ ok: true, value: { items: [hit(f.firstSession.id), hit(f.secondSession.id)], hasMore: true } })
    expect(f.supervisor.log).toEqual(['/api/session.search ' + f.first.workspaceId, '/api/session.search ' + f.second.workspaceId])
    f.supervisor.resultFor(f.first.workspaceId, { items: Array.from({ length: 20 }, () => hit(f.firstSession.id)), hasMore: false })
    f.supervisor.resultFor(f.second.workspaceId, { items: [hit(f.secondSession.id)], hasMore: false })
    const limited = await f.runtime.invoke(f.authority, undefined, f.request('session.search', { query: 'match' }))
    expect(limited.ok && (limited.value as { items: unknown[]; hasMore: boolean })).toMatchObject({ hasMore: true })
    expect(limited.ok && (limited.value as { items: unknown[] }).items).toHaveLength(20)
  })

  it('publishes the union of every workspace archive and drops worker order frames', async () => {
    const f = await setup()
    const view = (workspaceId: string) => ({ workspaceId, path: 'workspace://' + workspaceId, title: workspaceId,
      sessionIds: [], createdAt: '1', updatedAt: '1' })
    f.supervisor.resultFor(f.first.workspaceId, { items: [view(f.first.workspaceId)], archivedSessionIds: [f.firstSession.id] })
    f.supervisor.resultFor(f.second.workspaceId, { items: [view(f.second.workspaceId)], archivedSessionIds: [] })
    const archived = (ids: string[]) => ({ type: 'server-request', rpcId: randomUUID(), method: 'events.host',
      payload: { type: 'host/archived-sessions-changed', archivedSessionIds: ids } })
    const order = { type: 'server-request', rpcId: randomUUID(), method: 'events.host',
      payload: { type: 'host/workspace-order-changed', workspaceIds: [f.second.workspaceId] } }
    f.supervisor.framesFor(f.second.workspaceId, [order, archived([f.secondSession.id])])
    expect(await f.runtime.invoke(f.authority, undefined, f.request('workspace.list'))).toMatchObject({ ok: true,
      value: { archivedSessionIds: [f.firstSession.id] } })
    const controller = new AbortController()
    const downlink = f.runtime.streamHost(f.authority, controller.signal)[Symbol.asyncIterator]()
    const next = downlink.next()
    await f.scoped(f.second.workspaceId)
    const frame = await next
    expect(frame.done === true ? undefined : frame.value.payload).toEqual({ type: 'host/archived-sessions-changed',
      archivedSessionIds: [f.firstSession.id, f.secondSession.id] })
    f.supervisor.resultFor(f.second.workspaceId, { archivedSessionIds: [f.secondSession.id] })
    expect(await f.runtime.invoke(f.authority, undefined, f.request('workspace.archiveSession', { sessionId: f.secondSession.id })))
      .toEqual({ ok: true, value: { archivedSessionIds: [f.firstSession.id, f.secondSession.id] } })
    controller.abort()
    await downlink.return?.()
  })

  it('queues no archive frame on a downlink that closes while its archive union is filtered', async () => {
    const f = await setup()
    f.supervisor.framesFor(f.second.workspaceId, [{ type: 'server-request', rpcId: randomUUID(), method: 'events.host',
      payload: { type: 'host/archived-sessions-changed', archivedSessionIds: [f.secondSession.id] } }])
    const original = f.h.ctx.webIdentity.authorizeOwner.bind(f.h.ctx.webIdentity)
    let checks = 0
    let entered!: () => void, release!: () => void
    const filtering = new Promise<void>((resolve) => { entered = resolve })
    const held = new Promise<void>((resolve) => { release = resolve })
    vi.spyOn(f.h.ctx.webIdentity, 'authorizeOwner').mockImplementation(async (authority, resource, module) => {
      // The first check of this id admits the worker frame; the second one filters the archive union.
      if (resource.kind === 'session' && resource.sessionId === f.secondSession.id && ++checks === 2) { entered(); await held }
      return original(authority, resource, module)
    })
    const controller = new AbortController()
    const downlink = f.runtime.streamHost(f.authority, controller.signal)[Symbol.asyncIterator]()
    const next = downlink.next()
    await f.scoped(f.second.workspaceId)
    await filtering
    // The frame queue is private and a closed downlink has no consumer, so the queue is the only place a late frame shows.
    const queue = [...(f.runtime as unknown as { downlinks: Set<{ queue: unknown[] }> }).downlinks][0]!.queue
    controller.abort()
    expect(await next).toEqual({ done: true, value: undefined })
    release()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(queue).toEqual([])
    vi.restoreAllMocks()
    f.supervisor.resultFor(f.first.workspaceId, { items: [], archivedSessionIds: [] })
    f.supervisor.resultFor(f.second.workspaceId, { items: [], archivedSessionIds: [] })
    expect(await f.runtime.invoke(f.authority, undefined, f.request('workspace.list'))).toMatchObject({ ok: true })
  })

  it('does not expose a queued control order frame after the user is quiesced', async () => {
    const f = await setup()
    f.supervisor.framesFor(f.first.workspaceId, [status(f.firstSession.id)])
    const downlink = f.runtime.streamHost(f.authority, new AbortController().signal)[Symbol.asyncIterator]()
    const first = downlink.next()
    await f.scoped(f.first.workspaceId)
    expect((await first).done).toBe(false)
    expect(await f.runtime.invoke(f.authority, undefined, f.request('workspace.insertBefore',
      { workspaceId: f.second.workspaceId, beforeWorkspaceId: f.first.workspaceId }))).toMatchObject({ ok: true })
    const quiesced = f.runtime.quiesce(f.authority.principal.userId)
    const after = downlink.next().catch(() => ({ done: true, value: undefined }))
    await quiesced
    expect(await after).toEqual({ done: true, value: undefined })
  })

  it('publishes only archived sessions the user still owns', async () => {
    const f = await setup()
    f.supervisor.resultFor(f.first.workspaceId, { items: [], archivedSessionIds: [f.firstSession.id] })
    f.supervisor.resultFor(f.second.workspaceId, { items: [], archivedSessionIds: [] })
    expect(await f.runtime.invoke(f.authority, undefined, f.request('workspace.list'))).toMatchObject({ ok: true,
      value: { archivedSessionIds: [f.firstSession.id] } })
    await f.h.ctx.projectStorage.deleteSession(f.authority, f.firstSession.id)
    f.supervisor.resultFor(f.second.workspaceId, { archivedSessionIds: [f.secondSession.id] })
    expect(await f.runtime.invoke(f.authority, undefined, f.request('workspace.archiveSession', { sessionId: f.secondSession.id })))
      .toEqual({ ok: true, value: { archivedSessionIds: [f.secondSession.id] } })
  })

  it('propagates an identity failure while filtering the archive union', async () => {
    const f = await setup()
    f.supervisor.resultFor(f.first.workspaceId, { items: [], archivedSessionIds: [f.firstSession.id] })
    f.supervisor.resultFor(f.second.workspaceId, { items: [], archivedSessionIds: [] })
    await f.runtime.invoke(f.authority, undefined, f.request('workspace.list'))
    const original = f.h.ctx.webIdentity.authorizeOwner.bind(f.h.ctx.webIdentity)
    vi.spyOn(f.h.ctx.webIdentity, 'authorizeOwner').mockImplementation(async (authority, resource, module) => {
      if (resource.kind === 'session' && resource.sessionId === f.firstSession.id) throw new Error('identity unavailable')
      return original(authority, resource, module)
    })
    f.supervisor.resultFor(f.second.workspaceId, { archivedSessionIds: [f.secondSession.id] })
    await expect(f.runtime.invoke(f.authority, undefined, f.request('workspace.archiveSession', { sessionId: f.secondSession.id })))
      .rejects.toThrow('identity unavailable')
    vi.restoreAllMocks()
  })

  it('skips an order frame for a login that fails revalidation and propagates any other failure', async () => {
    const f = await setup()
    const user = f.h.users[0]!
    const second = await f.h.ctx.webIdentity.authenticate((await f.h.ctx.webIdentity.login(user.username, user.password, 'user')).token, 'user')
    const controller = new AbortController()
    const downlink = f.runtime.streamHost(second, controller.signal)[Symbol.asyncIterator]()
    const next = downlink.next()
    await new Promise(resolve => setTimeout(resolve, 20))
    const original = f.h.ctx.webIdentity.revalidate.bind(f.h.ctx.webIdentity)
    let failure: Error = new WebIdentityError('AUTH_EXPIRED', 401, 'expired')
    vi.spyOn(f.h.ctx.webIdentity, 'revalidate').mockImplementation(async (authority, options) => {
      if (authority === second) throw failure
      return original(authority, options)
    })
    expect(await f.runtime.invoke(f.authority, undefined, f.request('workspace.insertBefore',
      { workspaceId: f.second.workspaceId, beforeWorkspaceId: f.first.workspaceId }))).toMatchObject({ ok: true })
    failure = new WebIdentityError('RUNTIME_FORBIDDEN', 403, 'forbidden')
    expect(await f.runtime.invoke(f.authority, undefined, f.request('workspace.insertBefore',
      { workspaceId: f.second.workspaceId }))).toMatchObject({ ok: true })
    failure = new Error('identity unavailable')
    await expect(f.runtime.invoke(f.authority, undefined, f.request('workspace.insertBefore',
      { workspaceId: f.first.workspaceId, beforeWorkspaceId: f.second.workspaceId }))).rejects.toThrow('identity unavailable')
    vi.restoreAllMocks()
    controller.abort()
    expect(await next).toEqual({ done: true, value: undefined })
  })

  it('publishes the latest archive union last when two workspaces report archives concurrently', async () => {
    const f = await setup()
    const archived = (ids: string[]) => ({ type: 'server-request', rpcId: randomUUID(), method: 'events.host',
      payload: { type: 'host/archived-sessions-changed', archivedSessionIds: ids } })
    f.supervisor.framesFor(f.first.workspaceId, [archived([f.firstSession.id])])
    f.supervisor.framesFor(f.second.workspaceId, [archived([f.secondSession.id])])
    const original = f.h.ctx.webIdentity.authorizeOwner.bind(f.h.ctx.webIdentity)
    let release!: () => void
    const released = new Promise<void>((resolve) => { release = resolve })
    let held!: () => void
    const holding = new Promise<void>((resolve) => { held = resolve })
    let firstChecks = 0
    vi.spyOn(f.h.ctx.webIdentity, 'authorizeOwner').mockImplementation(async (authority, resource, module) => {
      if (resource.kind === 'session' && resource.sessionId === f.firstSession.id && ++firstChecks === 2) {
        held()
        await released
      }
      return original(authority, resource, module)
    })
    const controller = new AbortController()
    const downlink = f.runtime.streamHost(f.authority, controller.signal)[Symbol.asyncIterator]()
    const first = downlink.next()
    await f.scoped(f.first.workspaceId)
    await holding
    await f.scoped(f.second.workspaceId)
    await new Promise(resolve => setTimeout(resolve, 50))
    release()
    const frames = [await first, await downlink.next()].map(frame => frame.done === true ? undefined : frame.value.payload)
    expect(frames.at(-1)).toEqual({ type: 'host/archived-sessions-changed', archivedSessionIds: [f.firstSession.id, f.secondSession.id] })
    vi.restoreAllMocks()
    controller.abort()
    await downlink.return?.()
  })

  it('applies two concurrent workspace moves without losing either', async () => {
    const f = await setup()
    const third = await f.h.ctx.projectStorage.createWorkspace(f.authority, f.project.projectId, 'Third')
    const [first, second] = await Promise.all([
      f.runtime.invoke(f.authority, undefined, f.request('workspace.insertBefore',
        { workspaceId: third.workspaceId, beforeWorkspaceId: f.first.workspaceId })),
      f.runtime.invoke(f.authority, undefined, f.request('workspace.insertBefore', { workspaceId: f.second.workspaceId })),
    ])
    expect(first.ok && second.ok).toBe(true)
    expect(await f.h.ctx.projectStorage.workspaceOrder(f.authority)).toEqual([third.workspaceId, f.first.workspaceId, f.second.workspaceId])
  })

  it('bounds a scoped unary request by its caller signal while its sub-stream attach waits for headers', async () => {
    const supervisor = await supervisorFixture(); resources.push(supervisor)
    const silent = createServer((request, response) => {
      const cancel = /^\/_arx\/operations\/([^/]+)\/cancel$/.exec(request.url ?? '')
      if (cancel !== null) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ operationId: cancel[1], quiescent: true })); return
      }
      if (request.url?.startsWith('/api/events.') === true) return
      const proxied = httpRequest(supervisor.endpoint + String(request.url), { method: request.method, headers: request.headers },
        (upstream) => { response.writeHead(upstream.statusCode ?? 502, upstream.headers); upstream.pipe(response) })
      request.pipe(proxied)
    })
    silent.listen(0, '127.0.0.1'); await once(silent, 'listening')
    resources.push({ close: () => {
      silent.closeAllConnections()
      return new Promise<void>((resolve) => { silent.close(() => { resolve() }) })
    } })
    const address = silent.address()
    if (address === null || typeof address === 'string') throw new Error('silent fixture port missing')
    const h = await seededHarness({ endpoint: 'http://127.0.0.1:' + String(address.port) }); resources.push(h)
    const authority = h.users[0]!.authority
    const project = await h.ctx.projectStorage.createProject(authority, 'Owner')
    const workspace = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Only')
    const controller = new AbortController()
    const downlink = h.ctx.isolatedProjectRuntime.streamHost(authority, controller.signal)[Symbol.asyncIterator]()
    const next = downlink.next()
    next.catch(() => {})
    await new Promise(resolve => setTimeout(resolve, 20))
    const started = Date.now()
    await expect(h.ctx.isolatedProjectRuntime.invoke(authority, { kind: 'workspace', workspaceId: workspace.workspaceId },
      { type: 'client-request', method: 'llm.providers', payload: {}, rpcId: RpcId(randomUUID()) },
      AbortSignal.timeout(200))).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(2000)
    controller.abort()
    await downlink.return?.().catch(() => {})
  }, 15000)
})
