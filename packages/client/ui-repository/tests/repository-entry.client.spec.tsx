// @vitest-environment jsdom
import './dialog-platform.client.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate, SlotTestRuntime } from '@arx-ai/arx-client-test-runtime'
import { LocaleRuntime } from '@arx-ai/arx-client-locale/client'
import * as RepositoryPlugin from '../src/client/index.ts'
import { createSnapshotStore, type ClientContext, type WorkspaceListState } from '@arx-ai/arx-client-runtime/client'
import type { GithubInspectionOwnerProps, RepositoryProps } from '../src/client/props.ts'
import { RepositoryController, type RepositoryReads } from '../src/client/controller.ts'
import { RepositoryEntry } from '../src/client/RepositoryEntry.tsx'
import { createRepositoryViewStore } from '../src/client/store.ts'
import { pt } from '../src/client/locales.ts'
import { deferred, inspection, reads, status, wid } from './fixtures.client.ts'
import type { RepositoryInspection } from '@arx-ai/arx-repository/types'

afterEach(cleanup)
function bench(overrides: Partial<RepositoryReads> = {}, renderSlot: RepositoryProps['renderSlot'] = () => null) {
  const controller = new RepositoryController(reads(overrides))
  const store = createRepositoryViewStore().create()
  const workspaces = createSnapshotStore<WorkspaceListState>({
    items: ['one', 'two'].map(id => ({ workspaceId: wid(id), path: '/work/' + id, title: id,
      sessionIds: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' })),
    archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true, recentWorkspaceId: undefined,
  })
  const props: RepositoryProps = {
    renderSlot,
    wide: true, expandSidebar: vi.fn(), useSessions: () => { throw new Error('unused') },
    useWorkspaces: bindSnapshotSelector(workspaces), useStore: bindSnapshotSelector(store), actions: store.actions,
    useRepository: bindSnapshotSelector(controller), t: makeTranslate(pt),
    select: (id) => { controller.select(id) }, refresh: () => controller.refresh(),
    show: request => controller.show(request), close: () => { controller.close() }, cancel: () => { controller.cancel() },
  }
  const view = render(<RepositoryEntry {...props} />)
  const choose = async (id = 'one') => { await act(async () => { fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: id } }) }) }
  const refresh = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await screen.findByText('Preparados (1)')
  }
  return { view, props, store, controller, workspaces, choose, refresh }
}
describe('repository presentation', () => {
  it('retargets the same Git reads through an optional child explicit workspace callback', async () => {
    const pending = deferred<RepositoryInspection>()
    type RemoteRepository = ClientContext['remote']['repository']
    const inspect = vi.fn<RemoteRepository['inspect']>(async () => ({ ok: true, value: await pending.promise }))
    const getStatus = vi.fn<RemoteRepository['status']>(async () => ({ ok: true, value: status }))
    const remote: RemoteRepository = {
      inspect, status: getStatus, diff: async request => ({ ok: true, value: { ...request, binary: false, text: '' } }),
    }
    const runtime = await SlotTestRuntime.create()
    const locale = new LocaleRuntime(runtime.ctx)
    locale.setLocale('pt')
    runtime.provide('locale', locale)
    runtime.slots.installLocale(locale)
    runtime.provide('remote', { repository: remote })
    runtime.provide('remote.repository', remote)
    await runtime.workspaces.update((draft) => {
      draft.items = ['one', 'two'].map(id => ({ workspaceId: wid(id), path: '/work/' + id, title: id,
        sessionIds: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' }))
    })
    await runtime.declare({ 'sidebar.repository': { kind: 'single', scope: 'root' } })
    await runtime.mount(RepositoryPlugin)
    const observed = vi.fn<(owner: GithubInspectionOwnerProps) => void>()
    const Child = (owner: GithubInspectionOwnerProps) => {
      observed(owner)
      return <div>
        <output aria-label="Child workspace">{owner.workspaceId ?? 'none'}</output>
        <button type="button" onClick={() => { owner.selectWorkspace(wid('two')) }}>Pair workspace two</button>
        <button type="button" onClick={() => { owner.selectWorkspace(null) }}>Clear pairing</button>
      </div>
    }
    runtime.slots.register({ name: 'repository.github' }, Child)
    const expandSidebar = vi.fn()
    const view = runtime.renderSlot('sidebar.repository', { wide: true, expandSidebar })
    expect(screen.getByLabelText('Child workspace').textContent).toBe('none')
    expect(observed.mock.calls[0]?.[0]).toMatchObject({ wide: true, expandSidebar })
    fireEvent.click(screen.getByRole('button', { name: 'Pair workspace two' }))
    await screen.findByText('Carregando repositório…')
    expect(screen.getByLabelText('Child workspace').textContent).toBe('two')
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('two')
    expect(inspect.mock.calls[0]?.[0]).toEqual({ workspaceId: wid('two') })
    expect(getStatus.mock.calls[0]?.[0]).toEqual({ workspaceId: wid('two') })
    await act(async () => { pending.resolve({ ...inspection, branch: 'paired-workspace' }) })
    await screen.findByText('paired-workspace')
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => { expect(inspect).toHaveBeenCalledTimes(2) })
    expect(inspect.mock.calls.at(-1)?.[0]).toEqual({ workspaceId: wid('two') })
    fireEvent.click(screen.getByRole('button', { name: 'Clear pairing' }))
    await waitFor(() => { expect(screen.getByLabelText('Child workspace').textContent).toBe('none') })
    expect(screen.getByRole('button', { name: 'Atualizar' }).hasAttribute('disabled')).toBe(true)
    const renders = observed.mock.calls.length
    view.update({ wide: false, expandSidebar })
    expect(screen.queryByLabelText('Child workspace')).toBeNull()
    expect(observed).toHaveBeenCalledTimes(renders)
    await runtime.dispose()
  })
  it('wraps only Tab boundaries among its own controls and leaves modified and interior navigation native', async () => {
    const b = bench()
    await b.choose()
    fireEvent.click(screen.getByRole('button', { name: 'Preparados: same.ts' }))
    const dialog = await screen.findByRole('dialog')
    const patch = await screen.findByText('<script>alert(1)</script>', { exact: false })
    const first = screen.getByRole('button', { name: 'Fechar' })
    const press = (options: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, ...options })
      fireEvent(dialog, event)
      return event.defaultPrevented
    }
    first.focus()
    expect(press({ shiftKey: true })).toBe(true)
    expect(document.activeElement).toBe(patch)
    expect(press()).toBe(true)
    expect(document.activeElement).toBe(first)
    expect(press()).toBe(false)
    patch.focus()
    expect(press({ shiftKey: true })).toBe(false)
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { key: 'Enter' }]) {
      expect(press(options)).toBe(false)
      expect(document.activeElement).toBe(patch)
    }
    b.view.unmount()
    await b.controller.dispose()
  })
  it('keeps loading and binary focus on the sole Close control and handles absence of enabled controls', async () => {
    const pending = deferred<Awaited<ReturnType<RepositoryReads['diff']>>>()
    const b = bench({ diff: () => pending.promise })
    await b.choose()
    const source = screen.getByRole('button', { name: 'Preparados: same.ts' })
    fireEvent.click(source)
    const dialog = await screen.findByRole('dialog')
    const closeButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Fechar' })
    const content = dialog.querySelector<HTMLElement>('[tabindex="-1"]')!
    const press = (shiftKey = false) => {
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
      fireEvent(dialog, event)
      return event.defaultPrevented
    }
    expect(document.activeElement).toBe(content)
    expect(press()).toBe(true)
    expect(document.activeElement).toBe(closeButton)
    content.focus()
    expect(press(true)).toBe(true)
    expect(document.activeElement).toBe(closeButton)
    expect(press()).toBe(true)
    expect(press(true)).toBe(true)
    closeButton.disabled = true
    expect(press()).toBe(false)
    expect(press(true)).toBe(false)
    closeButton.disabled = false
    await act(async () => { pending.resolve({ path: 'same.ts', side: 'staged', binary: true, text: '' }) })
    await screen.findByText('Arquivo binário — sem comparação textual')
    content.focus()
    expect(press()).toBe(true)
    expect(document.activeElement).toBe(closeButton)
    const cancelled = new Event('cancel', { cancelable: true })
    fireEvent(dialog, cancelled)
    expect(cancelled.defaultPrevented).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(source)
    b.view.unmount()
    await b.controller.dispose()
  })
  it('uses native modal methods, keeps queued old close events from dismissing an open dialog, and synchronizes native closure', async () => {
    const shown = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    const closed = vi.spyOn(HTMLDialogElement.prototype, 'close')
    const b = bench()
    await b.choose()
    const source = screen.getByRole('button', { name: 'Preparados: same.ts' })
    fireEvent.click(source)
    const dialog = await screen.findByRole('dialog', { name: 'Comparação somente leitura' }) as HTMLDialogElement
    expect(shown).toHaveBeenCalledOnce()
    expect(dialog.open).toBe(true)
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent(dialog, new Event('close'))
    expect(dialog.open).toBe(true)
    expect(b.store.getSnapshot().selectedFile?.side).toBe('staged')
    await act(async () => { dialog.close() })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(b.store.getSnapshot().selectedFile).toBeNull()
    expect(b.controller.getSnapshot().comparison).toBeNull()
    expect(document.activeElement).toBe(source)
    fireEvent.click(source)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(source)
    expect(closed).toHaveBeenCalled()
    b.view.unmount()
    await b.controller.dispose()
    shown.mockRestore()
    closed.mockRestore()
  })
  it('reads selection and selected remount once, leaves registry metadata changes alone, and supports manual refresh', async () => {
    const inspect = vi.fn(async () => inspection)
    const b = bench({ inspect })
    expect(screen.getByText('Selecione um workspace para inspecionar o repositório.')).toBeTruthy()
    expect(inspect).not.toHaveBeenCalled()
    await b.choose()
    expect(inspect).toHaveBeenCalledTimes(1)
    act(() => { b.workspaces.update((draft) => { draft.items[0]!.title = 'Updated title' }) })
    expect(screen.getByText('Updated title', { selector: 'strong' })).toBeTruthy()
    expect(inspect).toHaveBeenCalledTimes(1)
    b.view.unmount()
    const mounted = render(<RepositoryEntry {...b.props} />)
    await screen.findByText('Preparados (1)')
    expect(inspect).toHaveBeenCalledTimes(2)
    await b.refresh()
    expect(inspect).toHaveBeenCalledTimes(3)
    mounted.unmount()
    await b.controller.dispose()
  })
  it('renders registry loading/error, detached and unborn metadata, renames and an empty patch', async () => {
    const b = bench({ inspect: async () => ({ ...inspection, branch: null, head: null, aheadBehind: null,
      remotes: [{ name: 'origin', host: null, transport: null }] }),
    status: async () => ({ ...status, staged: [{ path: 'same.ts', originalPath: 'old.ts', xy: 'R.', submodule: 'N...' }],
      unstaged: [...status.unstaged, { path: 'sub', xy: 'M.', submodule: 'SC..' }] }),
    diff: async request => ({ ...request, binary: false, text: '' }),
    })
    act(() => { b.workspaces.update((draft) => { draft.state = 'loading'; draft.items = [] }) })
    expect(screen.getByText('Carregando workspaces…')).toBeTruthy()
    act(() => { b.workspaces.update((draft) => {
      draft.state = 'error'; draft.error = { code: 'internal', message: 'Registry offline', details: {} }
    }) })
    expect(screen.getByText('Registry offline')).toBeTruthy()
    act(() => { b.workspaces.update((draft) => {
      draft.state = 'idle'; draft.error = null
      draft.items = [{ workspaceId: wid('one'), title: 'one', path: '/work/one', sessionIds: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' }]
    }) })
    await b.choose()
    await b.refresh()
    expect(screen.getByText('HEAD destacado')).toBeTruthy()
    expect(screen.getByText('Nenhum commit ainda')).toBeTruthy()
    expect(screen.getByText('old.ts → same.ts')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Modificados: sub' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Preparados: same.ts' }))
    await screen.findByText('Nenhuma diferença textual')
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    b.view.unmount()
    await b.controller.dispose()
  })
  it('shows a pending comparison and closes it on collapse before a late response', async () => {
    const pending = deferred<Awaited<ReturnType<RepositoryReads['diff']>>>()
    let signal: AbortSignal | undefined
    const b = bench({ diff: (_request, supplied) => { signal = supplied; return pending.promise } })
    await b.choose()
    await b.refresh()
    fireEvent.click(screen.getByRole('button', { name: 'Preparados: same.ts' }))
    await screen.findByText('Carregando repositório…')
    b.props.wide = false
    b.view.rerender(<RepositoryEntry {...b.props} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(signal?.aborted).toBe(true)
    await act(async () => { pending.resolve({ path: 'same.ts', side: 'staged', binary: false, text: 'late' }) })
    expect(screen.queryByText('late')).toBeNull()
    b.view.unmount()
    await b.controller.dispose()
  })
  it('shows separate counters and sends the correct same-path staged/unstaged/untracked side', async () => {
    const port = reads()
    const diff = vi.fn<RepositoryReads['diff']>((request, signal) => port.diff(request, signal))
    const b = bench({ diff })
    await b.choose()
    expect(screen.getByText('Preparados (1)')).toBeTruthy()
    await b.refresh()
    expect(screen.getByText('Modificados (1)')).toBeTruthy()
    expect(screen.getByText('Novos (1)')).toBeTruthy()
    expect(screen.getByText('Conflitos (1)')).toBeTruthy()
    expect(screen.getByText('github.com', { exact: false })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Conflitos: conflict.ts' }).hasAttribute('disabled')).toBe(true)
    for (const [label, path, side] of [['Preparados', 'same.ts', 'staged'], ['Modificados', 'same.ts', 'unstaged'], ['Novos', 'new.ts', 'untracked']] as const) {
      fireEvent.click(screen.getByRole('button', { name: label + ': ' + path }))
      await screen.findByRole('dialog', { name: 'Comparação somente leitura' })
      const patch = await screen.findByText('<script>alert(1)</script>', { exact: false })
      expect(patch.textContent).toBe('@@ -1 +1 @@\n-old\n+<script>alert(1)</script>\n')
      expect(document.querySelector('script')).toBeNull()
      expect(diff.mock.calls.at(-1)?.[0]).toEqual({ workspaceId: 'one', path, side })
      const cancelled = new Event('cancel', { bubbles: false, cancelable: true })
      fireEvent(screen.getByRole('dialog'), cancelled)
      expect(cancelled.defaultPrevented).toBe(true)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: label + ': ' + path }))
    }
    b.view.unmount()
    await b.controller.dispose()
  })
  it('renders binary notices and retries failed comparisons', async () => {
    const diff = vi.fn().mockRejectedValueOnce(new Error('REPOSITORY_STATUS_CHANGED')).mockResolvedValue({ path: 'same.ts', side: 'staged', binary: true, text: '' })
    const b = bench({ diff })
    await b.choose()
    await b.refresh()
    fireEvent.click(screen.getByRole('button', { name: 'Preparados: same.ts' }))
    await screen.findByText('REPOSITORY_STATUS_CHANGED')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await screen.findByText('Arquivo binário — sem comparação textual')
    expect(screen.queryByRole('textbox')).toBeNull()
    b.view.unmount()
    await b.controller.dispose()
  })
  it('cancels on workspace switch and unmount; stale responses never display old identity', async () => {
    const old = deferred<RepositoryInspection>()
    let signal: AbortSignal | undefined
    const b = bench({ inspect: (request, supplied) => {
      signal = supplied
      return request.workspaceId === wid('one') ? old.promise : Promise.resolve(inspection)
    } })
    await b.choose()
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(await screen.findByText('Carregando repositório…')).toBeTruthy()
    const previousSignal = signal
    await b.choose('two')
    expect(previousSignal?.aborted).toBe(true)
    await act(async () => { old.resolve({ ...inspection, branch: 'late-old' }); await Promise.resolve() })
    expect(screen.queryByText('late-old')).toBeNull()
    expect(screen.getByText('main')).toBeTruthy()
    expect(screen.getByText('Preparados (1)')).toBeTruthy()
    await b.choose('')
    expect(screen.getByRole('button', { name: 'Atualizar' }).hasAttribute('disabled')).toBe(true)
    b.view.unmount()
    await b.controller.dispose()
  })
  it('expands the collapsed rail through its owner and focuses the workspace selector', async () => {
    const b = bench()
    b.props.wide = false
    b.view.rerender(<RepositoryEntry {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: pt.expand }))
    expect(b.props.expandSidebar).toHaveBeenCalledOnce()
    b.props.wide = true
    b.view.rerender(<RepositoryEntry {...b.props} />)
    expect(document.activeElement).toBe(screen.getByRole('combobox'))
    b.view.unmount()
    await b.controller.dispose()
  })
  it('distinguishes empty workspaces, empty status, non-repositories, errors and reconnect staleness', async () => {
    const inspect = vi.fn().mockRejectedValueOnce(new Error('REPOSITORY_NOT_FOUND')).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(inspection)
    const b = bench({ inspect, status: async () => ({ staged: [], unstaged: [], untracked: [], unmerged: [] }) })
    await b.choose()
    await screen.findByText('Este workspace não tem um repositório Git')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await screen.findByText('Nenhuma alteração')
    act(() => { b.controller.invalidate() })
    await screen.findByText('Dados desatualizados. Atualize para continuar.')
    act(() => { b.workspaces.update((draft) => { draft.items = [] }) })
    await screen.findByText('Nenhum workspace registrado')
    await waitFor(() => { expect(b.store.getSnapshot().workspaceId).toBeNull() })
    b.view.unmount()
    await b.controller.dispose()
  })
})
