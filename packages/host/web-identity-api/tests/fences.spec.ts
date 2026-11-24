import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { identityHarness, nextInvalidation } from '../../../../examples/web-identity/tests/harness.ts'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER } from '@arx-ai/arx-web-identity/contract'
let fixture: Awaited<ReturnType<typeof identityHarness>> | undefined
afterEach(async () => { await fixture?.close(); fixture = undefined })
describe('native HTTP fences and bounded invalidation', () => {
  it('reuses sealed authority for canonical Host/Origin, cookie CSRF and explicit bearer clients', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ api: 'user', readyUsers: 1, apiConfig: { allowBearer: true } })
    const { ctx, url, users } = fixture, a = users[0]!, origin = new URL(url!)
    const cookie = AUTH_COOKIE_NAMES.user + '=' + a.token, state = await ctx.webIdentity.state(a.authority)
    expect(ctx.webIdentityApi.canonicalOrigin).toBe(url)
    const request = (headers: HeadersInit) => new Request(url! + '/native', { headers })
    expect((await ctx.webIdentityApi.authenticateRequest(request({ cookie }))).principal.userId).toBe(a.userId)
    expect((await ctx.webIdentityApi.authenticateRequest(request({ authorization: 'Bearer ' + a.token, [AUTH_HEADER]: '1' }), { mutating: true })).principal.userId).toBe(a.userId)
    for (const headers of [{ cookie, host: 'wrong.fixture.test' }, { cookie, origin: 'https://' + origin.host }, { cookie, authorization: 'Bearer ' + a.token },
      { cookie: cookie + '; ' + cookie }, { authorization: 'invalid' }, { cookie, upgrade: 'websocket' }]) {
      await expect(ctx.webIdentityApi.authenticateRequest(request(headers))).rejects.toMatchObject({
        status: expect.any(Number) as unknown })
    }
    expect((await ctx.webIdentityApi.authenticateRequest(request({ cookie, upgrade: 'websocket', origin: url! }))).principal.userId).toBe(a.userId)
    await expect(ctx.webIdentityApi.authenticateRequest(request({ cookie, [AUTH_HEADER]: '1' }), { mutating: true })).rejects.toMatchObject({ code: 'AUTH_CSRF' })
    expect((await ctx.webIdentityApi.authenticateRequest(request({ cookie, origin: url!, [AUTH_HEADER]: '1', [CSRF_HEADER]: state.csrfToken }), { mutating: true })).principal.userId).toBe(a.userId)
    const incoming = new IncomingMessage(new Socket())
    incoming.headers = { cookie, host: [origin.host, origin.host] } as unknown as typeof incoming.headers
    await expect(ctx.webIdentityApi.authenticateRequest(incoming)).rejects.toMatchObject({ code: 'AUTH_REQUEST' })
    incoming.destroy()
    const original = new Request('https://wrong.fixture.test/native', { headers: { cookie, host: origin.host } })
    await expect(ctx.webIdentityApi.authenticateRequest(original)).rejects.toMatchObject({ code: 'AUTH_ORIGIN' })
  })
  it('limits concurrent polls, handles disconnect and expiry, and rejects missing generations', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ api: 'user', readyUsers: 1, apiConfig: { invalidationTimeoutMs: 30000, maxInvalidationRequestsPerSession: 1 } })
    const { ctx, url, users, paths } = fixture, a = users[0]!, state = await ctx.webIdentity.state(a.authority), cookie = AUTH_COOKIE_NAMES.user + '=' + a.token
    const get = (path: string, signal?: AbortSignal) => fetch(url! + path, {
      headers: { cookie }, ...(signal === undefined ? {} : { signal }) })
    for (const query of ['', '?generation=-1', '?generation=NaN'])
      expect((await get('/auth/invalidation' + query)).status).toBe(400)
    expect(await (await get('/auth/invalidation?generation=0')).json()).toMatchObject({ invalidated: true, reason: 'credentials-changed' })
    // Each step waits for the server's poll state; the deadline of the first poll outlasts the test.
    const first = nextInvalidation(ctx, a.authority.authSessionId)
    const abort = new AbortController(), pending = get('/auth/invalidation?generation=' + String(state.generation), abort.signal)
    const abandoned = expect(pending).rejects.toBeDefined()
    await first.pending
    expect((await get('/auth/invalidation?generation=' + String(state.generation))).status).toBe(429)
    abort.abort()
    await abandoned
    expect(await first.settled).toMatchObject({ invalidated: true, reason: 'disposed' })
    // The expiry is detected when the poll's deadline revalidates the session. The session expires right after the
    // poll is registered, before any timer can run, so a short deadline keeps the test fast without a race.
    ;(ctx.webIdentityApi as unknown as { config: { invalidationTimeoutMs?: number } }).config.invalidationTimeoutMs = 200
    const second = nextInvalidation(ctx, a.authority.authSessionId)
    const expiring = get('/auth/invalidation?generation=' + String(state.generation))
    await second.pending
    const db = new DatabaseSync(paths.database)
    db.prepare('UPDATE web_sessions SET expires_at=0 WHERE id=?').run(a.authority.authSessionId)
    db.close()
    expect(await (await expiring).json()).toMatchObject({ invalidated: true, reason: 'expired' })
  })
  it('bounds bodies and retries without accepting forwarded client identity', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ api: 'user', bootstrap: false, apiConfig: { maxBodyBytes: 1024, publicRateLimitAttempts: 2, minimumRecoveryResponseMs: 20 } })
    const { url } = fixture
    const post = (path: string, body: string, type = 'application/json', extra: Record<string, string> = {}) => fetch(url! + path, {
      method: 'POST', headers: { origin: url!, [AUTH_HEADER]: '1', 'Content-Type': type, ...extra }, body,
    })
    const start = Date.now()
    expect((await post('/auth/password/forgot', JSON.stringify({ identifier: 'unknown@fixture.test' }))).status).toBe(202)
    expect(Date.now() - start).toBeGreaterThanOrEqual(15)
    expect((await post('/auth/login', JSON.stringify({ identifier: 'unknown@fixture.test', password: 'fixture-unavailable' }))).status).toBe(401)
    expect((await post('/auth/password/forgot', JSON.stringify({ identifier: 'UNKNOWN@FIXTURE.TEST' }))).status).toBe(429)
    expect((await post('/auth/login', JSON.stringify({ identifier: 'other@fixture.test', password: 'fixture-unavailable' }))).status).toBe(401)
    expect((await post('/auth/login', JSON.stringify({ identifier: 'third@fixture.test', password: 'fixture-unavailable' }), 'application/json', { 'X-Forwarded-For': 'different-fixture-client' })).status).toBe(429)
    expect((await post('/auth/password/reset', 'x'.repeat(1025))).status).toBe(413)
    expect((await post('/auth/invitation/accept', '{}', 'text/plain')).status).toBe(415)
    expect((await post('/auth/invitation/accept', 'null')).status).toBe(400)
  })
  it('keeps tokens unconsumed on GET/HEAD and fixes anonymous audience even when credentials belong elsewhere', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ api: 'user', readyUsers: 1 })
    const { ctx, url, users, deliveries } = fixture, a = users[0]!
    await ctx.webIdentity.forgotPassword(a.username)
    await ctx.webIdentity.flushOutbox()
    const reset = new URLSearchParams(new URL(deliveries.at(-1)!.link).hash.slice(1)).get('reset')!
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(url! + '/auth/password/reset?token=' + reset, { method })
      expect(response.status).toBe(401)
    }
    const response = await fetch(url! + '/auth/password/reset', { method: 'POST', headers: { origin: url!, [AUTH_HEADER]: '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ token: reset, newPassword: 'Reset-private-fixture-' + 'x'.repeat(20) }) })
    expect(response.status).toBe(200)
    const anonymous = await fetch(url! + '/auth/session', { headers: { cookie: AUTH_COOKIE_NAMES.admin + '=' + a.token } })
    expect(await anonymous.json()).toEqual({ authenticated: false, audience: 'user' })
    const old = await fetch(url! + '/auth/session', { headers: { cookie: AUTH_COOKIE_NAMES.user + '=' + a.token } })
    expect(await old.json()).toEqual({ authenticated: false, audience: 'user' })
  })
})
