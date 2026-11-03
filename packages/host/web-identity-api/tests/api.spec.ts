import type { AdminUserSummary } from '@arx-ai/arx-web-identity/contract'
import { afterEach, describe, expect, it } from 'vitest'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER, parseAuthState, parseAuthInvalidation } from '@arx-ai/arx-web-identity/contract'
import { identityProblem } from '../src/index.ts'
let fixture: Awaited<ReturnType<typeof identityHarness>> | undefined
afterEach(async () => { await fixture?.close(); fixture = undefined })
describe('native identity HTTP real composition', () => {
  it('keeps failures safe', () => { expect(identityProblem(new Error('fixture-private-value'))).toEqual({ status: 500, body: { error: { code: 'AUTH_INTERNAL', message: 'Identity request unavailable' } } }) })
  it('enforces first password, origin/CSRF, audience, closed admin and independent invalidation', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ api: 'admin', bootstrap: false })
    const { ctx, url, deliveries } = fixture
    const temporary = 'Temporary-fixture-' + 't'.repeat(20), changed = 'Changed-fixture-' + 'c'.repeat(20)
    await ctx.webIdentity.bootstrapMaster(temporary)
    const get = (path: string, cookie?: string) => fetch(url! + path, { headers: cookie === undefined ? {} : { cookie } })
    const mutation = (path: string, body: unknown, cookie?: string, csrf?: string, method = 'POST', origin = url!) => fetch(url! + path, {
      method, headers: { origin, 'Content-Type': 'application/json', [AUTH_HEADER]: '1', ...(cookie === undefined ? {} : { cookie }), ...(csrf === undefined ? {} : { [CSRF_HEADER]: csrf }) },
      body: JSON.stringify(body),
    })
    const anonymous = await get('/auth/session')
    expect(anonymous.headers.get('Cache-Control')).toBe('no-store')
    expect(parseAuthState(await anonymous.json())).toEqual({ authenticated: false, audience: 'admin' })
    const wrongOrigin = await mutation('/auth/login', { identifier: 'arxadmin', password: temporary }, undefined, undefined, 'POST', 'https://wrong.fixture.test')
    expect(wrongOrigin.status).toBe(403)
    const missingHeader = await fetch(url! + '/auth/login', { method: 'POST', headers: { origin: url!, 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'arxadmin', password: temporary }) })
    expect(missingHeader.status).toBe(403)
    const rejected = await mutation('/auth/login', { identifier: 'marker-not-reflected', password: 'marker-private-password' })
    expect(rejected.status).toBe(401)
    expect(await rejected.text()).not.toContain('marker')
    const login = await mutation('/auth/login', { identifier: 'ADMIN@CENTURIONARX.COM', password: temporary })
    expect(login.status).toBe(200)
    expect(login.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Strict')
    let cookie = login.headers.get('Set-Cookie')!.split(';')[0]!
    let state = parseAuthState(await login.json())
    if (!state.authenticated)
      throw new Error('fixture login missing')
    expect(state.principal.mustChangePassword).toBe(true)
    expect((await get('/admin/users', cookie)).status).toBe(403)
    const pollStart = Date.now()
    const unchanged = await get('/auth/invalidation?generation=' + String(state.generation), cookie)
    expect(parseAuthInvalidation(await unchanged.json()).invalidated).toBe(false)
    expect(Date.now() - pollStart).toBeGreaterThanOrEqual(75)
    const noCsrf = await mutation('/auth/password/change', { currentPassword: temporary, newPassword: changed }, cookie)
    expect(noCsrf.status).toBe(403)
    const change = await mutation('/auth/password/change', { currentPassword: temporary, newPassword: changed }, cookie, state.csrfToken)
    expect(change.status).toBe(200)
    const oldCookie = cookie
    cookie = change.headers.get('Set-Cookie')!.split(';')[0]!
    state = parseAuthState(await change.json())
    if (!state.authenticated)
      throw new Error('fixture changed login missing')
    expect(state.principal.mustChangePassword).toBe(false)
    expect(parseAuthState(await (await get('/auth/session', oldCookie)).json()).authenticated).toBe(false)
    const list = await get('/admin/users', cookie)
    expect(list.status).toBe(200)
    expect(JSON.stringify(await list.json())).not.toContain('password_hash')
    expect((await get('/api/session.list', cookie)).status).toBe(404)
    expect((await get('/auth/session', AUTH_COOKIE_NAMES.user + '=x'.repeat(43))).status).toBe(200)
    const create = await mutation('/admin/users', { username: 'fixture-created', email: 'created@fixture.test' }, cookie, state.csrfToken)
    expect(create.status).toBe(201)
    const user = (await create.json() as {
      user: AdminUserSummary
    }).user
    expect(user.role).toBe('USER')
    expect(user.status).toBe('PENDING')
    await ctx.webIdentity.flushOutbox()
    const invite = new URLSearchParams(new URL(deliveries.at(-1)!.link).hash.slice(1)).get('invite')!
    const accepted = await mutation('/auth/invitation/accept', { token: invite, newPassword: 'USER-fixture-' + 'u'.repeat(20) })
    expect(accepted.status).toBe(200)
    expect(accepted.headers.has('Set-Cookie')).toBe(false)
    expect((await mutation('/auth/invitation/accept', { token: invite, newPassword: 'USER-fixture-' + 'v'.repeat(20) })).status).toBe(400)
    const forbiddenEmail = await mutation('/admin/users/' + user.userId + '/invitation-email', { email: 'admin@fixture.test' }, cookie, state.csrfToken, 'PATCH')
    expect(forbiddenEmail.status).toBe(403)
    expect((await mutation('/admin/users/' + state.principal.userId + '/status', { status: 'BLOCKED' }, cookie, state.csrfToken, 'PATCH')).status).toBe(403)
    const invalidation = get('/auth/invalidation?generation=' + String(state.generation), cookie)
    await new Promise(resolve => setTimeout(resolve, 20))
    const logout = await mutation('/auth/logout', {}, cookie, state.csrfToken)
    expect(logout.status).toBe(204)
    expect(logout.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(parseAuthInvalidation(await (await invalidation).json())).toMatchObject({ invalidated: true, reason: 'logout' })
    expect(parseAuthState(await (await get('/auth/session', cookie)).json()).authenticated).toBe(false)
    expect((await mutation('/auth/password/forgot', { identifier: 'nonexistent@fixture.test' })).status).toBe(202)
  })
})
