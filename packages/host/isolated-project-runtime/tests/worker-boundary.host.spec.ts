/**
 * Native worker boundary cases over real Loader services and control-issued leases.
 * Capabilities are held only in memory and never printed or snapshotted.
 */
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it } from 'vitest'
import type { Context } from '@arx-ai/cordis'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { strFromU8, unzipSync } from 'fflate'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import type { ClientRequest } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { installLlmReplay } from '@arx-ai/arx-llm-replay'
import { defineContentToolFixture } from '@arx-ai/arx-tools'
import { textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import * as BrokerHttp from '../src/broker-http.ts'
import { WORKER_CAPABILITY_HEADER } from '../src/broker-contract.ts'
import type { toOwnedWorkerFetch } from '../src/worker-boundary.ts'
import { nativeSupervisorFixture } from './native-supervisor.ts'

describe('native owned worker boundary with genuine authority and host frames', () => {
  let supervisor: Awaited<ReturnType<typeof nativeSupervisorFixture>>
  let harness: Awaited<ReturnType<typeof storageHarness>>
  let workspaceId: Awaited<ReturnType<typeof harness.ctx.projectStorage.createWorkspace>>['workspaceId']
  let volumePath: string
  let sessionId: ReturnType<typeof SessionId>
  let worker: Context
  let headers: Headers
  let boundary: ReturnType<typeof toOwnedWorkerFetch>
  let abort: AbortController
  let mux: AsyncIterator<unknown>

  function authority() {
    const user = harness.users[0]
    if (user === undefined) throw new Error('ready native USER fixture missing')
    return user.authority
  }
  const envelope = (method: string, payload: unknown = {}): ClientRequest =>
    ({ type: 'client-request', method, payload, rpcId: RpcId(randomUUID()) })
  function post(method: string, payload: unknown = {}, requestHeaders = headers) {
    return new Request('http://fixture/api/' + method, { method: 'POST',
      headers: new Headers(requestHeaders), body: JSON.stringify(envelope(method, payload)) })
  }
  function get(path: string, signal?: AbortSignal) {
    return new Request('http://fixture' + path, { headers: new Headers(headers),
      ...(signal === undefined ? {} : { signal }) })
  }

  beforeAll(async () => {
    supervisor = await nativeSupervisorFixture({ dispatchRemotes: false })
    harness = await storageHarness({ endpoint: supervisor.endpoint, http: true,
      extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp }] })
    const project = await harness.ctx.projectStorage.createProject(authority(), 'Boundary USER project')
    const workspace = await harness.ctx.projectStorage.createWorkspace(authority(), project.projectId, 'Boundary workspace')
    workspaceId = workspace.workspaceId
    const provision = await harness.ctx.projectStorage.provision(authority(), workspaceId)
    volumePath = provision.volumePath
    if (harness.url === undefined) throw new Error('control HTTP fixture missing')
    supervisor.assign({ controlOrigin: harness.url, scope: provision.scope, volumePath })
  })
  beforeEach(async () => {
    await supervisor.restart()
    const created = await harness.ctx.isolatedProjectRuntime.invoke(authority(), undefined,
      envelope('session.create', { workspaceId }))
    expect(created).toMatchObject({ ok: true })
    if (!created.ok) throw new Error('real native session allocation refused')
    sessionId = SessionId((created.value as { sessionId: string }).sessionId)
    abort = new AbortController()
    mux = harness.ctx.isolatedProjectRuntime.streamMux(authority(), abort.signal)[Symbol.asyncIterator]()
    const first = mux.next()
    await sleep(50)
    expect(await harness.ctx.isolatedProjectRuntime.invoke(authority(), undefined,
      envelope('session.history', { sessionId }))).toMatchObject({ ok: true })
    expect((await first).done).toBe(false)
    const context = supervisor.ctxOf(workspaceId), captured = supervisor.streamHeadersOf(workspaceId)
    if (context === undefined || captured === undefined) throw new Error('native lease not captured')
    worker = context
    headers = captured
    headers.set('content-type', 'application/json')
    const carrier = supervisor.carrierOf(workspaceId)
    if (carrier === undefined) throw new Error('unique native worker carrier missing')
    boundary = carrier
  })
  afterEach(async () => { abort?.abort(); await mux?.return?.() })
  afterAll(async () => { await harness?.close(); await supervisor?.close() })

  it('refuses a wrong owner, project, workspace and missing private capability before native dispatch', async () => {
    const other = harness.users[1]
    if (other === undefined) throw new Error('second ready USER fixture missing')
    for (const [header, value] of [['x-arx-user-id', other.authority.principal.userId],
      ['x-arx-project-id', randomUUID()], ['x-arx-workspace-id', randomUUID()]] as const) {
      const changed = new Headers(headers)
      changed.set(header, value)
      const response = await boundary.fetch(post('host.describe', {}, changed))
      expect(response.status).toBe(403)
      expect(await response.text()).toMatch(/Worker (owner|scope) refused/u)
    }
    const absent = new Headers(headers)
    absent.delete(WORKER_CAPABILITY_HEADER)
    await expect(boundary.fetch(post('host.describe', {}, absent))).rejects.toThrow('worker capability scope differs')
    const snapshot = await harness.ctx.projectStorage.list(authority(), { kind: 'workspace', workspaceId })
    expect(snapshot.sessions.map(value => value.sessionId)).toContain(sessionId)
    expect(supervisor.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
  })

  it('returns 409 for an already aborted request without starting worker work', async () => {
    const sessions = worker.sessions.list().length
    const before = await harness.ctx.projectStorage.list(authority(), { kind: 'workspace', workspaceId })
    const controller = new AbortController()
    controller.abort()
    for (const request of [post('session.create', { workspaceId }), post('host.describe'), get('/api/session.export')]) {
      const response = await boundary.fetch(new Request(request, { signal: controller.signal }))
      expect(response.status).toBe(409)
      expect(await response.text()).toBe('Worker request aborted')
    }
    expect(worker.sessions.list()).toHaveLength(sessions)
    expect((await harness.ctx.projectStorage.list(authority(), { kind: 'workspace', workspaceId })).sessions)
      .toEqual(before.sessions)
    expect(supervisor.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
  })

  it('keeps the scoped history capability when an unscoped request reaches the worker', async () => {
    await boundary.fetch(post('llm.providers'))
    await expect(worker.ownedWorkerHistory.list()).resolves.toEqual(expect.any(Array))
    const unscoped = new Headers(headers)
    unscoped.delete('x-arx-workspace-id')
    unscoped.delete('x-arx-project-id')
    unscoped.set(WORKER_CAPABILITY_HEADER, 'u'.repeat(43))
    await boundary.fetch(post('llm.providers', {}, unscoped))
    await expect(worker.ownedWorkerHistory.list()).resolves.toEqual(expect.any(Array))
  })

  it('fails closed for canonical Remote without a dispatcher and rejects another workspace on session creation', async () => {
    const remote = await boundary.fetch(post('commands/list', { args: { agentId: sessionId } }))
    expect(remote.status).toBe(503)
    expect(await remote.text()).toBe('Worker Remote unavailable')
    const wrong = await boundary.fetch(post('session.create', { workspaceId: randomUUID() }))
    expect(wrong.status).toBe(403)
    expect(await wrong.text()).toBe('Worker workspace refused')
    expect(supervisor.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
  })

  it('rewrites the native host cwd and retains non-JSON misses and empty export receipts', async () => {
    const description = await boundary.fetch(post('host.describe'))
    expect(description.status).toBe(200)
    expect(await description.json()).toMatchObject({ result: { ok: true, value: {
      cwd: 'workspace://' + workspaceId } } })
    const missing = await boundary.fetch(get('/no-native-route'))
    expect(missing.status).toBe(404)
    expect(missing.headers.get('x-arx-quiescent')).toBe('true')
    expect(await missing.text()).toBe('not found')
    const noId = await boundary.fetch(get('/api/session.export'))
    expect(noId.status).toBe(400)
    expect(noId.headers.get('x-arx-export-sessions')).toBe('[]')
    expect(await noId.text()).toBe('missing or invalid sessionId query parameter')
  })

  it('publishes host SSE after actual session and workspace commits with durable and opaque fields', async () => {
    const hostAbort = new AbortController()
    const response = await boundary.fetch(get('/api/events.host', hostAbort.signal))
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const body = response.body
    if (body === null) throw new Error('real host SSE body missing')
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffered = ''
    async function nextFrame(): Promise<unknown> {
      for (;;) {
        const split = buffered.indexOf('\n\n')
        if (split !== -1) {
          const record = buffered.slice(0, split)
          buffered = buffered.slice(split + 2)
          const line = record.split('\n').find(value => value.startsWith('data: '))
          if (line !== undefined) return JSON.parse(line.slice(6)) as unknown
          continue
        }
        const value = await reader.read()
        if (value.done) throw new Error('host SSE ended before its committed change')
        buffered += decoder.decode(value.value, { stream: true })
      }
    }
    try {
      const seeded = await harness.ctx.projectStorage.register(authority(), workspaceId,
        { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1000 })
      await harness.ctx.projectStorage.append(authority(), seeded.id, oneTurnLog())
      const created = await boundary.fetch(post('session.create', { sessionId: seeded.id, workspaceId }))
      const value: unknown = await created.json()
      expect(value).toMatchObject({ result: { ok: true } })
      const id = SessionId((value as { result: { value: { sessionId: string } } }).result.value.sessionId)
      const frame = await nextFrame()
      expect(frame).toMatchObject({ type: 'server-request', payload: {
        type: 'host/session-added', sessionId: id, cwd: 'workspace://' + workspaceId } })
      expect(await harness.ctx.projectStorage.executionSnapshot(authority(), id)).toBeDefined()
      const local = worker.workspaceRegistry.list().find(item => item.path === volumePath)
      if (local === undefined) throw new Error('canonical native workspace missing')
      const anotherPath = join(volumePath, 'native-order-subdirectory')
      await mkdir(anotherPath)
      const another = await worker.workspaceRegistry.create(anotherPath)
      for (;;) {
        const change = await nextFrame()
        const selected = (change as { payload: { workspace: { workspaceId: string } } }).payload.workspace.workspaceId
        if (selected === another.id) {
          expect(change).toMatchObject({ payload: { type: 'host/workspace-changed',
            workspace: { workspaceId: another.id } } })
          break
        }
        expect(change).toMatchObject({ payload: { type: 'host/workspace-changed',
          workspace: { workspaceId, path: 'workspace://' + workspaceId } } })
      }
      const reordered = await boundary.fetch(post('workspace.insertBefore', { workspaceId: local.id,
        beforeWorkspaceId: another.id }))
      expect(await reordered.json()).toMatchObject({ result: { ok: true, value: {
        workspaceIds: [workspaceId, another.id] } } })
      expect(await nextFrame()).toMatchObject({ payload: {
        type: 'host/workspace-order-changed', workspaceIds: [workspaceId, another.id] } })
    } finally { hostAbort.abort(); await reader.cancel() }
  })

  it('exports a real native fork tree and accounts for every original control JSONL artifact', async () => {
    const meta = await harness.ctx.projectStorage.register(authority(), workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1000 })
    await harness.ctx.projectStorage.append(authority(), meta.id, oneTurnLog())
    const fork = await harness.ctx.isolatedProjectRuntime.invoke(authority(), undefined,
      envelope('session.fork', { sessionId: meta.id }))
    expect(fork).toMatchObject({ ok: true })
    if (!fork.ok) throw new Error('native child fork refused')
    const child = SessionId((fork.value as { sessionId: string }).sessionId)
    const grandFork = await harness.ctx.isolatedProjectRuntime.invoke(authority(), undefined,
      envelope('session.fork', { sessionId: child }))
    expect(grandFork).toMatchObject({ ok: true })
    if (!grandFork.ok) throw new Error('native grandchild fork refused')
    const grandchild = SessionId((grandFork.value as { sessionId: string }).sessionId)
    await boundary.fetch(post('host.describe'))
    const durableHeaders = await worker.ownedWorkerHistory.list()
    expect(durableHeaders.some(item => item.id === meta.id && item.createdAt === meta.createdAt)).toBe(true)
    for (const id of [child, grandchild]) {
      const native = worker.sessions.get(id), durable = durableHeaders.find(item => item.id === id)
      if (native === undefined || durable === undefined) throw new Error('materialized fork header missing')
      const fields = ['createdAt', 'cwd', 'parentSession', 'seedLength', 'version', 'delegationDepth'] as const
      const differingFields = fields.filter(field => native.header[field] !== durable[field])
      expect(differingFields, 'native and durable headers must identify the same immutable fork').toEqual([])
    }
    const response = await boundary.fetch(get('/api/session.export?sessionId=' + meta.id + '&includeDescendants=true'))
    expect(response.status).toBe(200)
    expect(JSON.parse(response.headers.get('x-arx-export-sessions') ?? 'null')).toEqual([meta.id, child, grandchild])
    const zip = unzipSync(new Uint8Array(await response.arrayBuffer()))
    const entries = Object.values(zip).map(content => strFromU8(content))
    for (const id of [meta.id, child, grandchild]) {
      const raw = await harness.ctx.sessionPersistence.readRaw(id)
      if (raw === undefined) throw new Error('original control artifact missing')
      expect(entries).toContain(raw.content)
      expect(await harness.ctx.webIdentity.authorizeOwner(authority(), { kind: 'session', sessionId: id }))
        .toMatchObject({ workspaceId, userId: authority().principal.userId })
    }
    expect(supervisor.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
  })

  it('reports non-quiescence during an actual replay tool and returns idle only after that tool finishes', async () => {
    const replayPath = join(volumePath, 'boundary-held-tool-replay.jsonl')
    const chunks = [toolCallResponse('boundary-held-call', 'boundary_wait', {}), textResponse('Boundary complete')]
    const records = [{ type: 'session', id: 'recorded-boundary-held-turn', createdAt: 1 },
      ...chunks.flatMap((rows, step) => rows.map(chunk => ({ type: 'assistant/chunk',
        data: { turn: 1, step: step + 1, chunk } })))]
    await writeFile(replayPath, records.map(row => JSON.stringify(row)).join('\n') + '\n')
    const replay = installLlmReplay(worker, { file: replayPath,
      providers: [{ id: 'boundary-replay', models: [{ id: 'boundary-model' }] }] })
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    const unregister = worker.tools.register(defineContentToolFixture({
      name: 'boundary_wait', description: 'Hold an actual owned turn at its tool boundary', parameters: {},
      async execute() {
        entered.resolve(undefined)
        await release.promise
        return [{ type: 'text', text: 'Actual owned tool released' }]
      },
    }))
    try {
      expect(await harness.ctx.isolatedProjectRuntime.invoke(authority(), undefined,
        envelope('session.selectModel', { sessionId, provider: 'boundary-replay', model: 'boundary-model' })))
        .toMatchObject({ ok: true })
      expect(await harness.ctx.isolatedProjectRuntime.invoke(authority(), undefined,
        envelope('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: 'Run boundary_wait' }] })))
        .toMatchObject({ ok: true, value: { accepted: true } })
      await entered.promise
      const busy = await boundary.fetch(post('host.describe'))
      expect(busy.headers.get('x-arx-quiescent')).toBe('false')
      const incomplete = await boundary.fetch(get('/api/session.export'))
      expect(incomplete.status).toBe(400)
      expect(incomplete.headers.get('x-arx-quiescent')).toBe('false')
      release.resolve(undefined)
      const agent = worker.agents.get(sessionId)
      if (agent === undefined) throw new Error('actual running agent missing')
      await agent.whenIdle()
      await worker.sessions.flush(agent.session)
      replay.assertConsumed()
      const idle = await boundary.fetch(post('host.describe'))
      expect(idle.headers.get('x-arx-quiescent')).toBe('true')
      expect((await harness.ctx.sessionPersistence.readFrom(sessionId, 0)).events.at(-1))
        .toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    } finally { release.resolve(undefined); unregister(); replay.dispose() }
  })
})
