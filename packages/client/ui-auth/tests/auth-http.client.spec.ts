// @vitest-environment jsdom
/** Source/HTTP integration: cookies, Loader, SQLite and journal are real, only delivery is fake. */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { AUTH_HEADER, parseAuthState } from '@arx-ai/arx-web-identity/contract'
import { parseCreatedProject, parseProjectsPage } from '@arx-ai/arx-project-storage/contract'
import { BrowserAuthClient, readAuthSession } from '../src/browser.ts'
import { applicationFixture } from './composition.client.ts'
import { browserFixture, httpBridge } from './http-fixture.client.ts'
let prepared: Awaited<ReturnType<typeof browserFixture>>
beforeEach(async () => {
  const name = expect.getState().currentTestName ?? ''
  prepared = await browserFixture(name.includes('MASTER trees') || name.includes('first password') || name.includes('active admin recovery') ? 'admin' : 'user',
    name.includes('first password'))
})
const disposers: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  await prepared?.close()
  vi.unstubAllGlobals(); localStorage.clear(); history.replaceState(null, '', '/'); document.body.replaceChildren()
})
async function server(audience: 'user' | 'admin', firstPassword = false) {
  expect(prepared.audience).toBe(audience)
  expect(firstPassword).toBe((expect.getState().currentTestName ?? '').includes('first password'))
  return prepared
}
async function login(bridge: ReturnType<typeof httpBridge>, identifier: string, password: string) {
  const response = await bridge.fetcher('/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: '1' }, body: JSON.stringify({ identifier, password }) })
  if (!response.ok) throw new Error('fixture login failed with status ' + String(response.status))
  return parseAuthState(await response.json())
}
describe('native identity application with real HTTP authority', () => {
  it('mounts anonymous and MASTER trees without project services; login requires a new tree', async () => {
    const fixture = await server('admin'), bridge = httpBridge(fixture.url); bridge.install()
    const publicUi = await applicationFixture(); disposers.push(() => publicUi.close())
    expect(publicUi.ctx.get('sessions')).toBeUndefined(); expect(publicUi.ctx.get('workspaces')).toBeUndefined()
    expect(publicUi.ctx.get('connection')).toBeUndefined(); expect(publicUi.ctx.slots.runtime).toBe('application')
    expect(screen.queryByText('Meus projetos')).toBeNull(); expect(screen.queryByRole('button', { name: /Cadastrar/ })).toBeNull()
    expect({ heading: screen.getByRole('heading', { level: 1 }).textContent,
      labels: [...publicUi.container.querySelectorAll('label')].map(label => label.textContent),
      buttons: [...publicUi.container.querySelectorAll('button')].map(button => button.textContent),
      lang: document.documentElement.lang }).toEqual({
      heading: 'Entrar', labels: ['Nome de usuário ou e-mail', 'Senha'],
      buttons: ['Entrar', 'Esqueci minha senha'], lang: 'pt-BR',
    })
    fireEvent.change(screen.getByLabelText('Nome de usuário ou e-mail'), { target: { value: 'admin@centurionarx.com' } })
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: fixture.masterPassword } })
    await act(async () => { fireEvent.submit(publicUi.container.querySelector('form')!) })
    await waitFor(() => { expect(publicUi.reloads).toEqual(['reload']) })
    expect(publicUi.container.textContent).toBe(''); expect(publicUi.auth.getSnapshot().principal).toBeUndefined()
    await publicUi.close()
    const adminUi = await applicationFixture(); disposers.push(() => adminUi.close())
    await screen.findByText('fixture-user-0')
    expect(adminUi.composition.kind).toBe('admin')
    for (const service of ['sessions', 'workspaces', 'connection', 'remote'] as const) expect(adminUi.ctx.get(service)).toBeUndefined()
    expect(screen.getByRole('heading', { name: 'MASTER-ADMIN' })).toBeTruthy()
    expect(screen.queryByText('Meus projetos')).toBeNull(); expect(screen.queryByText('Histórico salvo')).toBeNull()
    fireEvent.change(screen.getByLabelText('Nome de usuário'), { target: { value: 'fixture-new' } })
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'fixture-new@fixture.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar usuário' }))
    const row = (await screen.findByText('fixture-new')).closest('li')!
    expect(within(row).getByText('Estado: Pendente')).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: 'Liberar acesso' }))
    await waitFor(() => { expect(within(row).getByText('Estado: Ativo')).toBeTruthy() })
    expect(bridge.requests.some(row => row.path === '/api')).toBe(false)
    expect(bridge.requests.some(row => row.path.startsWith('/user/'))).toBe(false)
  })
  it('restricts first password change to a public tree and rotates the real session', async () => {
    const fixture = await server('admin', true), bridge = httpBridge(fixture.url); bridge.install()
    const restricted = await login(bridge, 'arxadmin', fixture.masterPassword)
    expect(restricted.authenticated && restricted.principal.mustChangePassword).toBe(true)
    const ui = await applicationFixture(); disposers.push(() => ui.close())
    expect(ui.composition.kind).toBe('public'); expect(screen.getByText('Defina uma nova senha antes de continuar.')).toBeTruthy()
    expect(ui.ctx.get('sessions')).toBeUndefined()
    expect((await bridge.fetcher('/admin/users')).status).toBe(403)
    const nextPassword = 'Fixture-' + crypto.randomUUID() + '-rotated'
    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: fixture.masterPassword } })
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: nextPassword } })
    fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: nextPassword } })
    await act(async () => { fireEvent.submit(ui.container.querySelector('form')!) })
    await waitFor(() => { expect(ui.reloads).toEqual(['reload']) })
    const state = await readAuthSession()
    expect(state.authenticated && state.principal.mustChangePassword).toBe(false)
    expect(state.authenticated && restricted.authenticated && state.generation >= restricted.generation).toBe(true)
  })
  it('uses independent cookies for two USER owners; server denies foreign IDs and MASTER paths', async () => {
    const fixture = await server('user'), first = httpBridge(fixture.url), second = httpBridge(fixture.url)
    const a = await login(first, fixture.users[0]!.username, fixture.users[0]!.password)
    const b = await login(second, fixture.users[1]!.username, fixture.users[1]!.password)
    first.install()
    const authA = new BrowserAuthClient(a, () => {}, () => {}); disposers.push(() =>{  authA.dispose() })
    const projectA = parseCreatedProject(await authA.userRequest('POST', '/user/projects', { name: 'Somente A' }))
    second.install()
    const authB = new BrowserAuthClient(b, () => {}, () => {}); disposers.push(() =>{  authB.dispose() })
    const projectB = parseCreatedProject(await authB.userRequest('POST', '/user/projects', { name: 'Somente B' }))
    const projects = parseProjectsPage(await authB.userRequest('GET', '/user/projects'))
    expect(projects.projects.map(row => row.name)).toEqual(['Somente B'])
    await expect(authB.userRequest('GET', '/user/projects/' + projectA.projectId + '/workspaces')).rejects.toMatchObject({ status: 403, code: 'OWNER_FORBIDDEN' })
    expect([403, 404]).toContain((await second.fetcher('/admin/users')).status)
    expect(JSON.stringify(projects)).not.toContain(projectA.projectId)
    first.install()
    await expect(authA.userRequest('POST', '/user/projects/' + projectB.projectId + '/workspaces', { name: 'foreign' })).rejects.toMatchObject({ status: 403, code: 'OWNER_FORBIDDEN' })
    expect(parseProjectsPage(await authA.userRequest('GET', '/user/projects')).projects.map(row => row.name)).toEqual(['Somente A'])
  })
  it('keeps own USER projects and saved history usable without any project runtime', async () => {
    const fixture = await server('user')
    await fixture.command('set-modules', { index: 0, grants: ['storage'] })
    const seeded = await fixture.command('seed-history', { index: 0 })
    const bridge = httpBridge(fixture.url); await login(bridge, fixture.users[0]!.username, fixture.users[0]!.password); bridge.install()
    const ui = await applicationFixture(); disposers.push(() => ui.close())
    expect(ui.composition.kind).toBe('user'); expect(ui.composition.scope).toBe('application')
    for (const service of ['sessions', 'workspaces', 'connection', 'remote'] as const) expect(ui.ctx.get(service)).toBeUndefined()
    const select = await screen.findByRole('combobox', { name: 'Meus projetos' })
    await waitFor(() => { expect(within(select).getByRole('option', { name: 'Projeto privado 0' })).toBeTruthy() })
    fireEvent.change(select, { target: { value: seeded.projectId } })
    await screen.findByText('Conversa privada 0')
    expect(screen.getByRole('button', { name: 'Retomar' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Abrir workspace' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Ver histórico' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => { expect(dialog.querySelector('pre')?.textContent).not.toBe('') })
    expect(dialog.querySelector('pre')?.textContent).not.toContain('"type":"session"')
    expect(dialog.querySelector('pre')?.textContent).not.toContain('/volumes/')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Minha conta' }))
    expect(screen.getByText(fixture.users[0]!.username)).toBeTruthy()
    expect(bridge.requests.some(row => row.path.startsWith('/api/'))).toBe(false)
  })
  it('strips reset fragments before UI factories and consumes a real recovery token once', async () => {
    const fixture = await server('user'), bridge = httpBridge(fixture.url); bridge.install()
    const anonymous = new BrowserAuthClient(await readAuthSession(), () => {}, () => {})
    disposers.push(() =>{  anonymous.dispose() }); await anonymous.forgotPassword(fixture.users[0]!.username)
    const fragment = new URL(String((await fixture.command('recovery-link')).link)).hash
    history.replaceState({ stale: 'private' }, '', '/' + fragment)
    let captured: string | undefined = fragment
    history.replaceState(null, '', '/')
    const carrier = globalThis as { __ARX_RECOVERY_FRAGMENT__?: { take(): string | undefined; clear(): void } }
    const clear = (): void => { captured = undefined; delete carrier.__ARX_RECOVERY_FRAGMENT__ }
    carrier.__ARX_RECOVERY_FRAGMENT__ = Object.freeze({ take: () => { const value = captured; clear(); return value }, clear })
    let tookBeforeAuthGet = false
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === 'string' && input === '/auth/session') {
        tookBeforeAuthGet = captured === undefined && carrier.__ARX_RECOVERY_FRAGMENT__ === undefined && location.hash === ''
      }
      return bridge.fetcher(input, init)
    })
    const { auth: recovery } = await BrowserAuthClient.bootstrap(() => {}); disposers.push(() =>{  recovery.dispose() })
    expect(tookBeforeAuthGet).toBe(true)
    expect(recovery.initialRoute).toBe('reset'); expect(location.hash).toBe(''); expect(history.state).toBeNull()
    expect(JSON.stringify(recovery.getSnapshot())).not.toContain(fragment.slice(7))
    const nextPassword = 'Fixture-' + crypto.randomUUID() + '-reset'
    await recovery.resetPassword(nextPassword)
    expect((await readAuthSession()).authenticated).toBe(false)
    await expect(recovery.resetPassword(nextPassword)).rejects.toMatchObject({ code: 'RESET_TOKEN_INVALID' })
    expect((await login(bridge, fixture.users[0]!.username, nextPassword)).authenticated).toBe(true)
  })
  it.each(['user', 'admin'] as const)('mounts active %s recovery paths as public without forging the real session', async (audience) => {
    const fixture = await server(audience), bridge = httpBridge(fixture.url)
    if (audience === 'user') await fixture.command('set-modules', { index: 0, grants: ['storage'] })
    const identifier = audience === 'admin' ? 'arxadmin' : fixture.users[0]!.username
    const password = audience === 'admin' ? fixture.masterPassword : fixture.users[0]!.password
    const active = await login(bridge, identifier, password)
    expect(active.authenticated).toBe(true)
    bridge.install()
    const transport = new BrowserAuthClient(active, () => {}, () => {}); disposers.push(() =>{  transport.dispose() })
    await transport.forgotPassword(identifier)
    const realReset = new URL(String((await fixture.command('recovery-link', { purpose: 'reset' })).link)).hash
    for (const route of ['/reset' + realReset, '/invite#invite=invalid-fixture-proof']) {
      history.replaceState(null, '', route)
      const ui = await applicationFixture(); disposers.push(() => ui.close())
      expect(ui.composition).toMatchObject({ kind: 'public', audience, scope: 'application' })
      expect(ui.composition.generation).toBe(active.authenticated ? active.generation : undefined)
      expect(ui.auth.getSnapshot().principal?.userId).toBe(active.authenticated ? active.principal.userId : undefined)
      expect(screen.getByRole('heading', { name: route.startsWith('/reset') ? 'Definir nova senha' : 'Aceitar convite' })).toBeTruthy()
      for (const service of ['sessions', 'workspaces', 'connection', 'remote'] as const) expect(ui.ctx.get(service)).toBeUndefined()
      expect((await readAuthSession()).authenticated).toBe(true)
      await ui.close()
    }
    history.replaceState(null, '', '/invite#invite=invalid-fixture-exit')
    const exit = await applicationFixture(); disposers.push(() => exit.close())
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao acesso' }))
    expect(location.pathname).toBe('/')
    expect(exit.reloads).toEqual(['reload'])
    expect(exit.auth.getSnapshot().phase).toBe('ended')
    await exit.close()
    const returned = await applicationFixture(); disposers.push(() => returned.close())
    expect(returned.composition.kind).toBe(audience === 'admin' ? 'admin' : 'user')
    await returned.close()
    history.replaceState(null, '', '/reset' + realReset)
    const recovery = await applicationFixture(); disposers.push(() => recovery.close())
    const nextPassword = 'Fixture-' + crypto.randomUUID() + '-active-reset'
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: nextPassword } })
    fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: nextPassword } })
    await act(async () => { fireEvent.submit(recovery.container.querySelector('form')!) })
    await screen.findByText('Senha definida. Volte ao acesso para entrar.')
    expect((await readAuthSession()).authenticated).toBe(false)
    expect((await login(bridge, identifier, nextPassword)).authenticated).toBe(true)
    await recovery.close()
    // A cookie can already be active while /reset has no remaining fragment.
    // Submitting that login must leave the recovery URL on a fresh tree.
    const entry = await applicationFixture(); disposers.push(() => entry.close())
    expect(entry.composition.kind).toBe('public')
    fireEvent.change(screen.getByLabelText('Nome de usuário ou e-mail'), { target: { value: identifier } })
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: nextPassword } })
    await act(async () => { fireEvent.submit(entry.container.querySelector('form')!) })
    await waitFor(() => { expect(entry.reloads).toEqual(['reload']) })
    expect(location.pathname).toBe('/')
    expect(entry.auth.getSnapshot().phase).toBe('ended')
    await entry.close()
    const entered = await applicationFixture(); disposers.push(() => entered.close())
    expect(entered.composition.kind).toBe(audience === 'admin' ? 'admin' : 'user')
    expect(bridge.requests.some(row => row.path.startsWith('/api/'))).toBe(false)
  })
  it('polls auth-only invalidation and clears principal/cache/history on real revocation', async () => {
    const fixture = await server('user'), bridge = httpBridge(fixture.url)
    const state = await login(bridge, fixture.users[0]!.username, fixture.users[0]!.password)
    bridge.install(); const boundary = vi.fn()
    const auth = new BrowserAuthClient(state, boundary, () => {}); disposers.push(() =>{  auth.dispose() })
    localStorage.setItem('arx.private.session', 'private-marker'); history.replaceState({ selectedSession: 'old' }, '', '/')
    auth.start(); await fixture.command('block-user', { index: 0 })
    await waitFor(() => { expect(boundary).toHaveBeenCalledWith('revoked') })
    expect(auth.getSnapshot()).toEqual({ authenticated: false, phase: 'ended' })
    expect(localStorage.getItem('arx.private.session')).toBeNull(); expect(history.state).toBeNull()
    expect(bridge.requests.some(row => row.path === '/auth/invalidation')).toBe(true)
    expect(bridge.requests.some(row => row.path === '/api')).toBe(false)
  })
})
