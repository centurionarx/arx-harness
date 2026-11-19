/** Native Loader races and Remote busy receipts with complete replay consumption. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@arx-ai/cordis'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { RpcId, type ClientRequest } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { installLlmReplay } from '@arx-ai/arx-llm-replay'
import { defineContentToolFixture } from '@arx-ai/arx-tools'
import { textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import * as BrokerHttp from '../src/broker-http.ts'
import type { toOwnedWorkerFetch } from '../src/worker-boundary.ts'
import { nativeSupervisorFixture } from './native-supervisor.ts'

describe('native worker availability races and canonical Remote quiescence', () => {
  let supervisor: Awaited<ReturnType<typeof nativeSupervisorFixture>>
  let harness: Awaited<ReturnType<typeof storageHarness>>
  let workspaceId: Awaited<ReturnType<typeof harness.ctx.projectStorage.createWorkspace>>['workspaceId']
  let volumePath: string
  let sessionId: SessionId
  let worker: Context
  let headers: Headers
  let carrier: ReturnType<typeof toOwnedWorkerFetch>
  let abort: AbortController
  let mux: AsyncIterator<unknown>
  function authority() {
    const user = harness.users[0]
    if (user === undefined) throw new Error('ready native lifecycle USER missing')
    return user.authority
  }
  const envelope = (method: string, payload: unknown = {}): ClientRequest =>
    ({ type: 'client-request', method, payload, rpcId: RpcId(randomUUID()) })
  function post(method: string, payload: unknown = {}) {
    return new Request('http://fixture/api/' + method, { method: 'POST', headers: new Headers(headers),
      body: JSON.stringify(envelope(method, payload)) })
  }
  beforeAll(async () => {
    supervisor = await nativeSupervisorFixture()
    harness = await storageHarness({ endpoint: supervisor.endpoint, http: true, readyUsers: 1,
      extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp }] })
    const project = await harness.ctx.projectStorage.createProject(authority(), 'Native lifecycle project')
    const workspace = await harness.ctx.projectStorage.createWorkspace(authority(), project.projectId, 'Native lifecycle workspace')
    workspaceId = workspace.workspaceId
    const provision = await harness.ctx.projectStorage.provision(authority(), workspaceId)
    volumePath = provision.volumePath
    if (harness.url === undefined) throw new Error('real control origin missing')
    supervisor.assign({ controlOrigin: harness.url, scope: provision.scope, volumePath })
  })
  beforeEach(async () => {
    await supervisor.restart()
    const created = await harness.ctx.isolatedProjectRuntime.invoke(authority(), undefined,
      envelope('session.create', { workspaceId }))
    expect(created).toMatchObject({ ok: true })
    if (!created.ok || typeof created.value !== 'object' || created.value === null
      || !('sessionId' in created.value) || typeof created.value.sessionId !== 'string') {
      throw new Error('actual control session allocation missing')
    }
    sessionId = SessionId(created.value.sessionId)
    abort = new AbortController()
    mux = harness.ctx.isolatedProjectRuntime.streamMux(authority(), abort.signal)[Symbol.asyncIterator]()
    const first = mux.next()
    await sleep(50)
    expect(await harness.ctx.isolatedProjectRuntime.invoke(authority(), undefined,
      envelope('session.history', { sessionId }))).toMatchObject({ ok: true })
    expect((await first).done).toBe(false)
    const context = supervisor.ctxOf(workspaceId), captured = supervisor.streamHeadersOf(workspaceId)
    const boundary = supervisor.carrierOf(workspaceId)
    if (context === undefined || captured === undefined || boundary === undefined) throw new Error('actual native worker lease missing')
    worker = context; headers = captured; carrier = boundary
    headers.set('content-type', 'application/json')
  })
  afterEach(async () => { vi.restoreAllMocks(); abort?.abort(); await mux?.return?.() })
  afterAll(async () => { await harness?.close(); await supervisor?.close() })

  it('withholds the native ZIP receipt when its real query provider is disposed after root preflight', async () => {
    const meta = await harness.ctx.projectStorage.register(authority(), workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1000 })
    await harness.ctx.projectStorage.append(authority(), meta.id, oneTurnLog())
    const entry = [...worker.loader.entries()].find(value => value.options.name === '@arx-ai/arx-session-query')
    if (entry === undefined) throw new Error('real native query Loader entry missing')
    const read = worker.ownedWorkerHistory.readRaw.bind(worker.ownedWorkerHistory)
    let prepared = false
    vi.spyOn(worker.ownedWorkerHistory, 'readRaw').mockImplementationOnce(async (...args) => {
      const raw = await read(...args)
      if (raw === undefined) throw new Error('actual root raw artifact missing')
      prepared = raw.content.includes(meta.id)
      await worker.loader.update(entry.id, { disabled: true })
      return raw
    })
    const controller = new AbortController()
    try {
      await expect(carrier.fetch(new Request('http://fixture/api/session.export?sessionId=' + meta.id + '&includeDescendants=true',
        { headers: new Headers(headers), signal: controller.signal }))).rejects.toThrow('worker export lineage unavailable')
      expect(prepared).toBe(true)
      expect(worker.get('sessionQuery')).toBeUndefined()
      expect(await harness.ctx.webIdentity.authorizeOwner(authority(), { kind: 'session', sessionId: meta.id }))
        .toMatchObject({ workspaceId })
      expect(supervisor.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
    } finally { controller.abort() }
  })

  it('publishes a canonical Remote busy receipt during an actual held replay tool and verifies its final durable turn', async () => {
    const replayPath = join(volumePath, 'remote-held-tool-replay.jsonl')
    const chunks = [toolCallResponse('remote-held-call', 'remote_wait', {}), textResponse('Remote tool complete')]
    const records = [{ type: 'session', id: 'recorded-remote-held-turn', createdAt: 1 },
      ...chunks.flatMap((rows, step) => rows.map(chunk => ({ type: 'assistant/chunk', data: { turn: 1, step: step + 1, chunk } })))]
    await writeFile(replayPath, records.map(row => JSON.stringify(row)).join('\n') + '\n')
    const replay = installLlmReplay(worker, { file: replayPath,
      providers: [{ id: 'remote-replay', models: [{ id: 'remote-model' }] }] })
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    const unregister = worker.tools.register(defineContentToolFixture({
      name: 'remote_wait', description: 'Hold one actual owned turn while a canonical Remote is read', parameters: {},
      async execute() {
        entered.resolve(undefined)
        await release.promise
        return [{ type: 'text', text: 'Actual Remote tool released' }]
      },
    }))
    try {
      expect(await harness.ctx.isolatedProjectRuntime.invoke(authority(), undefined,
        envelope('session.selectModel', { sessionId, provider: 'remote-replay', model: 'remote-model' }))).toMatchObject({ ok: true })
      expect(await harness.ctx.isolatedProjectRuntime.invoke(authority(), undefined,
        envelope('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: 'Run remote_wait' }] })))
        .toMatchObject({ ok: true, value: { accepted: true } })
      await entered.promise
      const busy = await carrier.fetch(post('commands/list', { args: { agentId: sessionId } }))
      expect(busy.status).toBe(200)
      expect(busy.headers.get('x-arx-quiescent')).toBe('false')
      expect(await busy.json()).toMatchObject({ result: { ok: true } })
      release.resolve(undefined)
      const agent = worker.agents.get(sessionId)
      if (agent === undefined) throw new Error('actual running native agent missing')
      await agent.whenIdle()
      await worker.sessions.flush(agent.session)
      replay.assertConsumed()
      const idle = await carrier.fetch(post('commands/list', { args: { agentId: sessionId } }))
      expect(idle.headers.get('x-arx-quiescent')).toBe('true')
      expect((await harness.ctx.sessionPersistence.readFrom(sessionId, 0)).events.at(-1))
        .toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      expect(supervisor.counts).toEqual({ modelCalls: 2, toolCalls: 1 })
    } finally { release.resolve(undefined); unregister(); replay.dispose() }
  })
})
