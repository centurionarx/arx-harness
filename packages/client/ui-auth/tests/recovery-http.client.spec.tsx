// @vitest-environment jsdom
/** Real HTTP sessions plus the production publisher/Loader; held bodies inject timing faults only. */
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { AUTH_HEADER, parseAuthState, type AuthState } from '@arx-ai/arx-web-identity/contract'
import { BrowserAuthClient, authComposition, readAuthSession } from '../src/browser.ts'
import { NATIVE_RECOVERY_SCRIPT } from '../../modules/src/client/recovery-script.ts'
import { verifiedComposition } from '../../web/src/composition.ts'
import { applicationFixture } from './composition.client.ts'
import { browserFixture, httpBridge } from './http-fixture.client.ts'
let fixture: Awaited<ReturnType<typeof browserFixture>>
let bridge: ReturnType<typeof httpBridge>
const dispose: Array<() => void | Promise<void>> = []
beforeAll(async () => { fixture = await browserFixture('user'); await fixture.command('set-modules', { index: 0, grants: ['storage'] }) })
afterAll(async () => { await fixture.close() })
afterEach(async () => {
  window.dispatchEvent(new Event('pagehide'))
  for (const release of dispose.splice(0).reverse()) await release()
  BrowserAuthClient.clearRecoveryTransfer(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/'); document.body.replaceChildren()
})
function deferred() {
  let release: (() => void) | undefined
  const promise = new Promise<void>((resolve) => { release = resolve })
  if (release === undefined) throw new Error('synchronous promise resolver missing')
  dispose.push(release)
  return { promise, release }
}
function publish(fragment: string): void {
  history.replaceState(null, '', location.pathname + fragment)
  window.dispatchEvent(new HashChangeEvent('hashchange', { newURL: location.href }))
}
function publisher(fragment = '', pathname = '/reset'): void {
  window.dispatchEvent(new Event('pagehide'))
  history.replaceState(null, '', pathname + fragment); window.eval(NATIVE_RECOVERY_SCRIPT)
}
async function entered(index = 0) {
  const row = fixture.users[index]
  if (row === undefined) throw new Error('real user fixture missing')
  const response = await bridge.fetcher('/auth/login', { method: 'POST',
    headers: { [AUTH_HEADER]: '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: row.username, password: row.password }) })
  expect(response.ok).toBe(true)
  return parseAuthState(await response.json())
}
function admit(auth: BrowserAuthClient, state: AuthState): void {
  const pathname = location.pathname, sealed = authComposition(state, pathname)
  auth.start((fresh, current) => {
    if (current !== pathname || location.pathname !== pathname) throw new Error('canonical recovery path changed')
    const next = verifiedComposition(sealed, fresh, pathname)
    if (next.kind !== 'public' || next.scope !== 'application') throw new Error('public recovery document required')
  })
}
async function boot(fragment = '') {
  bridge = httpBridge(fixture.url); bridge.install(); publisher(fragment)
  const boundary = vi.fn(), reload = vi.fn()
  const ready = await BrowserAuthClient.bootstrap(boundary, undefined, reload)
  dispose.push(() => { ready.auth.dispose() }); admit(ready.auth, ready.state)
  return { ...ready, boundary, reload }
}
function holdNextBody(path: string, redirect?: string, observe?: () => void) {
  const body = deferred(), arrived = deferred(); let once = true
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const matches = once && typeof input === 'string' && input.startsWith(path)
    if (matches) { once = false; observe?.() }
    const response = await bridge.fetcher(matches && redirect !== undefined ? redirect : input, init)
    if (matches) {
      const json = response.json.bind(response)
      vi.spyOn(response, 'json').mockImplementation(async () => {
        const data: unknown = await json(); arrived.release(); await body.promise; return data
      })
    }
    return response
  })
  return { body, arrived }
}
describe('same-document recovery admission and exclusive capabilities', () => {
  it('constructor does not capture a transfer, while bootstrap observes B before a held GET of A completes', async () => {
    bridge = httpBridge(fixture.url); bridge.install()
    const state = await readAuthSession(); publisher('#reset=fixture-A')
    const direct = new BrowserAuthClient(state, () => {}); dispose.push(() => { direct.dispose() })
    expect(direct.initialRoute).toBe('login')
    const held = holdNextBody('/auth/session'), boundary = vi.fn()
    const pending = BrowserAuthClient.bootstrap(boundary)
    await held.arrived.promise
    publish('#invite=fixture-B')
    const ready = await pending; dispose.push(() => { ready.auth.dispose() })
    expect(ready.auth.initialRoute).toBe('invitation')
    expect(ready.auth.getSnapshot().recovery).toEqual({ revision: 1, phase: 'ready', route: 'invitation' })
    expect(location.hash).toBe(''); expect(bridge.requests.filter(row => row.path === '/auth/session')).toHaveLength(3)
    // A's late finally and a late disposed transport cannot clear a newer one-use handle.
    ready.auth.dispose(); publish('#reset=fixture-C')
    const carrier = globalThis as { __ARX_RECOVERY_FRAGMENT__?: unknown }, current = carrier.__ARX_RECOVERY_FRAGMENT__
    held.body.release(); await readAuthSession(); direct.dispose()
    expect(carrier.__ARX_RECOVERY_FRAGMENT__).toBe(current)
    expect(boundary).not.toHaveBeenCalled()
  })
  it('retires filled reset drafts before revalidation, remounts reset to reset, and ignores stale callbacks', async () => {
    bridge = httpBridge(fixture.url); bridge.install(); history.replaceState(null, '', '/reset#reset=fixture-first')
    let ui: Awaited<ReturnType<typeof applicationFixture>> | undefined
    await act(async () => { ui = await applicationFixture() })
    if (ui === undefined) throw new Error('real application did not mount')
    const current = ui; dispose.push(() => current.close()); admit(current.auth, await readAuthSession())
    const revision = current.auth.getSnapshot().recovery?.revision
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'Transient-fixture-password' } })
    fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: 'Transient-fixture-password' } })
    const oldPassword = screen.getByLabelText<HTMLInputElement>('Nova senha')
    const warnings: string[] = []
    const originalError = console.error.bind(console)
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (args.some(value => typeof value === 'string' && value.includes('flushSync'))) warnings.push('flushSync')
      else originalError(...args)
    })
    let privateFormPresentAtGet = true
    const held = holdNextBody('/auth/session', undefined, () => { privateFormPresentAtGet = screen.queryByLabelText('Nova senha') !== null })
    act(() => { publish('#reset=fixture-second') })
    expect(privateFormPresentAtGet).toBe(false)
    expect(screen.queryByLabelText('Nova senha')).toBeNull(); expect(oldPassword.isConnected).toBe(false)
    expect(current.auth.getSnapshot().principal).toBeUndefined()
    expect(screen.getByRole('status').textContent).toBe('Validando link de recuperação.')
    await held.arrived.promise
    const before = bridge.requests.length
    await expect(current.auth.resetPassword('Unused-fixture', revision)).rejects.toMatchObject({ code: 'SESSION_ENDED' })
    current.auth.returnToEntry(revision); expect(location.pathname).toBe('/reset'); expect(bridge.requests).toHaveLength(before)
    await act(async () => { held.body.release() })
    await screen.findByRole('heading', { name: 'Definir nova senha' })
    expect(screen.getByLabelText<HTMLInputElement>('Nova senha').value).toBe('')
    expect(screen.getByLabelText<HTMLInputElement>('Confirmar nova senha').value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull(); expect(location.hash).toBe(''); expect(warnings).toEqual([])
  })
  it('replaces invitation drafts and a previous error with the latest invitation revision', async () => {
    bridge = httpBridge(fixture.url); bridge.install(); history.replaceState(null, '', '/invite#invite=fixture-old')
    let ui: Awaited<ReturnType<typeof applicationFixture>> | undefined
    await act(async () => { ui = await applicationFixture() })
    if (ui === undefined) throw new Error('real application did not mount')
    const current = ui; dispose.push(() => current.close()); admit(current.auth, await readAuthSession())
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'Fixture-mismatch' } })
    fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: 'Fixture-other' } })
    await act(async () => { fireEvent.submit(current.container.querySelector('form')!) })
    expect(screen.getByRole('alert').textContent).toBe('As senhas precisam ser iguais.')
    await act(async () => { publish('#invite=fixture-new') })
    await screen.findByRole('heading', { name: 'Aceitar convite' })
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.getByLabelText<HTMLInputElement>('Nova senha').value).toBe('')
    expect(current.auth.getSnapshot().recovery?.revision).toBe(1)
  })
  it('abandons an old error JSON and an old invalidation poll without retracting the new revision', async () => {
    bridge = httpBridge(fixture.url); bridge.install(); const state = await entered(); publisher()
    const boundary = vi.fn(), ready = await BrowserAuthClient.bootstrap(boundary)
    dispose.push(() => { ready.auth.dispose() })
    const poll = holdNextBody('/auth/invalidation'); admit(ready.auth, state)
    await poll.arrived.promise
    const failed = holdNextBody('/user/', '/user/projects/' + crypto.randomUUID() + '/workspaces')
    const old = ready.auth.userRequest('GET', '/user/projects'); const rejected = old.then(() => undefined, (cause: unknown) => cause)
    await failed.arrived.promise
    publish('#reset=fixture-new')
    await waitFor(() => { expect(ready.auth.getSnapshot().recovery?.phase).toBe('ready') })
    failed.body.release(); poll.body.release(); expect(await rejected).toMatchObject({ code: 'SESSION_ENDED' })
    expect(ready.auth.getSnapshot().recovery?.revision).toBe(1); expect(boundary).not.toHaveBeenCalled()
    expect(ready.auth.getSnapshot().authenticated).toBe(true)
  })
  it('does not put a late acknowledgement from an unmounted forgot form into the new reset form', async () => {
    bridge = httpBridge(fixture.url); bridge.install(); history.replaceState(null, '', '/reset')
    let ui: Awaited<ReturnType<typeof applicationFixture>> | undefined
    await act(async () => { ui = await applicationFixture() })
    if (ui === undefined) throw new Error('real application did not mount')
    const current = ui; dispose.push(() => current.close()); admit(current.auth, await readAuthSession())
    fireEvent.click(screen.getByRole('button', { name: 'Esqueci minha senha' }))
    fireEvent.change(screen.getByLabelText('Nome de usuário ou e-mail'), { target: { value: fixture.users[0]!.username } })
    const held = holdNextBody('/auth/password/forgot')
    act(() => { fireEvent.submit(current.container.querySelector('form')!) }); await held.arrived.promise
    await act(async () => { publish('#reset=fixture-new') })
    await screen.findByRole('heading', { name: 'Definir nova senha' })
    await act(async () => { held.body.release(); await readAuthSession() })
    expect(screen.queryByText('Se houver uma conta elegível, você receberá as instruções de recuperação.')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.getByLabelText<HTMLInputElement>('Nova senha').value).toBe('')
  })
  it.each(['kind', 'audience', 'generation'] as const)('rejects an untrusted divergent %s marker before recovery can reuse its document', async (field) => {
    bridge = httpBridge(fixture.url); bridge.install(); publisher()
    const boundary = vi.fn(), ready = await BrowserAuthClient.bootstrap(boundary); dispose.push(() => { ready.auth.dispose() })
    const marker = { ...authComposition(ready.state, '/reset'), [field]: field === 'kind' ? 'admin' : field === 'audience' ? 'admin' : 42 }
    ready.auth.start((state, pathname) => { verifiedComposition(marker, state, pathname) })
    publish('#reset=fixture-new')
    await waitFor(() => { expect(boundary).toHaveBeenCalledWith('unavailable') })
    expect(ready.auth.getSnapshot().phase).toBe('ended')
  })
  it('discards the initial capability on pagehide while the first session body is still pending', async () => {
    bridge = httpBridge(fixture.url); bridge.install(); publisher('#reset=fixture-initial')
    const held = holdNextBody('/auth/session'), boundary = vi.fn(), pending = BrowserAuthClient.bootstrap(boundary)
    const rejected = pending.then(() => undefined, (cause: unknown) => cause)
    await held.arrived.promise; window.dispatchEvent(new Event('pagehide')); held.body.release()
    expect(await rejected).toMatchObject({ code: 'AUTH_BOOT_ENDED' })
    expect((globalThis as { __ARX_RECOVERY_FRAGMENT__?: unknown }).__ARX_RECOVERY_FRAGMENT__).toBeUndefined()
    expect(boundary).not.toHaveBeenCalled()
  })
  it('rejects a replacement session of the same user with the same generation and a different private CSRF', async () => {
    bridge = httpBridge(fixture.url); bridge.install(); const state = await entered(); publisher()
    const boundary = vi.fn(), ready = await BrowserAuthClient.bootstrap(boundary); dispose.push(() => { ready.auth.dispose() })
    admit(ready.auth, state); const replacement = await entered()
    expect(state.authenticated && replacement.authenticated && state.principal.userId === replacement.principal.userId).toBe(true)
    expect(state.authenticated && replacement.authenticated && state.generation === replacement.generation).toBe(true)
    expect(state.authenticated && replacement.authenticated && state.csrfToken !== replacement.csrfToken).toBe(true)
    publish('#reset=fixture-new')
    await waitFor(() => { expect(boundary).toHaveBeenCalledWith('revoked') })
    expect(ready.auth.getSnapshot()).toEqual({ authenticated: false, phase: 'ended' })
  })
  it('fails closed when the canonical pathname changes and does not restore a token after pagehide', async () => {
    const ready = await boot('#reset=fixture-A'), held = holdNextBody('/auth/session')
    publish('#reset=fixture-B'); await held.arrived.promise
    history.replaceState(null, '', '/invite'); held.body.release()
    await waitFor(() => { expect(ready.boundary).toHaveBeenCalledWith('unavailable') })
    expect(ready.auth.getSnapshot().principal).toBeUndefined()
    const fresh = await boot('#reset=fixture-C'), body = holdNextBody('/auth/session')
    publish('#reset=fixture-D'); await body.arrived.promise
    window.dispatchEvent(new Event('pagehide')); body.body.release()
    await waitFor(() => { expect(fresh.boundary).toHaveBeenCalledWith('pagehide') })
    expect(fresh.auth.getSnapshot().phase).toBe('ended')
    await expect(fresh.auth.resetPassword('Unused-fixture')).rejects.toMatchObject({ code: 'SESSION_ENDED' })
  })
  it('consumes a real issued reset synchronously once despite two submissions and does not consume it on GET', async () => {
    const ready = await boot(), row = fixture.users[1]
    if (row === undefined) throw new Error('second real user fixture missing')
    await ready.auth.forgotPassword(row.username)
    const link = await fixture.command('recovery-link', { purpose: 'reset' })
    if (typeof link.link !== 'string') throw new Error('real delivery missing')
    const fragment = new URL(link.link).hash; publish(fragment)
    await waitFor(() => { expect(ready.auth.getSnapshot().recovery?.phase).toBe('ready') })
    expect((await readAuthSession()).authenticated).toBe(false)
    const next = 'Fixture-' + crypto.randomUUID() + '-reset', revision = ready.auth.getSnapshot().recovery?.revision
    const before = bridge.requests.filter(request => request.path === '/auth/password/reset').length
    const first = ready.auth.resetPassword(next, revision)
    await expect(ready.auth.resetPassword(next, revision)).rejects.toMatchObject({ code: 'RESET_TOKEN_INVALID' }); await first
    expect(bridge.requests.filter(request => request.path === '/auth/password/reset')).toHaveLength(before + 1)
    expect((await readAuthSession()).authenticated).toBe(false)
    const response = await bridge.fetcher('/auth/login', { method: 'POST',
      headers: { [AUTH_HEADER]: '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: row.username, password: next }) })
    expect(response.ok).toBe(true); expect(parseAuthState(await response.json()).authenticated).toBe(true)
    expect(JSON.stringify(ready.auth.getSnapshot()).includes(fragment.slice(7))).toBe(false)
  })
})
