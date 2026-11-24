import { afterEach, describe, expect, it, vi, afterAll, beforeAll } from 'vitest'
import { cp, mkdtemp, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
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
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arx-project-fixture-')))
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
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const item of resources.splice(0).reverse()) await item.close()
})
/**
 * Moves the runtime's header and unary deadlines to a fake clock, so `requestTimeoutMs` elapses only when the
 * test advances it. Loopback requests, sqlite and the supervisor fixture keep real time, and a slow machine
 * cannot expire a deadline before the step that the test observes.
 */
function fakeDeadlines(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    const controller = new AbortController()
    setTimeout(() => { controller.abort(new DOMException('The operation timed out', 'TimeoutError')) }, ms)
    return controller.signal
  })
}
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
    fakeDeadlines()
    f.supervisor.frame({ type: 'server-request', rpcId: 'first-frame', method: 'events.mux',
      payload: { type: 'session/subscribed', sessionId: f.header.id, lastSeq: 0 } })
    const controller = new AbortController()
    const stream = f.runtime.streamMux(f.authority, controller.signal)[Symbol.asyncIterator]()
    const first = stream.next()
    await f.attach()
    // The first frame proves that the runtime holds the stream's response headers before the deadline elapses.
    expect((await first).done).toBe(false)
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 4)
    const operation = [...f.supervisor.operations.values()][0]
    if (operation === undefined) throw new Error('the stream operation ended before the consumer aborted')
    // Only the stream's operation counts. The attach request is unary, and the runtime cancels it
    // when its reply takes longer than requestTimeoutMs.
    const streamCancels = () => f.supervisor.cancelled.filter(id => id === operation.id).length
    expect(streamCancels()).toBe(0)
    const late = stream.next()
    late.catch(() => {})
    operation.response.write(muxFrame('late-frame', { type: 'session/subscribed', sessionId: f.header.id, lastSeq: 0 }))
    const frame = await late
    if (frame.done === true) throw new Error('expected a late mux frame')
    expect(frame.value.payload).toEqual({ type: 'session/subscribed', sessionId: f.header.id, lastSeq: 0 })
    expect(streamCancels()).toBe(0)
    controller.abort()
    await stream.return?.()
    expect(streamCancels()).toBe(1)
    expect(f.supervisor.operations.size).toBe(0)
  })

  it('rejects a stream whose supervisor sends no response headers at requestTimeoutMs', async () => {
    const cancelled: string[] = []
    const streamOperations: string[] = []
    const streamRequested = Promise.withResolvers<undefined>()
    const silent = createServer((request, response) => {
      if (request.url?.startsWith('/api/events.') === true) {
        streamOperations.push(String(request.headers['x-arx-operation-id']))
        streamRequested.resolve(undefined)
      }
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
    fakeDeadlines()
    const stream = f.runtime.streamMux(f.authority, new AbortController().signal)[Symbol.asyncIterator]()
    let settled = false
    const next = stream.next().finally(() => { settled = true })
    next.catch(() => {})
    const attached = f.attach()
    await streamRequested.promise
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await Promise.all([expect(next).rejects.toMatchObject({ name: 'TimeoutError' }), attached])
    expect(streamOperations).toHaveLength(1)
    expect(cancelled.filter(id => streamOperations.includes(id))).toEqual(streamOperations)
  })

  it('keeps a pending question answerable after requestTimeoutMs', async () => {
    const f = await setup()
    fakeDeadlines()
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
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 4)
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
    fakeDeadlines()
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
  })

  it('cuts an idle frameless stream on revocation after it outlives requestTimeoutMs', async () => {
    const f = await setup()
    fakeDeadlines()
    const stream = f.runtime.streamMux(f.authority, new AbortController().signal)[Symbol.asyncIterator]()
    let settled = false
    const next = stream.next().then(result => (result.done ? 'done' : 'frame'), () => 'rejected')
    void next.then(() => { settled = true })
    // The attach request waits for the stream's response headers before its own request.
    await f.attach()
    expect(f.supervisor.operations.size).toBe(1)
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 4)
    // A loopback round trip runs after anything that an elapsed deadline would have ended.
    await f.attach()
    expect(settled).toBe(false)
    await f.harness.ctx.webIdentity.setStatus(f.harness.master, f.authority.principal.userId, 'BLOCKED')
    expect(await next).not.toBe('frame')
    expect(f.supervisor.operations.size).toBe(0)
  })
})
