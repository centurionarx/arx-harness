import type { AdminUserSummary } from '@arx-ai/arx-web-identity/contract'
import { Context } from '@arx-ai/cordis'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { identityHarness, nextInvalidation } from '../../../../examples/web-identity/tests/harness.ts'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER, parseModuleCatalog, parseAdminUserList } from '@arx-ai/arx-web-identity/contract'
import IdentityApi from '../src/index.ts'
let fixture: Awaited<ReturnType<typeof identityHarness>> | undefined
afterEach(async () => { vi.restoreAllMocks(); await fixture?.close(); fixture = undefined })
describe('closed native administration and HTTP failure budgets', () => {
  it('executes every advertised admin action while rejecting uncontrolled account fields', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ api: 'admin' })
    const { ctx, url, deliveries, passwords } = fixture
    const login = await ctx.webIdentity.login('arxadmin', passwords.master, 'admin')
    const cookie = AUTH_COOKIE_NAMES.admin + '=' + login.token, state = login.state
    const get = (path: string) => fetch(url! + path, { headers: { cookie } })
    const send = (path: string, body: unknown, method = 'POST') => fetch(url! + path, { method, headers: {
      origin: url!, cookie, [AUTH_HEADER]: '1', [CSRF_HEADER]: state.csrfToken, 'Content-Type': 'application/json',
    }, body: JSON.stringify(body) })
    expect(parseModuleCatalog(await (await get('/admin/modules')).json()).modules).toHaveLength(2)
    for (const limit of ['0', '101', '1.5', 'NaN'])
      expect((await get('/admin/users?limit=' + limit)).status).toBe(400)
    const create = await send('/admin/users', { username: 'api-pending', email: 'pending@fixture.test', role: 'MASTER_ADMIN', password: 'forbidden-final', grants: ['runtime'] })
    expect(create.status).toBe(201)
    const user = (await create.json() as {
      user: AdminUserSummary
    }).user
    expect(user.role).toBe('USER')
    expect(user.passwordEstablished).toBe(false)
    expect(user.grants).toEqual([])
    const page = parseAdminUserList(await (await get('/admin/users?limit=1')).json())
    expect(page.nextCursor).toBeDefined()
    if (page.nextCursor === undefined)
      throw new Error('expected native admin continuation')
    expect(parseAdminUserList(await (await get('/admin/users?limit=1&cursor=' + page.nextCursor)).json()).users).toHaveLength(1)
    expect((await send('/admin/users/' + user.userId + '/status', { status: 'PENDING' }, 'PATCH')).status).toBe(400)
    expect((await send('/admin/users/' + user.userId + '/status', { status: 'ACTIVE' }, 'PATCH')).status).toBe(200)
    for (const grants of ['storage', [1], ['unknown'], ['storage', 'storage']])
      expect((await send('/admin/users/' + user.userId + '/modules', { grants }, 'PUT')).status).toBe(400)
    expect((await send('/admin/users/' + user.userId + '/modules', { grants: ['storage'] }, 'PUT')).status).toBe(200)
    expect((await send('/admin/users/' + user.userId + '/invitation', {})).status).toBe(202)
    expect((await send('/admin/users/' + user.userId + '/status', { status: 'BLOCKED' }, 'PATCH')).status).toBe(200)
    expect((await send('/admin/users/' + user.userId + '/invitation', {})).status).toBe(403)
    const second = await (await send('/admin/users', { username: 'api-correctable', email: 'old@fixture.test' })).json() as {
      user: AdminUserSummary
    }
    expect((await send('/admin/users/' + second.user.userId + '/invitation-email', { email: 'corrected@fixture.test' }, 'PATCH')).status).toBe(200)
    await ctx.webIdentity.flushOutbox()
    expect(deliveries.some(mail => mail.to === 'corrected@fixture.test')).toBe(true)
    expect((await send('/admin/unknown', {})).status).toBe(404)
    expect((await send('/admin/users/' + second.user.userId + '/modules', {}, 'PATCH')).status).toBe(404)
    const missing = await fetch(url! + '/auth/login', { method: 'POST', headers: { origin: url!, [AUTH_HEADER]: '1', 'Content-Type': 'application/json' }, body: '{"identifier":1}' })
    expect(missing.status).toBe(400)
    for (const body of ['{invalid', '[]'])
      expect((await fetch(url! + '/auth/password/reset', { method: 'POST', headers: { origin: url!, [AUTH_HEADER]: '1', 'Content-Type': 'application/json' }, body })).status).toBe(400)
  })
  it('enforces configuration and bounded maps using the actual authority and Node carrier', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ api: 'user', readyUsers: 1 })
    const { ctx, url, users } = fixture, a = users[0]!
    const api = ctx.webIdentityApi as IdentityApi
    for (const config of [{ audience: 'user' as const, origin: 'http://public.fixture.test' }, { audience: 'user' as const, origin: url! + '/' },
      { audience: 'user' as const, origin: url!, allowInsecureLoopbackFixture: false }]) {
      const invalid = new Context()
      try {
        expect(() => new IdentityApi(invalid, config)).toThrow(/Canonical identity origin/)
      }
      finally {
        await invalid.fiber.dispose()
      }
    }
    const internals = api as unknown as {
      rates: Map<string, {
        count: number
        expiresAt: number
      }>
      identifierRates: Map<string, {
        count: number
        expiresAt: number
      }>
      config: Record<string, unknown>
      handle(request: IncomingMessage, response: ServerResponse): Promise<void>
    }
    delete internals.config.maxBodyBytes
    delete internals.config.publicRateLimitWindowMs
    delete internals.config.publicRateLimitAttempts
    delete internals.config.minimumRecoveryResponseMs
    delete internals.config.maxInvalidationRequestsPerSession
    delete internals.config.invalidationTimeoutMs
    const mutation = (identifier: string) => fetch(url! + '/auth/password/forgot', { method: 'POST', headers: { origin: url!, [AUTH_HEADER]: '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier }) })
    for (let index = 0; index < 1000; index++)
      internals.rates.set('fixture-' + String(index), { count: 0, expiresAt: Date.now() + 60000 })
    expect((await mutation('capacity@fixture.test')).status).toBe(429)
    internals.rates.clear()
    for (let index = 0; index < 1000; index++)
      internals.identifierRates.set('fixture-' + String(index), { count: 0, expiresAt: Date.now() + 60000 })
    expect((await mutation('identifier-capacity@fixture.test')).status).toBe(429)
    internals.identifierRates.clear()
    internals.rates.set('expired', { count: 999, expiresAt: 0 })
    internals.identifierRates.set('expired', { count: 999, expiresAt: 0 })
    expect((await mutation('expired-budgets@fixture.test')).status).toBe(202)
    expect(internals.rates.has('expired')).toBe(false)
    expect(internals.identifierRates.has('expired')).toBe(false)
    const cookie = AUTH_COOKIE_NAMES.user + '=' + a.token, state = await ctx.webIdentity.state(a.authority)
    const registered = nextInvalidation(ctx, a.authority.authSessionId)
    const poll = fetch(url! + '/auth/invalidation?generation=' + String(state.generation), { headers: { cookie } })
    await registered.pending
    await ctx.webIdentity.logout(a.authority)
    expect(await (await poll).json()).toMatchObject({ invalidated: true, reason: 'logout' })
    const request = new IncomingMessage(new Socket()), response = new ServerResponse(request)
    request.headers = { host: new URL(url!).host, origin: url!, [AUTH_HEADER.toLowerCase()]: '1', 'content-type': 'application/json' }
    request.method = 'POST'
    request.url = '/auth/login'
    request.setEncoding('utf8')
    request.push('{"identifier":42}')
    request.push(null)
    await internals.handle(request, response)
    expect(response.statusCode).toBe(400)
    request.destroy()
    const fallback = new IncomingMessage(new Socket()), reply = new ServerResponse(fallback)
    fallback.headers = { host: new URL(url!).host }
    fallback.push(null)
    await internals.handle(fallback, reply)
    expect(reply.statusCode).toBe(401)
    fallback.destroy()
  })
})
