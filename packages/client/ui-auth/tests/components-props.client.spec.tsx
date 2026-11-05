// @vitest-environment jsdom
/** Components rendered over fake slot props, so each interaction is observable without a server or timers. */
import { useSyncExternalStore, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { AdminRoot, AdminUsers, AdminModules, AdminAccount } from '../src/client/Admin.tsx'
import { UserBrowser } from '../src/client/UserBrowser.tsx'
import { UserHome, UserHomeAccount } from '../src/client/UserHome.tsx'
import { PublicRoot, PasswordForm, Account, AccountFooter } from '../src/client/forms.tsx'
import { createAdminStore, createUserBrowserStore } from '../src/client/stores.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const asProps = <C extends (props: never) => ReactNode>(_component: C, value: object): Parameters<C>[0] =>
  value as Parameters<C>[0]
const t = (key: string, options?: object): string => options === undefined ? key : key + ':' + JSON.stringify(options)
const uuid = (): string => crypto.randomUUID()
const silent = (): Promise<void> => Promise.resolve()
interface Observed<S> {
  store: {
    getSnapshot: () => S
    subscribe: (fn: () => void) => () => void
  }
}
function useStoreOf<S>(handle: Observed<S>) {
  return <R,>(selector: (snapshot: S) => R): R =>
    useSyncExternalStore(handle.store.subscribe, () => selector(handle.store.getSnapshot()))
}
function observable<S>(initial: S) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    set(next: S) { value = next; for (const fn of [...listeners]) fn() },
  }
}
const slot = (_name: string, _props: object, options: { entryKey: string }): ReactNode => <p data-testid="slot">{options.entryKey}</p>

const adminRow = (overrides: Record<string, unknown> = {}) => ({
  userId: uuid(), username: 'ana', email: 'ana@x.test', role: 'USER', status: 'ACTIVE',
  mustChangePassword: false, grants: [] as string[], passwordEstablished: true, ...overrides,
})
const storedModules = [
  { id: 'alpha', label: 'Alpha', operations: ['own.read'] },
  { id: 'beta', label: 'Beta', operations: ['own.write'] },
]

describe('administration views', () => {
  function adminHandle() { return createAdminStore().create() }
  const asLoaded = (handle: ReturnType<typeof adminHandle>, users: unknown[], modules: unknown[], cursor?: string): void => {
    handle.actions.loaded(users as never, modules as never, cursor, false)
  }

  it('switches the administrative page from the navigation and renders the selected key', async () => {
    const handle = adminHandle()
    const refresh = vi.fn(), logout = vi.fn(() => Promise.reject(new Error('offline')))
    const props = asProps(AdminRoot, { useStore: useStoreOf(handle), actions: handle.actions, refresh, logout, t, renderSlot: slot })
    render(<AdminRoot {...props} />)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('slot').textContent).toBe('users')
    fireEvent.click(screen.getByRole('button', { name: 'modules' }))
    expect(screen.getByTestId('slot').textContent).toBe('modules')
    expect(screen.getByRole('button', { name: 'modules' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'account' }))
    expect(screen.getByTestId('slot').textContent).toBe('account')
    fireEvent.click(screen.getByRole('button', { name: 'signout' }))
    await Promise.resolve()
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('pages further users and modules through the stored cursor', () => {
    const handle = adminHandle()
    asLoaded(handle, [adminRow()], [], 'next-page')
    const refresh = vi.fn()
    const view = render(<AdminUsers {...asProps(AdminUsers, { useStore: useStoreOf(handle), refresh, t })} />)
    fireEvent.click(screen.getByRole('button', { name: 'more' }))
    expect(refresh).toHaveBeenLastCalledWith('next-page')
    view.unmount()
    render(<AdminModules {...asProps(AdminModules, { useStore: useStoreOf(handle), refresh, t })} />)
    expect(screen.queryByText('noModules')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'more' }))
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenLastCalledWith('next-page')
  })

  it('enables module grant edits only for a selected active user', () => {
    const handle = adminHandle()
    const active = adminRow({ grants: ['alpha'] }), deleted = adminRow({ username: 'gone', status: 'DELETED' })
    asLoaded(handle, [active, deleted], storedModules)
    const modules = vi.fn()
    render(<AdminModules {...asProps(AdminModules, { useStore: useStoreOf(handle), refresh: vi.fn(), modules, t })} />)
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.every(box => box.disabled && !box.checked)).toBe(true)
    expect(screen.queryByText('gone')).toBeNull()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: active.userId } })
    const enabled = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(enabled.map(box => box.checked)).toEqual([true, false])
    fireEvent.click(enabled[1]!)
    expect(modules).toHaveBeenLastCalledWith(active.userId, ['alpha', 'beta'])
    fireEvent.click(enabled[0]!)
    expect(modules).toHaveBeenLastCalledWith(active.userId, [])
  })

  it('wraps the shared account form for the administrator and the HTTP-only user', () => {
    const principal = { username: 'adm', email: 'adm@x.test', grants: [] }
    const auth = observable({ principal })
    const props = { useAuth: <R,>(selector: (view: typeof auth extends { getSnapshot(): infer V } ? V : never) => R) =>
      useSyncExternalStore(auth.subscribe, () => selector(auth.getSnapshot())), t, change: vi.fn(), logout: vi.fn(() => silent()) }
    const first = render(<AdminAccount {...asProps(AdminAccount, props)} />)
    expect(screen.queryByText('adm@x.test')).not.toBeNull()
    first.unmount()
    render(<UserHomeAccount {...asProps(UserHomeAccount, props)} />)
    expect(screen.queryByText('adm')).not.toBeNull()
  })
})

describe('user home', () => {
  it('switches between the project and account pages and signs out, swallowing a rejected sign-out', async () => {
    const logout = vi.fn(() => Promise.reject(new Error('offline')))
    render(<UserHome {...asProps(UserHome, { t, logout, renderSlot: slot })} />)
    expect(screen.getByTestId('slot').textContent).toBe('projects')
    fireEvent.click(screen.getAllByRole('button', { name: 'account' })[0]!)
    expect(screen.getByTestId('slot').textContent).toBe('account')
    fireEvent.click(screen.getAllByRole('button', { name: 'projects' })[0]!)
    expect(screen.getByTestId('slot').textContent).toBe('projects')
    fireEvent.click(screen.getByRole('button', { name: 'signout' }))
    await Promise.resolve()
    expect(logout).toHaveBeenCalledTimes(1)
  })
})

describe('owner browser view', () => {
  const sessionId = uuid(), otherSession = uuid(), projectId = uuid(), workspaceId = uuid()
  function setup(overrides: Record<string, unknown> = {}, prepare?: (actions: ReturnType<typeof createUserBrowserStore>['create'] extends () => infer R ? R extends { actions: infer A } ? A : never : never) => void) {
    const handle = createUserBrowserStore().create()
    handle.actions.projects([{ projectId, name: 'Proj', createdAt: 1 }] as never, 'pc', false)
    handle.actions.select(projectId)
    handle.actions.workspaces([{ workspaceId, projectId, name: 'Work', createdAt: 1, grouped: true }] as never, 'wc', false)
    handle.actions.sessions([{ sessionId, projectId, workspaceId, createdAt: 1, nextSeq: 3, title: 'First', grouped: false }] as never, 'sc', false)
    prepare?.(handle.actions)
    const props = {
      useStore: useStoreOf(handle), actions: handle.actions, t, projectRuntimeAvailable: true,
      refreshProjects: vi.fn(), selectProject: vi.fn(), createProject: vi.fn(), createWorkspace: vi.fn(),
      moreWorkspaces: vi.fn(), moreSessions: vi.fn(), resume: vi.fn(), fork: vi.fn(), history: vi.fn(),
      export: vi.fn(), deleteSession: vi.fn(), ungroup: vi.fn(), rename: vi.fn(), openWorkspace: vi.fn(),
      expandSidebar: vi.fn(), ...overrides,
    }
    const view = render(<UserBrowser {...asProps(UserBrowser, props)} />)
    return { handle, props, view }
  }

  it('drives every project, workspace and session command from the rendered controls', () => {
    const { props } = setup()
    expect(props.refreshProjects).toHaveBeenCalledWith()
    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: projectId } })
    expect(props.selectProject).toHaveBeenCalledWith(projectId)
    fireEvent.click(screen.getAllByRole('button', { name: 'more' })[0]!)
    expect(props.refreshProjects).toHaveBeenLastCalledWith('pc')
    fireEvent.change(screen.getByLabelText('projectName'), { target: { value: '  Brand new  ' } })
    fireEvent.submit(screen.getByLabelText('projectName').closest('form')!)
    expect(props.createProject).toHaveBeenCalledWith('Brand new')
    fireEvent.change(screen.getByLabelText('workspaceName'), { target: { value: ' Desk ' } })
    fireEvent.submit(screen.getByLabelText('workspaceName').closest('form')!)
    expect(props.createWorkspace).toHaveBeenCalledWith('Desk')
    fireEvent.click(screen.getByRole('button', { name: 'openWorkspace' }))
    expect(props.openWorkspace).toHaveBeenCalledWith(workspaceId)
    fireEvent.click(screen.getByRole('button', { name: 'ungroup' }))
    expect(props.ungroup).toHaveBeenCalledWith(workspaceId)
    const session = screen.getByText('First').closest('li')!
    for (const [label, command] of [['resume', 'resume'], ['fork', 'fork'], ['viewHistory', 'history'], ['exportHistory', 'export']] as const) {
      fireEvent.click(within(session).getByRole('button', { name: label }))
      expect(props[command]).toHaveBeenCalledWith(sessionId)
    }
    const more = screen.getAllByRole('button', { name: 'more' })
    expect(more).toHaveLength(3)
    fireEvent.click(more[1]!)
    expect(props.moreWorkspaces).toHaveBeenCalledWith('wc')
    fireEvent.click(more[2]!)
    expect(props.moreSessions).toHaveBeenCalledWith('sc')
    expect(screen.queryByText('storedRecords:{"count":3}')).not.toBeNull()
  })

  it('asks for confirmation before deleting a session and renames through an inline form', () => {
    const { props } = setup()
    const session = screen.getByText('First').closest('li')!
    fireEvent.click(within(session).getByRole('button', { name: 'deleteSession' }))
    expect(props.deleteSession).not.toHaveBeenCalled()
    expect(screen.queryByText('deleteNote')).not.toBeNull()
    fireEvent.click(within(session).getByRole('button', { name: 'confirmDeleteSession' }))
    expect(props.deleteSession).toHaveBeenCalledWith(sessionId)
    expect(screen.queryByText('deleteNote')).toBeNull()
    fireEvent.click(within(session).getByRole('button', { name: 'rename' }))
    const field = within(session).getByLabelText('rename') as HTMLInputElement
    expect(field.value).toBe('First')
    fireEvent.change(field, { target: { value: ' Second ' } })
    fireEvent.submit(field.closest('form')!)
    expect(props.rename).toHaveBeenCalledWith(sessionId, 'Second')
    expect(within(session).queryByLabelText('rename')).toBeNull()
  })

  it('shows empty states, a loading message and the runtime restriction', () => {
    const empty = setup({ projectRuntimeAvailable: false }, (actions) => {
      actions.workspaces([], undefined, false); actions.sessions([], undefined, false); actions.projects([], undefined, false)
    })
    expect(screen.queryByText('noProjects')).not.toBeNull()
    expect(screen.queryByText('noWorkspaces')).not.toBeNull()
    expect(screen.queryByText('noSessions')).not.toBeNull()
    expect(screen.queryByText('serverSaved')).not.toBeNull()
    act(() => { empty.handle.actions.pending() })
    expect(screen.queryByText('loading')).not.toBeNull()
    act(() => { empty.handle.actions.fail('FORBIDDEN') })
    expect(screen.queryByText('unavailable')).not.toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('forbidden')
    cleanup()
    setup({ projectRuntimeAvailable: false })
    expect(screen.getByRole('button', { name: 'openWorkspace' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'resume' })).toHaveProperty('disabled', true)
  })

  it('shows the project chooser without workspace or history sections until a project is selected', () => {
    const handle = createUserBrowserStore().create()
    handle.actions.projects([{ projectId, name: 'Proj', createdAt: 1 }] as never, undefined, false)
    render(<UserBrowser {...asProps(UserBrowser, { useStore: useStoreOf(handle), actions: handle.actions, t, projectRuntimeAvailable: true,
      refreshProjects: vi.fn(), selectProject: vi.fn() })} />)
    expect(screen.getByRole('combobox')).toHaveProperty('value', '')
    expect(screen.queryByText('workspaces')).toBeNull()
    expect(screen.queryByText('history')).toBeNull()
  })

  it('collapses to an expander in a narrow sidebar and expands on click', () => {
    const { props } = setup({ wide: false })
    fireEvent.click(screen.getByRole('button', { name: 'projects' }))
    expect(props.expandSidebar).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('combobox')).toBeNull()
    cleanup()
    setup({ wide: true })
    expect(screen.queryByRole('combobox')).not.toBeNull()
  })

  describe('history dialog', () => {
    const lines = [
      JSON.stringify({ type: 'session', id: 'hidden' }), JSON.stringify({ type: 'message', text: 'shown' }),
      'null', '"scalar"', 'not json',
    ].join('\n')
    const open = (overrides: Record<string, unknown> = {}) => setup(overrides, (actions) => {
      actions.history(sessionId as never, lines, 'next', false)
    })

    it('projects only displayable records, pages further content, and closes from the button or Escape', () => {
      const { props, handle } = open()
      const dialog = screen.getByRole('dialog')
      const text = dialog.querySelector('pre')!.textContent
      expect(text.split('\n')).toEqual([JSON.stringify({ type: 'message', text: 'shown' }), 'null', '"scalar"'])
      fireEvent.click(within(dialog).getByRole('button', { name: 'more' }))
      expect(props.history).toHaveBeenCalledWith(sessionId, 'next')
      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(handle.store.getSnapshot().history).toBeUndefined()
      act(() => { handle.actions.history(otherSession as never, 'x', undefined, false) })
      const second = screen.getByRole('dialog')
      expect(within(second).queryByRole('button', { name: 'more' })).toBeNull()
      fireEvent.click(within(second).getByRole('button', { name: 'close' }))
      expect(handle.store.getSnapshot().history).toBeUndefined()
    })

    it('cycles focus inside the dialog with Tab and Shift+Tab and ignores other keys', () => {
      open()
      const dialog = screen.getByRole('dialog')
      const [close, more] = within(dialog).getAllByRole('button') as HTMLButtonElement[]
      expect(document.activeElement).toBe(close)
      fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(more)
      fireEvent.keyDown(dialog, { key: 'Tab' })
      expect(document.activeElement).toBe(close)
      more!.focus()
      fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(more)
      close!.focus()
      fireEvent.keyDown(dialog, { key: 'Tab' })
      expect(document.activeElement).toBe(close)
      fireEvent.keyDown(dialog, { key: 'a' })
      expect(document.activeElement).toBe(close)
    })

    it('returns focus to the opener when closed, unless the opener has left the document', () => {
      const { handle, view } = setup()
      const opener = screen.getByRole('button', { name: 'viewHistory' })
      opener.focus()
      act(() => { handle.actions.history(sessionId as never, 'a', undefined, false) })
      expect(document.activeElement).not.toBe(opener)
      act(() => { handle.actions.closeHistory() })
      expect(document.activeElement).toBe(opener)
      act(() => { handle.actions.history(sessionId as never, 'a', undefined, false) })
      const refocus = vi.spyOn(opener, 'focus')
      view.container.remove()
      act(() => { handle.actions.closeHistory() })
      expect(refocus).not.toHaveBeenCalled()
    })
  })
})

describe('credential forms', () => {
  const principal = { username: 'ana', email: 'ana@x.test', grants: ['alpha', 'beta'] }
  const pending = <T,>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => { resolve = res })
    return { promise, resolve }
  }
  function publicProps(view: unknown, overrides: Record<string, unknown> = {}, route = 'login') {
    const auth = observable(view)
    return { auth, props: {
      t, initialRoute: route,
      useAuth: <R,>(selector: (snapshot: never) => R) => useSyncExternalStore(auth.subscribe, () => selector(auth.getSnapshot() as never)),
      login: vi.fn(() => silent()), forgot: vi.fn(() => silent()), reset: vi.fn(() => silent()), accept: vi.fn(() => silent()),
      change: vi.fn(() => silent()), logout: vi.fn(() => Promise.reject(new Error('offline'))), returnToEntry: vi.fn(),
      ...overrides,
    } }
  }
  const fill = (label: string, value: string): void => { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }

  it.each(['reset', 'invitation'] as const)('submits the %s password with its form revision', async (route) => {
    const { props } = publicProps({ phase: 'login', recovery: { revision: 4, phase: 'ready', route } })
    render(<PublicRoot {...asProps(PublicRoot, props)} />)
    fill('newPassword', 'Secret-1'); fill('confirmPassword', 'Secret-1')
    fireEvent.submit(screen.getByLabelText('newPassword').closest('form')!)
    await screen.findByText('passwordSaved')
    const command = route === 'reset' ? props.reset : props.accept
    expect(command).toHaveBeenCalledWith('Secret-1', 4)
  })

  it('ignores a second submission while the first is still running', async () => {
    const gate = pending<undefined>()
    const { props } = publicProps({ phase: 'login' }, { login: vi.fn(() => gate.promise) })
    render(<PublicRoot {...asProps(PublicRoot, props)} />)
    fill('identifier', 'ana'); fill('password', 'pw')
    const form = screen.getByLabelText('identifier').closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(props.login).toHaveBeenCalledTimes(1)
    gate.resolve(undefined)
    await screen.findByText('passwordSaved')
  })

  it('offers sign-out while a first password is required or the account is pending, swallowing sign-out failures', async () => {
    const first = publicProps({ phase: 'change-password' })
    const view = render(<PublicRoot {...asProps(PublicRoot, first.props)} />)
    fireEvent.click(screen.getByRole('button', { name: 'signout' }))
    await Promise.resolve()
    expect(first.props.logout).toHaveBeenCalledWith(0)
    view.unmount()
    const waiting = publicProps({ phase: 'pending', recovery: { revision: 2, phase: 'ready' } })
    render(<PublicRoot {...asProps(PublicRoot, waiting.props)} />)
    expect(screen.queryByText('pending')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'signout' }))
    await Promise.resolve()
    expect(waiting.props.logout).toHaveBeenCalledWith(2)
  })

  it('shows the own account with grants, an empty-grants notice, and a failure-tolerant sign-out', async () => {
    const logout = vi.fn(() => Promise.reject(new Error('offline')))
    const withGrants = publicProps({ principal }, { logout })
    const view = render(<Account {...asProps(Account, withGrants.props)} />)
    expect(screen.queryByText('alpha, beta')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'signout' }))
    await Promise.resolve()
    expect(logout).toHaveBeenCalledTimes(1)
    view.unmount()
    const anonymous = publicProps({ principal: undefined })
    const hidden = render(<Account {...asProps(Account, anonymous.props)} />)
    expect(hidden.container.textContent).toBe('')
    hidden.unmount()
    const none = publicProps({ principal: { ...principal, grants: [] } })
    render(<Account {...asProps(Account, none.props)} />)
    expect(screen.queryByText('noGrants')).not.toBeNull()
  })

  it('rejects a password confirmation mismatch without calling the server', async () => {
    const change = vi.fn(() => silent())
    render(<PasswordForm t={t} change={change} />)
    fill('currentPassword', 'old'); fill('newPassword', 'one'); fill('confirmPassword', 'two')
    fireEvent.submit(screen.getByLabelText('currentPassword').closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toBe('mismatch')
    expect(change).not.toHaveBeenCalled()
  })

  describe('account dialog from the sidebar footer', () => {
    const footer = (wide: boolean) => {
      const { props } = publicProps({ principal })
      return render(<AccountFooter {...asProps(AccountFooter, { ...props, wide })} />)
    }

    it('shows a compact trigger in a narrow sidebar and opens the dialog', () => {
      footer(false)
      const trigger = screen.getByRole('button', { name: 'account' })
      expect(trigger.textContent).toBe('◉')
      fireEvent.click(trigger)
      expect(screen.queryByRole('dialog')).not.toBeNull()
    })

    it('cycles focus with Tab and Shift+Tab, closes on Escape, and restores focus to the trigger', () => {
      footer(true)
      const trigger = screen.getByRole('button', { name: 'account' })
      fireEvent.click(trigger)
      const dialog = screen.getByRole('dialog')
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')]
      const first = focusable[0]!, last = focusable.at(-1)!
      expect(dialog.contains(document.activeElement)).toBe(true)
      first.focus()
      fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(last)
      fireEvent.keyDown(dialog, { key: 'Tab' })
      expect(document.activeElement).toBe(first)
      last.focus()
      fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(last)
      first.focus()
      fireEvent.keyDown(dialog, { key: 'Tab' })
      expect(document.activeElement).toBe(first)
      fireEvent.keyDown(dialog, { key: 'x' })
      expect(screen.queryByRole('dialog')).not.toBeNull()
      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(trigger)
    })

    it('leaves focus alone when the trigger has left the document before the dialog closes', () => {
      const { container } = footer(true)
      const trigger = screen.getByRole('button', { name: 'account' })
      fireEvent.click(trigger)
      const refocus = vi.spyOn(trigger, 'focus')
      container.remove()
      fireEvent.click(within(container).getByRole('button', { name: 'close' }))
      expect(within(container).queryByRole('dialog')).toBeNull()
      expect(refocus).not.toHaveBeenCalled()
    })
  })
})
