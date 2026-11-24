import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { unzipSync, strFromU8 } from 'fflate'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import type { ClientRequest } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import { installLlmReplay } from '@arx-ai/arx-llm-replay'
import { defineContentToolFixture } from '@arx-ai/arx-tools'
import { textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as BrokerHttp from '../src/broker-http.ts'
import { WORKER_CAPABILITY_HEADER } from '../src/broker-contract.ts'
import { nativeSupervisorFixture } from './native-supervisor.ts'

describe('owned history with native worker Loader and ApiProxy', () => {
  let supervisor: Awaited<ReturnType<typeof nativeSupervisorFixture>>
  let harness: Awaited<ReturnType<typeof storageHarness>>
  let workspaceId: Awaited<ReturnType<typeof harness.ctx.projectStorage.createWorkspace>>['workspaceId']
  let otherWorkspaceId: typeof workspaceId
  let volumePath: string
  let ownScope: Awaited<ReturnType<typeof harness.ctx.projectStorage.provision>>['scope']
  const request = (method: string, payload: unknown = {}): ClientRequest =>
    ({ type: 'client-request', method, payload, rpcId: RpcId(randomUUID()) })
  beforeAll(async () => {
    supervisor = await nativeSupervisorFixture({ workerConfig: { rawPageBytes: 400 } })
    harness = await storageHarness({ endpoint: supervisor.endpoint, http: true,
      extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp }] })
    const authority = harness.users[0]!.authority
    const project = await harness.ctx.projectStorage.createProject(authority, 'Native own project')
    const workspace = await harness.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Native own workspace')
    workspaceId = workspace.workspaceId
    const provision = await harness.ctx.projectStorage.provision(authority, workspaceId)
    volumePath = provision.volumePath
    ownScope = provision.scope
    supervisor.assign({ controlOrigin: harness.url!, scope: provision.scope, volumePath })
    const other = harness.users[1]!.authority
    const otherProject = await harness.ctx.projectStorage.createProject(other, 'Native USER B project')
    const otherWorkspace = await harness.ctx.projectStorage.createWorkspace(other, otherProject.projectId, 'Native USER B workspace')
    otherWorkspaceId = otherWorkspace.workspaceId
    const otherProvision = await harness.ctx.projectStorage.provision(other, otherWorkspaceId)
    supervisor.assign({ controlOrigin: harness.url!, scope: otherProvision.scope, volumePath: otherProvision.volumePath })
  })
  beforeEach(async () => { vi.restoreAllMocks(); await supervisor.restart(); supervisor.resetCounts() })
  afterAll(async () => { await harness?.close(); await supervisor?.close() })
  async function seed(openTail = false, user = 0) {
    const authority = harness.users[user]!.authority
    const meta = await harness.ctx.projectStorage.register(authority, user === 0 ? workspaceId : otherWorkspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1000 })
    const events = oneTurnLog()
    await harness.ctx.projectStorage.append(authority, meta.id, openTail ? events.slice(0, 4) : events)
    return { authority, meta, events, runtime: harness.ctx.isolatedProjectRuntime }
  }
  async function attach(own: Awaited<ReturnType<typeof seed>>, mux: AsyncIterator<unknown>) {
    const first = mux.next()
    await sleep(50)
    expect(await own.runtime.invoke(own.authority, undefined, request('session.history', { sessionId: own.meta.id })))
      .toMatchObject({ ok: true })
    expect((await first).done).toBe(false)
  }
  it('commits a native replay turn before its tool side effect and cold-resumes without executing it twice', async () => {
    const authority = harness.users[0]!.authority
    const runtime = harness.ctx.isolatedProjectRuntime
    const initialCalls = supervisor.counts
    const created = await runtime.invoke(authority, undefined, request('session.create', { workspaceId }))
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    if (!created.ok) throw new Error('native fresh session refused')
    const id = SessionId((created.value as { sessionId: string }).sessionId)
    const ctx = supervisor.ctxOf(workspaceId)!
    const replayPath = join(volumePath, 'native-turn-model-fixture.jsonl')
    const chunks = [toolCallResponse('owned-side-effect', 'owned_checkpoint', {}), textResponse('Owned turn saved')]
    const records = [{ type: 'session', id: 'recorded-native-turn', createdAt: 1 },
      ...chunks.flatMap((rows, step) => rows.map(chunk => ({ type: 'assistant/chunk', data: { turn: 1, step: step + 1, chunk } })))]
    await writeFile(replayPath, records.map(row => JSON.stringify(row)).join('\n') + '\n')
    const replay = installLlmReplay(ctx, { file: replayPath,
      providers: [{ id: 'native-replay', models: [{ id: 'native-owned-model' }] }] })
    const sideEffect = join(volumePath, 'native-side-effect.txt')
    let toolRuns = 0
    const disposeTool = ctx.tools.register(defineContentToolFixture({
      name: 'owned_checkpoint', description: 'Check durable owned history before the fixture side effect', parameters: {},
      async execute() {
        const stored = await harness.ctx.sessionPersistence.readFrom(id, 0)
        expect(stored.events.some(event => event.type === 'tool/call')).toBe(true)
        toolRuns++
        await writeFile(sideEffect, String(toolRuns))
        return [{ type: 'text', text: 'Owned side effect committed once' }]
      },
    }))
    try {
      expect(await runtime.invoke(authority, undefined, request('session.selectModel',
        { sessionId: id, provider: 'native-replay', model: 'native-owned-model' }))).toMatchObject({ ok: true })
      expect(await runtime.invoke(authority, undefined, request('session.prompt',
        { sessionId: id, mode: 'queue', content: [{ type: 'text', text: 'Run the owned checkpoint once' }] })))
        .toMatchObject({ ok: true, value: { accepted: true } })
      const agent = ctx.agents.get(id)!
      await agent.whenIdle()
      await ctx.sessions.flush(agent.session)
      replay.assertConsumed()
      const stored = await harness.ctx.sessionPersistence.readFrom(id, 0)
      expect(stored.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      expect(stored.events.filter(event => event.type === 'tool/result')).toHaveLength(1)
      expect(JSON.stringify(stored.events.filter(event => event.type === 'assistant/message'))).toContain('Owned turn saved')
      expect(toolRuns).toBe(1)
      expect(await readFile(sideEffect, 'utf8')).toBe('1')
      const callsAfterTurn = supervisor.counts
      expect(callsAfterTurn.modelCalls - initialCalls.modelCalls).toBe(2)
      expect(callsAfterTurn.toolCalls - initialCalls.toolCalls).toBe(1)
      replay.dispose(); disposeTool()
      await runtime.quiesce(authority.principal.userId)
      await supervisor.restart()
      expect(await runtime.invoke(authority, undefined, request('session.create', { sessionId: id })))
        .toMatchObject({ ok: true, value: { sessionId: id } })
      const resumed = await harness.ctx.sessionPersistence.readFrom(id, 0)
      expect(resumed.events).toEqual([...stored.events, expect.objectContaining({ type: 'session/end-seed', seq: stored.events.length })])
      await supervisor.restart()
      expect(await runtime.invoke(authority, undefined, request('session.create', { sessionId: id })))
        .toMatchObject({ ok: true, value: { sessionId: id } })
      expect((await harness.ctx.sessionPersistence.readFrom(id, 0)).events).toEqual(resumed.events)
      expect(supervisor.counts).toEqual(callsAfterTurn)
      expect(await readFile(sideEffect, 'utf8')).toBe('1')
    } finally { replay.dispose(); disposeTool() }
  })
  it('serves cold history and forks a control-allocated durable lineage without a model or tool call', async () => {
    const own = await seed()
    const history = await own.runtime.invoke(own.authority, undefined, request('session.history', { sessionId: own.meta.id }))
    expect(history.ok).toBe(true)
    expect(JSON.stringify(history)).toContain('hello')
    const fork = await own.runtime.invoke(own.authority, undefined, request('session.fork', { sessionId: own.meta.id }))
    expect(fork.ok).toBe(true)
    if (!fork.ok) throw new Error('native fork refused')
    const child = SessionId((fork.value as { sessionId: string }).sessionId)
    expect(child).not.toBe(own.meta.id)
    expect(await harness.ctx.webIdentity.authorizeOwner(own.authority, { kind: 'session', sessionId: child }))
      .toMatchObject({ workspaceId, userId: own.authority.principal.userId })
    const stored = await harness.ctx.sessionPersistence.readFrom(child, 0)
    expect(stored.meta).toMatchObject({ parentSession: own.meta.id, seedLength: own.events.length })
    expect(stored.events.slice(0, own.events.length)).toEqual(own.events)
    expect(stored.events.at(-1)).toMatchObject({ type: 'session/end-seed', seq: own.events.length })
    expect(supervisor.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
  })
  it('cold-resumes an owned existing id after reconnect, repairs an interrupted tail, and never reruns tools', async () => {
    const own = await seed(true)
    const first = await own.runtime.invoke(own.authority, undefined, request('session.create', { sessionId: own.meta.id }))
    expect(first).toMatchObject({ ok: true, value: { sessionId: own.meta.id } })
    const before = await harness.ctx.sessionPersistence.readFrom(own.meta.id, 0)
    expect(before.events.findLast(event => event.type === 'turn/end')).toMatchObject({ type: 'turn/end',
      data: { reason: { kind: 'interrupted' } } })
    await supervisor.restart()
    const second = await own.runtime.invoke(own.authority, undefined, request('session.create', { sessionId: own.meta.id }))
    expect(second).toMatchObject({ ok: true, value: { sessionId: own.meta.id } })
    const after = await harness.ctx.sessionPersistence.readFrom(own.meta.id, 0)
    expect(after.events).toEqual(before.events)
    expect(supervisor.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
  })
  it('denies foreign, master, unknown browser ids and a mismatched own workspace before worker dispatch', async () => {
    const own = await seed()
    const initial = supervisor.seen.length
    for (const authority of [harness.users[1]!.authority, harness.master!]) {
      for (const method of ['session.history', 'session.fork', 'session.create'])
        await expect(own.runtime.invoke(authority, undefined, request(method,
          { sessionId: own.meta.id }))).rejects.toMatchObject({ status: 403 })
    }
    await expect(own.runtime.invoke(own.authority, undefined, request('session.create', { sessionId: randomUUID(),
      workspaceId }))).rejects.toMatchObject({ status: 403 })
    const other = await harness.ctx.projectStorage.createProject(own.authority, 'Other own project')
    const workspace = await harness.ctx.projectStorage.createWorkspace(own.authority, other.projectId, 'Other own workspace')
    await expect(own.runtime.invoke(own.authority, undefined, request('session.create', { sessionId: own.meta.id,
      workspaceId: workspace.workspaceId }))).rejects.toMatchObject({ status: 403 })
    expect(supervisor.seen).toHaveLength(initial)
  })
  it('runs two USER workers concurrently through one control journal while keeping providers and histories separate', async () => {
    const a = await seed(), b = await seed(false, 1)
    const calls = await Promise.all([a, b].map(own => own.runtime.invoke(own.authority, undefined,
      request('session.create', { sessionId: own.meta.id }))))
    expect(calls[0]).toMatchObject({ ok: true, value: { sessionId: a.meta.id } })
    expect(calls[1]).toMatchObject({ ok: true, value: { sessionId: b.meta.id } })
    const aCtx = supervisor.ctxOf(workspaceId)!, bCtx = supervisor.ctxOf(otherWorkspaceId)!
    expect(aCtx).not.toBe(bCtx)
    expect(aCtx.ownedWorkerHistory).not.toBe(bCtx.ownedWorkerHistory)
    expect(aCtx.ownedWorkerHistory.config.workspaceId).toBe(workspaceId)
    expect(bCtx.ownedWorkerHistory.config.workspaceId).toBe(otherWorkspaceId)
    expect(aCtx.sessions.list().map(value => value.id)).toContain(a.meta.id)
    expect(aCtx.sessions.list().map(value => value.id)).not.toContain(b.meta.id)
    expect(bCtx.sessions.list().map(value => value.id)).not.toContain(a.meta.id)
    await expect(a.runtime.invoke(a.authority, undefined, request('session.history',
      { sessionId: b.meta.id }))).rejects.toMatchObject({ status: 403 })
    expect(supervisor.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
  })
  it('invokes canonical commands, file preview, goals and feedback with actual Typert codecs and durable owner history', async () => {
    const own = await seed()
    await writeFile(join(volumePath, 'owner-preview.txt'), 'USER_A owned preview')
    const commands = await own.runtime.invoke(own.authority, undefined, request('commands/list', { args: { agentId: own.meta.id } }))
    expect(commands.ok).toBe(true)
    const preview = await own.runtime.invoke(own.authority, undefined, request('filePreviews/read',
      { args: { agentId: own.meta.id, path: 'owner-preview.txt' } }))
    expect(preview, JSON.stringify(preview)).toMatchObject({ ok: true, value: { content: 'USER_A owned preview' } })
    const goal = await own.runtime.invoke(own.authority, undefined, request('goals/create',
      { args: { agentId: own.meta.id, request: { objective: 'own durable native goal', maxGoalRounds: 2 } } }))
    expect(goal).toMatchObject({ ok: true, value: { ref: { revision: 1 } } })
    const stored = await harness.ctx.sessionPersistence.readFrom(own.meta.id, 0)
    expect(JSON.stringify(stored.events.filter(event => event.type === 'goal/change'))).toContain('own durable native goal')
    const feedback = await own.runtime.invoke(own.authority, undefined, request('messageFeedback/list',
      { args: { request: { sessionId: own.meta.id } } }))
    expect(feedback).toEqual({ ok: true, value: { ok: true, value: { items: [] } } })
    const admitted = supervisor.seen.length
    for (const denied of [harness.users[1]!.authority, harness.master!]) {
      await expect(own.runtime.invoke(denied, undefined, request('commands/list',
        { args: { agentId: own.meta.id } }))).rejects.toMatchObject({ status: 403 })
      await expect(own.runtime.invoke(denied, undefined, request('messageFeedback/list',
        { args: { request: { sessionId: own.meta.id } } }))).rejects.toMatchObject({ status: 403 })
    }
    await expect(own.runtime.invoke(own.authority, undefined, request('settings/replace',
      { args: {} }))).rejects.toMatchObject({ status: 403 })
    expect(supervisor.seen).toHaveLength(admitted)
  })
  it('exports the canonical ZIP over original control bytes and rejects other owners before the worker receives a download', async () => {
    const own = await seed()
    const original = await harness.ctx.sessionPersistence.readRaw(own.meta.id)
    const response = await own.runtime.fetch(own.authority, new Request('http://fixture/api/session.export?sessionId=' + own.meta.id))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    const zip = new Uint8Array(await response.arrayBuffer())
    expect([...zip.slice(0, 4)]).toEqual([80, 75, 3, 4])
    // The log stores the working directory as a JSON string, which escapes the backslashes of a Windows path.
    expect(original?.content).toContain(JSON.stringify(own.meta.cwd))
    const exported = unzipSync(zip)
    expect(Object.keys(exported)).toEqual(['session.jsonl'])
    expect(strFromU8(exported['session.jsonl']!)).toBe(original!.content)
    for (const denied of [harness.users[1]!.authority, harness.master!])
      await expect(own.runtime.fetch(denied,
        new Request('http://fixture/api/session.export?sessionId=' + own.meta.id))).rejects.toMatchObject({ status: 403 })
  })
  it('hydrates a restarted worker whose session writer is still a retained lease of the stopped worker', async () => {
    const authority = harness.users[0]!.authority
    const runtime = harness.ctx.isolatedProjectRuntime
    const created = await runtime.invoke(authority, undefined, request('session.create', { workspaceId }))
    if (!created.ok) throw new Error('native fresh session refused')
    const id = SessionId((created.value as { sessionId: string }).sessionId)
    const ctx = supervisor.ctxOf(workspaceId)!
    const replayPath = join(volumePath, 'native-retained-writer-fixture.jsonl')
    const records = [{ type: 'session', id: 'recorded-retained-writer', createdAt: 1 },
      ...textResponse('Retained writer turn').map(chunk => ({ type: 'assistant/chunk', data: { turn: 1, step: 1, chunk } }))]
    await writeFile(replayPath, records.map(row => JSON.stringify(row)).join('\n') + '\n')
    const replay = installLlmReplay(ctx, { file: replayPath,
      providers: [{ id: 'native-replay', models: [{ id: 'native-owned-model' }] }] })
    try {
      expect(await runtime.invoke(authority, undefined, request('session.selectModel',
        { sessionId: id, provider: 'native-replay', model: 'native-owned-model' }))).toMatchObject({ ok: true })
      // The prompt answers while its turn runs, so control retains its lease; the turn writes under it.
      expect(await runtime.invoke(authority, undefined, request('session.prompt',
        { sessionId: id, mode: 'queue', content: [{ type: 'text', text: 'Write under a retained lease' }] })))
        .toMatchObject({ ok: true, value: { accepted: true } })
      const agent = ctx.agents.get(id)!
      await agent.whenIdle()
      await ctx.sessions.flush(agent.session)
      replay.assertConsumed()
    } finally { replay.dispose() }
    const stored = await harness.ctx.sessionPersistence.readFrom(id, 0)
    // A worker restart that control never quiesced leaves that retained lease as the session writer.
    await supervisor.restart()
    const history = await runtime.invoke(authority, undefined, request('session.history', { sessionId: id }))
    expect(history, JSON.stringify(history)).toMatchObject({ ok: true })
    expect(await runtime.invoke(authority, undefined, request('session.create', { sessionId: id })))
      .toMatchObject({ ok: true, value: { sessionId: id } })
    expect((await harness.ctx.sessionPersistence.readFrom(id, 0)).events.slice(0, stored.events.length)).toEqual(stored.events)
  })

  it('answers a genuine pending user question only through its active owner lease and original RPC id', async () => {
    const own = await seed()
    expect(await own.runtime.invoke(own.authority, undefined, request('session.create', { sessionId: own.meta.id })))
      .toMatchObject({ ok: true, value: { sessionId: own.meta.id } })
    const abort = new AbortController()
    const mux = own.runtime.streamMux(own.authority, abort.signal)[Symbol.asyncIterator]()
    await attach(own, mux)
    const ctx = supervisor.ctxOf(workspaceId)!
    const agent = ctx.agents.get(own.meta.id)!
    const asked = ctx.userQuestions.ask({ agent, questions: [{ id: 'owner-choice',
      question: 'Choose the owned result', options: [{ label: 'Continue' }] }] })
    let frame = await mux.next()
    while (!frame.done && frame.value.payload.type !== 'question/requested') frame = await mux.next()
    if (frame.done || frame.value.payload.type !== 'question/requested') throw new Error('native question did not arrive')
    const response = { type: 'client-response', rpcId: frame.value.rpcId, result: { ok: true,
      value: { sessionId: own.meta.id, answer: { answers: [{ id: 'owner-choice', selected: ['Continue'] }] } } } }
    const send = (body: unknown) => new Request('http://fixture/api/respond', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    for (const denied of [harness.users[1]!.authority, harness.master!])
      await expect(own.runtime.fetch(denied, send(response))).rejects.toMatchObject({ status: 403 })
    await expect(own.runtime.fetch(own.authority, send({ ...response, rpcId: randomUUID() }))).rejects.toMatchObject({ status: 403 })
    const receipt = await own.runtime.fetch(own.authority, send(response))
    expect(await receipt.json()).toEqual({ accepted: true })
    await expect(asked).resolves.toEqual({ answers: [{ id: 'owner-choice', selected: ['Continue'] }] })
    await expect(own.runtime.fetch(own.authority, send(response))).rejects.toMatchObject({ status: 403 })
    abort.abort()
    await mux.return?.()
  })
  it('withholds the native rename receipt and every durable progress claim when the control append fails', async () => {
    const own = await seed()
    expect(await own.runtime.invoke(own.authority, undefined, request('session.create', { sessionId: own.meta.id })))
      .toMatchObject({ ok: true, value: { sessionId: own.meta.id } })
    const location = harness.ctx.sessionPersistence.locate(own.meta)!
    if (location.kind !== 'jsonl') throw new Error('JSONL fixture unavailable')
    const bytes = await readFile(location.path)
    const nextSeq = (await harness.ctx.projectStorage.list(own.authority, { kind: 'workspace',
      workspaceId })).sessions.find(value => value.sessionId === own.meta.id)!.nextSeq
    const failure = vi.spyOn(harness.ctx.sessionPersistence, 'append').mockRejectedValueOnce(new Error('fixture durable append failure'))
    await expect(own.runtime.invoke(own.authority, undefined, request('session.rename', { sessionId: own.meta.id,
      title: 'unsaved title' })))
      .rejects.toMatchObject({ status: 502 })
    failure.mockRestore()
    expect(await readFile(location.path)).toEqual(bytes)
    expect((await harness.ctx.projectStorage.list(own.authority, { kind: 'workspace',
      workspaceId })).sessions.find(value => value.sessionId === own.meta.id)?.nextSeq)
      .toBe(nextSeq)
  })
  it('uses the native worker persistence contract for bounded multi-page raw export and refuses live-tail repair', async () => {
    const own = await seed()
    expect(await own.runtime.invoke(own.authority, undefined, request('session.create', { sessionId: own.meta.id })))
      .toMatchObject({ ok: true })
    const abort = new AbortController()
    const mux = own.runtime.streamMux(own.authority, abort.signal)[Symbol.asyncIterator]()
    await attach(own, mux)
    try {
      const ctx = supervisor.ctxOf(workspaceId)!
      const persistence = ctx.ownedWorkerHistory
      // Direct persistence calls run under the live stream lease; the attaching unary lease is already quiescent.
      persistence.bind(supervisor.streamHeadersOf(workspaceId)!.get(WORKER_CAPABILITY_HEADER)!, ownScope)
      const control = await harness.ctx.sessionPersistence.readFrom(own.meta.id, 0)
      expect(persistence.locate(own.meta)).toBeUndefined()
      expect((await persistence.load(own.meta.id)).events).toEqual(control.events)
      expect((await persistence.inspect(own.meta.id)).events).toEqual(control.events)
      expect((await persistence.readFrom(own.meta.id, 2)).events).toEqual(control.events.slice(2))
      await expect(persistence.prepare(own.meta.id)).rejects.toThrow('while it is live')
      const original = (await harness.ctx.sessionPersistence.readRaw(own.meta.id))!
      expect((await persistence.readRaw(own.meta.id))!.content).toBe(original.content)
      const first = await persistence.readRawPage(own.meta.id, { offset: 0, maxBytes: 400 })
      expect(first.nextOffset).toBeDefined()
      const second = await persistence.readRawPage(own.meta.id, { offset: first.nextOffset!, maxBytes: 400, revision: first.revision })
      expect(second.revision).toBe(first.revision)
      expect(Buffer.from(original.content).subarray(first.nextOffset,
        first.nextOffset! + Buffer.byteLength(second.content)).toString()).toBe(second.content)
      expect((await persistence.listSnapshots()).map(value => value.header.id)).toContain(own.meta.id)
      await persistence.commitRepair(own.meta, undefined, [])
      await expect(persistence.commitRepair(own.meta, undefined, control.events.slice(0, 1))).rejects.toThrow('quiescent cold restart')
      const lazy = await harness.ctx.projectStorage.register(own.authority, workspaceId,
        { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
      expect(await persistence.readRaw(lazy.id)).toBeUndefined()
      await expect(persistence.readRawPage(lazy.id, { offset: 0, maxBytes: 400 })).rejects.toThrow('unavailable')
      await expect(persistence.allocateForkSessionId(lazy.id, 1)).rejects.toThrow('refused')
      await expect(persistence.allocateForkSessionId(own.meta.id, 0)).rejects.toThrow('refused')
      await expect(persistence.allocateForkSessionId(own.meta.id, control.events.length + 1)).rejects.toThrow('refused')
      const fork = await persistence.allocateForkSessionId(own.meta.id, 1, 'fixture-owned-preset')
      expect(await harness.ctx.webIdentity.authorizeOwner(own.authority, { kind: 'session', sessionId: fork }))
        .toMatchObject({ userId: own.authority.principal.userId, workspaceId })
      const child = await harness.ctx.projectStorage.executionSnapshot(own.authority, fork)
      expect(child).toBeUndefined()
    } finally { abort.abort(); await mux.return?.() }
  })

})
