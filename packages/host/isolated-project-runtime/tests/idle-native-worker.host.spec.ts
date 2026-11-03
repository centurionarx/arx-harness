import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { installLlmReplay } from '@arx-ai/arx-llm-replay'
import { defineContentToolFixture } from '@arx-ai/arx-tools'
import { toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import type { ClientRequest } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import type { RequestAuthority } from '@arx-ai/arx-web-identity'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import * as BrokerHttp from '../src/broker-http.ts'
import { nativeSupervisorFixture } from './native-supervisor.ts'

let supervisor: Awaited<ReturnType<typeof nativeSupervisorFixture>> | undefined
let harness: Awaited<ReturnType<typeof storageHarness>> | undefined
let restoreClock: (() => void) | undefined
let releaseRetained: (() => void) | undefined
let controller = new AbortController()
const request = (method: string, payload: unknown = {}): ClientRequest =>
  ({ type: 'client-request', method, payload, rpcId: RpcId(randomUUID()) })
function mounted() {
  if (supervisor === undefined || harness === undefined || harness.url === undefined) throw new Error('native idle fixture unavailable')
  return { h: harness, supervisor, origin: harness.url }
}
async function owned(user: number, options: { authority?: RequestAuthority; mount?: boolean } = {}) {
  const { h, supervisor, origin } = mounted()
  const account = h.users[user]
  if (account === undefined) throw new Error('native USER fixture unavailable')
  const authority = options.authority ?? account.authority
  const project = await h.ctx.projectStorage.createProject(authority, 'Idle owner ' + String(user))
  const workspace = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Idle workspace ' + String(user))
  const provision = await h.ctx.projectStorage.provision(authority, workspace.workspaceId)
  supervisor.assign({ controlOrigin: origin, scope: provision.scope, volumePath: provision.volumePath })
  const meta = await h.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  await h.ctx.projectStorage.append(authority, meta.id, oneTurnLog())
  if (options.mount !== false) expect(await h.ctx.isolatedProjectRuntime.invoke(authority, undefined,
    request('session.create', { sessionId: meta.id }))).toMatchObject({ ok: true, value: { sessionId: meta.id } })
  return { account, authority, workspace, meta, volumePath: provision.volumePath }
}
function deadlines(authority: RequestAuthority) {
  const { h } = mounted(), database = new DatabaseSync(h.paths.database)
  try {
    const row = database.prepare('SELECT expires_at,idle_expires_at FROM web_sessions WHERE id=?').get(authority.authSessionId)
    if (row === undefined) throw new Error('real issued session deadline unavailable')
    return { absolute: Number(row.expires_at), idle: Number(row.idle_expires_at) }
  } finally { database.close() }
}

async function pendingQuestion(id: string) {
  const { h, supervisor } = mounted()
  if (a === undefined) throw new Error('owned pending question unavailable')
  const own = a
  const mux = h.ctx.isolatedProjectRuntime.streamMux(own.authority, controller.signal)[Symbol.asyncIterator]()
  expect((await mux.next()).done).toBe(false)
  const ctx = supervisor.ctxOf(own.workspace.workspaceId)
  const agent = ctx?.agents.get(own.meta.id)
  if (ctx === undefined || agent === undefined) throw new Error('real native question agent unavailable')
  const asked = ctx.userQuestions.ask({ agent, questions: [{ id, question: 'Keep the original interaction lease',
    options: [{ label: 'Continue' }] }] })
  const outcome = asked.then(value => ({ value }), (error: unknown) => ({ error }))
  let frame = await mux.next()
  while (!frame.done && frame.value.payload.type !== 'question/requested') frame = await mux.next()
  if (frame.done || frame.value.payload.type !== 'question/requested') throw new Error('real native question frame unavailable')
  const body = { type: 'client-response', rpcId: frame.value.rpcId, result: { ok: true,
    value: { sessionId: own.meta.id, answer: { answers: [{ id, selected: ['Continue'] }] } } } }
  const send = () => new Request('http://fixture/api/respond', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { h, supervisor, own, mux, frame: frame.value, outcome, send }
}
function scheduleQuietClock(authority: RequestAuthority) {
  const initial = deadlines(authority), realNow = Date.now.bind(Date), offset = initial.idle - realNow() - 250
  const date = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset)
  restoreClock = () => { date.mockRestore() }
  return initial
}

let a: Awaited<ReturnType<typeof owned>> | undefined
let b: Awaited<ReturnType<typeof owned>> | undefined
beforeEach(async () => {
  controller = new AbortController()
  releaseRetained = undefined
  supervisor = await nativeSupervisorFixture()
  harness = await storageHarness({ endpoint: supervisor.endpoint, http: true,
    extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp }] })
  a = await owned(0); b = await owned(1, { mount: false })
})
afterEach(async () => {
  releaseRetained?.(); restoreClock?.(); controller.abort()
  await harness?.close(); await supervisor?.close(); vi.restoreAllMocks()
})
describe('idle expiry at a genuine native SDK publication boundary', () => {
  it('drops a queued native question, cancels its worker before rejection, and preserves the other USER without idle renewal', async () => {
    const { h, supervisor } = mounted()
    if (a === undefined || b === undefined) throw new Error('owned native sessions unavailable')
    const own = a, other = b
    expect(await h.ctx.isolatedProjectRuntime.invoke(other.authority, undefined,
      request('session.create', { sessionId: other.meta.id }))).toMatchObject({ ok: true, value: { sessionId: other.meta.id } })
    const initial = deadlines(own.authority), otherInitial = deadlines(other.authority)
    expect(initial.idle).toBeLessThan(initial.absolute)
    expect(otherInitial.idle).toBeGreaterThan(initial.idle)
    const head = h.ctx.webIdentity.authorityHead
    let now = initial.idle - 1
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    restoreClock = () => { clock.mockRestore() }
    await h.ctx.webIdentity.revalidate(own.authority)
    expect(await h.ctx.isolatedProjectRuntime.invoke(own.authority, undefined,
      request('session.history', { sessionId: own.meta.id }))).toMatchObject({ ok: true })
    const stream = h.ctx.isolatedProjectRuntime.streamMux(own.authority, controller.signal)[Symbol.asyncIterator]()
    expect((await stream.next()).done).toBe(false)
    expect(deadlines(own.authority)).toEqual(initial)
    expect(h.ctx.webIdentity.authorityHead).toEqual(head)
    const ctx = supervisor.ctxOf(own.workspace.workspaceId)
    if (ctx === undefined) throw new Error('real owned native SDK context unavailable')
    const agent = ctx.agents.get(own.meta.id)
    if (agent === undefined) throw new Error('real native SDK session unavailable')
    const question = ctx.userQuestions.ask({ agent, questions: [{ id: 'idle-owner-choice',
      question: 'Choose only while the own session is active', options: [{ label: 'Continue' }] }] })
    const questionOutcome = question.then(value => ({ value }), (error: unknown) => ({ error }))
    // The canonical provider synchronously queued this genuine question while
    // active. Its next real MUX publication must refuse at the idle boundary.
    now = initial.idle
    await expect(stream.next()).rejects.toMatchObject({ code: 'AUTH_INVALID', status: 401 })
    expect(await questionOutcome).toMatchObject({ error: { code: 'ASK_ABORTED' } })
    expect(supervisor.ctxOf(own.workspace.workspaceId)).toBeUndefined()
    expect(supervisor.ctxOf(other.workspace.workspaceId)).toBeDefined()
    await expect(h.ctx.webIdentity.authenticate(own.account.token, 'user')).rejects.toMatchObject({ code: 'AUTH_INVALID' })
    expect(await h.ctx.isolatedProjectRuntime.invoke(other.authority, undefined,
      request('session.history', { sessionId: other.meta.id }))).toMatchObject({ ok: true })
    expect(deadlines(own.authority)).toEqual(initial)
    expect(deadlines(other.authority)).toEqual(otherInitial)
    expect(h.ctx.webIdentity.authorityHead).toEqual(head)
    expect(supervisor.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
  })
  it('quiesces a quiet expired SID without a frame or new request and preserves another login of that USER', async () => {
    const { h, supervisor } = mounted()
    if (a === undefined || b === undefined) throw new Error('owned native sessions unavailable')
    const own = a, other = b
    const login = await h.ctx.webIdentity.login(own.account.username, own.account.password, 'user')
    const secondAuthority = await h.ctx.webIdentity.authenticate(login.token, 'user')
    const second = await owned(0, { authority: secondAuthority })
    expect(second.authority.authSessionId).not.toBe(own.authority.authSessionId)
    expect(second.authority.principal.userId).toBe(own.authority.principal.userId)
    const ctx = supervisor.ctxOf(own.workspace.workspaceId)
    if (ctx === undefined) throw new Error('quiet native SDK context unavailable')
    const agent = ctx.agents.get(own.meta.id)
    if (agent === undefined) throw new Error('quiet native SDK session unavailable')
    const replayPath = join(own.volumePath, 'quiet-idle-model-fixture.jsonl')
    const chunks = toolCallResponse('quiet-idle-call', 'quiet_idle_question', {})
    await writeFile(replayPath, [{ type: 'session', id: 'quiet-idle-recording', createdAt: 1 },
      ...chunks.map(chunk => ({ type: 'assistant/chunk', data: { turn: 1, step: 1, chunk } }))]
      .map(row => JSON.stringify(row)).join('\n') + '\n')
    const replay = installLlmReplay(ctx, { file: replayPath,
      providers: [{ id: 'quiet-idle-replay', models: [{ id: 'quiet-idle-model' }] }] })
    let entered!: () => void
    const toolEntered = new Promise<void>((resolve) => { entered = resolve })
    let outcome: Promise<unknown> | undefined
    const disposeTool = ctx.tools.register(defineContentToolFixture({
      name: 'quiet_idle_question', description: 'Real pending question for idle cancellation', parameters: {},
      async execute(_args, execution) {
        if (execution.agent !== agent) throw new Error('real idle tool owner differs')
        const question = ctx.userQuestions.ask({ agent, signal: execution.signal, questions: [{ id: 'quiet-idle-choice',
          question: 'The quiet owner must expire without another frame', options: [{ label: 'Continue' }] }] })
        outcome = question.then(value => ({ value }), (error: unknown) => ({ error }))
        entered()
        await question
        return [{ type: 'text', text: 'Own question answered' }]
      },
    }))
    expect(await h.ctx.isolatedProjectRuntime.invoke(own.authority, undefined, request('session.selectModel',
      { sessionId: own.meta.id, provider: 'quiet-idle-replay', model: 'quiet-idle-model' }))).toMatchObject({ ok: true })
    expect(await h.ctx.isolatedProjectRuntime.invoke(own.authority, undefined, request('session.prompt',
      { sessionId: own.meta.id, mode: 'queue', content: [{ type: 'text', text: 'Wait for the genuine quiet question' }] })))
      .toMatchObject({ ok: true, value: { accepted: true } })
    await toolEntered
    let resolveCancel!: () => void
    const cancelled = new Promise<void>((resolve) => { resolveCancel = resolve })
    let cancellationReceipts = 0
    const originalFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
      const response = await originalFetch(...args)
      const input = args[0]
      if (input instanceof URL && input.pathname.startsWith('/_arx/operations/') && input.pathname.endsWith('/cancel')
        && new Headers(args[1]?.headers).get('x-arx-workspace-id') === own.workspace.workspaceId) {
        const receipt: unknown = await response.clone().json()
        expect(response.status).toBe(200)
        expect(receipt).toMatchObject({ quiescent: true })
        cancellationReceipts++; resolveCancel()
      }
      return response
    })
    const initial = deadlines(own.authority), initialRevision = own.authority.revision
    await h.ctx.webIdentity.revalidate(second.authority, { activity: true })
    await h.ctx.webIdentity.revalidate(other.authority, { activity: true })
    expect(deadlines(second.authority).idle).toBeGreaterThan(initial.idle - 250)
    expect(deadlines(other.authority).idle).toBeGreaterThan(initial.idle - 250)
    const realNow = Date.now.bind(Date), offset = initial.idle - realNow() - 250
    const date = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset)
    restoreClock = () => { date.mockRestore() }
    await h.ctx.webIdentity.revalidate(second.authority, { activity: true })
    await h.ctx.webIdentity.revalidate(other.authority, { activity: true })
    const secondDeadline = deadlines(second.authority), otherDeadline = deadlines(other.authority)
    expect(secondDeadline.idle).toBeGreaterThan(initial.idle)
    expect(otherDeadline.idle).toBeGreaterThan(initial.idle)
    // Passive admission may reschedule the genuine timer but does not renew A.
    await h.ctx.webIdentity.authenticate(own.account.token, 'user')
    expect(deadlines(own.authority)).toEqual(initial)
    // No A HTTP call, frame, question response or explicit cancel occurs here.
    await cancelled
    if (outcome === undefined) throw new Error('genuine idle question was not entered')
    expect(await outcome).toMatchObject({ error: { code: 'ASK_ABORTED' } })
    expect(cancellationReceipts).toBeGreaterThan(0)
    expect(supervisor.ctxOf(own.workspace.workspaceId)).toBeUndefined()
    expect(supervisor.ctxOf(second.workspace.workspaceId)).toBeDefined()
    await expect(h.ctx.webIdentity.authenticate(own.account.token, 'user')).rejects.toMatchObject({ code: 'AUTH_INVALID' })
    expect((await h.ctx.webIdentity.authenticate(login.token, 'user')).revision).toBe(initialRevision)
    expect(await h.ctx.isolatedProjectRuntime.invoke(second.authority, undefined,
      request('session.history', { sessionId: second.meta.id }))).toMatchObject({ ok: true })
    // A has stopped before B mounts, so no more than two real worker contexts
    // are active. Same-workspace cancellation remains an operational limit.
    expect(await h.ctx.isolatedProjectRuntime.invoke(other.authority, undefined,
      request('session.create', { sessionId: other.meta.id }))).toMatchObject({ ok: true, value: { sessionId: other.meta.id } })
    expect(supervisor.ctxOf(other.workspace.workspaceId)).toBeDefined()
    expect(deadlines(second.authority)).toEqual(secondDeadline)
    expect(deadlines(other.authority)).toEqual(otherDeadline)
    replay.assertConsumed()
    replay.dispose(); disposeTool()
    expect(supervisor.counts).toEqual({ modelCalls: 1, toolCalls: 1 })
  })

  it('rejects a same-USER reply retained after real authorization when the originating quiet SID expires', async () => {
    const { h, supervisor } = mounted()
    if (a === undefined || b === undefined) throw new Error('owned native sessions unavailable')
    const own = a, other = b
    const login = await h.ctx.webIdentity.login(own.account.username, own.account.password, 'user')
    const responder = await h.ctx.webIdentity.authenticate(login.token, 'user')
    expect(responder.authSessionId).not.toBe(own.authority.authSessionId)
    const ctx = supervisor.ctxOf(own.workspace.workspaceId)
    if (ctx === undefined) throw new Error('real pending native context unavailable')
    const agent = ctx.agents.get(own.meta.id)
    if (agent === undefined) throw new Error('real pending native session unavailable')
    const replayPath = join(own.volumePath, 'reply-idle-model-fixture.jsonl')
    const chunks = toolCallResponse('reply-idle-call', 'reply_idle_question', {})
    await writeFile(replayPath, [{ type: 'session', id: 'reply-idle-recording', createdAt: 1 },
      ...chunks.map(chunk => ({ type: 'assistant/chunk', data: { turn: 1, step: 1, chunk } }))]
      .map(row => JSON.stringify(row)).join('\n') + '\n')
    const replay = installLlmReplay(ctx, { file: replayPath,
      providers: [{ id: 'reply-idle-replay', models: [{ id: 'reply-idle-model' }] }] })
    let entered!: () => void
    const toolEntered = new Promise<void>((resolve) => { entered = resolve })
    let questionOutcome: Promise<unknown> | undefined
    const disposeTool = ctx.tools.register(defineContentToolFixture({
      name: 'reply_idle_question', description: 'Real question with a retained same-owner reply', parameters: {},
      async execute(_args, execution) {
        if (execution.agent !== agent) throw new Error('real reply tool owner differs')
        const question = ctx.userQuestions.ask({ agent, signal: execution.signal, questions: [{ id: 'reply-idle-choice',
          question: 'A reply must remain bound to the original active lease', options: [{ label: 'Continue' }] }] })
        questionOutcome = question.then(value => ({ value }), (error: unknown) => ({ error }))
        entered()
        await question
        return [{ type: 'text', text: 'Own question answered' }]
      },
    }))
    const mux = h.ctx.isolatedProjectRuntime.streamMux(own.authority, controller.signal)[Symbol.asyncIterator]()
    expect((await mux.next()).done).toBe(false)
    expect(await h.ctx.isolatedProjectRuntime.invoke(own.authority, undefined, request('session.selectModel',
      { sessionId: own.meta.id, provider: 'reply-idle-replay', model: 'reply-idle-model' }))).toMatchObject({ ok: true })
    expect(await h.ctx.isolatedProjectRuntime.invoke(own.authority, undefined, request('session.prompt',
      { sessionId: own.meta.id, mode: 'queue', content: [{ type: 'text', text: 'Wait for the own retained reply' }] })))
      .toMatchObject({ ok: true, value: { accepted: true } })
    await toolEntered
    let frame = await mux.next()
    while (!frame.done && frame.value.payload.type !== 'question/requested') frame = await mux.next()
    if (frame.done || frame.value.payload.type !== 'question/requested') throw new Error('real pending reply frame unavailable')
    let authorizeEntered!: () => void
    const authorizationHeld = new Promise<void>((resolve) => { authorizeEntered = resolve })
    let release!: () => void
    const authorizationRelease = new Promise<void>((resolve) => { release = resolve })
    releaseRetained = release
    const authorize = h.ctx.webIdentity.authorizeOwner.bind(h.ctx.webIdentity)
    let held = false
    vi.spyOn(h.ctx.webIdentity, 'authorizeOwner').mockImplementation(async (...args) => {
      const owner = await authorize(...args)
      if (!held && args[0] === responder && args[1].kind === 'session' && args[1].sessionId === own.meta.id) {
        held = true; authorizeEntered(); await authorizationRelease
      }
      return owner
    })
    let resolveCancel!: () => void
    const cancelled = new Promise<void>((resolve) => { resolveCancel = resolve })
    let replyDispatches = 0, cancellationReceipts = 0
    const originalFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
      const input = args[0]
      if (input instanceof URL && input.pathname === '/api/respond') replyDispatches++
      const response = await originalFetch(...args)
      if (input instanceof URL && input.pathname.startsWith('/_arx/operations/') && input.pathname.endsWith('/cancel')
        && new Headers(args[1]?.headers).get('x-arx-user-id') === own.authority.principal.userId) {
        const receipt: unknown = await response.clone().json()
        expect(response.status).toBe(200)
        expect(receipt).toMatchObject({ quiescent: true })
        cancellationReceipts++; resolveCancel()
      }
      return response
    })
    const reply = h.ctx.isolatedProjectRuntime.fetch(responder, new Request('http://fixture/api/respond', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        type: 'client-response', rpcId: frame.value.rpcId, result: { ok: true,
          value: { sessionId: own.meta.id, answer: { answers: [{ id: 'reply-idle-choice', selected: ['Continue'] }] } } },
      }),
    })).then(value => ({ value }), (error: unknown) => ({ error }))
    await authorizationHeld
    const initial = deadlines(own.authority), initialRevision = responder.revision
    await h.ctx.webIdentity.revalidate(responder, { activity: true })
    await h.ctx.webIdentity.revalidate(other.authority, { activity: true })
    expect(deadlines(responder).idle).toBeGreaterThan(initial.idle - 250)
    expect(deadlines(other.authority).idle).toBeGreaterThan(initial.idle - 250)
    const realNow = Date.now.bind(Date), offset = initial.idle - realNow() - 250
    const date = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset)
    restoreClock = () => { date.mockRestore() }
    await h.ctx.webIdentity.revalidate(responder, { activity: true })
    await h.ctx.webIdentity.revalidate(other.authority, { activity: true })
    await h.ctx.webIdentity.authenticate(own.account.token, 'user')
    expect(deadlines(own.authority)).toEqual(initial)
    // Authorization has completed against the real owner, but the original SID
    // expires without another frame or request before that result is delivered.
    await cancelled
    if (questionOutcome === undefined) throw new Error('real pending tool question unavailable')
    expect(await questionOutcome).toMatchObject({ error: { code: 'ASK_ABORTED' } })
    expect(supervisor.ctxOf(own.workspace.workspaceId)).toBeUndefined()
    release()
    const outcome = await reply
    expect(replyDispatches).toBe(0)
    expect(outcome).toMatchObject({ error: { code: 'RUNTIME_FORBIDDEN', status: 403 } })
    expect(supervisor.ctxOf(own.workspace.workspaceId)).toBeUndefined()
    expect(cancellationReceipts).toBeGreaterThan(0)
    expect((await h.ctx.webIdentity.authenticate(login.token, 'user')).revision).toBe(initialRevision)
    expect(await h.ctx.isolatedProjectRuntime.invoke(other.authority, undefined,
      request('session.create', { sessionId: other.meta.id }))).toMatchObject({ ok: true, value: { sessionId: other.meta.id } })
    expect(supervisor.ctxOf(other.workspace.workspaceId)).toBeDefined()
    replay.assertConsumed()
    replay.dispose(); disposeTool()
    expect(supervisor.counts).toEqual({ modelCalls: 1, toolCalls: 1 })
  })

  it('shares a real USER deletion barrier when the quiet SID expires before its retained cancellation receipt returns', async () => {
    const { h, supervisor, own, outcome } = await pendingQuestion('delete-expiry-choice')
    if (b === undefined) throw new Error('other owned USER unavailable')
    const other = b
    const login = await h.ctx.webIdentity.login(own.account.username, own.account.password, 'user')
    const responder = await h.ctx.webIdentity.authenticate(login.token, 'user')
    let entered!: () => void, release!: () => void, expired!: () => void
    const receiptHeld = new Promise<void>((resolve) => { entered = resolve })
    const receiptRelease = new Promise<void>((resolve) => { release = resolve })
    const realExpiry = new Promise<void>((resolve) => { expired = resolve })
    releaseRetained = release
    h.ctx.on('web-identity/session-expired', (_userId, sid) => { if (sid === own.authority.authSessionId) expired() })
    const originalFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
      const response = await originalFetch(...args), input = args[0]
      if (input instanceof URL && input.pathname.startsWith('/_arx/operations/') && input.pathname.endsWith('/cancel')
        && new Headers(args[1]?.headers).get('x-arx-user-id') === own.authority.principal.userId) {
        expect(response.status).toBe(200)
        expect(await response.clone().json()).toMatchObject({ quiescent: true })
        entered(); await receiptRelease
      }
      return response
    })
    const initial = scheduleQuietClock(own.authority)
    await h.ctx.webIdentity.revalidate(responder, { activity: true })
    await h.ctx.webIdentity.revalidate(other.authority, { activity: true })
    await h.ctx.webIdentity.authenticate(own.account.token, 'user')
    let acknowledgements = 0
    const deletion = h.ctx.webIdentity.deleteWorkspace(own.authority, own.workspace.workspaceId)
      .then(() => { acknowledgements++; return { deleted: true } }, (error: unknown) => ({ error }))
    await receiptHeld
    await realExpiry
    expect(acknowledgements).toBe(0)
    await expect(h.ctx.isolatedProjectRuntime.invoke(responder, undefined, request('host.describe')))
      .rejects.toMatchObject({ code: 'RUNTIME_UNAVAILABLE', status: 503 })
    release()
    expect(await deletion).toEqual({ deleted: true })
    expect(acknowledgements).toBe(1)
    expect(await outcome).toMatchObject({ error: { code: 'ASK_ABORTED' } })
    expect(supervisor.ctxOf(own.workspace.workspaceId)).toBeUndefined()
    expect(deadlines(own.authority)).toEqual(initial)
    expect((await h.ctx.webIdentity.authenticate(login.token, 'user')).authSessionId).toBe(responder.authSessionId)
    expect(await h.ctx.isolatedProjectRuntime.invoke(other.authority, undefined,
      request('session.create', { sessionId: other.meta.id }))).toMatchObject({ ok: true })
    expect(supervisor.ctxOf(other.workspace.workspaceId)).toBeDefined()
  })
  it('closes authority when a quiet SID cannot obtain a receipt from its genuinely unavailable supervisor', async () => {
    const { h, supervisor: peer, own, outcome } = await pendingQuestion('unavailable-expiry-choice')
    if (b === undefined) throw new Error('other owned USER unavailable')
    const other = b
    let failed!: () => void
    const failedCancellation = new Promise<void>((resolve) => { failed = resolve })
    const originalFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
      try { return await originalFetch(...args) }
      catch (error) {
        const input = args[0]
        if (input instanceof URL && input.pathname.startsWith('/_arx/operations/') && input.pathname.endsWith('/cancel')) failed()
        throw error
      }
    })
    scheduleQuietClock(own.authority)
    await h.ctx.webIdentity.revalidate(other.authority, { activity: true })
    await h.ctx.webIdentity.authenticate(own.account.token, 'user')
    // Actual server and worker closure creates the missing transport; no
    // cancellation receipt or provider result is substituted.
    await peer.close(); supervisor = undefined
    expect(await outcome).toMatchObject({ error: { code: 'ASK_ABORTED' } })
    await failedCancellation
    await vi.waitFor(async () => {
      await expect(h.ctx.webIdentity.authenticate(other.account.token, 'user'))
        .rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE', status: 503 })
    })
    await expect(h.ctx.isolatedProjectRuntime.invoke(other.authority, undefined, request('host.describe')))
      .rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE', status: 503 })
  })
  it('rejects a retained same-owner reply after the original MUX observes a genuine question resolution', async () => {
    const { h, own, mux, outcome, send } = await pendingQuestion('resolved-retained-choice')
    const login = await h.ctx.webIdentity.login(own.account.username, own.account.password, 'user')
    const responder = await h.ctx.webIdentity.authenticate(login.token, 'user')
    const authorize = h.ctx.webIdentity.authorizeOwner.bind(h.ctx.webIdentity)
    let entered!: () => void, release!: () => void, held = false
    const authorizationHeld = new Promise<void>((resolve) => { entered = resolve })
    const authorizationRelease = new Promise<void>((resolve) => { release = resolve })
    releaseRetained = release
    vi.spyOn(h.ctx.webIdentity, 'authorizeOwner').mockImplementation(async (...args) => {
      const owner = await authorize(...args)
      if (!held && args[0] === responder && args[1].kind === 'session' && args[1].sessionId === own.meta.id) {
        held = true; entered(); await authorizationRelease
      }
      return owner
    })
    let dispatched = 0
    const originalFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation((...args) => {
      if (args[0] instanceof URL && args[0].pathname === '/api/respond') dispatched++
      return originalFetch(...args)
    })
    const retained = h.ctx.isolatedProjectRuntime.fetch(responder, send())
      .then(value => ({ value }), (error: unknown) => ({ error }))
    await authorizationHeld
    const accepted = await h.ctx.isolatedProjectRuntime.fetch(own.authority, send())
    expect(await accepted.json()).toEqual({ accepted: true })
    expect(await outcome).toMatchObject({ value: { answers: [{ id: 'resolved-retained-choice', selected: ['Continue'] }] } })
    let frame = await mux.next()
    while (!frame.done && frame.value.payload.type !== 'question/resolved') frame = await mux.next()
    if (frame.done) throw new Error('real question resolution frame unavailable')
    expect(dispatched).toBe(1)
    release()
    expect(await retained).toMatchObject({ error: { code: 'RUNTIME_FORBIDDEN', status: 403 } })
    expect(dispatched).toBe(1)
    expect((await h.ctx.webIdentity.authenticate(login.token, 'user')).authSessionId).toBe(responder.authSessionId)
    controller.abort(); await mux.return?.()
  })
  it('refuses an expired original authority before timer delivery without logging out its valid responder', async () => {
    const { h, own, mux, outcome, send } = await pendingQuestion('clock-expired-choice')
    const login = await h.ctx.webIdentity.login(own.account.username, own.account.password, 'user')
    const responder = await h.ctx.webIdentity.authenticate(login.token, 'user')
    const initial = deadlines(own.authority)
    expect(deadlines(responder).idle).toBeGreaterThan(initial.idle)
    let dispatched = 0
    const originalFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation((...args) => {
      if (args[0] instanceof URL && args[0].pathname === '/api/respond') dispatched++
      return originalFetch(...args)
    })
    // Advance the actual clock at the original deadline without rescheduling
    // the timer: native SQLite revalidate must independently refuse it.
    const date = vi.spyOn(Date, 'now').mockReturnValue(initial.idle)
    restoreClock = () => { date.mockRestore() }
    await expect(h.ctx.isolatedProjectRuntime.fetch(responder, send()))
      .rejects.toMatchObject({ code: 'RUNTIME_FORBIDDEN', status: 403 })
    expect(dispatched).toBe(0)
    expect((await h.ctx.webIdentity.authenticate(login.token, 'user')).authSessionId).toBe(responder.authSessionId)
    controller.abort(); await mux.return?.()
    expect(await outcome).toMatchObject({ error: { code: 'ASK_ABORTED' } })
  })

  it('preserves the genuine projection-unavailable error when original-lease validation sees a journal-only commit', async () => {
    const { h, own, mux, outcome, send } = await pendingQuestion('journal-unavailable-choice')
    const login = await h.ctx.webIdentity.login(own.account.username, own.account.password, 'user')
    const responder = await h.ctx.webIdentity.authenticate(login.token, 'user')
    const beforeHead = h.ctx.webIdentity.authorityHead
    const original = h.ctx.webIdentity.revalidate.bind(h.ctx.webIdentity)
    let injected = false, dispatched = 0
    vi.spyOn(h.ctx.webIdentity, 'revalidate').mockImplementation(async (...args) => {
      if (!injected && args[0] === own.authority) {
        injected = true
        const journal = h.ctx.identityAuthorityJournal, head = journal.head
        const record = (await journal.recordsAfter(head.sequence - 1)).at(-1)
        if (record === undefined) throw new Error('real final journal event unavailable')
        // The original real decision payload is appended with a fresh operation
        // ID; the journal rejects duplicate IDs. Leave the projection behind
        // without restoring or recreating that authoritative journal head.
        await journal.append(head.sequence, { operationId: randomUUID(), kind: record.kind, payload: record.payload })
      }
      return original(...args)
    })
    const originalFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation((...args) => {
      if (args[0] instanceof URL && args[0].pathname === '/api/respond') dispatched++
      return originalFetch(...args)
    })
    await expect(h.ctx.isolatedProjectRuntime.fetch(responder, send()))
      .rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE', status: 503 })
    expect(injected).toBe(true)
    expect(dispatched).toBe(0)
    expect(h.ctx.webIdentity.authorityHead).toEqual(beforeHead)
    expect(h.ctx.identityAuthorityJournal.head.sequence).toBe(beforeHead.sequence + 1)
    await expect(h.ctx.webIdentity.authenticate(login.token, 'user'))
      .rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE', status: 503 })
    controller.abort(); await mux.return?.()
    expect(await outcome).toMatchObject({ error: { code: 'ASK_ABORTED' } })
  })
  it('preserves the genuine SQLite error during a temporary synthetic metadata-schema failure and restores the table', async () => {
    const { h, own, mux, outcome, send } = await pendingQuestion('schema-unavailable-choice')
    const login = await h.ctx.webIdentity.login(own.account.username, own.account.password, 'user')
    const responder = await h.ctx.webIdentity.authenticate(login.token, 'user')
    const beforeHead = h.ctx.webIdentity.authorityHead
    const original = h.ctx.webIdentity.revalidate.bind(h.ctx.webIdentity)
    let injected = false, dispatched = 0
    vi.spyOn(h.ctx.webIdentity, 'revalidate').mockImplementation(async (...args) => {
      if (!injected && args[0] === own.authority) {
        injected = true
        const database = new DatabaseSync(h.paths.database)
        try {
          // Rename only this synthetic table; its rows, seals and revisions
          // stay untouched and the original name is restored before returning.
          database.exec('ALTER TABLE auth_meta RENAME TO auth_meta_fixture_failure')
          try { return await original(...args) }
          finally { database.exec('ALTER TABLE auth_meta_fixture_failure RENAME TO auth_meta') }
        } finally { database.close() }
      }
      return original(...args)
    })
    const originalFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation((...args) => {
      if (args[0] instanceof URL && args[0].pathname === '/api/respond') dispatched++
      return originalFetch(...args)
    })
    const reply = await h.ctx.isolatedProjectRuntime.fetch(responder, send())
      .then(value => ({ value }), (error: unknown) => ({ error }))
    expect(injected).toBe(true)
    expect(dispatched).toBe(0)
    expect(reply).toHaveProperty('error')
    if (!('error' in reply)) throw new Error('genuine SQLite failure unavailable')
    expect(reply.error).toMatchObject({ code: 'ERR_SQLITE_ERROR' })
    expect(h.ctx.webIdentity.authorityHead).toEqual(beforeHead)
    expect((await h.ctx.webIdentity.authenticate(login.token, 'user')).authSessionId).toBe(responder.authSessionId)
    const database = new DatabaseSync(h.paths.database)
    try {
      expect(database.prepare("SELECT name FROM sqlite_schema WHERE name IN ('auth_meta','auth_meta_fixture_failure') ORDER BY name").all())
        .toEqual([{ name: 'auth_meta' }])
    } finally { database.close() }
    controller.abort(); await mux.return?.()
    expect(await outcome).toMatchObject({ error: { code: 'ASK_ABORTED' } })
  })
})
