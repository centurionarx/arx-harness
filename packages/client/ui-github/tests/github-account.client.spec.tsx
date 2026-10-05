// @vitest-environment jsdom
import './dialog-platform.client.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { GithubAccountSection } from '../src/client/GithubAccountSection.tsx'
import { en, pt } from '../src/client/locales.ts'
import { account, attempt, deferred, reads, reply } from './fixtures.client.ts'
import { controllers, accountBench as bench } from './presentation.client.ts'
afterEach(async () => { cleanup(); for (const controller of controllers.splice(0)) await controller.dispose() })
describe('GitHub account settings', () => {
  it('uses visible refresh and reports private authorization failure without echoing raw errors', async () => {
    const b = bench()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.refresh })); await Promise.resolve() })
    b.carrier.begin.mockRejectedValueOnce(new Error('never echo secret-bearing exception'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.authorize })); await Promise.resolve() })
    expect(screen.getAllByText(en.authError).length).toBeGreaterThan(0)
    expect(b.view.container.textContent).not.toContain('never echo')
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
  })
  it('renders safe public notices and cancels a select prompt without a password field', async () => {
    const b = bench()
    b.carrier.begin.mockResolvedValue(reply({ attempt: { ...attempt, notice: { message: '<b>notice</b>' },
      prompt: { id: attempt.prompt!.id, kind: 'select', message: 'Pick', options: [{ id: 'yes', label: 'Yes' }] } } }))
    await b.open(); expect(screen.getByText('<b>notice</b>')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Pick' }), { target: { value: 'yes' } })
    fireEvent.click(screen.getByRole('button', { name: en.cancel })); expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('does not query on mount and disables authorization before explicit refresh', () => {
    const read = vi.fn(reads().account); bench({ account: read })
    expect(read).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: en.authorize }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(en.cold)).toBeTruthy()
  })
  it('shows unconfigured state and never calls generic auth', async () => {
    const b = bench({ account: async () => ({ state: 'unconfigured', writable: false }) }); await b.refresh()
    expect(screen.getByText(en.unconfigured)).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: en.authorize }))
    expect(b.carrier.begin).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('shows disconnected reference mode with disabled authorization', async () => {
    const b = bench({ account: async () => ({ state: 'disconnected', writable: false }) }); await b.refresh()
    expect(screen.getByText(en.disconnected)).toBeTruthy(); expect(screen.getByText(en.readonly)).toBeTruthy()
  })
  it('shows warning before PAT and clears password immediately on submission', async () => {
    const b = bench(); await b.open(); const input = screen.getByLabelText(en.pat) as HTMLInputElement
    expect(input.type).toBe('password'); expect(screen.getByText(en.warning)).toBeTruthy()
    fireEvent.change(input, { target: { value: 'private-human-draft' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.submit }))
      expect(input.value).toBe('')
      await Promise.resolve()
    })
    expect(b.carrier.submit.mock.calls[0]![0]).toEqual({ attemptId: attempt.id, promptId: attempt.prompt!.id, answer: 'private-human-draft' })
    expect(b.view.container.textContent).not.toContain('private-human-draft'); expect(screen.getByText(en.authorized)).toBeTruthy()
  })
  it('clears cancel drafts and returns focus to source before reopening', async () => {
    const b = bench(); await b.open(); fireEvent.change(screen.getByLabelText(en.pat), { target: { value: 'do-not-retain' } })
    const source = screen.getByRole('button', { name: en.authorize }); fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(source)
    await act(async () => { fireEvent.click(source); await Promise.resolve() }); expect(screen.getByLabelText<HTMLInputElement>(en.pat).value).toBe('')
  })
  it('clears secrets on credential invalidation and unmount', async () => {
    const b = bench(); await b.open(); fireEvent.change(screen.getByLabelText(en.pat), { target: { value: 'stale' } })
    await act(async () => { b.controller.invalidate() })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(en.stale)).toBeTruthy()
    expect(b.carrier.cancel.mock.calls[0]![0]).toEqual({ attemptId: attempt.id }); b.view.unmount()
  })
  it('wraps owned Tab edges only and handles native Escape cancellation', async () => {
    const b = bench()
    await b.open()
    const dialog = screen.getByRole('dialog')
    const input = screen.getByLabelText(en.pat)
    const cancel = within(dialog).getByRole('button', { name: en.cancel })
    const press = (options: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, ...options })
      fireEvent(dialog, event)
      return event.defaultPrevented
    }
    cancel.focus(); expect(press()).toBe(true); expect(document.activeElement).toBe(input)
    expect(press({ shiftKey: true })).toBe(true); expect(document.activeElement).toBe(cancel)
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { key: 'Enter' }]) expect(press(modifier)).toBe(false)
    input.focus(); expect(press()).toBe(false)
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true })); expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('clears the old draft on prompt revision and renders select prompts', async () => {
    const b = bench()
    b.carrier.begin.mockResolvedValue(reply({ attempt: { ...attempt, prompt: { id: attempt.prompt!.id, kind: 'select', message: 'Pick account', options: [{ id: 'yes', label: '<b>confirm</b>' }] } } }))
    await b.open(); expect(screen.getByRole('option', { name: '<b>confirm</b>' })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Pick account' }), { target: { value: 'yes' } })
    await act(async () => { fireEvent.submit(screen.getByRole('button', { name: en.submit }).closest('form')!); await Promise.resolve() })
    expect(b.carrier.submit.mock.calls[0]![0].answer).toBe('yes')
  })
  it('works without a workspace and leaves repositories out of account refresh', async () => {
    const repoRead = vi.fn(reads().repositories)
    const b = bench({ repositories: repoRead }, 'pt')
    expect(screen.getByRole('region', { name: pt.title })).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: pt.workspace })).toBeNull()
    expect(screen.queryByRole('combobox', { name: pt.repository })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: pt.refresh }))
    await screen.findByText(pt.connected)
    expect(repoRead).not.toHaveBeenCalled()
    expect(screen.getByText(account.account!.login, { exact: false })).toBeTruthy()
    await b.open()
    expect(screen.getByRole('dialog', { name: pt.authTitle })).toBeTruthy()
  })
  it('reports account read failure and loading without exposing a raw provider error', async () => {
    const read = vi.fn(reads().account).mockRejectedValueOnce(new Error('never echo secret provider error'))
    const b = bench({ account: read })
    await b.refresh(); expect(screen.getAllByText(en.readError).length).toBeGreaterThan(0)
    expect(b.view.container.textContent).not.toContain('secret provider error')
    const late = deferred<Awaited<ReturnType<ReturnType<typeof reads>['account']>>>()
    read.mockReturnValueOnce(late.promise)
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    expect(screen.getByText(en.loading)).toBeTruthy()
    await act(async () => { late.resolve(account) })
  })
  it('Escape is contained by the inner native dialog and keeps settings navigation mounted', async () => {
    const b = bench(); await b.open()
    const parentEscape = vi.fn(); document.addEventListener('keydown', parentEscape)
    try {
      const dialog = screen.getByRole('dialog')
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      fireEvent(dialog, event)
      expect(event.defaultPrevented).toBe(false)
      expect(parentEscape).not.toHaveBeenCalled()
      fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.getByRole('region', { name: en.title })).toBeTruthy()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: en.authorize }))
    } finally { document.removeEventListener('keydown', parentEscape) }
  })
  it('page exit cancels its attempt, clears its detached password and remounts with a fresh draft', async () => {
    const b = bench(); await b.open()
    const input = screen.getByLabelText<HTMLInputElement>(en.pat)
    fireEvent.change(input, { target: { value: 'page-private-draft' } })
    b.view.rerender(<div>Another settings section</div>)
    expect(b.carrier.cancel).toHaveBeenCalledWith({ attemptId: attempt.id }, expect.any(AbortSignal))
    expect(input.value).toBe('')
    expect(JSON.stringify(b.controller.getSnapshot())).not.toContain('page-private-draft')
    expect(JSON.stringify(b.controller.authorizationView.getSnapshot())).not.toContain('page-private-draft')
    expect(window.localStorage.length).toBe(0); expect(window.sessionStorage.length).toBe(0)
    b.view.rerender(<GithubAccountSection {...b.props} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.authorize })); await Promise.resolve() })
    expect(screen.getByLabelText<HTMLInputElement>(en.pat).value).toBe('')
  })
})
