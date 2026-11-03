import { DatabaseSync } from 'node:sqlite'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER } from '@arx-ai/arx-web-identity/contract'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'
let fixture: Awaited<ReturnType<typeof identityHarness>> | undefined
let clock: MockInstance<() => number> | undefined
afterEach(async () => { clock?.mockRestore(); clock = undefined; await fixture?.close(); fixture = undefined })
function deadlines() {
  const h = fixture!, db = new DatabaseSync(h.paths.database)
  try {
    const row = db.prepare('SELECT expires_at,idle_expires_at FROM web_sessions WHERE id=?').get(h.users[0]!.authority.authSessionId)!
    return { absolute: Number(row.expires_at), idle: Number(row.idle_expires_at) }
  }
  finally { db.close() }
}
describe('native durable idle and absolute session expiry', () => {
  it('keeps passive HTTP, websocket admission, provider checks and refused mutations idle', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ api: 'user', readyUsers: 1, identityConfig: { sessionTtlMs: 20000, sessionIdleTtlMs: 10000 } })
    const h = fixture, a = h.users[0]!, initial = deadlines(), base = initial.absolute - 20000
    let now = base + 6000
    clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const cookie = AUTH_COOKIE_NAMES.user + '=' + a.token, head = h.ctx.webIdentity.authorityHead
    const get = () => fetch(h.url! + '/auth/session', { headers: { cookie } })
    expect(await (await get()).json()).toMatchObject({ authenticated: true })
    await h.ctx.webIdentity.authenticate(a.token, 'user')
    await h.ctx.webIdentity.revalidate(a.authority)
    const state = await h.ctx.webIdentity.state(a.authority)
    const headResponse = await fetch(h.url! + '/auth/session', { method: 'HEAD', headers: { cookie, origin: h.url!, [AUTH_HEADER]: '1', [CSRF_HEADER]: state.csrfToken } })
    expect(headResponse.status).toBe(404)
    await h.ctx.webIdentityApi.authenticateRequest(new Request(h.url! + '/native', { headers: { cookie, origin: h.url!, upgrade: 'websocket' } }))
    expect(deadlines()).toEqual(initial)
    expect(h.ctx.webIdentity.authorityHead).toEqual(head)
    now = base + 9000
    const post = (extra: Record<string, string>) => fetch(h.url! + '/auth/password/change', { method: 'POST', headers: { cookie, origin: h.url!, [AUTH_HEADER]: '1', 'Content-Type': 'application/json', ...extra }, body: '{}' })
    expect((await post({ [CSRF_HEADER]: 'invalid' })).status).toBe(403)
    expect((await post({ origin: 'https://wrong.fixture.test', [CSRF_HEADER]: state.csrfToken })).status).toBe(403)
    expect(deadlines()).toEqual(initial)
    expect(h.ctx.webIdentity.authorityHead).toEqual(head)
    // Passing CSRF does not turn a malformed identity request into admitted activity.
    expect((await post({ [CSRF_HEADER]: state.csrfToken })).status).toBe(400)
    expect(deadlines()).toEqual(initial)
    expect(h.ctx.webIdentity.authorityHead).toEqual(head)
    const records = (await readFile(join(h.paths.journal, 'authority.jsonl'), 'utf8')).trim().split('\n')
    const record = JSON.parse(records.at(-1)!) as { payload: { session: { idle_expires_at: number; expires_at: number } } }
    expect(record.payload.session.idle_expires_at).toBe(initial.idle)
    expect(record.payload.session.expires_at).toBe(initial.absolute)
    expect(records.at(-1)).not.toContain(a.token)
    now = initial.idle - 1
    expect((await post({ [CSRF_HEADER]: state.csrfToken })).status).toBe(400)
    expect(deadlines()).toEqual(initial)
    expect(h.ctx.webIdentity.authorityHead).toEqual(head)
    now = initial.absolute
    expect(await (await get()).json()).toEqual({ authenticated: false, audience: 'user' })
    await expect(h.ctx.webIdentity.revalidate(a.authority, { activity: true })).rejects.toMatchObject({ code: 'AUTH_INVALID' })
  })
  it('rejects idle expiry at its boundary despite passive polls, and cannot revive the expired authority', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ api: 'user', readyUsers: 1, identityConfig: { sessionTtlMs: 20000, sessionIdleTtlMs: 10000 } })
    const h = fixture, a = h.users[0]!, initial = deadlines()
    let now = initial.idle - 1
    clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const cookie = AUTH_COOKIE_NAMES.user + '=' + a.token
    const state = await h.ctx.webIdentity.state(a.authority)
    const get = () => fetch(h.url! + '/auth/session', { headers: { cookie } })
    expect(await (await get()).json()).toMatchObject({ authenticated: true })
    now = initial.idle
    expect(now).toBeLessThan(initial.absolute)
    expect(await (await get()).json()).toEqual({ authenticated: false, audience: 'user' })
    await expect(h.ctx.webIdentity.authenticate(a.token, 'user')).rejects.toMatchObject({ code: 'AUTH_INVALID' })
    await expect(h.ctx.webIdentity.revalidate(a.authority)).rejects.toMatchObject({ code: 'AUTH_INVALID' })
    await expect(h.ctx.webIdentity.revalidate(a.authority, { activity: true })).rejects.toMatchObject({ code: 'AUTH_INVALID' })
    const response = await fetch(h.url! + '/auth/password/change', { method: 'POST', headers: { cookie, origin: h.url!, [AUTH_HEADER]: '1', [CSRF_HEADER]: state.csrfToken, 'Content-Type': 'application/json' }, body: '{}' })
    expect(response.status).toBe(401)
    expect(deadlines()).toEqual(initial)
  })
  it('persists admitted activity through a normal private-provider reopen without extending the absolute deadline', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ readyUsers: 1, identityConfig: { sessionTtlMs: 20000, sessionIdleTtlMs: 10000 } })
    const h = fixture, a = h.users[0]!, initial = deadlines(), now = initial.idle - 1000
    clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    await h.ctx.webIdentity.revalidate(a.authority, { activity: true })
    const renewed = deadlines()
    expect(renewed).toEqual({ absolute: initial.absolute, idle: now + 10000 })
    const paths = h.paths
    await h.close(false)
    fixture = undefined
    fixture = await identityHarness({ root: paths.root, initialize: false, bootstrap: false,
      identityConfig: { sessionTtlMs: 20000, sessionIdleTtlMs: 10000 } })
    const authority = await fixture.ctx.webIdentity.authenticate(a.token, 'user')
    expect((await fixture.ctx.webIdentity.state(authority)).expiresAt).toBe(initial.absolute)
    const db = new DatabaseSync(paths.database)
    try { expect(Number(db.prepare('SELECT idle_expires_at FROM web_sessions WHERE id=?').get(authority.authSessionId)!.idle_expires_at)).toBe(renewed.idle) }
    finally { db.close() }
  })
})
