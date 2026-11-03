import { afterEach, describe, expect, it } from 'vitest'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER } from '@arx-ai/arx-web-identity/contract'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'

let fixture: Awaited<ReturnType<typeof identityHarness>> | undefined

afterEach(async () => { await fixture?.close(); fixture = undefined })

describe('administrative owner namespace refusal', () => {
  it('authenticates the real MASTER and denies owner routes without constructing owner services', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ api: 'admin' })
    const { ctx, url, passwords } = fixture
    if (url === undefined) throw new Error('native administration origin required')
    const login = await ctx.webIdentity.login('arxadmin', passwords.master, 'admin')
    const cookie = AUTH_COOKIE_NAMES.admin + '=' + login.token
    expect(ctx.get('projectStorage')).toBeUndefined()
    expect(ctx.get('sessions')).toBeUndefined()
    expect(ctx.get('apiProxy')).toBeUndefined()
    for (const path of ['/user', '/user/', '/user/projects', '/user/history']) {
      const response = await fetch(url + path, { headers: { cookie } })
      expect(response.status).toBe(403)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.json()).toEqual({ error: {
        code: 'PROJECT_ACCESS_DENIED', message: 'Owner resources unavailable on administration origin',
      } })
    }
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const response = await fetch(url + '/user/projects', { method, headers: {
        origin: url, cookie, [AUTH_HEADER]: '1', [CSRF_HEADER]: login.state.csrfToken,
      } })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ error: { code: 'PROJECT_ACCESS_DENIED' } })
    }
    expect((await fetch(url + '/admin/users', { headers: { cookie } })).status).toBe(200)
    expect(ctx.get('projectStorage')).toBeUndefined()
    expect(ctx.get('sessions')).toBeUndefined()
    expect(ctx.get('apiProxy')).toBeUndefined()
  })

  it('keeps canonical origin, session and mutation fences ahead of the fixed refusal', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ api: 'admin', readyUsers: 1 })
    const { ctx, url, passwords, users } = fixture
    if (url === undefined) throw new Error('native administration origin required')
    const user = users[0]
    if (user === undefined) throw new Error('real USER session required')
    const login = await ctx.webIdentity.login('arxadmin', passwords.master, 'admin')
    const cookie = AUTH_COOKIE_NAMES.admin + '=' + login.token
    expect((await fetch(url + '/user/projects')).status).toBe(401)
    expect((await fetch(url + '/user/projects', { headers: { cookie: AUTH_COOKIE_NAMES.user + '=' + user.token } })).status).toBe(401)
    const wrongOrigin = await fetch(url + '/user/projects', { headers: { cookie, origin: 'https://other.fixture.test' } })
    expect(wrongOrigin.status).toBe(403)
    expect(await wrongOrigin.json()).toMatchObject({ error: { code: 'AUTH_ORIGIN' } })
    const unverified = await fetch(url + '/user/projects', { method: 'POST', headers: { cookie } })
    expect(unverified.status).toBe(403)
    expect(await unverified.json()).toMatchObject({ error: { code: 'AUTH_CSRF' } })
    const csrf = await fetch(url + '/user/projects', { method: 'POST', headers: { cookie, origin: url, [AUTH_HEADER]: '1' } })
    expect(csrf.status).toBe(403)
    expect(await csrf.json()).toMatchObject({ error: { code: 'AUTH_CSRF' } })
    expect((await fetch(url + '/auth/session', { headers: { cookie } })).status).toBe(200)
  })
})
