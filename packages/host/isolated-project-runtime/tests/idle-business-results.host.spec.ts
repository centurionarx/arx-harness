/** Business refusals from genuine Typert providers are passive auth activity. */
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { serverResponseSchema } from '@arx-ai/arx-host-apiproxy/api'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER } from '@arx-ai/arx-web-identity'
import * as Connection from '../../../client/connection/src/index.ts'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import * as BrokerHttp from '../src/broker-http.ts'
import { nativeSupervisorFixture } from './native-supervisor.ts'

let harness: Awaited<ReturnType<typeof storageHarness>> | undefined
let supervisor: Awaited<ReturnType<typeof nativeSupervisorFixture>> | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  await harness?.close()
  await supervisor?.close()
  harness = undefined; supervisor = undefined
})

async function ownFixture() {
  supervisor = await nativeSupervisorFixture()
  harness = await storageHarness({ http: true, endpoint: supervisor.endpoint, readyUsers: 1,
    extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp },
      { name: '@arx-ai/arx-client-connection', plugin: Connection, config: { accessMode: 'authenticated' } }] })
  const h = harness, peer = supervisor, user = h.users[0], origin = h.url
  if (user === undefined || origin === undefined) throw new Error('real authenticated USER fixture unavailable')
  const project = await h.ctx.projectStorage.createProject(user.authority, 'Business receipt')
  const workspace = await h.ctx.projectStorage.createWorkspace(user.authority, project.projectId, 'Own Remote workspace')
  const provision = await h.ctx.projectStorage.provision(user.authority, workspace.workspaceId)
  peer.assign({ controlOrigin: origin, scope: provision.scope, volumePath: provision.volumePath })
  const meta = await h.ctx.projectStorage.register(user.authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  await h.ctx.projectStorage.append(user.authority, meta.id, oneTurnLog())
  const state = await h.ctx.webIdentity.state(user.authority)
  const call = async (method: string, payload: unknown) => {
    const response = await fetch(origin + '/api/' + method, { method: 'POST', headers: {
      cookie: AUTH_COOKIE_NAMES.user + '=' + user.token, origin,
      [AUTH_HEADER]: '1', [CSRF_HEADER]: state.csrfToken, 'content-type': 'application/json',
    }, body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }) })
    expect(response.status).toBe(200)
    const body: unknown = await response.json()
    return body
  }
  expect(await call('session.create', { sessionId: meta.id })).toMatchObject({ result: { ok: true, value: { sessionId: meta.id } } })
  const deadlines = () => {
    const database = new DatabaseSync(h.paths.database)
    try {
      const row = database.prepare('SELECT expires_at,idle_expires_at FROM web_sessions WHERE id=?').get(user.authority.authSessionId)
      if (row === undefined) throw new Error('real session deadline missing')
      return { absolute: Number(row.expires_at), idle: Number(row.idle_expires_at) }
    } finally { database.close() }
  }
  const initial = deadlines(), head = h.ctx.webIdentity.authorityHead
  let now = initial.idle - 1000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const advance = () => { now += 10 }
  const ctx = peer.ctxOf(workspace.workspaceId)
  if (ctx === undefined) throw new Error('real owned worker unavailable')
  return { h, peer, user, meta, ctx, call, deadlines, initial, head, advance, workspace, provision }
}

it('does not renew idle for an unresolved command even when the canonical Remote RPC succeeds', async () => {
  const own = await ownFixture()
  const events = await own.h.ctx.sessionPersistence.readFrom(own.meta.id, 0)
  expect(await own.call('commands/execute', { args: { agentId: own.meta.id, line: '/unknown-activity-fixture', images: [] } }))
    .toMatchObject({ result: { ok: true } })
  expect(own.deadlines()).toEqual(own.initial)
  expect(own.h.ctx.webIdentity.authorityHead).toEqual(own.head)
  expect((await own.h.ctx.sessionPersistence.readFrom(own.meta.id, 0)).events).toEqual(events.events)
  expect(own.peer.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
}, 30000)

it('keeps a canonical command image-admission error passive without entering its registered handler', async () => {
  const own = await ownFixture()
  let handlerCalls = 0
  own.ctx.commands.register({ name: 'image-refusal-fixture', description: 'Actual command image refusal',
    handler: () => { handlerCalls++; return { kind: 'success', text: 'admitted handler' } } })
  expect(await own.call('commands/execute', { args: { agentId: own.meta.id, line: '/image-refusal-fixture',
    images: [{ mediaType: 'image/png', data: 'eA==' }] } }))
    .toMatchObject({ result: { ok: true, value: { result: { kind: 'error', text: '/image-refusal-fixture does not accept image attachments' } } } })
  expect(handlerCalls).toBe(0)
  expect(own.deadlines()).toEqual(own.initial)
  expect(own.h.ctx.webIdentity.authorityHead).toEqual(own.head)
  const stored = await own.h.ctx.sessionPersistence.readFrom(own.meta.id, 0)
  expect(stored.events.filter(event => event.type === 'command/done')).toHaveLength(1)
  expect(own.peer.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
}, 30000)

it('does not renew idle for a real feedback business failure carried by an outer successful RPC', async () => {
  const own = await ownFixture()
  expect(await own.call('messageFeedback/put', { args: { request: { sessionId: own.meta.id,
    messageId: randomUUID(), rating: 'positive', note: ' ', ifVersion: null } } }))
    .toMatchObject({ result: { ok: true, value: { ok: false, error: { code: 'note-blank' } } } })
  expect(own.deadlines()).toEqual(own.initial)
  expect(own.h.ctx.webIdentity.authorityHead).toEqual(own.head)
  expect(await own.call('messageFeedback/list', { args: { request: { sessionId: own.meta.id } } }))
    .toMatchObject({ result: { ok: true, value: { ok: true, value: { items: [] } } } })
  expect(own.peer.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
}, 30000)


function rpcValue(receipt: unknown): unknown {
  const response = serverResponseSchema.parse(receipt)
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('canonical RPC business result unavailable')
  return response.result.value
}

it('renews once after a real successful command and preserves the durable command lifecycle before its receipt', async () => {
  const own = await ownFixture(), effectPath = join(own.provision.volumePath, 'activity-command.txt')
  let handlerCalls = 0
  own.ctx.commands.register({ name: 'owned-write-fixture', description: 'Write an actual owned fixture artifact',
    async handler() {
      handlerCalls++
      await writeFile(effectPath, String(handlerCalls))
      return { kind: 'success', text: 'Owned artifact written' }
    } })
  own.advance()
  expect(await own.call('commands/execute', { args: { agentId: own.meta.id, line: '/owned-write-fixture', images: [] } }))
    .toMatchObject({ result: { ok: true, value: { result: { kind: 'success', text: 'Owned artifact written' } } } })
  expect(await readFile(effectPath, 'utf8')).toBe('1')
  expect(handlerCalls).toBe(1)
  expect(own.deadlines().absolute).toBe(own.initial.absolute)
  expect(own.deadlines().idle).toBeGreaterThan(own.initial.idle)
  expect((await own.h.ctx.identityAuthorityJournal.recordsAfter(own.head.sequence)).filter(record => record.kind === 'session')).toHaveLength(1)
  const stored = await own.h.ctx.sessionPersistence.readFrom(own.meta.id, 0)
  expect(stored.events.filter(event => event.type === 'command/run')).toHaveLength(1)
  expect(stored.events.filter(event => event.type === 'command/done')).toEqual([expect.objectContaining({ data: expect.objectContaining({ kind: 'success' }) as unknown })])
  expect(own.peer.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
}, 30000)

it('renews successful feedback put and delete but keeps compare-and-set refusals passive', async () => {
  const own = await ownFixture(), target = 'one-turn-assistant'
  own.advance()
  const created = rpcValue(await own.call('messageFeedback/put', { args: { request: { sessionId: own.meta.id,
    messageId: target, rating: 'positive', ifVersion: null } } }))
  expect(created).toMatchObject({ ok: true, value: { messageId: target, rating: 'positive', version: expect.any(String) as unknown } })
  if (typeof created !== 'object' || created === null || !('value' in created)
    || typeof created.value !== 'object' || created.value === null || !('version' in created.value)
    || typeof created.value.version !== 'string') throw new Error('canonical feedback version unavailable')
  const version = created.value.version
  const renewed = own.deadlines(), head = own.h.ctx.webIdentity.authorityHead
  expect(renewed.absolute).toBe(own.initial.absolute)
  expect(renewed.idle).toBeGreaterThan(own.initial.idle)
  expect((await own.h.ctx.identityAuthorityJournal.recordsAfter(own.head.sequence)).filter(record => record.kind === 'session')).toHaveLength(1)
  own.advance()
  expect(await own.call('messageFeedback/put', { args: { request: { sessionId: own.meta.id,
    messageId: target, rating: 'negative', ifVersion: null } } }))
    .toMatchObject({ result: { ok: true, value: { ok: false, error: { code: 'version-conflict' } } } })
  expect(await own.call('messageFeedback/delete', { args: { request: { sessionId: own.meta.id,
    messageId: target, ifVersion: randomUUID() } } }))
    .toMatchObject({ result: { ok: true, value: { ok: false, error: { code: 'version-conflict' } } } })
  expect(own.deadlines()).toEqual(renewed)
  expect(own.h.ctx.webIdentity.authorityHead).toEqual(head)
  expect(await own.call('messageFeedback/delete', { args: { request: { sessionId: own.meta.id,
    messageId: target, ifVersion: version } } }))
    .toMatchObject({ result: { ok: true, value: { ok: true, value: { absent: true } } } })
  expect(own.deadlines().absolute).toBe(own.initial.absolute)
  expect(own.deadlines().idle).toBeGreaterThan(renewed.idle)
  expect((await own.h.ctx.identityAuthorityJournal.recordsAfter(head.sequence)).filter(record => record.kind === 'session')).toHaveLength(1)
  expect(await own.call('messageFeedback/list', { args: { request: { sessionId: own.meta.id } } }))
    .toMatchObject({ result: { ok: true, value: { ok: true, value: { items: [] } } } })
  expect(own.peer.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
}, 30000)

it('renews an exact goal mutation after its canonical durable owner receipt', async () => {
  const own = await ownFixture()
  expect(await own.call('goals/create', { args: { agentId: own.meta.id,
    request: { objective: 'Owned authorized activity', maxGoalRounds: 2 } } }))
    .toMatchObject({ result: { ok: true, value: { ref: { revision: 1 } } } })
  expect(own.deadlines().absolute).toBe(own.initial.absolute)
  expect(own.deadlines().idle).toBeGreaterThan(own.initial.idle)
  expect((await own.h.ctx.identityAuthorityJournal.recordsAfter(own.head.sequence)).filter(record => record.kind === 'session')).toHaveLength(1)
  const stored = await own.h.ctx.sessionPersistence.readFrom(own.meta.id, 0)
  expect(stored.events.filter(event => event.type === 'goal/change')).toHaveLength(1)
  expect(own.peer.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
}, 30000)
