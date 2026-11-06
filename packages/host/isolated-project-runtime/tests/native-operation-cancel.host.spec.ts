import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { DatabaseSync } from 'node:sqlite'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { installLlmReplay } from '@arx-ai/arx-llm-replay'
import { defineContentToolFixture } from '@arx-ai/arx-tools'
import { toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import type { ClientRequest } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import * as BrokerHttp from '../src/broker-http.ts'
import { nativeSupervisorFixture } from './native-supervisor.ts'

let supervisor: Awaited<ReturnType<typeof nativeSupervisorFixture>>
let harness: Awaited<ReturnType<typeof storageHarness>>
const controllers: AbortController[] = []
const request = (method: string, payload: unknown = {}): ClientRequest =>
  ({ type: 'client-request', method, payload, rpcId: RpcId(randomUUID()) })
async function owned(user: number, name: string) {
  const authority = harness.users[user]!.authority
  const project = await harness.ctx.projectStorage.createProject(authority, 'Cancel owner ' + name)
  const workspace = await harness.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Cancel workspace ' + name)
  const provision = await harness.ctx.projectStorage.provision(authority, workspace.workspaceId)
  supervisor.assign({ controlOrigin: harness.url!, scope: provision.scope, volumePath: provision.volumePath })
  const meta = await harness.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  await harness.ctx.projectStorage.append(authority, meta.id, oneTurnLog())
  expect(await harness.ctx.isolatedProjectRuntime.invoke(authority, undefined,
    request('session.create', { sessionId: meta.id }))).toMatchObject({ ok: true, value: { sessionId: meta.id } })
  return { authority, workspace, meta, volumePath: provision.volumePath }
}
function cancelAs(operationId: string, userId: string) {
  return fetch(new URL('/_arx/operations/' + operationId + '/cancel', supervisor.endpoint), { method: 'POST',
    headers: { authorization: 'Bearer disposable-supervisor-fixture', 'x-arx-user-id': userId, 'x-arx-operation-id': operationId } })
}
function openMux(authority: Awaited<ReturnType<typeof owned>>['authority']) {
  const controller = new AbortController(); controllers.push(controller)
  return { controller, stream: harness.ctx.isolatedProjectRuntime.streamMux(authority, controller.signal)[Symbol.asyncIterator]() }
}

beforeEach(async () => {
  supervisor = await nativeSupervisorFixture()
  harness = await storageHarness({ endpoint: supervisor.endpoint, http: true,
    extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp }] })
})
afterEach(async () => {
  vi.restoreAllMocks()
  for (const controller of controllers.splice(0)) controller.abort()
  await harness.close(); await supervisor.close()
})
function idleDeadline(authority: Awaited<ReturnType<typeof owned>>['authority']) {
  const database = new DatabaseSync(harness.paths.database)
  try {
    const row = database.prepare('SELECT idle_expires_at FROM web_sessions WHERE id=?').get(authority.authSessionId)
    if (row === undefined) throw new Error('issued session deadline unavailable')
    return Number(row.idle_expires_at)
  } finally { database.close() }
}
function captureOperationIds(path: string) {
  const ids: string[] = []
  const originalFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((...args) => {
    const input = args[0]
    if (input instanceof URL && input.pathname === path) ids.push(new Headers(args[1]?.headers).get('x-arx-operation-id')!)
    return originalFetch(...args)
  })
  return ids
}
async function questionFrame(stream: ReturnType<typeof openMux>['stream'], own: Awaited<ReturnType<typeof owned>>, id: string) {
  const ctx = supervisor.ctxOf(own.workspace.workspaceId)
  const agent = ctx?.agents.get(own.meta.id)
  if (ctx === undefined || agent === undefined) throw new Error('worker stopped')
  ctx.userQuestions.ask({ agent, questions: [{ id, question: 'Is the stream open?', options: [{ label: 'Yes' }] }] })
    .catch(() => {})
  let frame = await stream.next()
  while (!frame.done && frame.value.payload.type !== 'question/requested') frame = await stream.next()
  if (frame.done === true) throw new Error('the stream ended')
  return frame.value.payload
}

describe('native supervisor cancellation by operation id', () => {
  it('stops a finished background turn before confirming its SID expiry while another login streams from the worker', async () => {
    const own = await owned(0, 'A')
    const account = harness.users[0]!
    const login = await harness.ctx.webIdentity.login(account.username, account.password, 'user')
    const other = await harness.ctx.webIdentity.authenticate(login.token, 'user')
    const ctx = supervisor.ctxOf(own.workspace.workspaceId)
    const agent = ctx?.agents.get(own.meta.id)
    if (ctx === undefined || agent === undefined) throw new Error('native worker unavailable')
    const replayPath = join(own.volumePath, 'background-turn-fixture.jsonl')
    await writeFile(replayPath, [{ type: 'session', id: 'background-turn-recording', createdAt: 1 },
      ...toolCallResponse('background-call', 'background_wait', {}).map(chunk =>
        ({ type: 'assistant/chunk', data: { turn: 1, step: 1, chunk } }))].map(row => JSON.stringify(row)).join('\n') + '\n')
    installLlmReplay(ctx, { file: replayPath, providers: [{ id: 'background-replay', models: [{ id: 'background-model' }] }] })
    let entered!: () => void
    const toolEntered = new Promise<void>((resolve) => { entered = resolve })
    let toolSignal: AbortSignal | undefined
    ctx.tools.register(defineContentToolFixture({ name: 'background_wait', description: 'Background turn', parameters: {},
      async execute(_args, execution) {
        toolSignal = execution.signal
        entered()
        await new Promise<void>((resolve) => { execution.signal.addEventListener('abort', () => { resolve() }) })
        return [{ type: 'text', text: 'stopped' }]
      } }))
    expect(await harness.ctx.isolatedProjectRuntime.invoke(own.authority, undefined, request('session.selectModel',
      { sessionId: own.meta.id, provider: 'background-replay', model: 'background-model' }))).toMatchObject({ ok: true })
    expect(await harness.ctx.isolatedProjectRuntime.invoke(own.authority, undefined, request('session.prompt',
      { sessionId: own.meta.id, mode: 'queue', content: [{ type: 'text', text: 'Run in the background' }] })))
      .toMatchObject({ ok: true, value: { accepted: true } })
    await toolEntered
    const { stream } = openMux(other)
    expect((await stream.next()).done).toBe(false)
    const atReceipt: { workerStopped: boolean; turnAborted: boolean }[] = []
    let confirmed!: () => void
    const receipt = new Promise<void>((resolve) => { confirmed = resolve })
    const originalFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
      const response = await originalFetch(...args)
      const input = args[0]
      if (input instanceof URL && input.pathname.endsWith('/cancel')
        && new Headers(args[1]?.headers).get('x-arx-workspace-id') === own.workspace.workspaceId) {
        atReceipt.push({ workerStopped: supervisor.ctxOf(own.workspace.workspaceId) !== ctx, turnAborted: toolSignal?.aborted === true })
        confirmed()
      }
      return response
    })
    await harness.ctx.webIdentity.revalidate(other, { activity: true })
    const realNow = Date.now.bind(Date), offset = idleDeadline(own.authority) - realNow() - 250
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset)
    await harness.ctx.webIdentity.revalidate(other, { activity: true })
    // Passive admission reschedules the real expiry timer under the shifted clock.
    await harness.ctx.webIdentity.authenticate(account.token, 'user')
    await receipt
    expect(atReceipt).toEqual([{ workerStopped: true, turnAborted: true }])
  })

  it('refuses a later request that carries an operation id confirmed while unseen', async () => {
    const own = await owned(0, 'A')
    const unseen = randomUUID()
    expect((await cancelAs(unseen, own.authority.principal.userId)).status).toBe(200)
    const late = await fetch(new URL('/api/host.describe', supervisor.endpoint), { method: 'POST',
      headers: { authorization: 'Bearer disposable-supervisor-fixture', 'content-type': 'application/json',
        'x-arx-user-id': own.authority.principal.userId, 'x-arx-operation-id': unseen },
      body: JSON.stringify(request('host.describe')) })
    expect(late.status).toBe(403)
  })

  it('refuses another USER a finished operation and keeps the owner stream delivering', async () => {
    const a = await owned(0, 'A')
    const b = await owned(1, 'B')
    const finished = captureOperationIds('/api/session.history')
    expect(await harness.ctx.isolatedProjectRuntime.invoke(a.authority, undefined,
      request('session.history', { sessionId: a.meta.id }))).toMatchObject({ ok: true })
    const { stream } = openMux(a.authority)
    expect((await stream.next()).done).toBe(false)
    expect((await cancelAs(finished[0]!, b.authority.principal.userId)).status).toBe(403)
    expect(await questionFrame(stream, a, 'after-foreign-cancel')).toMatchObject({ type: 'question/requested', sessionId: a.meta.id })
  })

  it('confirms an unscoped cancel for a USER with two workers and keeps later scoped work available', async () => {
    const own = await owned(0, 'A1')
    await owned(0, 'A2')
    const receipts: { status: number; receipt: unknown }[] = []
    const originalFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
      const response = await originalFetch(...args)
      const input = args[0]
      if (input instanceof URL && input.pathname.endsWith('/cancel')) {
        receipts.push({ status: response.status, receipt: response.ok ? await response.clone().json() as unknown : undefined })
      }
      return response
    })
    // The fixture keeps its one-worker routing for unscoped user-level work.
    await expect(harness.ctx.isolatedProjectRuntime.invoke(own.authority, undefined, request('host.describe')))
      .rejects.toMatchObject({ status: 502 })
    expect(receipts).toMatchObject([{ status: 200, receipt: { quiescent: true } }])
    expect(await harness.ctx.isolatedProjectRuntime.invoke(own.authority, undefined,
      request('session.history', { sessionId: own.meta.id }))).toMatchObject({ ok: true })
  })

  it('confirms an unknown operation only to its caller USER and refuses another USER a known operation', async () => {
    const a = await owned(0, 'A')
    const b = await owned(1, 'B1')
    await owned(1, 'B2')
    let streamOperation: string | undefined
    const originalFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation((...args) => {
      const input = args[0]
      if (input instanceof URL && input.pathname === '/api/events.mux') {
        streamOperation = new Headers(args[1]?.headers).get('x-arx-operation-id') ?? undefined
      }
      return originalFetch(...args)
    })
    const { stream } = openMux(a.authority)
    expect((await stream.next()).done).toBe(false)
    const unknown = randomUUID()
    const confirmed = await cancelAs(unknown, b.authority.principal.userId)
    expect(confirmed.status).toBe(200)
    expect(await confirmed.json()).toEqual({ operationId: unknown, quiescent: true })
    if (streamOperation === undefined) throw new Error('native stream operation id unavailable')
    const foreign = await cancelAs(streamOperation, b.authority.principal.userId)
    expect(foreign.status).toBe(403)
    expect(supervisor.ctxOf(a.workspace.workspaceId)).toBeDefined()
  })

  it('closing one stream leaves the USER\'s other stream on the same worker delivering frames', async () => {
    const own = await owned(0, 'A')
    const first = openMux(own.authority), second = openMux(own.authority)
    expect((await first.stream.next()).done).toBe(false)
    expect((await second.stream.next()).done).toBe(false)
    first.controller.abort()
    await first.stream.return?.()
    await sleep(100)
    const ctx = supervisor.ctxOf(own.workspace.workspaceId)
    const agent = ctx?.agents.get(own.meta.id)
    if (ctx === undefined || agent === undefined) throw new Error('worker stopped with the closed stream')
    const asked = ctx.userQuestions.ask({ agent, questions: [{ id: 'still-open', question: 'Is the other stream open?',
      options: [{ label: 'Yes' }] }] })
    asked.catch(() => {})
    let frame = await second.stream.next()
    while (!frame.done && frame.value.payload.type !== 'question/requested') frame = await second.stream.next()
    if (frame.done === true) throw new Error('the other stream ended')
    expect(frame.value.payload).toMatchObject({ type: 'question/requested', sessionId: own.meta.id })
  })
})
