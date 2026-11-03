// @vitest-environment jsdom
/** Real HTTP authority with genuine slot lifetimes and public subscriber/abort boundaries. */
import { BroadcastChannel } from 'node:worker_threads'
import { Context } from '@arx-ai/cordis'
import * as Slots from '@arx-ai/arx-client-slots/client'
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { AUTH_HEADER, parseAuthState } from '@arx-ai/arx-web-identity/contract'
import { BrowserAuthClient, readAuthSession, authComposition, type AuthBoundary, type AuthRevocationHandoff } from '../src/browser.ts'
import { browserFixture, httpBridge } from './http-fixture.client.ts'
let fixture: Awaited<ReturnType<typeof browserFixture>>
const cleanup: Array<() => void | Promise<void>> = []
beforeAll(async () => {
  fixture = await browserFixture('user')
  await fixture.command('set-modules', { index: 0, grants: ['storage'] })
})
afterAll(async () => { await fixture.close() })
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/')
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, release: () => { resolve() } }
}
async function entered() {
  const bridge = httpBridge(fixture.url)
  const response = await bridge.fetcher('/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: '1' },
    body: JSON.stringify({ identifier: fixture.users[0]!.username, password: fixture.users[0]!.password }) })
  expect(response.ok).toBe(true)
  const state = parseAuthState(await response.json())
  bridge.install(); vi.stubGlobal('BroadcastChannel', BroadcastChannel)
  const ctx = new Context()
  const composition = authComposition(state)
  expect(composition.scope).toBe('application')
  ctx.provide('clientComposition', composition)
  await ctx.plugin(Slots)
  cleanup.push(async () => { await ctx.fiber.dispose() })
  return { bridge, state, ctx }
}
const guardKey = 'arx.web.logout-denial'
describe('atomic auth boundaries survive real tree disposal', () => {
  it('keeps the neutral handoff and guard alive when the kernel aborts the bootstrap lifetime', async () => {
    const { bridge, ctx } = await entered()
    const lifetime = new AbortController(), ready = deferred(), release = deferred()
    let handoff: AuthRevocationHandoff | undefined
    const boundary = vi.fn((_: AuthBoundary, confirmation?: AuthRevocationHandoff) => {
      handoff?.dispose(); handoff = confirmation
      lifetime.abort(); void ctx.fiber.dispose()
    })
    const reload = vi.fn()
    const { auth } = await BrowserAuthClient.bootstrap(boundary, lifetime.signal, reload)
    cleanup.push(() => { handoff?.dispose(); auth.dispose(); release.release() })
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await bridge.fetcher(input, init)
      if (input === '/auth/logout') { ready.release(); await release.promise }
      return response
    })
    auth.start()
    const logout = auth.logout()
    await ready.promise; await ctx.fiber.dispose()
    expect(boundary).toHaveBeenCalledTimes(1)
    expect(boundary.mock.calls[0]?.[0]).toBe('logout')
    expect(auth.getSnapshot()).toEqual({ authenticated: false, phase: 'ended' })
    expect(auth.transportConfig()).toEqual({ accessMode: 'authenticated' })
    expect(localStorage.getItem(guardKey)).not.toBeNull()
    expect(reload).not.toHaveBeenCalled()
    if (handoff === undefined) throw new Error('real neutral handoff missing')
    const confirmation = handoff
    release.release(); await logout
    expect(await confirmation.confirmed).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
    expect(localStorage.getItem(guardKey)).toBeNull()
    expect((await readAuthSession()).authenticated).toBe(false)
  })
  it('preserves a failed logout guard through slot disposal and rejects a fresh genuine private state', async () => {
    const { bridge, ctx } = await entered()
    const lifetime = new AbortController()
    let handoff: AuthRevocationHandoff | undefined
    const { auth } = await BrowserAuthClient.bootstrap((_, confirmation) => {
      handoff = confirmation; lifetime.abort(); void ctx.fiber.dispose()
    }, lifetime.signal, () => {})
    cleanup.push(() => { handoff?.dispose(); auth.dispose() })
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      bridge.fetcher(input === '/auth/logout' ? '/missing-logout-route' : input, init))
    auth.start()
    await expect(auth.logout()).rejects.toMatchObject({ status: 404 })
    await ctx.fiber.dispose()
    const before = localStorage.getItem(guardKey)
    expect(before).not.toBeNull()
    bridge.install()
    const { state, auth: fresh } = await BrowserAuthClient.bootstrap(() => {})
    cleanup.push(() => { fresh.dispose() })
    expect(state.authenticated).toBe(true)
    expect(fresh.checkLogoutGuard(authComposition(state))).toBe('blocked')
    fresh.dispose()
    expect(localStorage.getItem(guardKey)).toBe(before)
  })
  it('contains a throwing public subscriber and still retracts every other subscriber and boundary', async () => {
    const { state, ctx } = await entered()
    const lifetime = new AbortController()
    const boundary = vi.fn(() => { lifetime.abort(); void ctx.fiber.dispose() })
    const reload = vi.fn()
    const { auth } = await BrowserAuthClient.bootstrap(boundary, lifetime.signal, reload)
    cleanup.push(() => { auth.dispose() })
    const good = vi.fn(() => { expect(auth.getSnapshot().principal).toBeUndefined() })
    auth.subscribe(() => { throw new Error('consumer notification failure') })
    auth.subscribe(good)
    auth.start()
    localStorage.setItem('arx.private', 'discarded'); sessionStorage.setItem('arx.private', 'discarded')
    expect(() => { auth.returnToEntry() }).not.toThrow()
    await ctx.fiber.dispose()
    expect(good).toHaveBeenCalledOnce(); expect(boundary).toHaveBeenCalledOnce(); expect(reload).toHaveBeenCalledOnce()
    expect(auth.getSnapshot()).toEqual({ authenticated: false, phase: 'ended' })
    expect(localStorage.getItem('arx.private')).toBeNull(); expect(sessionStorage.getItem('arx.private')).toBeNull()
    expect(() => { auth.start() }).toThrow('auth client is disposed')
    await expect(auth.userRequest('GET', '/user/projects')).rejects.toMatchObject({ status: 403 })
    // A throwing boundary is a public consumer fault too; it cannot retain the client's private state.
    const badBoundary = new BrowserAuthClient(state, () => { throw new Error('boundary consumer failure') }, () => {})
    cleanup.push(() => { badBoundary.dispose() })
    expect(() => { badBoundary.returnToEntry() }).toThrow('boundary consumer failure')
    expect(badBoundary.transportConfig()).toEqual({ accessMode: 'authenticated' })
    expect(badBoundary.getSnapshot().principal).toBeUndefined()
    await waitFor(async () => { expect((await readAuthSession()).authenticated).toBe(true) })
  })
  it('contains a real logout request that rejects after a throwing kernel boundary', async () => {
    const { bridge, state } = await entered()
    const ready = deferred(), release = deferred()
    let handoff: AuthRevocationHandoff | undefined
    const boundary = vi.fn((_: AuthBoundary, confirmation?: AuthRevocationHandoff) => {
      handoff = confirmation; throw new Error('boundary consumer failure')
    })
    const auth = new BrowserAuthClient(state, boundary, () => {})
    cleanup.push(() => { release.release(); handoff?.dispose(); auth.dispose() })
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await bridge.fetcher(input === '/auth/logout' ? '/missing-logout-route' : input, init)
      if (input === '/auth/logout') {
        expect(response.status).toBe(404); ready.release(); await release.promise
      }
      return response
    })
    auth.start()
    await expect(auth.logout()).rejects.toThrow('boundary consumer failure')
    await ready.promise
    if (handoff === undefined) throw new Error('real neutral handoff missing')
    expect(await handoff.confirmed).toBe(false)
    expect(boundary).toHaveBeenCalledOnce()
    expect(auth.transportConfig()).toEqual({ accessMode: 'authenticated' })
    expect(auth.getSnapshot().principal).toBeUndefined()
    expect(localStorage.getItem(guardKey)).not.toBeNull()
    release.release()
    // The real 404 leaves the issuer active while the detached client remains closed.
    expect((await readAuthSession()).authenticated).toBe(true)
  })
})
