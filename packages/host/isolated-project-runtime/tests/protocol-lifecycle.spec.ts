import { afterEach, beforeEach, describe, expect, it, vi, afterAll, beforeAll } from 'vitest'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { RpcId, type ClientRequest, type MuxFrame, type RpcRequest } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import type { RequestAuthority } from '@arx-ai/arx-web-identity'
import type { WorkspaceId } from '@arx-ai/arx-workspace'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import * as BrokerHttp from '../src/broker-http.ts'
import { WORKER_BROKER_PATH, WORKER_CAPABILITY_HEADER } from '../src/broker-contract.ts'
import { supervisorFixture } from './supervisor.ts'

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

let peer: Awaited<ReturnType<typeof supervisorFixture>> | undefined
let h: Awaited<ReturnType<typeof storageHarness>> | undefined
let authority: RequestAuthority
let own: { projectId: string; workspaceId: WorkspaceId; sessionId: SessionId }
const streams: { abort: AbortController; iterator: AsyncIterator<unknown> }[] = []
function frame(payload: unknown, rpcId = randomUUID()) {
  return { type: 'server-request', rpcId, method: 'events.mux', payload }
}
function question(sessionId: SessionId) {
  return { type: 'question/requested', sessionId,
    questions: [{ id: 'owner-question', question: 'Choose', options: [{ label: 'Continue' }] }] }
}
function input(method: string, payload: unknown = {}): ClientRequest {
  return { type: 'client-request', rpcId: RpcId(randomUUID()), method, payload }
}
function respond(rpcId: string, result: unknown = { ok: true, value: {} }) {
  return new Request('http://fixture/api/respond', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-response', rpcId, result }) })
}
/** A workspace-scoped request attaches that workspace's sub-stream to every open downlink; its own reply may fail. */
function attach(owner = authority, workspaceId = own.workspaceId) {
  if (h === undefined) throw new Error('real protocol fixture missing')
  return h.ctx.isolatedProjectRuntime.invoke(owner, { kind: 'workspace', workspaceId },
    input('llm.providers')).then(() => undefined, () => undefined)
}
async function open(payload: unknown, rpcId = randomUUID(), owner = authority, workspaceId = own.workspaceId) {
  if (peer === undefined || h === undefined) throw new Error('real protocol fixture missing')
  peer.frame(frame(payload, rpcId))
  const abort = new AbortController()
  const iterator = h.ctx.isolatedProjectRuntime.streamMux(owner, abort.signal)[Symbol.asyncIterator]()
  streams.push({ abort, iterator })
  const first = iterator.next()
  first.catch(() => {})
  await attach(owner, workspaceId)
  expect((await first).done).toBe(false)
  return iterator
}
async function nextType(iterator: AsyncIterator<RpcRequest<MuxFrame>>): Promise<MuxFrame['type']> {
  const next = await iterator.next()
  if (next.done) throw new Error('actual owner stream ended before its expected frame')
  return next.value.payload.type
}
function emit(payload: unknown, rpcId = randomUUID(), owner = authority) {
  if (peer === undefined) throw new Error('real protocol fixture missing')
  const operation = [...peer.operations.values()].find(value => value.userId === owner.principal.userId)
  if (operation === undefined) throw new Error('actual owner stream missing')
  operation.response.write('data: ' + JSON.stringify(frame(payload, rpcId)) + '\n\n')
}
beforeEach(async () => {
  peer = await supervisorFixture()
  h = await seededHarness({ endpoint: peer.endpoint, http: true,
    extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp }] })
  authority = h.users[0]!.authority
  const project = await h.ctx.projectStorage.createProject(authority, 'Owned protocol project')
  const workspace = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Owned protocol workspace')
  const meta = await h.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  own = { projectId: project.projectId, workspaceId: workspace.workspaceId, sessionId: meta.id }
})
afterEach(async () => {
  vi.restoreAllMocks()
  for (const stream of streams.splice(0)) { stream.abort.abort(); await stream.iterator.return?.() }
  try { await h?.close() } finally { await peer?.close() }
  h = undefined; peer = undefined
})
describe('real HTTP peer faults in correlated owner lifecycle', () => {
  it('validates project and array references before publishing an aggregate response', async () => {
    if (peer === undefined || h === undefined) throw new Error('real protocol fixture missing')
    const expected = { projectId: own.projectId, workspaceIds: [own.workspaceId],
      sessionIds: [own.sessionId], archivedSessionIds: [own.sessionId] }
    peer.result(expected)
    expect(await h.ctx.isolatedProjectRuntime.invoke(authority, undefined, input('llm.providers'))).toEqual({ ok: true, value: expected })
    peer.result({ workspaceIds: [42] })
    await expect(h.ctx.isolatedProjectRuntime.invoke(authority, undefined, input('llm.providers')))
      .rejects.toMatchObject({ status: 502, code: 'RUNTIME_PROTOCOL' })
  })
  it('refuses a creation without a server-managed workspace before the peer sees a request', async () => {
    if (peer === undefined || h === undefined) throw new Error('real protocol fixture missing')
    await expect(h.ctx.isolatedProjectRuntime.invoke(authority, undefined, input('session.create')))
      .rejects.toMatchObject({ status: 403, code: 'RUNTIME_FORBIDDEN' })
    expect(peer.accepted).toEqual([])
  })
  it('keeps a correlated reply pending when the genuine transport returns accepted=false, then accepts a retry', async () => {
    if (peer === undefined || h === undefined) throw new Error('real protocol fixture missing')
    const rpcId = randomUUID()
    await open(question(own.sessionId), rpcId)
    peer.rawReply(JSON.stringify({ accepted: false }))
    const response = await h.ctx.isolatedProjectRuntime.fetch(authority, respond(rpcId))
    expect(await response.json()).toEqual({ accepted: false })
    peer.rawReply(JSON.stringify({ accepted: true }))
    const retry = await h.ctx.isolatedProjectRuntime.fetch(authority, respond(rpcId, { ok: false, error: { code: 'cancelled', message: 'Owner cancelled', details: {} } }))
    expect(await retry.json()).toEqual({ accepted: true })
    await expect(h.ctx.isolatedProjectRuntime.fetch(authority, respond(rpcId))).rejects.toMatchObject({ status: 403 })
  })
  it('keeps a correlated nonquiescent reply lease until cancellation even after its question was accepted', async () => {
    if (peer === undefined || h === undefined) throw new Error('real protocol fixture missing')
    const rpcId = randomUUID(), iterator = await open(question(own.sessionId), rpcId)
    peer.rawReply(JSON.stringify({ accepted: true }), { 'x-arx-quiescent': 'false' })
    expect(await (await h.ctx.isolatedProjectRuntime.fetch(authority, respond(rpcId))).json()).toEqual({ accepted: true })
    await expect(h.ctx.isolatedProjectRuntime.fetch(authority, respond(rpcId))).rejects.toMatchObject({ status: 403 })
    const stream = streams[0]
    if (stream === undefined) throw new Error('actual owner stream missing')
    stream.abort.abort()
    await iterator.return?.()
    const cancelled = peer.cancelledSignal()
    await h.ctx.isolatedProjectRuntime.quiesce(authority.principal.userId)
    await cancelled
    expect(await h.ctx.webIdentity.revalidate(authority)).toBe(authority)
  })
  it('refuses a malformed response receipt and quiesces its dispatch while the original request remains pending', async () => {
    if (peer === undefined || h === undefined) throw new Error('real protocol fixture missing')
    const rpcId = randomUUID()
    await open(question(own.sessionId), rpcId)
    peer.rawReply(JSON.stringify({ accepted: 'yes' }))
    await expect(h.ctx.isolatedProjectRuntime.fetch(authority, respond(rpcId)))
      .rejects.toMatchObject({ status: 502, code: 'RUNTIME_PROTOCOL' })
    peer.rawReply(JSON.stringify({ accepted: true }))
    expect(await (await h.ctx.isolatedProjectRuntime.fetch(authority, respond(rpcId))).json()).toEqual({ accepted: true })
  })
  it('removes a question after its actual resolved frame even while the owner stream lease remains active', async () => {
    if (h === undefined) throw new Error('real protocol fixture missing')
    const rpcId = randomUUID(), iterator = await open(question(own.sessionId), rpcId)
    emit({ type: 'question/resolved', sessionId: own.sessionId, questionRpcId: rpcId, outcome: 'answered' })
    expect(await nextType(iterator)).toBe('question/resolved')
    await expect(h.ctx.isolatedProjectRuntime.fetch(authority, respond(rpcId))).rejects.toMatchObject({ status: 403 })
  })
  it('resolves one approval without deleting another pending question on the same owner stream', async () => {
    if (peer === undefined || h === undefined) throw new Error('real protocol fixture missing')
    const questionId = randomUUID(), approvalRpcId = randomUUID(), approvalId = randomUUID()
    const iterator = await open(question(own.sessionId), questionId)
    emit({ type: 'approval/requested', sessionId: own.sessionId, approvalId, toolName: 'write' }, approvalRpcId)
    expect(await nextType(iterator)).toBe('approval/requested')
    emit({ type: 'approval/resolved', sessionId: own.sessionId, approvalId, outcome: 'allowed-once' })
    expect(await nextType(iterator)).toBe('approval/resolved')
    await expect(h.ctx.isolatedProjectRuntime.fetch(authority, respond(approvalRpcId))).rejects.toMatchObject({ status: 403 })
    peer.rawReply(JSON.stringify({ accepted: true }))
    expect(await (await h.ctx.isolatedProjectRuntime.fetch(authority, respond(questionId))).json()).toEqual({ accepted: true })
  })
  it('drops foreign resource and stream-error frames while preserving the following owner frame', async () => {
    if (peer === undefined || h === undefined) throw new Error('real protocol fixture missing')
    const foreign = h.users[1]!.authority
    const project = await h.ctx.projectStorage.createProject(foreign, 'Other owner')
    const workspace = await h.ctx.projectStorage.createWorkspace(foreign, project.projectId, 'Other workspace')
    const meta = await h.ctx.projectStorage.register(foreign, workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
    const values = [frame({ type: 'session/subscribed', sessionId: meta.id, lastSeq: 0 }),
      frame({ type: 'stream/error', error: { code: 'cancelled', message: 'Peer stream cancelled', details: {} } }),
      frame({ type: 'session/subscribed', sessionId: own.sessionId, lastSeq: 0 })]
    peer.rawReply(values.map(value => 'data: ' + JSON.stringify(value) + '\n\n').join(''), { 'content-type': 'text/event-stream' })
    const abort = new AbortController(), seen: unknown[] = []
    const downlink = h.ctx.isolatedProjectRuntime.streamMux(authority, abort.signal)
    const collected = (async () => { for await (const value of downlink) seen.push(value.payload) })()
    await attach()
    await collected
    expect(seen).toEqual([values[2]!.payload])
  })
  it('refuses a second pending request that reuses the rpcId for a different owned session', async () => {
    if (h === undefined) throw new Error('real protocol fixture missing')
    const rpcId = randomUUID(), iterator = await open(question(own.sessionId), rpcId)
    const scope = await h.ctx.webIdentity.authorizeOwner(authority, { kind: 'session', sessionId: own.sessionId })
    if (scope.workspaceId === undefined) throw new Error('real session workspace missing')
    const other = await h.ctx.projectStorage.register(authority, scope.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 2 })
    emit(question(other.id), rpcId)
    await expect(iterator.next()).rejects.toMatchObject({ status: 502, code: 'RUNTIME_PROTOCOL' })
  })

  it.each(['list', 'mux'] as const)('propagates real journal revocation during %s authorization and waits for quiescence before ACK', async (kind) => {
    if (peer === undefined || h === undefined) throw new Error('real protocol fixture missing')
    const fixture = h
    let committed!: () => void
    const barrier = new Promise<void>((resolve) => { committed = resolve })
    const unlisten = fixture.ctx.on('web-identity/invalidated', () => { committed() })
    let revocation: Promise<void> | undefined
    const original = fixture.ctx.webIdentity.authorizeOwner.bind(fixture.ctx.webIdentity)
    vi.spyOn(fixture.ctx.webIdentity, 'authorizeOwner').mockImplementation(async (...args) => {
      if (revocation === undefined && args[1].kind === 'session') {
        revocation = fixture.ctx.webIdentity.logout(authority)
        void revocation.catch(() => undefined)
        await barrier
      }
      return original(...args)
    })
    try {
      if (kind === 'list') {
        peer.result({ items: [{ sessionId: own.sessionId }] })
        await expect(fixture.ctx.isolatedProjectRuntime.invoke(authority, undefined, input('session.list')))
          .rejects.toMatchObject({ status: 401 })
      } else {
        peer.frame(frame({ type: 'session/subscribed', sessionId: own.sessionId, lastSeq: 0 }))
        const abort = new AbortController()
        const iterator = fixture.ctx.isolatedProjectRuntime.streamMux(authority, abort.signal)[Symbol.asyncIterator]()
        streams.push({ abort, iterator })
        await Promise.all([expect(iterator.next()).rejects.toMatchObject({ status: 401 }), attach()])
      }
      expect(revocation).toBeDefined()
      await revocation
      expect(peer.operations.size).toBe(0)
      await expect(fixture.ctx.webIdentity.authenticate(fixture.users[0]!.token, 'user')).rejects.toMatchObject({ status: 401 })
    } finally { unlisten() }
  })
  it('does not publish an owned frame when quiescence starts after its final authority check', async () => {
    if (peer === undefined || h === undefined) throw new Error('real protocol fixture missing')
    const fixture = h
    let checked = false
    let barrier: Promise<void> | undefined
    const originalOwner = fixture.ctx.webIdentity.authorizeOwner.bind(fixture.ctx.webIdentity)
    vi.spyOn(fixture.ctx.webIdentity, 'authorizeOwner').mockImplementation(async (...args) => {
      const owner = await originalOwner(...args)
      if (args[1].kind === 'session') checked = true
      return owner
    })
    const original = fixture.ctx.webIdentity.revalidate.bind(fixture.ctx.webIdentity)
    vi.spyOn(fixture.ctx.webIdentity, 'revalidate').mockImplementation(async (...args) => {
      const current = await original(...args)
      if (checked && barrier === undefined) {
        barrier = fixture.ctx.isolatedProjectRuntime.quiesce(authority.principal.userId)
        void barrier.catch(() => undefined)
      }
      return current
    })
    peer.frame(frame({ type: 'session/subscribed', sessionId: own.sessionId, lastSeq: 0 }))
    const abort = new AbortController()
    const iterator = fixture.ctx.isolatedProjectRuntime.streamMux(authority, abort.signal)[Symbol.asyncIterator]()
    streams.push({ abort, iterator })
    const next = iterator.next()
    await attach()
    expect(await next).toEqual({ done: true, value: undefined })
    expect(barrier).toBeDefined()
    await barrier
    expect(peer.operations.size).toBe(0)
    expect(await original(authority)).toBe(authority)
  })
  it('removes pending replies when its owner lease is cancelled and refuses them under a fresh cookie', async () => {
    if (h === undefined || peer === undefined) throw new Error('real protocol fixture missing')
    const rpcId = randomUUID()
    await open(question(own.sessionId), rpcId)
    await h.ctx.webIdentity.logout(authority)
    expect(peer.operations.size).toBe(0)
    const login = await h.ctx.webIdentity.login(h.users[0]!.username, h.users[0]!.password, 'user')
    const fresh = await h.ctx.webIdentity.authenticate(login.token, 'user')
    await expect(h.ctx.isolatedProjectRuntime.fetch(fresh, respond(rpcId))).rejects.toMatchObject({ status: 403 })
  })

  it('refuses a private cold-worker append until a real snapshot binds its writer, without materializing an empty log', async () => {
    if (h === undefined || peer === undefined) throw new Error('real protocol fixture missing')
    await open({ type: 'session/subscribed', sessionId: own.sessionId, lastSeq: 0 })
    const operation = [...peer.operations.values()][0]!
    const workerId = randomUUID()
    const send = (operationName: 'snapshot' | 'append') => fetch(h!.url! + WORKER_BROKER_PATH, { method: 'POST',
      headers: { 'content-type': 'application/json', [WORKER_CAPABILITY_HEADER]: operation.capability },
      body: JSON.stringify({ operation: operationName, workerId, workspaceId: own.workspaceId, sessionId: own.sessionId,
        ...(operationName === 'append' ? { events: [] } : {}) }) })
    const cold = await send('append')
    expect(cold.status).toBe(409)
    expect(await h.ctx.sessionPersistence.readRaw(own.sessionId)).toBeUndefined()
    const snapshot = await send('snapshot')
    expect(snapshot.status).toBe(200)
    expect(await snapshot.json()).toEqual({ value: null })
    const warm = await send('append')
    expect(warm.status).toBe(200)
    expect(await warm.json()).toEqual({ value: { sessionId: own.sessionId, nextSeq: 0 } })
    expect(await h.ctx.sessionPersistence.readRaw(own.sessionId)).toBeUndefined()
  })
  it('refuses a pending rpcId collision from another genuinely authenticated USER', async () => {
    if (h === undefined) throw new Error('real protocol fixture missing')
    const rpcId = randomUUID()
    await open(question(own.sessionId), rpcId)
    const foreign = h.users[1]!.authority
    const project = await h.ctx.projectStorage.createProject(foreign, 'Other pending owner')
    const workspace = await h.ctx.projectStorage.createWorkspace(foreign, project.projectId, 'Other pending workspace')
    const meta = await h.ctx.projectStorage.register(foreign, workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
    await expect(open(question(meta.id), rpcId, foreign, workspace.workspaceId)).rejects.toMatchObject({ status: 502, code: 'RUNTIME_PROTOCOL' })
    expect(await h.ctx.webIdentity.revalidate(authority)).toBe(authority)
  })
  it('retains one correlated reply across a repeated frame for the same owner and session', async () => {
    if (h === undefined || peer === undefined) throw new Error('real protocol fixture missing')
    const rpcId = randomUUID(), iterator = await open(question(own.sessionId), rpcId)
    emit(question(own.sessionId), rpcId)
    expect(await nextType(iterator)).toBe('question/requested')
    peer.rawReply(JSON.stringify({ accepted: true }))
    expect(await (await h.ctx.isolatedProjectRuntime.fetch(authority, respond(rpcId))).json()).toEqual({ accepted: true })
    await expect(h.ctx.isolatedProjectRuntime.fetch(authority, respond(rpcId))).rejects.toMatchObject({ status: 403 })
  })
})
