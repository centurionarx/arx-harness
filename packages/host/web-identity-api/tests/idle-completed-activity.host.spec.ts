/** Exact administrative actions renew only while their real request remains admissible. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@arx-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER } from '@arx-ai/arx-web-identity'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'

let fixture: Awaited<ReturnType<typeof identityHarness>> | undefined
let release: (() => void) | undefined
afterEach(async () => { release?.(); vi.restoreAllMocks(); await fixture?.close(); fixture = undefined; release = undefined })

async function adminActivityFixture() {
  fixture = await identityHarness({ api: 'admin', readyUsers: 1 })
  const h = fixture, origin = h.url, target = h.users[0]
  if (origin === undefined || target === undefined) throw new Error('real administration fixture unavailable')
  const login = await h.ctx.webIdentity.login('arxadmin', h.passwords.master, 'admin')
  const authority = await h.ctx.webIdentity.authenticate(login.token, 'admin')
  const headers = { cookie: AUTH_COOKIE_NAMES.admin + '=' + login.token, origin,
    [AUTH_HEADER]: '1', [CSRF_HEADER]: login.state.csrfToken, 'content-type': 'application/json' }
  const send = (path: string, body: unknown, method = 'POST', signal?: AbortSignal) => fetch(origin + path, {
    method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    ...(signal === undefined ? {} : { signal }),
  })
  const deadlines = () => {
    const database = new DatabaseSync(h.paths.database)
    try {
      const row = database.prepare('SELECT expires_at,idle_expires_at FROM web_sessions WHERE id=?').get(authority.authSessionId)
      if (row === undefined) throw new Error('real MASTER session deadline missing')
      return { absolute: Number(row.expires_at), idle: Number(row.idle_expires_at) }
    } finally { database.close() }
  }
  const initial = deadlines()
  let now = initial.idle - 1000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  return { h, authority, target, send, deadlines, initial, advance: () => { now += 10 } }
}

it('renews each exact successful administration route once while GET, invalid and unknown actions remain passive', async () => {
  const own = await adminActivityFixture()
  const renew = async (path: string, body: unknown, method: string, status: number) => {
    const before = own.deadlines(), head = own.h.ctx.webIdentity.authorityHead
    own.advance()
    const database = new DatabaseSync(own.h.paths.database)
    let due: string[]
    try {
      due = database.prepare('SELECT id FROM web_sessions WHERE revoked=0 AND id<>? AND (idle_expires_at<=? OR expires_at<=?) ORDER BY id')
        .all(own.authority.authSessionId, Date.now(), Date.now()).map(row => String(row.id))
    } finally { database.close() }
    const response = await own.send(path, body, method)
    expect(response.status).toBe(status)
    const value: unknown = await response.json()
    expect(own.deadlines().absolute).toBe(own.initial.absolute)
    expect(own.deadlines().idle).toBeGreaterThan(before.idle)
    expect(own.deadlines().idle).toBeLessThanOrEqual(own.initial.absolute)
    const records = (await own.h.ctx.identityAuthorityJournal.recordsAfter(head.sequence)).filter(record => record.kind === 'session')
    const rows = records.map((record) => {
      const row = record.payload.session
      if (typeof row !== 'object' || row === null || !('id' in row) || typeof row.id !== 'string'
        || !('revoked' in row) || !('idle_expires_at' in row)) throw new Error('canonical authority session record unavailable')
      return { id: row.id, revoked: row.revoked, idle: row.idle_expires_at }
    })
    expect(rows.filter(row => row.id === own.authority.authSessionId)).toEqual([{
      id: own.authority.authSessionId, revoked: 0, idle: own.deadlines().idle,
    }])
    const expired = rows.filter(row => row.id !== own.authority.authSessionId)
    expect(expired.map(row => row.id).sort()).toEqual(due)
    for (const row of expired) {
      expect(row.revoked).toBe(1)
      expect(row.idle).toBeLessThanOrEqual(Date.now())
    }
    return value
  }
  const username = 'activity-user-' + randomUUID()
  const created = await renew('/admin/users', { username, email: username + '@fixture.test' }, 'POST', 201)
  expect(created).toMatchObject({ user: { username } })
  if (typeof created !== 'object' || created === null || !('user' in created)
    || typeof created.user !== 'object' || created.user === null || !('userId' in created.user)
    || typeof created.user.userId !== 'string') throw new Error('canonical USER creation receipt missing')
  const id = created.user.userId, email = 'corrected-' + randomUUID() + '@fixture.test'
  expect(await renew('/admin/users/' + id + '/invitation-email', { email }, 'PATCH', 200))
    .toMatchObject({ user: { userId: id, email } })
  expect(await renew('/admin/users/' + id + '/invitation', {}, 'POST', 202)).toMatchObject({ accepted: true })
  expect(await renew('/admin/users/' + own.target.userId + '/modules', { grants: ['storage'] }, 'PUT', 200))
    .toMatchObject({ user: { userId: own.target.userId } })
  expect(await renew('/admin/users/' + own.target.userId + '/status', { status: 'BLOCKED' }, 'PATCH', 200))
    .toMatchObject({ user: { userId: own.target.userId, status: 'BLOCKED' } })
  const renewed = own.deadlines(), head = own.h.ctx.webIdentity.authorityHead
  own.advance()
  expect((await own.send('/admin/users', undefined, 'GET')).status).toBe(200)
  expect((await own.send('/admin/modules', undefined, 'GET')).status).toBe(200)
  expect((await own.send('/admin/users', {})).status).toBe(400)
  expect((await own.send('/admin/unknown', {})).status).toBe(404)
  expect(own.deadlines()).toEqual(renewed)
  expect(own.h.ctx.webIdentity.authorityHead).toEqual(head)
}, 30000)

it('does not renew or publish an admin result when logout precedes completed activity', async () => {
  const own = await adminActivityFixture(), entered = Promise.withResolvers<undefined>(), retained = Promise.withResolvers<undefined>()
  release = () => { retained.resolve(undefined) }
  const original = own.h.ctx.webIdentity.createUser.bind(own.h.ctx.webIdentity)
  vi.spyOn(own.h.ctx.webIdentity, 'createUser').mockImplementation(async (...args) => {
    const user = await original(...args); entered.resolve(undefined); await retained.promise; return user
  })
  const username = 'held-admin-' + randomUUID()
  const outcome = own.send('/admin/users', { username, email: username + '@fixture.test' })
    .then(value => ({ value }), (error: unknown) => ({ error }))
  await entered.promise
  expect(own.deadlines()).toEqual(own.initial)
  await own.h.ctx.webIdentity.logout(own.authority)
  const head = own.h.ctx.webIdentity.authorityHead
  release()
  const result = await outcome
  if (!('value' in result)) throw result.error
  expect(result.value.status).toBe(401)
  expect(await result.value.json()).toMatchObject({ error: { code: 'AUTH_INVALID' } })
  expect(own.deadlines()).toEqual(own.initial)
  expect(own.h.ctx.webIdentity.authorityHead).toEqual(head)
}, 30000)

function retainedActivity(own: Awaited<ReturnType<typeof adminActivityFixture>>) {
  const entered = Promise.withResolvers<undefined>(), retained = Promise.withResolvers<undefined>()
  release = () => { retained.resolve(undefined) }
  const original = own.h.ctx.webIdentity.revalidate.bind(own.h.ctx.webIdentity)
  let held = false
  vi.spyOn(own.h.ctx.webIdentity, 'revalidate').mockImplementation(async (...args) => {
    const result = await original(...args)
    if (!held && args[0].authSessionId === own.authority.authSessionId && args[1]?.activity === true) {
      held = true; entered.resolve(undefined); await retained.promise
    }
    return result
  })
  const username = 'renewed-admin-' + randomUUID()
  return { entered, username }
}

it('rechecks admin authority after an awaited durable renewal before returning a retained result', async () => {
  const own = await adminActivityFixture(), held = retainedActivity(own)
  const outcome = own.send('/admin/users', { username: held.username, email: held.username + '@fixture.test' })
    .then(value => ({ value }), (error: unknown) => ({ error }))
  await held.entered.promise
  const renewed = own.deadlines()
  expect(renewed.absolute).toBe(own.initial.absolute)
  expect(renewed.idle).toBeGreaterThan(own.initial.idle)
  await own.h.ctx.webIdentity.logout(own.authority)
  const head = own.h.ctx.webIdentity.authorityHead
  release?.()
  const result = await outcome
  if (!('value' in result)) throw result.error
  expect(result.value.status).toBe(401)
  expect(await result.value.json()).toMatchObject({ error: { code: 'AUTH_INVALID' } })
  expect(own.deadlines()).toEqual(renewed)
  expect(own.h.ctx.webIdentity.authorityHead).toEqual(head)
}, 30000)

type NodeIdentityApi = { handle(request: IncomingMessage, response: ServerResponse): Promise<void> }
it('rechecks the real Node connection signal after awaited durable activity when the HTTP caller closes', async () => {
  const own = await adminActivityFixture(), held = retainedActivity(own)
  const closed = Promise.withResolvers<undefined>(), completed = Promise.withResolvers<undefined>()
  const api = own.h.ctx.webIdentityApi as unknown as NodeIdentityApi, original = api.handle.bind(api)
  vi.spyOn(api, 'handle').mockImplementation(async (request, response) => {
    response.once('close', () => { closed.resolve(undefined) })
    try { await original(request, response) } finally { completed.resolve(undefined) }
  })
  const controller = new AbortController()
  const outcome = own.send('/admin/users', { username: held.username, email: held.username + '@fixture.test' }, 'POST', controller.signal)
    .then(value => ({ value }), (error: unknown) => ({ error }))
  await held.entered.promise
  const renewed = own.deadlines(), head = own.h.ctx.webIdentity.authorityHead
  expect(renewed.absolute).toBe(own.initial.absolute)
  expect(renewed.idle).toBeGreaterThan(own.initial.idle)
  controller.abort()
  await closed.promise
  expect(await outcome).toMatchObject({ error: { name: 'AbortError' } })
  release?.()
  await completed.promise
  expect(own.deadlines()).toEqual(renewed)
  expect(own.h.ctx.webIdentity.authorityHead).toEqual(head)
}, 30000)

it('rechecks the API provider lifetime after awaited durable activity before publishing the committed action', async () => {
  const own = await adminActivityFixture(), held = retainedActivity(own), api = own.h.ctx.webIdentityApi
  const outcome = own.send('/admin/users', { username: held.username, email: held.username + '@fixture.test' })
    .then(value => ({ value }), (error: unknown) => ({ error }))
  await held.entered.promise
  const renewed = own.deadlines(), head = own.h.ctx.webIdentity.authorityHead
  expect(renewed.absolute).toBe(own.initial.absolute)
  expect(renewed.idle).toBeGreaterThan(own.initial.idle)
  const owner = api as unknown as { readonly ownerCtx: Context }
  expect(owner.ownerCtx.fiber).not.toBe(own.h.ctx.fiber)
  await owner.ownerCtx.fiber.dispose()
  release?.()
  const result = await outcome
  if (!('value' in result)) throw result.error
  expect(result.value.status).toBe(503)
  const body = await result.value.json() as Record<string, unknown>
  expect(body).toMatchObject({ error: { code: 'AUTH_UNAVAILABLE' } })
  expect(Object.keys(body)).toEqual(['error'])
  expect(own.deadlines()).toEqual(renewed)
  expect(own.h.ctx.webIdentity.authorityHead).toEqual(head)
}, 30000)
