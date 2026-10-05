// @vitest-environment jsdom
import './dialog-platform.client.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { GithubEntry } from '../src/client/GithubEntry.tsx'
import { en, pt } from '../src/client/locales.ts'
import { account, deferred, gid, reads, repository, wid } from './fixtures.client.ts'
import { controllers, repositoryBench as bench } from './presentation.client.ts'
afterEach(async () => { cleanup(); for (const controller of controllers.splice(0)) await controller.dispose() })
describe('GitHub repository navigation', () => {
  it('clears explicit choices when the human selects the empty option', async () => {
    const b = bench(); await b.refresh()
    fireEvent.change(screen.getByRole('combobox', { name: en.workspace }), { target: { value: 'one' } })
    fireEvent.change(screen.getByRole('combobox', { name: en.repository }), { target: { value: '9' } })
    fireEvent.change(screen.getByRole('combobox', { name: en.repository }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: en.workspace }), { target: { value: '' } })
    expect(b.store.getSnapshot()).toEqual({ repositoryId: null })
  })
  it('escapes login and repository metadata as plaintext without images or links', async () => {
    const b = bench(); await b.refresh()
    expect(screen.getAllByText(repository.owner + '/' + repository.name)).toHaveLength(2)
    expect(b.view.container.querySelector('script,img,a')).toBeNull()
  })
  it('requires both explicit choices and clears repository association on workspace change', async () => {
    const b = bench(); await b.refresh()
    expect(screen.queryByText(en.pair, { exact: false })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Repo' }), { target: { value: '9' } })
    expect(screen.queryByText(en.pair, { exact: false })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: 'one' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Repo' }), { target: { value: '9' } })
    expect(screen.getByText(en.pair, { exact: false })).toBeTruthy()
    expect(b.props.selectWorkspace).toHaveBeenLastCalledWith(wid('one'))
    expect(screen.getByTestId('git-workspace').textContent).toBe('one')
    expect(b.store.getSnapshot()).toEqual({ repositoryId: gid('9') })
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: 'two' } })
    expect(b.props.selectWorkspace).toHaveBeenLastCalledWith(wid('two'))
    expect(screen.getByTestId('git-workspace').textContent).toBe('two')
    expect(screen.queryByText(en.pair, { exact: false })).toBeNull(); expect(b.store.getSnapshot().repositoryId).toBeNull()
  })
  it('leaves owner workspace changes to the parent and clears unavailable repository choices only', async () => {
    const b = bench(); await b.refresh()
    b.view.rerender(<GithubEntry {...b.props} workspaceId={wid('missing')} />)
    await act(async () => { b.store.actions.selectRepository(gid('missing')) })
    expect(b.store.getSnapshot()).toEqual({ repositoryId: null })
    expect(b.props.selectWorkspace).not.toHaveBeenCalled()
  })
  it('loads explicit pages with binary privacy metadata and nullable branches', async () => {
    const read = vi.fn(reads().repositories).mockResolvedValueOnce({ repositories: [repository], nextPage: 2 }).mockResolvedValueOnce({ repositories: [{ ...repository, id: gid('10'), name: 'private-repo', private: true, defaultBranch: null }] })
    const b = bench({ repositories: read }); await b.refresh(); fireEvent.click(screen.getByRole('button', { name: en.more }))
    await screen.findByText(en.private); expect(screen.getByText(en.branch + ': ' + en.none)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.more }).hasAttribute('disabled')).toBe(true)
  })
  it('shows an empty account repository page and retryable read failure', async () => {
    const read = vi.fn(reads().account).mockRejectedValueOnce(new Error('bad login')).mockResolvedValue(account)
    const b = bench({ account: read, repositories: async () => ({ repositories: [] }) }); await b.refresh()
    expect(screen.getAllByText(en.readError).length).toBeGreaterThan(0)
    await b.refresh()
    expect(screen.getByText(en.noRepositories)).toBeTruthy()
  })
  it('renders PT-BR labels and leaves collapsed expansion to the parent Git control', () => {
    const b = bench({}, 'pt')
    expect(screen.getByRole('button', { name: pt.refresh })).toBeTruthy()
    b.view.rerender(<GithubEntry {...b.props} wide={false} />)
    expect(b.view.container.textContent).toBe('')
    expect(b.props.expandSidebar).not.toHaveBeenCalled()
  })
  it.each([
    { language: 'en' as const, globalName: 'Settings', matcher: /settings/i, shortcut: 'Configure GitHub' },
    { language: 'pt' as const, globalName: 'Configurações', matcher: /configurações/i, shortcut: 'Configurar GitHub' },
  ])('keeps the global $globalName trigger unambiguous beside the account shortcut', ({ language, globalName, matcher, shortcut }) => {
    const b = bench({}, language)
    b.view.rerender(<><button type="button">{globalName}</button><GithubEntry {...b.props} /></>)
    expect(screen.getByRole('button', { name: matcher }).textContent).toBe(globalName)
    fireEvent.click(screen.getByRole('button', { name: shortcut }))
    expect(b.props.openSettings).toHaveBeenCalledOnce()
  })
  it('contains no account authorization workflow and opens the registered settings section', () => {
    const b = bench()
    expect(screen.queryByRole('button', { name: en.authorize })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.openSettings }))
    expect(b.props.openSettings).toHaveBeenCalledOnce()
  })
  it('shows current metadata invalidation and pending refresh', async () => {
    const late = deferred<Awaited<ReturnType<ReturnType<typeof reads>['account']>>>()
    const b = bench({ account: () => late.promise })
    await act(async () => { b.controller.invalidate() })
    expect(screen.getByText(en.stale)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    expect(screen.getByText(en.loading)).toBeTruthy()
    await act(async () => { late.resolve(account) })
  })
})
