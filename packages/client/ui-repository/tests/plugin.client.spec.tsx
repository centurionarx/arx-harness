// @vitest-environment jsdom
import './dialog-platform.client.ts'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Service } from '@arx-ai/cordis'
import Loader from '@arx-ai/cordis-plugin-loader'
import Include from '@arx-ai/cordis-plugin-include'
import { SlotRegistry, createSnapshotStore, type ClientContext, type WorkspaceListState } from '@arx-ai/arx-client-runtime/client'
import type { PropsRuntime, PropsRenderSlots } from '@arx-ai/arx-client-ui-slots'
import { LocaleRuntime } from '@arx-ai/arx-client-locale/client'
import { bindSnapshotSelector, makeTranslate } from '@arx-ai/arx-client-test-runtime'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as Plugin from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import type { RepositoryInjected, RepositoryProps } from '../src/client/props.ts'
import { createRepositoryViewStore } from '../src/client/store.ts'
import { pt } from '../src/client/locales.ts'
import { inspection, status, wid } from './fixtures.client.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { cleanup(); for (const dispose of cleanups.splice(0)) await dispose() })
it('Loader installs the entry, unwraps Remote failures, and disposes the declaration-owned contribution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arx-client-repository-'))
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  type RemoteRepository = ClientContext['remote']['repository']
  const inspect = vi.fn<RemoteRepository['inspect']>()
    .mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'REPOSITORY_NOT_FOUND', details: {} } })
    .mockResolvedValue({ ok: true, value: inspection })
  const remote: RemoteRepository = {
    inspect, status: async () => ({ ok: true, value: status }),
    diff: async request => ({ ok: true, value: { ...request, binary: false, text: 'unified patch' } }),
  }
  class RemoteService extends Service { constructor(serviceCtx: Context) { super(serviceCtx, 'remote') } }
  const fixtures = { apply(fixtureCtx: Context) {
    new RemoteService(fixtureCtx)
    fixtureCtx.provide('remote.repository', remote)
    fixtureCtx.provide('locale', new LocaleRuntime(fixtureCtx))
  } }
  type RootOwnerProps = PropsRuntime<'root'> & PropsRenderSlots<'sidebar.repository'>
  const RootOwner = ({ renderSlot }: RootOwnerProps) =>
    <>{renderSlot('sidebar.repository', { wide: true, expandSidebar: () => {} })}</>
  const owner = { inject: ['slots'], apply(ownerCtx: Context) {
    ownerCtx.slots.register({ name: 'root', children: { 'sidebar.repository': { kind: 'single', scope: 'root' } } }, RootOwner)
  } }
  const modules = new Map<string, unknown>([['slots', SlotRegistry], ['fixtures', fixtures], ['owner', owner], ['repository-ui', Plugin]])
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([{ name: 'slots' }, { name: 'fixtures' }, { name: 'repository-ui' }, { name: 'owner' }]))
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error('unexpected fixture module')
    return modules.get(specifier)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const entry = ctx.slots.entries('sidebar.repository')[0]!
  expect(entry.locale).toBe('repository')
  const face = (entry.inject as unknown as () => RepositoryInjected)()
  const store = createRepositoryViewStore().create()
  const workspaces = createSnapshotStore<WorkspaceListState>({
    items: [{ workspaceId: wid('one'), path: '/work/one', title: 'Workspace one', sessionIds: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
    archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true, recentWorkspaceId: undefined,
  })
  const Component = entry.component as (props: RepositoryProps) => React.JSX.Element
  const view = render(<Component renderSlot={() => null} wide expandSidebar={() => {}} useSessions={() => { throw new Error('unused') }}
    useWorkspaces={bindSnapshotSelector(workspaces)} useStore={bindSnapshotSelector(store)} actions={store.actions}
    useRepository={bindSnapshotSelector(face.hooks.repository)} t={makeTranslate(pt)}
    select={(id) => { face.select(id) }} refresh={() => face.refresh()} show={request => face.show(request)}
    close={() => { face.close() }} cancel={() => { face.cancel() }} />)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'one' } })
  await screen.findByText(pt.notRepository)
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  await screen.findByText('Preparados (1)')
  fireEvent.click(screen.getByRole('button', { name: 'Preparados: same.ts' }))
  await screen.findByText('unified patch')
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
  await act(async () => { ctx.emit('connection/reset'); await Promise.resolve() })
  await screen.findByText(pt.stale)
  const pluginEntry = [...ctx.loader.entries()].find(row => row.options.name === 'repository-ui')!
  view.unmount()
  await act(async () => { await pluginEntry.fiber!.dispose() })
  expect(ctx.slots.entries('sidebar.repository')).toHaveLength(0)
  expect(ctx.slots.spec('sidebar.repository')).toBeDefined()
  const calls = inspect.mock.calls.length
  await face.refresh()
  expect(inspect).toHaveBeenCalledTimes(calls)
  nodeApply()
})
