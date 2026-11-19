import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthInvalidation, AuthInvalidationReason, RequestAuthority } from '@arx-ai/arx-web-identity'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER, parseAuthState } from '@arx-ai/arx-web-identity/contract'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'
let fixture: Awaited<ReturnType<typeof identityHarness>> | undefined
afterEach(async () => { vi.restoreAllMocks(); await fixture?.close(); fixture = undefined })
type ApiInternals = {
  pending: Map<string, Set<{
    resolve: (reason?: AuthInvalidationReason) => void
  }>>
  config: Record<string, unknown>
  invalidation: (response: ServerResponse, authority: RequestAuthority, generation: number) => Promise<AuthInvalidation>
  handle: (request: IncomingMessage, response: ServerResponse) => Promise<void>
}
describe('identity invalidation and Node response lifecycle', () => {
  it('settles concurrent checks once, ignores another user, and drains pending checks on composition disposal', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ api: 'user', readyUsers: 2, apiConfig: { invalidationTimeoutMs: 30000 } })
    const { ctx, users } = fixture, a = users[0]!, b = users[1]!, api = ctx.webIdentityApi as unknown as ApiInternals
    const one = new IncomingMessage(new Socket()), two = new IncomingMessage(new Socket())
    const r1 = new ServerResponse(one), r2 = new ServerResponse(two)
    const first = api.invalidation(r1, a.authority, a.authority.revision)
    const second = api.invalidation(r2, a.authority, a.authority.revision)
    const callbacks = [...api.pending.get(a.authority.authSessionId)!]
    await ctx.webIdentity.logout(b.authority)
    expect(api.pending.get(a.authority.authSessionId)!.size).toBe(2)
    callbacks[0]!.resolve()
    expect(await first).toMatchObject({ invalidated: false })
    callbacks[0]!.resolve('logout')
    expect(api.pending.get(a.authority.authSessionId)!.size).toBe(1)
    await ctx.fiber.dispose()
    expect(await second).toMatchObject({ invalidated: true, reason: 'disposed' })
    expect(api.pending.size).toBe(0)
    one.destroy()
    two.destroy()
  })
  it('preserves safe session errors, closed USER routes and a close event after Node response completion', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ api: 'user', readyUsers: 1 })
    const { ctx, url, users } = fixture, a = users[0]!, api = ctx.webIdentityApi as unknown as ApiInternals, cookie = AUTH_COOKIE_NAMES.user + '=' + a.token
    const duplicate = await fetch(url! + '/auth/session', { headers: { cookie: cookie + '; ' + cookie } })
    expect(duplicate.status).toBe(400)
    expect(await duplicate.json()).toMatchObject({ error: { code: 'AUTH_REQUEST' } })
    const request = new IncomingMessage(new Socket()), response = new ServerResponse(request)
    request.headers = { host: new URL(url!).host, cookie }
    request.method = 'GET'
    request.url = '/auth/unknown'
    request.push(null)
    // Native response completion can precede a close notification. The delegated
    // end call keeps Node's writableEnded state; no identity issuer is replaced.
    const end = response.end.bind(response)
    vi.spyOn(response, 'end').mockImplementation((...args: Parameters<typeof response.end>) => {
      const result = end(...args)
      response.emit('close')
      return result
    })
    await api.handle(request, response)
    expect(response.statusCode).toBe(404)
    expect(response.writableEnded).toBe(true)
    request.destroy()
    const missing = new IncomingMessage(new Socket()), reply = new ServerResponse(missing)
    missing.headers = { host: new URL(url!).host }
    Object.defineProperty(missing, 'url', { value: undefined, writable: true })
    missing.push(null)
    await api.handle(missing, reply)
    expect(reply.statusCode).toBe(401)
    missing.destroy()
  })
  it('uses bounded default body policies for authenticated password and administration mutations', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ api: 'admin' })
    const { ctx, url, passwords } = fixture, api = ctx.webIdentityApi as unknown as ApiInternals
    delete api.config.maxBodyBytes
    const login = await ctx.webIdentity.login('arxadmin', passwords.master, 'admin')
    let cookie = AUTH_COOKIE_NAMES.admin + '=' + login.token, csrf = login.state.csrfToken
    const send = (path: string, body: unknown) => fetch(url! + path, { method: 'POST', headers: { cookie, origin: url!, [AUTH_HEADER]: '1', [CSRF_HEADER]: csrf, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const changed = await send('/auth/password/change', { currentPassword: passwords.master, newPassword: 'Default-bounded-fixture-' + 'x'.repeat(20) })
    expect(changed.status).toBe(200)
    cookie = changed.headers.get('Set-Cookie')!.split(';')[0]!
    const changedState = parseAuthState(await changed.json())
    if (!changedState.authenticated)
      throw new Error('changed MASTER session unavailable')
    csrf = changedState.csrfToken
    expect((await send('/admin/unknown', {})).status).toBe(404)
  })
})
