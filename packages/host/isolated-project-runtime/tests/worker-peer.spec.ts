import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { rm } from 'node:fs/promises'
import { promises as fsPromises } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { randomUUID } from 'node:crypto'
import SessionStore, { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { MessageId, freezeMessage } from '@arx-ai/arx-llm'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import OwnedWorkerPersistence from '../src/worker-persistence.ts'
import type { WorkerPersistenceConfig } from '../src/worker-persistence.ts'
import { WORKER_CAPABILITY_HEADER } from '../src/broker-contract.ts'
import { supervisorFixture } from './supervisor.ts'

describe('native worker provider over a real private broker transport', () => {
  let h: Awaited<ReturnType<typeof storageHarness>>
  let supervisor: Awaited<ReturnType<typeof supervisorFixture>>
  let own: Awaited<ReturnType<typeof seed>>
  let capability: string
  let origin: string
  let pending: Promise<string>
  let onOperation: ((operation: string) => void) | undefined
  let override: ((operation: string, value: unknown) => { status?: number
    body: string }) | undefined
  const fixtures: Awaited<ReturnType<typeof identityHarness>>[] = []
  async function handleFixtureRequest(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk as Uint8Array))
      const body = Buffer.concat(chunks).toString()
      const operation = (JSON.parse(body) as { operation: string }).operation
      onOperation?.(operation)
      const reply = await h.ctx.isolatedProjectRuntime.broker(new Request('http://fixture' + String(incoming.url), { method: 'POST',
        headers: { 'content-type': 'application/json',
          [WORKER_CAPABILITY_HEADER]: String(incoming.headers[WORKER_CAPABILITY_HEADER]) }, body }))
      const text = await reply.text()
      const selected = override?.(operation, JSON.parse(text))
      outgoing.writeHead(selected?.status ?? reply.status, { 'content-type': 'application/json' })
      outgoing.end(selected?.body ?? text)
    } catch { outgoing.writeHead(503); outgoing.end('{"error":"fixture transport failure"}') }
  }
  const peer = createServer((incoming, outgoing) => { void handleFixtureRequest(incoming, outgoing) })
  async function seed() {
    const authority = h.users[0]!.authority
    const project = await h.ctx.projectStorage.createProject(authority, 'Own broker project')
    const workspace = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Own broker workspace')
    const provision = await h.ctx.projectStorage.provision(authority, workspace.workspaceId)
    const meta = await h.ctx.projectStorage.register(authority, workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
    await h.ctx.projectStorage.append(authority, meta.id, oneTurnLog())
    return { authority, workspace, scope: provision.scope, meta, provision }
  }
  beforeAll(async () => {
    supervisor = await supervisorFixture()
    h = await storageHarness({ endpoint: supervisor.endpoint, readyUsers: 1 })
    own = await seed()
    peer.listen(0, '127.0.0.1'); await once(peer, 'listening')
    const address = peer.address()
    if (address === null || typeof address === 'string') throw new Error('fixture private peer missing')
    origin = 'http://127.0.0.1:' + String(address.port)
  })
  beforeEach(async () => {
    supervisor.hold(true)
    const accepted = supervisor.acceptedSignal()
    pending = h.ctx.isolatedProjectRuntime.invoke(own.authority, undefined,
      { type: 'client-request', rpcId: RpcId(randomUUID()), method: 'session.prompt',
        payload: { sessionId: own.meta.id, mode: 'queue', content: [] } }).then(() => 'unexpected', () => 'cancelled')
    await accepted
    capability = [...supervisor.operations.values()][0]!.capability
  })
  afterEach(async () => {
    override = undefined; onOperation = undefined
    for (const fixture of fixtures.splice(0)) await fixture.close()
    await h.ctx.isolatedProjectRuntime.quiesce(own.authority.principal.userId)
    expect(await pending).toBe('cancelled')
  })
  afterAll(async () => {
    await h?.close(); await supervisor?.close()
    peer.closeAllConnections()
    await new Promise<void>((resolve, reject) => peer.close((error) =>{  if (error !== undefined) reject(error); else resolve() }))
  })
  function config(extra: Partial<WorkerPersistenceConfig> = {}): WorkerPersistenceConfig {
    return { controlOrigin: origin, workerId: randomUUID(), ...own.scope, volumePath: own.provision.volumePath,
      fixtureLoopback: true, requestTimeoutMs: 5000, maxResponseBytes: 16384, rawPageBytes: 400, ...extra }
  }
  async function worker(extra: Partial<WorkerPersistenceConfig> = {}) {
    const fixture = await identityHarness({ extraPlugins: [
      { name: '@arx-ai/arx-session', plugin: SessionStore },
      { name: '@arx-ai/arx-isolated-project-runtime/worker', plugin: OwnedWorkerPersistence, config: config(extra) },
    ] })
    fixtures.push(fixture)
    return fixture.ctx.ownedWorkerHistory
  }
  it.each([
    { controlOrigin: 'http://external.invalid', fixtureLoopback: true },
    { controlOrigin: 'http://127.0.0.1', fixtureLoopback: false },
    { controlOrigin: 'https://user@fixture.invalid' },
    { controlOrigin: 'https://:password@fixture.invalid' },
    { controlOrigin: 'https://fixture.invalid/path' },
    { controlOrigin: 'https://fixture.invalid/?x=1' },
    { controlOrigin: 'https://fixture.invalid/#x' },
  ])('rejects untrusted operator control origins: $controlOrigin', async (extra) => {
    await expect(worker(extra)).rejects.toThrow('credential-free HTTPS origin')
  })
  it('does not call any broker before binding one actual owner lease and rejects changed fixed scope', async () => {
    const persistence = await worker()
    await expect(persistence.list()).rejects.toThrow('capability unavailable')
    expect(() =>{  persistence.bind('invalid', own.scope) }).toThrow('scope differs')
    for (const field of ['userId', 'projectId', 'workspaceId'] as const) {
      expect(() =>{  persistence.bind(capability, { ...own.scope, [field]: randomUUID() }) }).toThrow('scope differs')
    }
    persistence.bind(capability, own.scope)
    expect((await persistence.list()).map(value => value.id)).toContain(own.meta.id)
  })
  it('creates and appends through the real coordinator and hydrates only its fixed operator mount', async () => {
    const persistence = await worker()
    persistence.bind(capability, own.scope)
    const meta = await h.ctx.projectStorage.register(own.authority, own.workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 2 })
    await persistence.create(meta)
    await persistence.append(meta.id, oneTurnLog())
    expect((await persistence.load(meta.id)).events).toEqual(oneTurnLog())
    expect((await persistence.readFrom(meta.id, 2)).events).toEqual(oneTurnLog().slice(2))
    const revision = await h.ctx.sessionPersistence.readRevision(meta.id)
    expect(revision).toBeDefined()
    expect(await persistence.readRevision(meta.id)).toBe(revision)
    expect((await persistence.listSnapshots()).map(value => value.header.id)).toContain(meta.id)
    expect(persistence.locate(meta)).toBeUndefined()
  })
  it('refuses control fork receipts whose immutable lineage, mount or preset differs from the requested parent', async () => {
    const persistence = await worker()
    persistence.bind(capability, own.scope)
    const original = await h.ctx.sessionPersistence.readRaw(own.meta.id)
    if (original === undefined) throw new Error('materialized own fixture missing')
    for (const changed of [
      { parentSession: SessionId(randomUUID()) },
      { seedLength: oneTurnLog().length + 1 },
      { cwd: own.provision.volumePath + '/different-mount' },
      { agentPreset: 'different-preset' },
    ]) {
      override = (operation, value) => {
        if (operation !== 'allocate-fork' || typeof value !== 'object' || value === null || !('value' in value)
          || typeof value.value !== 'object' || value.value === null) {
          throw new Error('actual control fork header missing')
        }
        return { body: JSON.stringify({ ...value, value: { ...value.value, ...changed } }) }
      }
      await expect(persistence.allocateForkSessionHeader(own.meta.id, oneTurnLog().length))
        .rejects.toThrow('worker fork allocation header differs')
    }
    override = undefined
    expect((await h.ctx.sessionPersistence.readRaw(own.meta.id))?.content).toBe(original.content)
  })
  it('refuses oversized and error broker receipts while keeping already durable original bytes intact', async () => {
    const persistence = await worker({ maxResponseBytes: 1500 })
    persistence.bind(capability, own.scope)
    const before = (await h.ctx.sessionPersistence.readRaw(own.meta.id))!.content
    override = () => ({ body: 'x'.repeat(1501) })
    await expect(persistence.list()).rejects.toThrow('response limit')
    override = () => ({ body: '{"error":"fixture broker error"}' })
    await expect(persistence.list()).rejects.toThrow('operation refused')
    override = (_operation, value) => ({ status: 503, body: JSON.stringify(value) })
    await expect(persistence.list()).rejects.toThrow('operation refused')
    override = undefined
    expect((await h.ctx.sessionPersistence.readRaw(own.meta.id))!.content).toBe(before)
  })
  it('refuses nonadvancing raw cursors and total export overflow across valid bounded pages', async () => {
    const persistence = await worker({ maxResponseBytes: 1500 })
    persistence.bind(capability, own.scope)
    override = (operation, value) => {
      if (operation !== 'raw-page') return { body: JSON.stringify(value) }
      const reply = value as { value: Record<string, unknown> }
      return { body: JSON.stringify({ value: { ...reply.value, nextOffset: 0 } }) }
    }
    await expect(persistence.readRaw(own.meta.id)).rejects.toThrow('cursor did not advance')
    override = undefined
    const large = await h.ctx.projectStorage.register(own.authority, own.workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 3 })
    const events = oneTurnLog().map(event => event.type === 'user/message' ? { ...event, data: freezeMessage({
      id: MessageId('large-owned-export'), role: 'user', content: [{ type: 'text', text: 'x'.repeat(4000) }], source: { kind: 'user' },
    }) } : event)
    await h.ctx.projectStorage.append(own.authority, large.id, events)
    await expect(persistence.readRaw(large.id)).rejects.toThrow('raw artifact response limit')
    expect((await h.ctx.sessionPersistence.readRaw(large.id))!.content).toContain('x'.repeat(4000))
  })
  it('refuses a second native worker boot for the same live session and retains the first writer', async () => {
    const first = await worker()
    first.bind(capability, own.scope)
    expect((await first.loadStored(own.meta.id))?.meta.id).toBe(own.meta.id)
    const second = await worker()
    second.bind(capability, own.scope)
    await expect(second.loadStored(own.meta.id)).rejects.toThrow('operation refused')
    expect((await first.loadStored(own.meta.id))?.meta.id).toBe(own.meta.id)
  })
  it('refuses an actual worker capability rebound to another owned workspace without changing original bytes', async () => {
    const before = (await h.ctx.sessionPersistence.readRaw(own.meta.id))!.content
    const project = await h.ctx.projectStorage.createProject(own.authority, 'Other own broker project')
    const workspace = await h.ctx.projectStorage.createWorkspace(own.authority, project.projectId, 'Other own broker workspace')
    const provision = await h.ctx.projectStorage.provision(own.authority, workspace.workspaceId)
    const other = await worker({ projectId: project.projectId, workspaceId: workspace.workspaceId, volumePath: provision.volumePath })
    other.bind(capability, provision.scope)
    await expect(other.loadStored(own.meta.id)).rejects.toThrow('operation refused')
    expect((await h.ctx.sessionPersistence.readRaw(own.meta.id))!.content).toBe(before)
  })
  it('settles a failed durable append before a queued native snapshot and preserves the original bytes', async () => {
    const persistence = await worker()
    persistence.bind(capability, own.scope)
    const stored = await persistence.loadStored(own.meta.id)
    if (stored === undefined) throw new Error('real owned source missing')
    const before = (await h.ctx.sessionPersistence.readRaw(own.meta.id))!.content
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    const queued = Promise.withResolvers<undefined>()
    const seq = stored.events.length
    const batch: import('@arx-ai/arx-session').SessionEvent[] = [
      { type: 'turn/start', seq, time: 10, data: { turn: 2 } },
      { type: 'user/message', seq: seq + 1, time: 11, surfaceOp: 'append', data: freezeMessage({
        id: MessageId('queued-append'), role: 'user', content: [{ type: 'text', text: 'Owned append' }], source: { kind: 'user' },
      }) },
      { type: 'turn/end', seq: seq + 2, time: 12, data: { turn: 2, reason: { kind: 'completed' } } },
    ]
    const append = vi.spyOn(h.ctx.sessionPersistence, 'append').mockImplementation(async () => {
      entered.resolve(undefined)
      await release.promise
      throw Object.assign(new Error('fixture durable write refused'), { code: 'ENOSPC' })
    })
    const writing = persistence.appendBatch(stored.meta, batch, true).then(() => 'unexpected', (error: unknown) => error)
    try {
      await entered.promise
      onOperation = (operation) => { if (operation === 'snapshot') queued.resolve(undefined) }
      const reading = persistence.loadStored(own.meta.id).then(value => ({ value }), (error: unknown) => ({ error }))
      await queued.promise
      release.resolve(undefined)
      expect(await writing).toBeInstanceOf(Error)
      const loaded = await reading
      if ('error' in loaded) throw new Error('queued owned snapshot failed', { cause: loaded.error })
      expect(loaded.value?.events).toEqual(stored.events)
      expect((await h.ctx.sessionPersistence.readRaw(own.meta.id))!.content).toBe(before)
    } finally { release.resolve(undefined); append.mockRestore(); onOperation = undefined }
  })
  it('omits a snapshot physically removed after the authorized header scan and before physical revision qualification', async () => {
    const persistence = await worker()
    persistence.bind(capability, own.scope)
    const snapshots = await h.ctx.sessionPersistence.listSnapshots()
    const paths = new Set(snapshots.flatMap((snapshot) => {
      const location = h.ctx.sessionPersistence.locate(snapshot.header)
      return location?.kind === 'jsonl' ? [location.path] : []
    }))
    const originalStat = fsPromises.stat
    let removed = false
    // The original JSONL listSnapshots awaits its real header/identity scan before
    // this bigint stat. Delegate the actual stat after real deletion: ENOENT is genuine.
    const qualification = vi.spyOn(fsPromises, 'stat').mockImplementation(async (path, options) => {
      if (!removed && options?.bigint === true && paths.has(String(path))) {
        removed = true
        for (const source of paths) await rm(source)
      }
      return originalStat(path, options)
    })
    syncBuiltinESMExports()
    try {
      const listed = await persistence.listSnapshots()
      expect(listed).toEqual([])
      expect(removed).toBe(true)
    } finally { qualification.mockRestore(); syncBuiltinESMExports() }
  })
})
