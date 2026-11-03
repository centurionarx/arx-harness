// @vitest-environment jsdom
/** Account views use genuine application props and HTTP identity, without invented project services. */
import { useState, type ReactNode } from 'react'
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within, render, cleanup } from '@testing-library/react'
import type { PropsApplication, PropsRenderSlots } from '@arx-ai/arx-client-ui-slots'
import { AUTH_HEADER, parseAuthState } from '@arx-ai/arx-web-identity/contract'
import { AccountFooter, LogoutFooter, ErrorMessage } from '../src/client/forms.tsx'
import { authErrorCode } from '../src/client/errors.ts'
import { en, pt } from '../src/client/locales.ts'
import type { PublicInjected } from '../src/client/contract.ts'
import { AuthHttpError } from '../src/browser.ts'
import { applicationFixture } from './composition.client.ts'
import { browserFixture, httpBridge } from './http-fixture.client.ts'
let fixture: Awaited<ReturnType<typeof browserFixture>>
let bridge: ReturnType<typeof httpBridge>
let ui: Awaited<ReturnType<typeof applicationFixture>> | undefined
beforeAll(async () => { fixture = await browserFixture('user') })
afterAll(async () => { await fixture.close() })
beforeEach(async () => {
  const anonymous = (expect.getState().currentTestName ?? '').includes('anonymous')
  await fixture.command('set-modules', { index: 0, grants: anonymous ? ['storage'] : [] })
  bridge = httpBridge(fixture.url)
  if (!anonymous) {
    const response = await bridge.fetcher('/auth/login', { method: 'POST',
      headers: { [AUTH_HEADER]: '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: fixture.users[0]!.username, password: fixture.users[0]!.password }) })
    expect(response.ok).toBe(true); expect(parseAuthState(await response.json()).authenticated).toBe(true)
  }
  bridge.install()
})
afterEach(async () => {
  await ui?.close(); ui = undefined; cleanup()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren()
  localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/')
})
function Controller(props: PropsApplication<'root'> & PropsRenderSlots<'sidebar.footer.action'>): ReactNode {
  const [wide, setWide] = useState(false)
  return <main><button onClick={() => { setWide(value => !value) }}>Alternar largura</button>
    {props.renderSlot('sidebar.footer.action', { wide })}</main>
}
async function accountPresentation() {
  await act(async () => {
    ui = await applicationFixture(undefined, async (ctx, auth) => {
      const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === '@arx-ai/arx-client-ui-auth')
      const fiber = entry?.fiber
      if (fiber === undefined) throw new Error('real auth UI fiber missing')
      await fiber.dispose()
      ctx.effect(() => ctx.locale.register('auth', { en, pt }), 'test: account presentation dictionary')
      const publicFace = (): PublicInjected => ({ hooks: { auth }, initialRoute: auth.initialRoute,
        login: (identifier, password) => auth.login(identifier, password), forgot: identifier => auth.forgotPassword(identifier),
        reset: password => auth.resetPassword(password), accept: password => auth.acceptInvitation(password),
        change: (before, password) => auth.changePassword(before, password), logout: () => auth.logout(),
        returnToEntry: () => { auth.returnToEntry() } })
      ctx.slots.register({ name: 'root', runtime: 'application',
        children: { 'sidebar.footer.action': { kind: 'list', scope: 'root' } } }, Controller)
      ctx.slots.register({ name: 'sidebar.footer.action', runtime: 'application', id: 'account',
        locale: 'auth', inject: publicFace }, AccountFooter)
      ctx.slots.register({ name: 'sidebar.footer.action', runtime: 'application', id: 'logout',
        locale: 'auth', inject: () => ({ logout: () => auth.logout() }) }, LogoutFooter)
    })
  })
  const current = ui
  if (current === undefined) throw new Error('application fixture did not mount')
  for (const service of ['sessions', 'workspaces', 'connection'] as const) expect(current.ctx.get(service)).toBeUndefined()
  return current
}

describe('account presentation under the same generic slot and identity contracts', () => {
  it('returns focus on Escape and close, clears rejected password input, and shows both footer widths using real own-account data', async () => {
    const current = await accountPresentation(), trigger = screen.getByRole('button', { name: 'Minha conta' })
    expect(trigger.textContent).toBe('◉'); expect(screen.getByRole('button', { name: 'Sair' }).textContent).toBe('↪')
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog'), nodes = [...dialog.querySelectorAll<HTMLElement>('button,input')]
    const first = nodes[0]!
    expect(document.activeElement).toBe(first)
    expect(within(dialog).getByText(fixture.users[0]!.username)).toBeTruthy()
    expect(within(dialog).getByText(pt.noGrants)).toBeTruthy()
    fireEvent.keyDown(dialog, { key: 'x' }); expect(document.activeElement).toBe(first)
    // Chromium exercises keyboard wrapping in native-project-browser-gate: JSDOM changes
    // document order for this enabled-control selector and cannot witness that behavior.
    fireEvent.change(within(dialog).getByLabelText('Nova senha'), { target: { value: 'Fixture-unused-mismatch' } })
    fireEvent.change(within(dialog).getByLabelText('Confirmar nova senha'), { target: { value: 'Fixture-other' } })
    fireEvent.submit(dialog.querySelector('form')!)
    await within(dialog).findByRole('alert')
    expect(within(dialog).getByLabelText<HTMLInputElement>('Nova senha').value).toBe('')
    expect(within(dialog).getByLabelText<HTMLInputElement>('Confirmar nova senha').value).toBe('')
    fireEvent.keyDown(dialog, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Alternar largura' }))
    expect(trigger.textContent).toBe('Minha conta'); expect(screen.getByRole('button', { name: 'Sair' }).textContent).toBe('Sair')
    fireEvent.click(trigger); fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
    await waitFor(() => { expect(current.reloads).toEqual(['reload']) })
    expect(current.container.textContent).toBe('')
  })
  it('renders no account identity for anonymous facts and contains rejected signout in the component', async () => {
    await accountPresentation(); fireEvent.click(screen.getByRole('button', { name: 'Minha conta' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('region', { name: 'Minha conta' })).toBeNull()
    expect(within(dialog).queryByLabelText('Nova senha')).toBeNull()
    const before = bridge.requests.length
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sair' })) })
    expect(bridge.requests.length).toBe(before)
    expect(within(dialog).queryByText(fixture.users[0]!.username)).toBeNull()
    fireEvent.keyDown(dialog, { key: 'Escape' })
  })
  it('projects only sanitized known failure codes through the real locale service', async () => {
    const current = await accountPresentation(), t = current.ctx.locale.bind('auth')
    for (const [code, key] of [['FORBIDDEN', 'forbidden'], ['QUOTA_EXCEEDED', 'quota'], ['AUTH_LOGIN_INVALID', 'invalid'],
      ['AUTH_CREDENTIAL_INVALID', 'invalid'], ['AUTH_SESSION_ENDED', 'expired'], ['AUTH_REQUIRED', 'expired'],
      ['INVITATION_INVALID', 'tokenInvalid'], ['unknown untrusted message', 'error']] as const) {
      const result = render(<ErrorMessage code={code} t={t} />)
      expect(within(result.container).getByRole('alert').textContent).toBe(pt[key]); result.unmount()
    }
    expect(authErrorCode(new AuthHttpError(403, 'OWNER_FORBIDDEN'))).toBe('OWNER_FORBIDDEN')
    expect(authErrorCode(new AuthHttpError(429, 'AUTH_RATE_LIMIT'))).toBe('AUTH_RATE_LIMIT')
    expect(authErrorCode(new Error('untrusted server text'))).toBe('OPERATION_FAILED')
    for (const cause of [undefined, null, 'untrusted text', { code: 'lower-case text' }, { code: 401 }]) {
      expect(authErrorCode(cause)).toBe('OPERATION_FAILED')
    }
    const empty = render(<ErrorMessage code={undefined} t={t} />)
    expect(empty.container.textContent).toBe(''); empty.unmount()
  })
})
