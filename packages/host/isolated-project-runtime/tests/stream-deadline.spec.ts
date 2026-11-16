import { afterEach, describe, expect, it, vi, afterAll, beforeAll } from 'vitest'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
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

const REQUEST_TIMEOUT_MS = 50
const resources: { close(): Promise<void> }[] = []
afterEach(async () => { for (const item of resources.splice(0).reverse()) await item.close() })
async function setup(endpoint?: string) {
  const supervisor = await supervisorFixture(); resources.push(supervisor)
  const harness = await seededHarness({ endpoint: endpoint ?? supervisor.endpoint,
    runtimeConfig: { requestTimeoutMs: REQUEST_TIMEOUT_MS } }); resources.push(harness)
  const authority = harness.users[0]!.authority
  const project = await harness.ctx.projectStorage.createProject(authority, 'USER_A')
  const workspace = await harness.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Workspace A')
  const header = await harness.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1000 })
  // A workspace-scoped request attaches that workspace's sub-stream to every open downlink; its own reply may fail.
  const attach = () => harness.ctx.isolatedProjectRuntime.invoke(authority, { kind: 'workspace', workspaceId: workspace.workspaceId },
    { type: 'client-request', method: 'llm.providers', payload: {}, rpcId: RpcId(randomUUID()) }).then(() => undefined, () => undefined)
  return { supervisor, harness, authority, header, attach, runtime: harness.ctx.isolatedProjectRuntime }
}
const muxFrame = (rpcId: string, payload: unknown) => 'data: ' + JSON.stringify({ type: 'server-request', rpcId,
  method: 'events.mux', payload }) + '\n\n'

describe('stream deadline covers only the supervisor response headers', () => {
  it('keeps a stream open beyond requestTimeoutMs and cancels only when the consumer aborts', async () => {
    const f = await setup()
    let cancels = 0
    const counted = () => { void f.supervisor.cancelledSignal().then(() => { cancels++; counted() }) }
    counted()
    const accepted = f.supervisor.acceptedSignal()
    const controller = new AbortController()
    const stream = f.runtime.streamMux(f.authority, controller.signal)[Symbol.asyncIterator]()
    const first = stream.next()
    first.catch(() => {})
    await f.attach()
    await accepted
    await sleep(REQUEST_TIMEOUT_MS * 4)
    expect(cancels).toBe(0)
    const operation = [...f.supervisor.operations.values()][0]!
    operation.response.write(muxFrame('late-frame', { type: 'session/subscribed', sessionId: f.header.id, lastSeq: 0 }))
    const frame = await first
    if (frame.done === true) throw new Error('expected a late mux frame')
    expect(frame.value.payload).toEqual({ type: 'session/subscribed', sessionId: f.header.id, lastSeq: 0 })
    expect(cancels).toBe(0)
    controller.abort()
    await stream.return?.()
    expect(cancels).toBe(1)
    expect(f.supervisor.operations.size).toBe(0)
  })

  it('rejects a stream whose supervisor sends no response headers at requestTimeoutMs', async () => {
    const cancelled: string[] = []
    const streamOperations: string[] = []
    const silent = createServer((request, response) => {
      if (request.url?.startsWith('/api/events.') === true) streamOperations.push(String(request.headers['x-arx-operation-id']))
      const match = /^\/_arx\/operations\/([^/]+)\/cancel$/.exec(request.url ?? '')
      if (match === null) return
      cancelled.push(match[1]!)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ operationId: match[1], quiescent: true }))
    })
    silent.listen(0, '127.0.0.1'); await once(silent, 'listening')
    resources.push({ async close() { silent.closeAllConnections(); await new Promise(resolve => silent.close(resolve)) } })
    const address = silent.address()
    if (address === null || typeof address === 'string') throw new Error('silent supervisor port unavailable')
    const f = await setup('http://127.0.0.1:' + String(address.port))
    const started = performance.now()
    const stream = f.runtime.streamMux(f.authority, new AbortController().signal)[Symbol.asyncIterator]()
    const next = stream.next()
    await Promise.all([expect(next).rejects.toMatchObject({ name: 'TimeoutError' }), f.attach()])
    expect(performance.now() - started).toBeLessThan(REQUEST_TIMEOUT_MS * 40)
    expect(streamOperations).toHaveLength(1)
    expect(cancelled.filter(id => streamOperations.includes(id))).toEqual(streamOperations)
  })

  it('keeps a pending question answerable after requestTimeoutMs', async () => {
    const f = await setup()
    f.supervisor.frame({ type: 'server-request', rpcId: 'pending-question', method: 'events.mux',
      payload: { type: 'question/requested', sessionId: f.header.id,
        questions: [{ id: 'choice', question: 'Continue?', options: [{ label: 'Continue' }] }] } })
    const controller = new AbortController()
    const stream = f.runtime.streamMux(f.authority, controller.signal)[Symbol.asyncIterator]()
    const next = stream.next()
    await f.attach()
    const frame = await next
    if (frame.done === true) throw new Error('expected a pending question frame')
    expect(frame.value.payload.type).toBe('question/requested')
    // A live downlink keeps reading, so a closed transport runs the stream's cleanup.
    const reading = stream.next()
    reading.catch(() => {})
    await sleep(REQUEST_TIMEOUT_MS * 4)
    f.supervisor.rawReply(JSON.stringify({ accepted: true }))
    const response = await f.runtime.fetch(f.authority, new Request('http://fixture/api/respond', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-response', rpcId: 'pending-question',
        result: { ok: true, value: { sessionId: f.header.id, answer: { answers: [{ id: 'choice', selected: ['Continue'] }] } } } }) }))
    expect(await response.json()).toEqual({ accepted: true })
    f.supervisor.resetReply()
    controller.abort()
    await reading.catch(() => {})
    await stream.return?.()
  })

  it('refuses an answer whose stream lease is cancelled during its authorization', async () => {
    const f = await setup()
    f.supervisor.frame({ type: 'server-request', rpcId: 'cancelled-question', method: 'events.mux',
      payload: { type: 'question/requested', sessionId: f.header.id,
        questions: [{ id: 'choice', question: 'Continue?', options: [{ label: 'Continue' }] }] } })
    const stream = f.runtime.streamMux(f.authority, new AbortController().signal)[Symbol.asyncIterator]()
    const next = stream.next()
    await f.attach()
    expect((await next).done).toBe(false)
    const revalidate = f.harness.ctx.webIdentity.revalidate.bind(f.harness.ctx.webIdentity)
    let closing: Promise<unknown> | undefined
    vi.spyOn(f.harness.ctx.webIdentity, 'revalidate').mockImplementationOnce(async (...args) => {
      closing = stream.return?.()
      return revalidate(...args)
    })
    await expect(f.runtime.fetch(f.authority, new Request('http://fixture/api/respond', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-response', rpcId: 'cancelled-question',
        result: { ok: true, value: { sessionId: f.header.id, answer: { answers: [{ id: 'choice', selected: ['Continue'] }] } } } }) })))
      .rejects.toMatchObject({ status: 403 })
    await closing
    vi.restoreAllMocks()
  })

  it('cuts an idle frameless stream on revocation after it outlives requestTimeoutMs', async () => {
    const f = await setup()
    const accepted = f.supervisor.acceptedSignal()
    const stream = f.runtime.streamMux(f.authority, new AbortController().signal)[Symbol.asyncIterator]()
    let settled = false
    const next = stream.next().then(result => (result.done ? 'done' : 'frame'), () => 'rejected')
    void next.then(() => { settled = true })
    await f.attach()
    await accepted
    await sleep(REQUEST_TIMEOUT_MS * 4)
    expect(settled).toBe(false)
    await f.harness.ctx.webIdentity.setStatus(f.harness.master!, f.authority.principal.userId, 'BLOCKED')
    expect(await next).not.toBe('frame')
    expect(f.supervisor.operations.size).toBe(0)
  })
})
