/**
 * Genuine Node HTTP parser/socket cases for the private history broker.
 * Diagnostics observes actual requests; it does not construct or mock them.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { channel } from 'node:diagnostics_channel'
import { IncomingMessage, ServerResponse, request } from 'node:http'
import { randomUUID } from 'node:crypto'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import * as BrokerHttp from '../src/broker-http.ts'
import { WORKER_BROKER_PATH, WORKER_CAPABILITY_HEADER } from '../src/broker-contract.ts'
import { nativeSupervisorFixture } from './native-supervisor.ts'

interface WireResult { status: number; text: string; cacheControl: string | undefined }

describe('private broker over genuine Node HTTP lifecycle', () => {
  let supervisor: Awaited<ReturnType<typeof nativeSupervisorFixture>>
  let harness: Awaited<ReturnType<typeof storageHarness>>
  let workspaceId: Awaited<ReturnType<typeof harness.ctx.projectStorage.createWorkspace>>['workspaceId']
  let sessionId: ReturnType<typeof SessionId>
  let workerId: string
  let capability: string
  let abort: AbortController
  let mux: AsyncIterator<unknown>
  let origin: string

  function authority() {
    const user = harness.users[0]
    if (user === undefined) throw new Error('ready broker USER fixture missing')
    return user.authority
  }
  function body(operation = 'list') {
    return JSON.stringify({ operation, workerId, workspaceId })
  }
  function observe(marker: string, handler: (incoming: IncomingMessage, outgoing: ServerResponse) => void) {
    const diagnostics = channel('http.server.request.start')
    const listener = (message: unknown) => {
      if (typeof message !== 'object' || message === null || !('request' in message) || !('response' in message)) return
      const incoming = message.request, outgoing = message.response
      if (!(incoming instanceof IncomingMessage) || !(outgoing instanceof ServerResponse)
        || incoming.headers['x-arx-fixture-observer'] !== marker) return
      handler(incoming, outgoing as ServerResponse)
    }
    diagnostics.subscribe(listener)
    return () =>{  diagnostics.unsubscribe(listener) }
  }
  async function collect(incoming:IncomingMessage):Promise<WireResult> {
    const chunks: Buffer[] = []
    for await (const value of incoming as AsyncIterable<Buffer | string>) {
      chunks.push(typeof value === 'string' ? Buffer.from(value) : value)
    }
    return { status: incoming.statusCode ?? 0, text: Buffer.concat(chunks).toString(),
      cacheControl: incoming.headers['cache-control'] }
  }
  function wire(method: string, content?: string, requestHeaders: Record<string, string> = {},
    path = WORKER_BROKER_PATH): Promise<WireResult> {
    return new Promise<WireResult>((resolve, reject) => {
      const client = request(origin, { method, path, agent: false, headers: requestHeaders }, (incoming) => {
        collect(incoming).then(resolve, reject)
      })
      client.once('error', reject)
      client.end(content)
    })
  }
  function authorized(marker?: string) {
    return { 'content-type': 'application/json', [WORKER_CAPABILITY_HEADER]: capability,
      ...(marker === undefined ? {} : { 'x-arx-fixture-observer': marker }) }
  }

  beforeAll(async () => {
    supervisor = await nativeSupervisorFixture()
    harness = await storageHarness({ endpoint: supervisor.endpoint, http: true,
      runtimeConfig: { requestTimeoutMs: 1000, maxRequestBytes: 1024 },
      extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp }] })
    if (harness.url === undefined) throw new Error('real broker HTTP endpoint missing')
    origin = harness.url
    const project = await harness.ctx.projectStorage.createProject(authority(), 'Broker USER project')
    const workspace = await harness.ctx.projectStorage.createWorkspace(authority(), project.projectId, 'Broker workspace')
    workspaceId = workspace.workspaceId
    const provision = await harness.ctx.projectStorage.provision(authority(), workspaceId)
    supervisor.assign({ controlOrigin: origin, scope: provision.scope, volumePath: provision.volumePath })
    const meta = await harness.ctx.projectStorage.register(authority(), workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1000 })
    sessionId = meta.id
    await harness.ctx.projectStorage.append(authority(), sessionId, oneTurnLog())
    expect(await harness.ctx.isolatedProjectRuntime.invoke(authority(), undefined,
      { type: 'client-request', method: 'session.create', payload: { sessionId },
        rpcId: RpcId(randomUUID()) })).toMatchObject({ ok: true })
    abort = new AbortController()
    mux = harness.ctx.isolatedProjectRuntime.streamMux(authority(), abort.signal)[Symbol.asyncIterator]()
    expect((await mux.next()).done).toBe(false)
    const context = supervisor.ctxOf(workspaceId), headers = supervisor.headersOf(workspaceId)
    const token = headers?.get(WORKER_CAPABILITY_HEADER)
    if (context === undefined || token === undefined || token === null) throw new Error('genuine private lease missing')
    workerId = context.ownedWorkerHistory.config.workerId
    capability = token
  })
  afterAll(async () => { abort?.abort(); await mux?.return?.(); await harness?.close(); await supervisor?.close() })

  it('refuses GET/HEAD and absent JSON or capability without accepting a browser credential', async () => {
    for (const method of ['GET', 'HEAD']) {
      const result = await wire(method)
      expect(result.status).toBe(404)
      expect(result.cacheControl).toBe('no-store')
      expect(result.text).toBe(method === 'HEAD' ? '' : '{"error":"Worker operation refused"}')
    }
    const noType = await wire('POST', body(), { [WORKER_CAPABILITY_HEADER]: capability })
    expect(noType.status).toBe(415)
    const noCapability = await wire('POST', body(), { 'content-type': 'application/json' })
    expect(noCapability.status).toBe(403)
    expect(noCapability.text).toBe('{"error":"Worker operation refused"}')
  })

  it('reads a lazy canonical creation header without materialization and refuses foreign metadata and injected fields', async () => {
    const lazy = await harness.ctx.projectStorage.register(authority(), workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1234 })
    const metadata = { operation: 'creation-header', workerId, workspaceId, sessionId: lazy.id }
    const result = await wire('POST', JSON.stringify(metadata), authorized())
    expect(result.status).toBe(200)
    expect(JSON.parse(result.text)).toEqual({ value: lazy })
    expect(result.cacheControl).toBe('no-store')
    expect(await harness.ctx.projectStorage.executionRevision(authority(), lazy.id)).toBeUndefined()
    expect(await harness.ctx.projectStorage.executionRawPage(authority(), lazy.id, { offset: 0, maxBytes: 400 })).toBeUndefined()
    const foreign = harness.users[1]!
    const project = await harness.ctx.projectStorage.createProject(foreign.authority, 'Foreign metadata owner')
    const workspace = await harness.ctx.projectStorage.createWorkspace(foreign.authority, project.projectId, 'Foreign metadata workspace')
    const header = await harness.ctx.projectStorage.register(foreign.authority, workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 5678 })
    const refused = await wire('POST', JSON.stringify({ ...metadata, sessionId: header.id }), authorized())
    expect(refused.status).toBe(403)
    expect(JSON.parse(refused.text)).toEqual({ error: 'Worker operation refused' })
    const injected = await wire('POST', JSON.stringify({ ...metadata, createdAt: 9999 }), authorized())
    expect(injected.status).toBe(400)
    expect(JSON.parse(injected.text)).toEqual({ error: 'Worker operation refused' })
    const controller = new AbortController(), reason = new Error('creation metadata admission cancelled')
    controller.abort(reason)
    await expect(harness.ctx.projectStorage.executionCreationHeader(authority(), lazy.id, controller.signal)).rejects.toBe(reason)
    await expect(harness.ctx.projectStorage.executionCreationHeader(foreign.authority, lazy.id))
      .rejects.toMatchObject({ code: 'OWNER_FORBIDDEN', status: 403 })
    expect(await harness.ctx.projectStorage.executionRevision(authority(), lazy.id)).toBeUndefined()
    expect(supervisor.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
  })

  it('accepts string chunks from an actual IncomingMessage setEncoding and preserves the owned result', async () => {
    const marker = randomUUID()
    let encoding: string | null = null
    const dispose = observe(marker, (incoming) => { incoming.setEncoding('utf8'); encoding = incoming.readableEncoding })
    try {
      const response = await wire('POST', body(), authorized(marker))
      expect(encoding).toBe('utf8')
      expect(response.status).toBe(200)
      const data: unknown = JSON.parse(response.text)
      expect(data).toMatchObject({ value: [expect.objectContaining({ id: sessionId })] })
      expect(response.cacheControl).toBe('no-store')
    } finally { dispose() }
  })

  it('bounds an actual oversized body before any broker allocation', async () => {
    const before = await harness.ctx.projectStorage.list(authority(), { kind: 'workspace', workspaceId })
    const response = await wire('POST', 'x'.repeat(1025), authorized())
    expect(response.status).toBe(413)
    expect(response.text).toBe('')
    expect((await harness.ctx.projectStorage.list(authority(), { kind: 'workspace', workspaceId })).sessions)
      .toEqual(before.sessions)
  })

  it('refuses a genuine absolute-form proxy request that does not address the closed broker path', async () => {
    const result = await wire('POST', body(), authorized(),
      'http://proxy-target.fixture' + WORKER_BROKER_PATH)
    expect(result.status).toBe(404)
    expect(result.cacheControl).toBe('no-store')
    expect(result.text).toBe('{"error":"Worker operation refused"}')
  })

  it('never allocates a fork when the actual partial request exceeds its configured socket deadline', async () => {
    const marker = randomUUID(), started = Promise.withResolvers<undefined>(), timedOut = Promise.withResolvers<undefined>()
    const dispose = observe(marker, (incoming) => {
      incoming.socket.once('timeout', () => { timedOut.resolve(undefined) })
      started.resolve(undefined)
    })
    const before = await harness.ctx.projectStorage.list(authority(), { kind: 'workspace', workspaceId })
    const fork = JSON.stringify({ operation: 'allocate-fork', workerId, workspaceId, sessionId,
      seedLength: oneTurnLog().length })
    const settled = Promise.withResolvers<WireResult>()
    const client = request(origin, { method: 'POST', path: WORKER_BROKER_PATH, agent: false,
      headers: authorized(marker) }, (incoming) => {
      collect(incoming).then(settled.resolve, settled.reject)
    })
    const outcome = settled.promise.catch((error: unknown) => { throw error })
    client.once('error', settled.reject)
    try {
      client.write(fork.slice(0, 1))
      await started.promise
      await timedOut.promise
      client.end(fork.slice(1))
      const result = await outcome
      const after = await harness.ctx.projectStorage.list(authority(), { kind: 'workspace', workspaceId })
      const existing = new Set(before.sessions.map(item => item.sessionId))
      const allocationsAfterDeadline = after.sessions.filter(item => !existing.has(item.sessionId)).length
      expect(allocationsAfterDeadline, 'ownership allocations after the actual socket deadline').toBe(0)
      expect(result.status).toBe(503)
    } finally { dispose(); client.destroy() }
  })

  it('observes a real client disconnect while reading a partial body without a mutation or receipt', async () => {
    const marker = randomUUID(), started = Promise.withResolvers<undefined>(), aborted = Promise.withResolvers<undefined>(),
      closed = Promise.withResolvers<undefined>()
    const dispose = observe(marker, (incoming, outgoing) => {
      incoming.once('aborted', () => { aborted.resolve(undefined) })
      outgoing.once('close', () => { closed.resolve(undefined) })
      started.resolve(undefined)
    })
    const before = await harness.ctx.projectStorage.list(authority(), { kind: 'workspace', workspaceId })
    const client = request(origin, { method: 'POST', path: WORKER_BROKER_PATH, agent: false,
      headers: authorized(marker) })
    client.on('error', () => {})
    let receipts = 0
    client.on('response', (incoming) => { receipts++; incoming.resume() })
    try {
      client.write('{')
      await started.promise
      client.destroy()
      await Promise.all([aborted.promise, closed.promise])
      expect(receipts).toBe(0)
      expect((await harness.ctx.projectStorage.list(authority(), { kind: 'workspace', workspaceId })).sessions)
        .toEqual(before.sessions)
    } finally { dispose(); client.destroy() }
  })

  it('refuses retained creation metadata after real logout without materializing its owned lazy log', async () => {
    const user = harness.users[0]!
    const login = await harness.ctx.webIdentity.login(user.username, user.password, 'user')
    const fresh = await harness.ctx.webIdentity.authenticate(login.token, 'user')
    const lazy = await harness.ctx.projectStorage.register(fresh, workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 2468 })
    const controller = new AbortController()
    const stream = harness.ctx.isolatedProjectRuntime.streamMux(fresh, controller.signal)[Symbol.asyncIterator]()
    expect((await stream.next()).done).toBe(false)
    const headers = supervisor.headersOf(workspaceId)
    const privateCapability = headers?.get(WORKER_CAPABILITY_HEADER)
    if (privateCapability === undefined || privateCapability === null) throw new Error('fresh metadata lease unavailable')
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    const read = harness.ctx.projectStorage.executionCreationHeader.bind(harness.ctx.projectStorage)
    const retained = vi.spyOn(harness.ctx.projectStorage, 'executionCreationHeader').mockImplementationOnce(async (...args) => {
      const header = await read(...args)
      entered.resolve(undefined)
      await release.promise
      return header
    })
    try {
      const pending = harness.ctx.isolatedProjectRuntime.broker(new Request('http://fixture' + WORKER_BROKER_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json', [WORKER_CAPABILITY_HEADER]: privateCapability },
        body: JSON.stringify({ operation: 'creation-header', workerId, workspaceId, sessionId: lazy.id }),
      }))
      await entered.promise
      const logout = harness.ctx.webIdentity.logout(fresh)
      await vi.waitFor(async () => {
        await expect(harness.ctx.webIdentity.revalidate(fresh)).rejects.toMatchObject({ code: 'AUTH_INVALID' })
      })
      release.resolve(undefined)
      const refused = await pending
      expect(refused.ok).toBe(false)
      expect(await refused.json()).toEqual({ error: 'Worker operation refused' })
      await logout
      await expect(harness.ctx.webIdentity.revalidate(authority())).rejects.toMatchObject({ code: 'AUTH_INVALID' })
      // Logout revokes every SID for this USER. Inspect with newly issued owner
      // authority while retaining real revision, grant and resource checks.
      const inspectedLogin = await harness.ctx.webIdentity.login(user.username, user.password, 'user')
      const inspector = await harness.ctx.webIdentity.authenticate(inspectedLogin.token, 'user')
      expect(await harness.ctx.projectStorage.executionRevision(inspector, lazy.id)).toBeUndefined()
      expect(await harness.ctx.projectStorage.executionRawPage(inspector, lazy.id, { offset: 0, maxBytes: 400 })).toBeUndefined()
      expect(supervisor.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
    } finally { release.resolve(undefined); retained.mockRestore(); controller.abort(); await stream.return?.() }
  })
})
