// @vitest-environment jsdom
/** Real publisher/Loader/UI/HTTP with faults injected only through public subscriptions. */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { AUTH_HEADER, parseAuthState, type AuthState } from '@arx-ai/arx-web-identity/contract'
import { BrowserAuthClient, authComposition, readAuthSession } from '../src/browser.ts'
import { verifiedComposition } from '../../web/src/composition.ts'
import { applicationFixture } from './composition.client.ts'
import { browserFixture, httpBridge } from './http-fixture.client.ts'
let fixture: Awaited<ReturnType<typeof browserFixture>>
let bridge: ReturnType<typeof httpBridge>
const release: Array<() => void | Promise<void>> = []
beforeAll(async () => { fixture = await browserFixture('user') })
afterAll(async () => { await fixture.close() })
afterEach(async () => {
  window.dispatchEvent(new Event('pagehide'))
  for (const stop of release.splice(0).reverse()) await stop()
  BrowserAuthClient.clearRecoveryTransfer(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/'); document.body.replaceChildren()
})
function deferred() {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>((done) => { resolve = done })
  if (resolve === undefined) throw new Error('synchronous resolver missing')
  release.push(resolve)
  return { promise, resolve }
}
function holdBody(path: string) {
  const delegated = globalThis.fetch
  const arrived = deferred(), body = deferred(), completed = deferred(); let once = true
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const hold = once && typeof input === 'string' && input.startsWith(path)
    if (hold) once = false
    const response = await delegated(input, init)
    if (hold) {
      const json = response.json.bind(response)
      vi.spyOn(response, 'json').mockImplementation(async () => {
        const data: unknown = await json(); arrived.resolve(); await body.promise; completed.resolve(); return data
      })
    }
    return response
  })
  return { arrived, body, completed }
}
function admit(auth: BrowserAuthClient, state: AuthState): void {
  const pathname = location.pathname, sealed = authComposition(state, pathname)
  auth.start((fresh, current) => {
    if (current !== pathname || location.pathname !== pathname) throw new Error('canonical pathname changed')
    const next = verifiedComposition(sealed, fresh, pathname)
    if (next.kind !== 'public' || next.scope !== 'application') throw new Error('public recovery required')
  })
}
async function entered(): Promise<void> {
  const user = fixture.users[0]
  if (user === undefined) throw new Error('real user fixture missing')
  const response = await bridge.fetcher('/auth/login', { method: 'POST',
    headers: { [AUTH_HEADER]: '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: user.username, password: user.password }) })
  expect(response.status).toBe(200); expect(parseAuthState(await response.json()).authenticated).toBe(true)
}
function publish(fragment: string): void {
  history.replaceState(null, '', location.pathname + fragment)
  window.dispatchEvent(new HashChangeEvent('hashchange', { newURL: location.href }))
}
async function mounted(fault?: 'checking' | 'ready', fragment = '#reset=fixture-A') {
  bridge = httpBridge(fixture.url); bridge.install(); await entered()
  history.replaceState(null, '', '/reset' + fragment)
  const boundary = vi.fn(), phases: string[] = []
  let ui: Awaited<ReturnType<typeof applicationFixture>> | undefined
  await act(async () => {
    ui = await applicationFixture(boundary, (_ctx, auth) => {
      release.push(auth.subscribe(() => {
        const recovery = auth.getSnapshot().recovery
        if (fault !== undefined && recovery?.revision !== 0 && recovery?.phase === fault) {
          throw new Error('throwing-recovery-consumer')
        }
      }))
    })
  })
  if (ui === undefined) throw new Error('real UI did not mount')
  const current = ui; release.push(() => current.close())
  release.push(current.auth.subscribe(() => { phases.push(current.auth.getSnapshot().recovery?.phase ?? 'ended') }))
  const state = await readAuthSession(), poll = holdBody('/auth/invalidation'); admit(current.auth, state); await poll.arrived.promise
  if (fragment !== '') {
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'Transient-fixture-password' } })
    fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: 'Transient-fixture-password' } })
  }
  const oldInput = screen.getByLabelText<HTMLInputElement>(fragment === '' ? 'Nome de usuário ou e-mail' : 'Nova senha')
  const oldRevision = current.auth.getSnapshot().recovery?.revision
  return { current, boundary, phases, poll, oldInput, oldRevision }
}
describe('recovery subscriber failure containment', () => {
  for (const phase of ['checking', 'ready'] as const) it(`notifies healthy consumers and closes unavailable after ${phase} failure`, async () => {
    const value = await mounted(phase)
    const beforeGet = bridge.requests.filter(row => row.path === '/auth/session').length
    const beforePoll = bridge.requests.filter(row => row.path === '/auth/invalidation').length
    await act(async () => { publish('#reset=fixture-B') })
    await waitFor(() => { expect(value.boundary).toHaveBeenCalledWith('unavailable') })
    expect(value.phases).toContain('checking')
    if (phase === 'ready') expect(value.phases).toContain('ready')
    expect(value.oldInput.isConnected).toBe(false)
    expect(screen.queryByLabelText('Nova senha')).toBeNull()
    expect(screen.queryByLabelText('Confirmar nova senha')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(value.current.auth.getSnapshot().authenticated).toBe(false)
    expect(bridge.requests.filter(row => row.path === '/auth/session')).toHaveLength(beforeGet + (phase === 'ready' ? 1 : 0))
    expect(bridge.requests.filter(row => row.path === '/auth/invalidation')).toHaveLength(beforePoll)
    const beforeStale = bridge.requests.length
    await expect(value.current.auth.resetPassword('Unused-fixture', value.oldRevision)).rejects.toMatchObject({ code: 'SESSION_ENDED' })
    expect(bridge.requests).toHaveLength(beforeStale)
    await act(async () => { value.poll.body.resolve(); await value.poll.completed.promise })
    expect(value.boundary).toHaveBeenCalledTimes(1)
    expect(value.current.auth.getSnapshot().recovery).toBeUndefined()
    expect(location.hash).toBe('')
  })
  it('cannot restore an old forgot acknowledgement after a failed checking notification', async () => {
    const value = await mounted('checking', '')
    const user = fixture.users[0]
    if (user === undefined) throw new Error('real user fixture missing')
    fireEvent.click(screen.getByRole('button', { name: 'Esqueci minha senha' }))
    fireEvent.change(screen.getByLabelText('Nome de usuário ou e-mail'), { target: { value: user.username } })
    const held = holdBody('/auth/password/forgot'), form = value.current.container.querySelector('form')
    if (form === null) throw new Error('real forgot form missing')
    act(() => { fireEvent.submit(form) }); await held.arrived.promise
    await act(async () => { publish('#reset=fixture-B') })
    expect(value.boundary).toHaveBeenCalledWith('unavailable')
    expect(value.phases).toContain('checking'); expect(form.isConnected).toBe(false)
    await act(async () => { held.body.resolve(); await held.completed.promise })
    expect(screen.queryByText('Se houver uma conta elegível, você receberá as instruções de recuperação.')).toBeNull()
    expect(screen.queryByLabelText('Nome de usuário ou e-mail')).toBeNull()
    expect(value.current.auth.getSnapshot().recovery).toBeUndefined()
    expect(bridge.requests.filter(row => row.path === '/auth/password/forgot')).toHaveLength(1)
    expect(bridge.requests.filter(row => row.path === '/auth/password/reset')).toHaveLength(0)
  })
  it('retracts drafts before a genuine GET and resumes only the current poll when consumers succeed', async () => {
    const value = await mounted(), before = bridge.requests.length
    let retractionObserved = false
    const delegated = globalThis.fetch
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/auth/session') retractionObserved = screen.queryByLabelText('Nova senha') === null && !value.oldInput.isConnected
      return delegated(input, init)
    })
    await act(async () => { publish('#reset=fixture-B') })
    await screen.findByRole('heading', { name: 'Definir nova senha' })
    expect(retractionObserved).toBe(true); expect(value.phases).toContain('checking'); expect(value.phases).toContain('ready')
    expect(screen.getByLabelText<HTMLInputElement>('Nova senha').value).toBe('')
    expect(screen.getByLabelText<HTMLInputElement>('Confirmar nova senha').value).toBe('')
    expect(bridge.requests.slice(before).filter(row => row.path === '/auth/session')).toHaveLength(1)
    expect(bridge.requests.slice(before).filter(row => row.path === '/auth/invalidation')).toHaveLength(1)
    await expect(value.current.auth.resetPassword('Unused-fixture', value.oldRevision)).rejects.toMatchObject({ code: 'SESSION_ENDED' })
    await act(async () => { value.poll.body.resolve(); await value.poll.completed.promise })
    expect(value.current.auth.getSnapshot().recovery?.revision).toBe(1)
    expect(value.boundary).not.toHaveBeenCalled()
  })
})
