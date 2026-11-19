import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { cp, mkdtemp, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import type { ClientRequest } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
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
async function setup(runtimeConfig: Readonly<Record<string, unknown>> = {}) {
  const supervisor = await supervisorFixture(); resources.push(supervisor)
  const h = await seededHarness({ endpoint: supervisor.endpoint, runtimeConfig }); resources.push(h)
  const authority = h.users[0]!.authority
  const project = await h.ctx.projectStorage.createProject(authority, 'Owner')
  const workspace = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Workspace')
  const register = () => h.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  const first = await register(), second = await register()
  const request = (method: string): ClientRequest => ({ type: 'client-request', method, payload: {}, rpcId: RpcId(randomUUID()) })
  const runtime = h.ctx.isolatedProjectRuntime
  supervisor.hold(true)
  // A held scoped request is a live, retained lease whose capability a worker can present to the broker.
  const retained = async (authorityOf = authority, workspaceId = workspace.workspaceId) => {
    const accepted = supervisor.acceptedSignal()
    const outcome = runtime.invoke(authorityOf, { kind: 'workspace', workspaceId }, request('llm.providers'))
      .then(() => 'answered', () => 'cancelled')
    await accepted
    const operation = [...supervisor.operations.values()].at(-1)!
    return { id: operation.id, capability: operation.capability, outcome }
  }
  const broker = (capability: string, workerId: string, sessionId: string, operation = 'snapshot', signal?: AbortSignal) =>
    runtime.broker(new Request('http://control' + WORKER_BROKER_PATH, { method: 'POST', ...(signal === undefined ? {} : { signal }),
      headers: { 'content-type': 'application/json', [WORKER_CAPABILITY_HEADER]: capability },
      body: JSON.stringify({ operation, workerId, workspaceId: workspace.workspaceId, sessionId: sessionId,
        ...(operation === 'append' ? { events: [] } : {}) }) }))
  return { supervisor, h, authority, workspace, first, second, retained, broker, runtime }
}
// Once armed, the next ownership check of the session pauses: the takeover has read the writer and not yet cancelled it.
function pauseOwnershipCheck(f: Awaited<ReturnType<typeof setup>>, sessionId: string) {
  const reached = Promise.withResolvers<undefined>(), resumed = Promise.withResolvers<undefined>()
  const original = f.h.ctx.webIdentity.authorizeOwner.bind(f.h.ctx.webIdentity)
  let armed = false
  const spy = vi.spyOn(f.h.ctx.webIdentity, 'authorizeOwner').mockImplementation(async (...args) => {
    const value = await original(...args)
    if (armed && args[1].kind === 'session' && args[1].sessionId === sessionId) {
      armed = false
      reached.resolve(undefined)
      await resumed.promise
    }
    return value
  })
  return { arm() { armed = true }, reached: reached.promise, resume() { resumed.resolve(undefined) },
    restore() { resumed.resolve(undefined); spy.mockRestore() } }
}

describe('a restarted worker takes over a session writer only after the old lease is quiescent', () => {
  it('cancels the old writer lease, waits for its receipt, and then hydrates the new worker', async () => {
    const f = await setup()
    const old = await f.retained(), next = await f.retained()
    const oldWorker = randomUUID(), newWorker = randomUUID()
    expect((await f.broker(old.capability, oldWorker, f.first.id)).status).toBe(200)
    expect((await f.broker(next.capability, newWorker, f.first.id, 'append')).status).toBe(409)
    expect(f.supervisor.cancelled).toEqual([])
    const hydrated = await f.broker(next.capability, newWorker, f.first.id)
    expect(hydrated.status).toBe(200)
    expect(f.supervisor.cancelled).toEqual([old.id])
    expect(await old.outcome).toBe('cancelled')
    expect((await f.broker(next.capability, newWorker, f.first.id, 'append')).status).toBe(200)
    expect((await f.broker(old.capability, oldWorker, f.first.id)).status).toBe(403)
  })

  it('never cancels a live writer lease for the same worker', async () => {
    const f = await setup()
    const old = await f.retained(), next = await f.retained()
    const worker = randomUUID()
    expect((await f.broker(old.capability, worker, f.first.id)).status).toBe(200)
    expect((await f.broker(next.capability, worker, f.first.id)).status).toBe(200)
    expect(f.supervisor.cancelled).toEqual([])
    expect((await f.broker(old.capability, worker, f.first.id, 'append')).status).toBe(200)
  })

  it('refuses another worker presenting the writer lease itself without cancelling that lease', async () => {
    const f = await setup()
    const old = await f.retained()
    expect((await f.broker(old.capability, randomUUID(), f.first.id)).status).toBe(200)
    expect((await f.broker(old.capability, randomUUID(), f.first.id)).status).toBe(409)
    expect(f.supervisor.cancelled).toEqual([])
  })

  it('sends one cancellation for concurrent hydration requests of a new worker', async () => {
    const f = await setup()
    const old = await f.retained(), next = await f.retained()
    const oldWorker = randomUUID(), newWorker = randomUUID()
    expect((await f.broker(old.capability, oldWorker, f.first.id)).status).toBe(200)
    expect((await f.broker(old.capability, oldWorker, f.second.id)).status).toBe(200)
    const statuses = await Promise.all([f.broker(next.capability, newWorker, f.first.id),
      f.broker(next.capability, newWorker, f.second.id), f.broker(next.capability, newWorker, f.first.id)])
    expect(statuses.map(response => response.status)).toEqual([200, 200, 200])
    expect(f.supervisor.cancelled).toEqual([old.id])
  })

  it('refuses the takeover and closes the adapter when the old lease has no quiescent receipt', async () => {
    const f = await setup({ cancellationTimeoutMs: 200 })
    const old = await f.retained(), next = await f.retained()
    const oldWorker = randomUUID(), newWorker = randomUUID()
    expect((await f.broker(old.capability, oldWorker, f.first.id)).status).toBe(200)
    f.supervisor.cancellationGate(new Promise<void>(() => {}))
    const refused = await f.broker(next.capability, newWorker, f.first.id)
    expect(refused.status).toBe(503)
    expect(await refused.json()).toEqual({ error: 'Worker operation refused' })
    // A missing receipt closes the adapter: neither worker can write afterwards.
    expect((await f.broker(next.capability, newWorker, f.first.id, 'append')).status).toBe(403)
    await expect(f.runtime.invoke(f.authority, undefined, { type: 'client-request', method: 'llm.providers',
      payload: {}, rpcId: RpcId(randomUUID()) })).rejects.toMatchObject({ status: 503 })
    expect(f.h.ctx.logger.buffer.filter(message => message.type === 'error').map((message): unknown[] => message.args))
      .toEqual([['isolated runtime adapter closed: operation %s has no quiescent receipt (trigger: %s, cause: %s)',
        old.id, 'writer-handoff', 'TimeoutError']])
    f.supervisor.cancellationGate()
  })

  it('names the error code when the old lease receipt is larger than maxResponseBytes', async () => {
    const f = await setup({ maxResponseBytes: 32 })
    const old = await f.retained(), next = await f.retained()
    const oldWorker = randomUUID(), newWorker = randomUUID()
    expect((await f.broker(old.capability, oldWorker, f.first.id)).status).toBe(200)
    expect((await f.broker(next.capability, newWorker, f.first.id)).status).toBe(503)
    expect(f.supervisor.cancelled).toEqual([old.id])
    expect(f.h.ctx.logger.buffer.filter(message => message.type === 'error').map((message): unknown[] => message.args))
      .toEqual([['isolated runtime adapter closed: operation %s has no quiescent receipt (trigger: %s, cause: %s, code: %s)',
        old.id, 'writer-handoff', 'WebIdentityError', 'RUNTIME_LIMIT']])
  })

  it('stops waiting for the old lease when the takeover request itself is aborted', async () => {
    const f = await setup()
    const old = await f.retained(), next = await f.retained()
    const oldWorker = randomUUID(), newWorker = randomUUID()
    expect((await f.broker(old.capability, oldWorker, f.first.id)).status).toBe(200)
    let release!: () => void
    f.supervisor.cancellationGate(new Promise<void>((resolve) => { release = resolve }))
    const caller = new AbortController()
    const cancelled = f.supervisor.cancelledSignal()
    const takeover = f.broker(next.capability, newWorker, f.first.id, 'snapshot', caller.signal)
    await cancelled
    const started = Date.now()
    caller.abort()
    expect((await takeover).status).toBe(503)
    expect(Date.now() - started).toBeLessThan(1000)
    // The shared cancellation continues: once its receipt arrives the new worker hydrates.
    release()
    f.supervisor.cancellationGate()
    expect(await old.outcome).toBe('cancelled')
    expect((await f.broker(next.capability, newWorker, f.first.id)).status).toBe(200)
    expect(f.supervisor.cancelled).toEqual([old.id])
    expect(f.h.ctx.logger.buffer.filter(message => message.type === 'error')).toEqual([])
  })

  it('sends no cancellation for a writer lease that ended while the takeover was checking ownership', async () => {
    const f = await setup()
    const next = await f.retained()
    f.supervisor.hold(false)
    const oldWorker = randomUUID(), newWorker = randomUUID()
    // The old writer is an ordinary request: its receipt is quiescent, so its lease ends without a cancellation.
    const sent = Promise.withResolvers<string>(), receipt = Promise.withResolvers<undefined>()
    const fetchOriginal = globalThis.fetch.bind(globalThis)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
      const response = await fetchOriginal(...args)
      if (new URL(args[0] instanceof Request ? args[0].url : String(args[0])).pathname === '/api/llm.providers') {
        sent.resolve(new Headers(args[1]?.headers).get(WORKER_CAPABILITY_HEADER) ?? '')
        await receipt.promise
      }
      return response
    })
    const check = pauseOwnershipCheck(f, f.first.id)
    try {
      const old = f.runtime.invoke(f.authority, { kind: 'workspace', workspaceId: f.workspace.workspaceId },
        { type: 'client-request', method: 'llm.providers', payload: {}, rpcId: RpcId(randomUUID()) })
      const capability = await sent.promise
      expect((await f.broker(capability, oldWorker, f.first.id)).status).toBe(200)
      check.arm()
      const takeover = f.broker(next.capability, newWorker, f.first.id)
      await check.reached
      receipt.resolve(undefined)
      expect(await old).toEqual({ ok: true, value: {} })
      check.resume()
      expect((await takeover).status).toBe(200)
      expect(f.supervisor.cancelled).toEqual([])
      expect((await f.broker(next.capability, newWorker, f.first.id, 'append')).status).toBe(200)
    } finally { receipt.resolve(undefined); check.restore(); fetchSpy.mockRestore() }
  })

  it('still cancels the old writer when it appends under the same lease while the takeover is checking ownership', async () => {
    const f = await setup()
    const old = await f.retained(), next = await f.retained()
    const oldWorker = randomUUID(), newWorker = randomUUID()
    expect((await f.broker(old.capability, oldWorker, f.first.id)).status).toBe(200)
    const check = pauseOwnershipCheck(f, f.first.id)
    try {
      check.arm()
      const takeover = f.broker(next.capability, newWorker, f.first.id)
      await check.reached
      // The append records the same worker and lease again: the writer did not change.
      expect((await f.broker(old.capability, oldWorker, f.first.id, 'append')).status).toBe(200)
      check.resume()
      expect((await takeover).status).toBe(200)
      expect(f.supervisor.cancelled).toEqual([old.id])
      expect(await old.outcome).toBe('cancelled')
    } finally { check.restore() }
  })

  it('sends no cancellation when the writer moved to a newer lease while the takeover was checking ownership', async () => {
    const f = await setup()
    const old = await f.retained(), moved = await f.retained(), next = await f.retained()
    const oldWorker = randomUUID(), newWorker = randomUUID()
    expect((await f.broker(old.capability, oldWorker, f.first.id)).status).toBe(200)
    const check = pauseOwnershipCheck(f, f.first.id)
    try {
      check.arm()
      const takeover = f.broker(next.capability, newWorker, f.first.id)
      await check.reached
      // The old worker is alive: it hydrates again with a newer lease, which becomes the writer.
      expect((await f.broker(moved.capability, oldWorker, f.first.id)).status).toBe(200)
      check.resume()
      expect((await takeover).status).toBe(409)
      expect(f.supervisor.cancelled).toEqual([])
      expect((await f.broker(moved.capability, oldWorker, f.first.id, 'append')).status).toBe(200)
    } finally { check.restore() }
  })

  it('refuses a takeover request outside the session owner and workspace before cancelling anything', async () => {
    const f = await setup()
    const old = await f.retained()
    const oldWorker = randomUUID(), newWorker = randomUUID()
    expect((await f.broker(old.capability, oldWorker, f.first.id)).status).toBe(200)
    const other = f.h.users[1]!.authority
    const otherProject = await f.h.ctx.projectStorage.createProject(other, 'Other')
    const otherWorkspace = await f.h.ctx.projectStorage.createWorkspace(other, otherProject.projectId, 'Other')
    const foreign = await f.retained(other, otherWorkspace.workspaceId)
    expect((await f.broker(foreign.capability, newWorker, f.first.id)).status).toBe(403)
    expect(f.supervisor.cancelled).toEqual([])
    expect((await f.broker(old.capability, oldWorker, f.first.id, 'append')).status).toBe(200)
  })
})
