/** Automatic SDK POST reads remain passive through the genuine native gateway. */
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { installLlmReplay } from '@arx-ai/arx-llm-replay'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER } from '@arx-ai/arx-web-identity'
import { AbstractApiClient } from '@arx-ai/arx-host-apiproxy/client'
import type { IApiClient } from '@arx-ai/arx-host-apiproxy/client'
import * as Connection from '../../../client/connection/src/index.ts'
import { frozenBeforeIdle, storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import * as BrokerHttp from '../src/broker-http.ts'
import { nativeSupervisorFixture } from './native-supervisor.ts'


let harness: Awaited<ReturnType<typeof storageHarness>> | undefined
let supervisor: Awaited<ReturnType<typeof nativeSupervisorFixture>> | undefined
let downlink: AbortController | undefined
afterEach(async () => {
  downlink?.abort(); downlink = undefined
  vi.restoreAllMocks()
  await harness?.close()
  await supervisor?.close()
  harness = undefined; supervisor = undefined
})

/** Load the actual Client-face SDK while this Node fixture owns only public wire contracts. */
async function actualWebApiClient(send: typeof globalThis.fetch): Promise<IApiClient> {
  const namespace: unknown = await import(new URL('../../../client/connection/src/client/web-api-client.ts', import.meta.url).href)
  if (typeof namespace !== 'object' || namespace === null || !('WebApiClient' in namespace)
    || typeof namespace.WebApiClient !== 'function') throw new Error('actual WebApiClient export unavailable')
  const client: unknown = Reflect.construct(namespace.WebApiClient, [send])
  if (!(client instanceof AbstractApiClient)) throw new Error('actual SDK wire client unavailable')
  return client
}

/** Read the real web session absolute and idle deadlines from the identity database. */
function sessionDeadlines(path: string, authSessionId: string) {
  const database = new DatabaseSync(path)
  try {
    const row = database.prepare('SELECT expires_at,idle_expires_at FROM web_sessions WHERE id=?').get(authSessionId)
    if (row === undefined) throw new Error('real session deadline missing')
    return { absolute: Number(row.expires_at), idle: Number(row.idle_expires_at) }
  } finally { database.close() }
}

it('does not renew idle or journal head for SDK handshake, reconnect and automatic subagent refetch POSTs', async () => {
  supervisor = await nativeSupervisorFixture()
  harness = await storageHarness({ http: true, endpoint: supervisor.endpoint, readyUsers: 1,
    extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp },
      { name: '@arx-ai/arx-client-connection', plugin: Connection, config: { accessMode: 'authenticated' } }] })
  const h = harness, peer = supervisor, user = h.users[0], origin = h.url
  if (user === undefined || origin === undefined) throw new Error('real authenticated USER fixture unavailable')
  const project = await h.ctx.projectStorage.createProject(user.authority, 'Passive SDK')
  const workspace = await h.ctx.projectStorage.createWorkspace(user.authority, project.projectId, 'Own SDK workspace')
  const provision = await h.ctx.projectStorage.provision(user.authority, workspace.workspaceId)
  peer.assign({ controlOrigin: origin, scope: provision.scope, volumePath: provision.volumePath })
  const meta = await h.ctx.projectStorage.register(user.authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  await h.ctx.projectStorage.append(user.authority, meta.id, oneTurnLog())
  const state = await h.ctx.webIdentity.state(user.authority)
  const methods: string[] = []
  const client = await actualWebApiClient((input, init) => {
    const url = new URL(input as string | URL, origin)
    methods.push(url.pathname)
    const headers = new Headers(init?.headers)
    headers.set('cookie', AUTH_COOKIE_NAMES.user + '=' + user.token)
    headers.set('origin', origin)
    headers.set(AUTH_HEADER, '1')
    headers.set(CSRF_HEADER, state.csrfToken)
    return fetch(new URL(url.pathname + url.search, origin), { ...init, headers })
  })
  expect(await client.sessions.create({ sessionId: meta.id })).toMatchObject({ result: { ok: true, value: { sessionId: meta.id } } })
  const deadlines = () => sessionDeadlines(h.paths.database, user.authority.authSessionId)
  const initial = deadlines(), head = h.ctx.webIdentity.authorityHead
  const now = frozenBeforeIdle(h.paths.database)
  vi.spyOn(Date, 'now').mockReturnValue(now)
  expect((await client.host.describe({})).result.ok).toBe(true)
  expect(deadlines()).toEqual(initial)
  expect(h.ctx.webIdentity.authorityHead).toEqual(head)
  expect((await client.host.describe({})).result.ok).toBe(true)
  expect((await client.sessions.list({})).result.ok).toBe(true)
  const refetch = await client.subagents.list({ parentSessionId: meta.id })
  expect(refetch.result.ok).toBe(true)
  expect(deadlines()).toEqual(initial)
  expect(h.ctx.webIdentity.authorityHead).toEqual(head)
  expect(methods).toEqual(['/api/session.create', '/api/host.describe', '/api/host.describe', '/api/session.list', '/api/subagent.list'])
  expect(peer.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
}, 30000)


async function sdkActivityFixture() {
  supervisor = await nativeSupervisorFixture()
  harness = await storageHarness({ http: true, endpoint: supervisor.endpoint, readyUsers: 1,
    extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp },
      { name: '@arx-ai/arx-client-connection', plugin: Connection, config: { accessMode: 'authenticated' } }] })
  const h = harness, peer = supervisor, user = h.users[0], origin = h.url
  if (user === undefined || origin === undefined) throw new Error('real authenticated USER fixture unavailable')
  const project = await h.ctx.projectStorage.createProject(user.authority, 'Actual SDK activity')
  const workspace = await h.ctx.projectStorage.createWorkspace(user.authority, project.projectId, 'Owned activity workspace')
  const provision = await h.ctx.projectStorage.provision(user.authority, workspace.workspaceId)
  peer.assign({ controlOrigin: origin, scope: provision.scope, volumePath: provision.volumePath })
  const state = await h.ctx.webIdentity.state(user.authority)
  const client = await actualWebApiClient((input, init) => {
    const url = new URL(input as string | URL, origin), headers = new Headers(init?.headers)
    headers.set('cookie', AUTH_COOKIE_NAMES.user + '=' + user.token)
    headers.set('origin', origin)
    headers.set(AUTH_HEADER, '1')
    headers.set(CSRF_HEADER, state.csrfToken)
    return fetch(new URL(url.pathname + url.search, origin), { ...init, headers })
  })
  const deadlines = () => sessionDeadlines(h.paths.database, user.authority.authSessionId)
  const initial = deadlines()
  let now = frozenBeforeIdle(h.paths.database)
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  return { h, peer, user, origin, project, workspace, provision, client, deadlines, initial, advance: () => { now += 10 } }
}

it('renews new session creation, rename and a consumed replay prompt through the actual authenticated SDK', async () => {
  const own = await sdkActivityFixture()
  const expectRenewal = async (before: ReturnType<typeof own.deadlines>, sequence: number) => {
    expect(own.deadlines().absolute).toBe(own.initial.absolute)
    expect(own.deadlines().idle).toBeGreaterThan(before.idle)
    expect(own.deadlines().idle).toBeLessThanOrEqual(own.initial.absolute)
    expect((await own.h.ctx.identityAuthorityJournal.recordsAfter(sequence)).filter(record => record.kind === 'session')).toHaveLength(1)
  }
  let before = own.deadlines(), head = own.h.ctx.webIdentity.authorityHead
  const created = await own.client.sessions.create({ workspaceId: own.workspace.workspaceId })
  expect(created.result.ok).toBe(true)
  if (!created.result.ok) throw new Error('real SDK session creation denied')
  const id = created.result.value.sessionId
  await expectRenewal(before, head.sequence)
  expect(await own.h.ctx.webIdentity.authorizeOwner(own.user.authority, { kind: 'session', sessionId: id }))
    .toMatchObject({ userId: own.user.userId, projectId: own.project.projectId, workspaceId: own.workspace.workspaceId })
  const ctx = own.peer.ctxOf(own.workspace.workspaceId), agent = ctx?.agents.get(id)
  if (ctx === undefined || agent === undefined) throw new Error('actual SDK created worker session unavailable')
  own.advance(); before = own.deadlines(); head = own.h.ctx.webIdentity.authorityHead
  expect(await own.client.sessions.rename({ sessionId: id, title: 'Durable SDK activity title' }))
    .toMatchObject({ result: { ok: true, value: { title: 'Durable SDK activity title', seq: expect.any(Number) as unknown } } })
  await expectRenewal(before, head.sequence)
  const renamed = await own.h.ctx.sessionPersistence.readFrom(id, 0)
  expect(renamed.events.some(event => JSON.stringify(event.data).includes('Durable SDK activity title'))).toBe(true)
  const replayPath = join(own.provision.volumePath, 'sdk-activity-replay.jsonl')
  await writeFile(replayPath, [{ type: 'session', id: 'sdk-activity-recording', createdAt: 1 },
    ...textResponse('Actual SDK replay output').map(chunk => ({ type: 'assistant/chunk', data: { turn: 1, step: 1, chunk } }))]
    .map(row => JSON.stringify(row)).join('\n') + '\n')
  const replay = installLlmReplay(ctx, { file: replayPath,
    providers: [{ id: 'sdk-activity-replay', models: [{ id: 'sdk-activity-model' }] }] })
  try {
    own.advance(); before = own.deadlines(); head = own.h.ctx.webIdentity.authorityHead
    expect(await own.client.sessions.selectModel({ sessionId: id, provider: 'sdk-activity-replay', model: 'sdk-activity-model' }))
      .toMatchObject({ result: { ok: true } })
    await expectRenewal(before, head.sequence)
    own.advance(); before = own.deadlines(); head = own.h.ctx.webIdentity.authorityHead
    expect(await own.client.sessions.prompt({ sessionId: id, mode: 'queue', content: [{ type: 'text', text: 'Actual SDK activity input' }] }))
      .toMatchObject({ result: { ok: true, value: { accepted: true } } })
    await expectRenewal(before, head.sequence)
    await agent.whenIdle()
    expect(await ctx.sessions.flush(agent.session)).toBe(true)
    replay.assertConsumed()
    const stored = await own.h.ctx.sessionPersistence.readFrom(id, 0)
    expect(stored.events.filter(event => event.type === 'user/message').some(event => JSON.stringify(event.data).includes('Actual SDK activity input'))).toBe(true)
    expect(stored.events.filter(event => event.type === 'assistant/message').some(event => JSON.stringify(event.data).includes('Actual SDK replay output'))).toBe(true)
    expect(stored.events.filter(event => event.type === 'turn/end')).toHaveLength(1)
    expect(own.peer.counts).toEqual({ modelCalls: 1, toolCalls: 0 })
  } finally { replay.dispose() }
}, 30000)


it('renews only the replying SID after a real same-owner question is accepted through authenticated HTTP', async () => {
  const own = await sdkActivityFixture()
  const created = await own.client.sessions.create({ workspaceId: own.workspace.workspaceId })
  expect(created.result.ok).toBe(true)
  if (!created.result.ok) throw new Error('real question session creation denied')
  const id = created.result.value.sessionId, ctx = own.peer.ctxOf(own.workspace.workspaceId), agent = ctx?.agents.get(id)
  if (ctx === undefined || agent === undefined) throw new Error('actual question worker unavailable')
  const login = await own.h.ctx.webIdentity.login(own.user.username, own.user.password, 'user')
  const responder = await own.h.ctx.webIdentity.authenticate(login.token, 'user')
  expect(responder.authSessionId).not.toBe(own.user.authority.authSessionId)
  expect(responder.principal.userId).toBe(own.user.userId)
  const deadline = () => {
    const database = new DatabaseSync(own.h.paths.database)
    try {
      const row = database.prepare('SELECT expires_at,idle_expires_at FROM web_sessions WHERE id=?').get(responder.authSessionId)
      if (row === undefined) throw new Error('real responder deadline unavailable')
      return { absolute: Number(row.expires_at), idle: Number(row.idle_expires_at) }
    } finally { database.close() }
  }
  downlink = new AbortController()
  const mux = own.h.ctx.isolatedProjectRuntime.streamMux(own.user.authority, downlink.signal)[Symbol.asyncIterator]()
  expect((await mux.next()).done).toBe(false)
  const asked = ctx.userQuestions.ask({ agent, questions: [{ id: 'sid-activity-choice',
    question: 'Only the SID providing this answer performs activity', options: [{ label: 'Continue' }] }] })
  const outcome = asked.then(value => ({ value }), (error: unknown) => ({ error }))
  let frame = await mux.next()
  while (!frame.done && frame.value.payload.type !== 'question/requested') frame = await mux.next()
  if (frame.done || frame.value.payload.type !== 'question/requested') throw new Error('real pending question frame unavailable')
  const beforeOriginal = own.deadlines(), beforeResponder = deadline(), head = own.h.ctx.webIdentity.authorityHead
  const body = { type: 'client-response', rpcId: frame.value.rpcId, result: { ok: true,
    value: { sessionId: id, answer: { answers: [{ id: 'sid-activity-choice', selected: ['Continue'] }] } } } }
  const send = () => fetch(own.origin + '/api/respond', { method: 'POST', headers: {
    cookie: AUTH_COOKIE_NAMES.user + '=' + login.token, origin: own.origin,
    [AUTH_HEADER]: '1', [CSRF_HEADER]: login.state.csrfToken, 'content-type': 'application/json',
  }, body: JSON.stringify(body) })
  own.advance()
  const response = await send()
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ accepted: true })
  expect(await outcome).toHaveProperty('value')
  expect(own.deadlines()).toEqual(beforeOriginal)
  expect(deadline().absolute).toBe(beforeResponder.absolute)
  expect(deadline().idle).toBeGreaterThan(beforeResponder.idle)
  expect(deadline().idle).toBeLessThanOrEqual(beforeResponder.absolute)
  expect((await own.h.ctx.identityAuthorityJournal.recordsAfter(head.sequence)).filter(record => record.kind === 'session')).toHaveLength(1)
  const acceptedDeadline = deadline(), acceptedHead = own.h.ctx.webIdentity.authorityHead
  own.advance()
  const duplicate = await send()
  expect(duplicate.status).toBe(403)
  expect(own.deadlines()).toEqual(beforeOriginal)
  expect(deadline()).toEqual(acceptedDeadline)
  expect(own.h.ctx.webIdentity.authorityHead).toEqual(acceptedHead)
  expect(own.peer.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
}, 30000)
