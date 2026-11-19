// @vitest-environment jsdom
/** Real issuer and BroadcastChannel phase tests; controlled delivery never fabricates auth responses. */
import { BroadcastChannel } from 'node:worker_threads'
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { AUTH_HEADER, CSRF_HEADER, parseAuthState } from '@arx-ai/arx-web-identity/contract'
import { BrowserAuthClient, readAuthSession, authComposition, type AuthBoundary, type AuthRevocationHandoff } from '../src/browser.ts'
import { browserFixture, httpBridge } from './http-fixture.client.ts'
let fixture: Awaited<ReturnType<typeof browserFixture>>
const cleanup: Array<() => void> = []
beforeAll(async () => { fixture = await browserFixture('user') })
afterAll(async () => { await fixture.close() })
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/')
})
function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release: () => { release() } }
}
async function entered() {
  const bridge = httpBridge(fixture.url)
  const response = await bridge.fetcher('/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: '1' },
    body: JSON.stringify({ identifier: fixture.users[0]!.username, password: fixture.users[0]!.password }) })
  expect(response.ok).toBe(true)
  const state = parseAuthState(await response.json()); bridge.install()
  vi.stubGlobal('BroadcastChannel', BroadcastChannel)
  function client() {
    let handoff: AuthRevocationHandoff | undefined
    const boundary = vi.fn((_: AuthBoundary, confirmation?: AuthRevocationHandoff) => { handoff = confirmation })
    const reload = vi.fn()
    const auth = new BrowserAuthClient(state, boundary, reload)
    cleanup.push(() => { handoff?.dispose(); auth.dispose() })
    return { auth, boundary, reload, completion() {
      if (handoff === undefined) throw new Error('real logout handoff missing')
      return handoff
    } }
  }
  return { bridge, state, client }
}
function observeControl() {
  const channel = new BroadcastChannel('arx.web.identity')
  const received: unknown[] = []
  channel.onmessage = (event) => { const value: unknown = event.data; received.push(value) }
  cleanup.push(() => { channel.close() })
  return { received }
}
function externalControl() {
  const channel = new BroadcastChannel('arx.web.identity')
  cleanup.push(() => { channel.close() })
  return channel
}
const guardKey = 'arx.web.logout-denial'
function storedGuard(): { origin: string; audience: string; generation: number; operationId: string } {
  const raw = localStorage.getItem(guardKey)
  if (raw === null) throw new Error('real negative logout guard missing')
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null || !('origin' in value) || typeof value.origin !== 'string'
    || !('audience' in value) || typeof value.audience !== 'string' || !('generation' in value) || typeof value.generation !== 'number'
    || !('operationId' in value) || typeof value.operationId !== 'string') throw new Error('negative guard contract invalid')
  return { origin: value.origin, audience: value.audience, generation: value.generation, operationId: value.operationId }
}
describe('confirmed logout without reusing the old principal tree', () => {
  it('retracts both clients before real HTTP acknowledgement and transfers only a neutral completion', async () => {
    const { bridge, client } = await entered()
    const sender = client(), peer = client(), responseReady = deferred(), release = deferred()
    const observer = observeControl()
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await bridge.fetcher(input, init)
      if (input === '/auth/logout') { responseReady.release(); await release.promise }
      return response
    })
    sender.auth.start(); peer.auth.start()
    localStorage.setItem('arx.private', 'stale'); sessionStorage.setItem('arx.private', 'stale')
    history.replaceState({ selection: 'stale' }, '', '/')
    const logout = sender.auth.logout()
    await waitFor(() => { expect(peer.boundary.mock.calls[0]?.[0]).toBe('logout-pending') })
    await responseReady.promise
    expect(sender.boundary.mock.calls[0]?.[0]).toBe('logout')
    for (const item of [sender, peer]) {
      expect(item.auth.getSnapshot()).toEqual({ authenticated: false, phase: 'ended' })
      expect(item.auth.transportConfig()).toEqual({ accessMode: 'authenticated' })
      expect(Object.keys(item.completion())).not.toContain('principal')
      expect(item.reload).not.toHaveBeenCalled()
    }
    expect(localStorage.getItem('arx.private')).toBeNull(); expect(sessionStorage.getItem('arx.private')).toBeNull()
    expect(history.state).toBeNull(); expect((await readAuthSession()).authenticated).toBe(false)
    await waitFor(() => { expect(observer.received.length).toBe(1) })
    const begin: unknown = observer.received[0]
    expect(typeof begin).toBe('object'); expect(begin).not.toBeNull()
    if (typeof begin !== 'object' || begin === null) throw new Error('real logout begin missing')
    expect(Object.keys(begin).sort()).toEqual(['operationId', 'type'])
    expect(Reflect.get(begin, 'type')).toBe('logout-begin')
    release.release(); await logout
    expect(await sender.completion().confirmed).toBe(true)
    expect(await peer.completion().confirmed).toBe(true)
    expect(sender.reload).toHaveBeenCalledOnce(); expect(peer.reload).not.toHaveBeenCalled()
    await waitFor(() => { expect(observer.received.length).toBe(2) })
    const ack: unknown = observer.received[1]
    if (typeof ack !== 'object' || ack === null) throw new Error('real logout acknowledgement missing')
    expect(Object.keys(ack).sort()).toEqual(['operationId', 'type'])
    expect(Reflect.get(ack, 'type')).toBe('logout-ack')
    expect(Reflect.get(ack, 'operationId')).toBe(Reflect.get(begin, 'operationId'))
  })
  it('ignores malformed, unrelated and duplicate neutral messages without adopting any auth snapshot', async () => {
    const { client } = await entered(), peer = client()
    const external = externalControl(), observer = observeControl()
    peer.auth.start()
    const invalid: unknown[] = [null, 'logout', {}, { type: 'other' }, { type: 'logout-begin' },
      { type: 'logout-begin', operationId: 1 }, { type: 'logout-begin', operationId: 'invalid' },
      { type: 'logout-ack', operationId: crypto.randomUUID() }]
    for (const message of invalid) external.postMessage(message)
    await waitFor(() => { expect(observer.received.length).toBe(invalid.length) })
    expect(peer.boundary).not.toHaveBeenCalled(); expect(peer.auth.getSnapshot().authenticated).toBe(true)
    const operationId = crypto.randomUUID()
    external.postMessage({ type: 'logout-begin', operationId })
    await waitFor(() => { expect(peer.boundary.mock.calls[0]?.[0]).toBe('logout-pending') })
    const confirmation = vi.fn(); void peer.completion().confirmed.then(confirmation)
    for (const message of [...invalid, { type: 'logout-begin', operationId },
      { type: 'logout-ack', operationId: crypto.randomUUID() }]) external.postMessage(message)
    await waitFor(() => { expect(observer.received.length).toBe(invalid.length * 2 + 3) })
    expect(confirmation).not.toHaveBeenCalled(); expect(peer.reload).not.toHaveBeenCalled()
    external.postMessage({ type: 'logout-ack', operationId }); external.postMessage({ type: 'logout-ack', operationId })
    expect(await peer.completion().confirmed).toBe(true)
    await waitFor(() => { expect(observer.received.length).toBe(invalid.length * 2 + 5) })
    expect(confirmation).toHaveBeenCalledExactlyOnceWith(true)
    peer.completion().dispose(); peer.completion().dispose()
    expect(peer.auth.getSnapshot().principal).toBeUndefined(); expect(peer.boundary).toHaveBeenCalledOnce()
  })
  it('keeps both views closed when a genuine route fault refuses logout and sends no acknowledgement', async () => {
    const { bridge, client } = await entered(), sender = client(), peer = client()
    const observer = observeControl()
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      bridge.fetcher(input === '/auth/logout' ? '/missing-logout-route' : input, init))
    sender.auth.start(); peer.auth.start()
    await expect(sender.auth.logout()).rejects.toMatchObject({ status: 404 })
    await waitFor(() => { expect(peer.boundary.mock.calls[0]?.[0]).toBe('logout-pending') })
    expect(await sender.completion().confirmed).toBe(false)
    expect((await readAuthSession()).authenticated).toBe(true)
    for (const item of [sender, peer]) {
      expect(item.auth.getSnapshot().principal).toBeUndefined(); expect(item.reload).not.toHaveBeenCalled()
    }
    await waitFor(() => { expect(observer.received.length).toBe(1) })
    peer.completion().dispose(); expect(await peer.completion().confirmed).toBe(false)
  })
  it('releases the public handoff idempotently and ignores a real acknowledgement delivered after teardown', async () => {
    const { bridge, client } = await entered(), sender = client(), peer = client()
    const ready = deferred(), release = deferred()
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await bridge.fetcher(input, init)
      if (input === '/auth/logout') { ready.release(); await release.promise }
      return response
    })
    sender.auth.start(); peer.auth.start()
    const logout = sender.auth.logout()
    await waitFor(() => { expect(peer.boundary.mock.calls[0]?.[0]).toBe('logout-pending') })
    await ready.promise
    for (const item of [sender, peer]) { item.completion().dispose(); item.completion().dispose() }
    release.release(); await logout
    for (const item of [sender, peer]) {
      expect(await item.completion().confirmed).toBe(false)
      expect(item.reload).not.toHaveBeenCalled(); expect(item.boundary).toHaveBeenCalledOnce()
      expect(item.auth.getSnapshot()).toEqual({ authenticated: false, phase: 'ended' })
    }
  })
  it('blocks a fresh validated private composition after failed logout and preserves only negative metadata', async () => {
    const { bridge, state, client } = await entered(), sender = client()
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      bridge.fetcher(input === '/auth/logout' ? '/missing-logout-route' : input, init))
    sender.auth.start()
    await expect(sender.auth.logout()).rejects.toMatchObject({ status: 404 })
    const guard = storedGuard()
    expect(Object.keys(guard).sort()).toEqual(['audience', 'generation', 'operationId', 'origin'])
    expect(guard).toMatchObject({ audience: 'user', origin: location.origin, generation: state.authenticated ? state.generation : -1 })
    const { state: fresh, auth } = await BrowserAuthClient.bootstrap(() => {})
    cleanup.push(() => { auth.dispose() })
    expect(fresh.authenticated).toBe(true)
    expect(auth.checkLogoutGuard(authComposition(fresh))).toBe('blocked')
    auth.dispose()
    expect(storedGuard()).toEqual(guard)
    history.replaceState(null, '', '/reset')
    const recovery = new BrowserAuthClient(await readAuthSession(), () => {}, () => {})
    cleanup.push(() => { recovery.dispose() })
    expect(recovery.checkLogoutGuard(authComposition(fresh, '/reset'))).toBe('admitted')
    expect(storedGuard()).toEqual(guard)
  })
  it('clears the guard after genuine anonymous status, and after a genuinely different validated generation', async () => {
    const { bridge, state, client } = await entered(), sender = client()
    if (!state.authenticated) throw new Error('real authenticated fixture missing')
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      bridge.fetcher(input === '/auth/logout' ? '/missing-logout-route' : input, init))
    await expect(sender.auth.logout()).rejects.toMatchObject({ status: 404 })
    bridge.install()
    const response = await bridge.fetcher('/auth/logout', { method: 'POST', headers: {
      [AUTH_HEADER]: '1', [CSRF_HEADER]: state.csrfToken, 'Content-Type': 'application/json',
    } })
    expect(response.status).toBe(204)
    const anonymous = await readAuthSession(), publicAuth = new BrowserAuthClient(anonymous, () => {})
    cleanup.push(() => { publicAuth.dispose() })
    expect(anonymous.authenticated).toBe(false)
    expect(publicAuth.checkLogoutGuard(authComposition(anonymous))).toBe('admitted')
    expect(localStorage.getItem(guardKey)).toBeNull()
    const next = await entered(), nextSender = next.client()
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      next.bridge.fetcher(input === '/auth/logout' ? '/missing-logout-route' : input, init))
    await expect(nextSender.auth.logout()).rejects.toMatchObject({ status: 404 })
    const old = storedGuard()
    await fixture.command('set-modules', { index: 0, grants: ['storage'] })
    const renewed = await entered(), real = renewed.client()
    expect(renewed.state.authenticated && renewed.state.generation !== old.generation).toBe(true)
    expect(real.auth.checkLogoutGuard(authComposition(renewed.state))).toBe('admitted')
    expect(localStorage.getItem(guardKey)).toBeNull()
  })
  it('uses confirmed explicit USER login to clear a colliding negative generation without adopting a foreign snapshot', async () => {
    const { bridge, client } = await entered(), sender = client()
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      bridge.fetcher(input === '/auth/logout' ? '/missing-logout-route' : input, init))
    await expect(sender.auth.logout()).rejects.toMatchObject({ status: 404 })
    const original = storedGuard(), second = httpBridge(fixture.url)
    const response = await second.fetcher('/auth/login', { method: 'POST',
      headers: { [AUTH_HEADER]: '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: fixture.users[1]!.username, password: fixture.users[1]!.password }) })
    expect(response.ok).toBe(true)
    const other = parseAuthState(await response.json())
    if (!other.authenticated) throw new Error('real second USER login missing')
    // Counterfactual negative metadata exercises a generation collision; the authority is still the real HTTP issuer.
    localStorage.setItem(guardKey, JSON.stringify({ ...original, generation: other.generation }))
    bridge.install(); history.replaceState(null, '', '/reset')
    const auth = new BrowserAuthClient(await readAuthSession(), () => {}, () => {})
    cleanup.push(() => { auth.dispose() })
    await auth.login(fixture.users[1]!.username, fixture.users[1]!.password)
    const confirmed = await readAuthSession()
    expect(confirmed.authenticated && confirmed.principal.userId).toBe(other.principal.userId)
    expect(localStorage.getItem(guardKey)).toBeNull()
    expect(auth.getSnapshot().principal).toBeUndefined()
    expect(location.pathname).toBe('/')
  })
  it('keeps a later same-generation operation blocked when an old matching acknowledgement arrives', async () => {
    const { state, client } = await entered(), peer = client(), external = externalControl()
    if (!state.authenticated) throw new Error('real authenticated fixture missing')
    peer.auth.start()
    const oldOperation = crypto.randomUUID(), newOperation = crypto.randomUUID()
    external.postMessage({ type: 'logout-begin', operationId: oldOperation })
    await waitFor(() => { expect(peer.boundary.mock.calls[0]?.[0]).toBe('logout-pending') })
    const old = storedGuard()
    localStorage.setItem(guardKey, JSON.stringify({ ...old, operationId: newOperation }))
    external.postMessage({ type: 'logout-ack', operationId: oldOperation })
    expect(await peer.completion().confirmed).toBe(false)
    expect(storedGuard()).toEqual({ ...old, operationId: newOperation })
    expect(peer.reload).not.toHaveBeenCalled()
    const fresh = new BrowserAuthClient(await readAuthSession(), () => {})
    cleanup.push(() => { fresh.dispose() })
    expect(fresh.checkLogoutGuard(authComposition(state))).toBe('blocked')
  })
  it('fails closed when storage refuses persistence, retains no private view, and does not reload on a real server ACK', async () => {
    const { state, client } = await entered(), sender = client()
    const realSet = localStorage.setItem.bind(localStorage)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key: string, value: string) {
      if (key === guardKey || key === 'arx.web.logout-probe') throw new DOMException('storage denied', 'SecurityError')
      realSet(key, value)
    })
    expect(sender.auth.checkLogoutGuard(authComposition(state))).toBe('storage-unavailable')
    expect(sender.auth.checkLogoutGuard(authComposition(state, '/reset'))).toBe('admitted')
    await sender.auth.logout()
    expect(sender.completion().persistent).toBe(false)
    expect(await sender.completion().confirmed).toBe(false)
    expect(sender.reload).not.toHaveBeenCalled()
    expect(sender.auth.getSnapshot()).toEqual({ authenticated: false, phase: 'ended' })
    expect((await readAuthSession()).authenticated).toBe(false)
  })
  it.each([
    'not-json', 'null', '1', '[]', '{}',
    JSON.stringify({ origin: 'https://different.invalid', audience: 'user', generation: 1, operationId: crypto.randomUUID() }),
    JSON.stringify({ origin: location.origin, audience: 'other', generation: 1, operationId: crypto.randomUUID() }),
    JSON.stringify({ origin: location.origin, audience: 'user', generation: '1', operationId: crypto.randomUUID() }),
    JSON.stringify({ origin: location.origin, audience: 'user', generation: -1, operationId: crypto.randomUUID() }),
    JSON.stringify({ origin: location.origin, audience: 'user', generation: 1.5, operationId: crypto.randomUUID() }),
    JSON.stringify({ origin: location.origin, audience: 'user', generation: 1, operationId: 1 }),
    JSON.stringify({ origin: location.origin, audience: 'user', generation: 1, operationId: 'invalid' }),
    JSON.stringify({ origin: location.origin, audience: 'user', generation: 1, operationId: crypto.randomUUID(), extra: true }),
  ])('never admits a private tree from a malformed negative record (%#)', async (raw) => {
    const { state, client } = await entered(), item = client()
    localStorage.setItem(guardKey, raw)
    expect(item.auth.checkLogoutGuard(authComposition(state))).toBe('storage-unavailable')
    expect(item.auth.checkLogoutGuard(authComposition(state, '/reset'))).toBe('admitted')
    expect(localStorage.getItem(guardKey)).toBe(raw)
  })

})
