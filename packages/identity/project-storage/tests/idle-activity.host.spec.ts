/** Successful owner operations must still qualify before durable idle renewal. */
import { randomUUID } from 'node:crypto'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER } from '@arx-ai/arx-web-identity'
import { storageHarness } from './harness.ts'
let fixture: Awaited<ReturnType<typeof storageHarness>> | undefined
let release: (() => void) | undefined
afterEach(async () => { release?.(); vi.restoreAllMocks(); await fixture?.close(); fixture = undefined; release = undefined })


async function ownerHttpFixture() {
  fixture = await storageHarness({ http: true, readyUsers: 1 })
  const h = fixture, user = h.users[0], origin = h.url
  if (user === undefined || origin === undefined) throw new Error('real owner HTTP fixture missing')
  const state = await h.ctx.webIdentity.state(user.authority)
  const deadlines = () => {
    const database = new DatabaseSync(h.paths.database)
    try {
      const row = database.prepare('SELECT expires_at,idle_expires_at FROM web_sessions WHERE id=?').get(user.authority.authSessionId)
      if (row === undefined) throw new Error('real session deadline missing')
      return { absolute: Number(row.expires_at), idle: Number(row.idle_expires_at) }
    } finally { database.close() }
  }
  const initial = deadlines()
  vi.spyOn(Date, 'now').mockReturnValue(initial.idle - 1000)
  const headers = { cookie: AUTH_COOKIE_NAMES.user + '=' + user.token, origin,
    [AUTH_HEADER]: '1', [CSRF_HEADER]: state.csrfToken, 'content-type': 'application/json' }
  return { h, user, origin, state, initial, deadlines, headers }
}

it('does not renew idle when the committed project becomes tombstoned before HTTP publication', async () => {
  const { h, user, origin, state, initial, deadlines } = await ownerHttpFixture()
  const created = Promise.withResolvers<Awaited<ReturnType<typeof h.ctx.projectStorage.createProject>>>()
  const retained = Promise.withResolvers<void>(); release = retained.resolve
  const original = h.ctx.projectStorage.createProject.bind(h.ctx.projectStorage)
  vi.spyOn(h.ctx.projectStorage, 'createProject').mockImplementation(async (...args) => {
    const project = await original(...args)
    created.resolve(project)
    await retained.promise
    return project
  })
  const response = fetch(origin + '/user/projects', { method: 'POST', headers: {
    cookie: AUTH_COOKIE_NAMES.user + '=' + user.token, origin, [AUTH_HEADER]: '1',
    [CSRF_HEADER]: state.csrfToken, 'content-type': 'application/json',
  }, body: JSON.stringify({ name: 'Retained committed own project' }) })
  const outcome = response.then(value => ({ value }), (error: unknown) => ({ error }))
  const project = await created.promise
  await h.ctx.webIdentity.deleteProject(user.authority, project.projectId)
  const headAfterTombstone = h.ctx.webIdentity.authorityHead
  release()
  const result = await outcome
  if (!('value' in result)) throw result.error
  expect(result.value.status).toBe(403)
  expect(deadlines()).toEqual(initial)
  expect(h.ctx.webIdentity.authorityHead).toEqual(headAfterTombstone)
  expect((await h.ctx.webIdentity.authenticate(user.token, 'user')).revision).toBe(user.authority.revision)
  await expect(h.ctx.webIdentity.authorizeOwner(user.authority, { kind: 'project', projectId: project.projectId })).rejects.toMatchObject({ code: 'OWNER_FORBIDDEN' })
}, 30000)

it('renews each successful exact owner HTTP mutation once while preserving the absolute deadline and deletion', async () => {
  const { h, user, origin, initial, deadlines, headers } = await ownerHttpFixture()
  const project = await h.ctx.projectStorage.createProject(user.authority, 'Existing own project')
  const workspace = await h.ctx.projectStorage.createWorkspace(user.authority, project.projectId, 'Existing own workspace')
  const meta = await h.ctx.projectStorage.register(user.authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  await h.ctx.projectStorage.append(user.authority, meta.id, oneTurnLog())
  let now = initial.idle - 1000, previousIdle = initial.idle
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const operations = [
    { path: '/user/projects', method: 'POST', body: { name: 'Created project' }, status: 201 },
    { path: `/user/projects/${project.projectId}/workspaces`, method: 'POST', body: { name: 'Created workspace' }, status: 201 },
    { path: `/user/sessions/${meta.id}`, method: 'PATCH', body: { title: 'Renamed own session' }, status: 200 },
    { path: `/user/workspaces/${workspace.workspaceId}/grouping`, method: 'DELETE', status: 200 },
    { path: `/user/sessions/${meta.id}`, method: 'DELETE', status: 200 },
  ]
  for (const operation of operations) {
    now += 10
    const head = h.ctx.webIdentity.authorityHead
    const response = await fetch(origin + operation.path, { method: operation.method, headers,
      ...(operation.body === undefined ? {} : { body: JSON.stringify(operation.body) }) })
    expect(response.status).toBe(operation.status)
    await response.json()
    expect(deadlines().absolute).toBe(initial.absolute)
    expect(deadlines().idle).toBeGreaterThan(previousIdle)
    expect(deadlines().idle).toBeLessThanOrEqual(initial.absolute)
    expect((await h.ctx.identityAuthorityJournal.recordsAfter(head.sequence)).filter(record => record.kind === 'session')).toHaveLength(1)
    previousIdle = deadlines().idle
  }
  await expect(h.ctx.webIdentity.authorizeOwner(user.authority, { kind: 'session', sessionId: meta.id })).rejects.toMatchObject({ code: 'OWNER_FORBIDDEN' })
  expect((await h.ctx.webIdentity.authenticate(user.token, 'user')).revision).toBe(user.authority.revision)
}, 30000)

it('does not renew when an admitted owner loses the storage grant before the committed result is published', async () => {
  const { h, user, origin, initial, deadlines, headers } = await ownerHttpFixture()
  const master = h.master
  if (master === undefined) throw new Error('real MASTER authority unavailable')
  const created = Promise.withResolvers<void>(), retained = Promise.withResolvers<void>(); release = retained.resolve
  const original = h.ctx.projectStorage.createProject.bind(h.ctx.projectStorage)
  vi.spyOn(h.ctx.projectStorage, 'createProject').mockImplementation(async (...args) => {
    const project = await original(...args); created.resolve(); await retained.promise; return project
  })
  const outcome = fetch(origin + '/user/projects', { method: 'POST', headers,
    body: JSON.stringify({ name: 'Committed before grant withdrawal' }) }).then(value => ({ value }), (error: unknown) => ({ error }))
  await created.promise
  await h.ctx.webIdentity.setModules(master, user.userId, [])
  const headAfterWithdrawal = h.ctx.webIdentity.authorityHead
  release()
  const result = await outcome
  if (!('value' in result)) throw result.error
  expect(result.value.status).toBe(401)
  expect(deadlines()).toEqual(initial)
  expect(h.ctx.webIdentity.authorityHead).toEqual(headAfterWithdrawal)
  await expect(h.ctx.webIdentity.authenticate(user.token, 'user')).rejects.toMatchObject({ code: 'AUTH_INVALID' })
}, 30000)
