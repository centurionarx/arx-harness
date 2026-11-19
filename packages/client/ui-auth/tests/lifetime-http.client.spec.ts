// @vitest-environment jsdom
/** Transport and teardown faults retain the real HTTP issuer; no fabricated authenticated response. */
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { AUTH_HEADER, parseAuthState } from '@arx-ai/arx-web-identity/contract'
import { BrowserAuthClient, readAuthSession } from '../src/browser.ts'
import { browserFixture, httpBridge } from './http-fixture.client.ts'
let fixture: Awaited<ReturnType<typeof browserFixture>>
const cleanup: Array<() => void> = []
beforeAll(async () => { fixture = await browserFixture('user') })
afterAll(async () => { await fixture.close() })
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
  BrowserAuthClient.clearRecoveryTransfer(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
  localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/')
})
async function entered() {
  const bridge = httpBridge(fixture.url)
  const response = await bridge.fetcher('/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: '1' },
    body: JSON.stringify({ identifier: fixture.users[0]!.username, password: fixture.users[0]!.password }) })
  expect(response.ok).toBe(true)
  const state = parseAuthState(await response.json()); bridge.install()
  const boundary = vi.fn(), reload = vi.fn()
  const auth = new BrowserAuthClient(state, boundary, reload); cleanup.push(() => { auth.dispose() })
  return { bridge, state, auth, boundary, reload }
}
describe('real issuer lifetime and private transfer boundaries', () => {
  it('denies anonymous mutations and administrative methods without making protected HTTP requests', async () => {
    const bridge = httpBridge(fixture.url); bridge.install()
    const auth = new BrowserAuthClient(await readAuthSession(), () => {})
    cleanup.push(() => { auth.dispose() })
    expect(auth.transportConfig()).toEqual({ accessMode: 'authenticated' })
    const before = bridge.requests.length
    await expect(auth.userRequest('POST', '/user/projects', { name: 'denied' })).rejects.toMatchObject({ status: 403 })
    await expect(auth.listUsers()).rejects.toMatchObject({ status: 403 })
    await expect(auth.listModules()).rejects.toMatchObject({ status: 403 })
    await expect(auth.exportHistory('unowned')).rejects.toMatchObject({ status: 403 })
    await expect(auth.resetPassword('Fixture-unused')).rejects.toMatchObject({ code: 'RESET_TOKEN_INVALID' })
    await expect(auth.acceptInvitation('Fixture-unused')).rejects.toMatchObject({ code: 'INVITATION_INVALID' })
    expect(bridge.requests).toHaveLength(before)
    auth.start(); auth.dispose(); auth.dispose()
    expect(() => { auth.start() }).toThrow('auth client is disposed')
    expect(auth.transportConfig()).toEqual({ accessMode: 'authenticated' })
    auth.returnToEntry()
    await expect(auth.logout()).rejects.toMatchObject({ code: 'SESSION_ENDED' })
  })
  it('rejects a malformed private recovery handle before reading auth and always clears it', async () => {
    const bridge = httpBridge(fixture.url); bridge.install()
    const carrier = globalThis as { __ARX_RECOVERY_FRAGMENT__?: unknown }
    carrier.__ARX_RECOVERY_FRAGMENT__ = { take: 'invalid' }
    await expect(BrowserAuthClient.bootstrap(() => {})).rejects.toMatchObject({ code: 'RECOVERY_TRANSFER_INVALID' })
    expect(bridge.requests).toHaveLength(0)
    BrowserAuthClient.clearRecoveryTransfer(); expect(carrier.__ARX_RECOVERY_FRAGMENT__).toBeUndefined()
    let cleared = false
    carrier.__ARX_RECOVERY_FRAGMENT__ = { take: () => 1, clear: () => { cleared = true; throw new Error('transfer failure') } }
    await expect(BrowserAuthClient.bootstrap(() => {})).rejects.toThrow('transfer failure')
    expect(cleared).toBe(true)
    BrowserAuthClient.clearRecoveryTransfer(); expect(carrier.__ARX_RECOVERY_FRAGMENT__).toBeUndefined()
  })
  it('rejects an abandoned bootstrap even when the real session response finished and releases its transfer', async () => {
    const bridge = httpBridge(fixture.url), abort = new AbortController()
    const carrier = globalThis as { __ARX_RECOVERY_FRAGMENT__?: unknown }
    carrier.__ARX_RECOVERY_FRAGMENT__ = Object.freeze({ take: () => undefined, clear: () => {} })
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await bridge.fetcher(input, init), json = response.json.bind(response)
      vi.spyOn(response, 'json').mockImplementation(async () => { const data: unknown = await json(); abort.abort(); return data })
      return response
    })
    await expect(BrowserAuthClient.bootstrap(() => {}, abort.signal)).rejects.toMatchObject({ code: 'AUTH_BOOT_ENDED' })
    expect(carrier.__ARX_RECOVERY_FRAGMENT__).toBeUndefined()
    expect(bridge.requests.map(row => row.path)).toEqual(['/auth/session'])
  })
  it('does not adopt a completed private response after disposal or expose stale data through subscribers', async () => {
    const { bridge, auth } = await entered()
    const seen = vi.fn(); const unsubscribe = auth.subscribe(seen); unsubscribe()
    await expect(auth.userRequest('GET', '/admin/users')).rejects.toThrow('invalid user route')
    let release: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => { release = resolve })
    let bodyStarted = false
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await bridge.fetcher(input, init)
      const json = response.json.bind(response)
      vi.spyOn(response, 'json').mockImplementation(async () => {
        const data: unknown = await json(); bodyStarted = true; await blocked; return data
      })
      return response
    })
    const pending = auth.userRequest('GET', '/user/projects')
    await waitFor(() => { expect(bodyStarted).toBe(true) })
    auth.dispose(); release?.()
    await expect(pending).rejects.toMatchObject({ status: 401, code: 'SESSION_ENDED' })
    expect(seen).not.toHaveBeenCalled(); expect(auth.getSnapshot().principal).toBeUndefined()
  })
  it('retracts on restored pages, pagehide and neutral auth-required events and clears both private stores', async () => {
    for (const event of [new PageTransitionEvent('pageshow', { persisted: true }), new Event('pagehide'), new Event('arx-auth-required')]) {
      const { auth, boundary } = await entered()
      localStorage.setItem('arx.private', 'private'); sessionStorage.setItem('arx.selected', 'private')
      history.replaceState({ selected: 'private' }, '', '/')
      auth.start(); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))
      expect(boundary).not.toHaveBeenCalled()
      window.dispatchEvent(event)
      expect(boundary).toHaveBeenCalledOnce(); expect(auth.getSnapshot()).toEqual({ authenticated: false, phase: 'ended' })
      expect(localStorage.getItem('arx.private')).toBeNull(); expect(sessionStorage.getItem('arx.selected')).toBeNull()
      expect(history.state).toBeNull()
      window.dispatchEvent(event); expect(boundary).toHaveBeenCalledOnce()
    }
  })
  it('continues real long polling until teardown and treats an unavailable HTTP channel as a closed tree', async () => {
    const { bridge, auth, boundary } = await entered()
    auth.start()
    await waitFor(() => { expect(bridge.requests.filter(row => row.path === '/auth/invalidation').length).toBeGreaterThan(1) })
    expect(boundary).not.toHaveBeenCalled(); auth.dispose()
    const fresh = await entered()
    // Route-level transport fault: the server still authenticates its actual cookie;
    // an unrelated real 404 response cannot become an accepted invalidation DTO.
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      fresh.bridge.fetcher(typeof input === 'string' && input.startsWith('/auth/invalidation') ? '/missing-invalidation-route' : input, init))
    fresh.auth.start()
    await waitFor(() => { expect(fresh.boundary).toHaveBeenCalledWith('unavailable') })
    expect(fresh.auth.getSnapshot().principal).toBeUndefined()
  })
  it('clears private view state even if browser storage rejects cleanup', async () => {
    const { auth, boundary } = await entered()
    localStorage.setItem('arx.private', 'private')
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage unavailable') })
    auth.start()
    expect(() => { window.dispatchEvent(new Event('pagehide')) }).not.toThrow()
    expect(boundary).toHaveBeenCalledWith('pagehide'); expect(auth.getSnapshot().principal).toBeUndefined()
  })
  it('reports a genuine non-JSON route response as a sanitized error during auth bootstrap', async () => {
    const bridge = httpBridge(fixture.url)
    vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => bridge.fetcher('/missing-auth-route', init))
    await expect(readAuthSession()).rejects.toMatchObject({ status: 404, code: 'HTTP_ERROR' })
  })
})
