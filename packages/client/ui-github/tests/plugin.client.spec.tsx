// @vitest-environment jsdom
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Service } from '@arx-ai/cordis'
import Loader from '@arx-ai/cordis-plugin-loader'
import Include from '@arx-ai/cordis-plugin-include'
import { SlotRegistry, type ClientContext } from '@arx-ai/arx-client-runtime/client'
import { LocaleRuntime } from '@arx-ai/arx-client-locale/client'
import type { PropsRuntime, PropsRenderSlots } from '@arx-ai/arx-client-ui-slots'
import type { AuthorizationAttemptView, RpcResponse } from '@arx-ai/arx-api-remotes/client'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'
import { expect, it, vi } from 'vitest'
import * as Plugin from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import { apply as invariantApply } from '../src/invariant.ts'
import type { GithubAccountInjected, GithubInjected } from '../src/client/props.ts'
import { account, attempt, auth, deferred, reply, repository } from './fixtures.client.ts'

it('Loader binds the actual declaration, unwraps typed Remote errors and removes/redeclares the contribution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arx-client-github-'))
  const ctx = new Context()
  try {
    type RemoteGithub = ClientContext['remote']['github']
    const accountRead = vi.fn<RemoteGithub['account']>()
      .mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'fixture read failure', details: {} } })
      .mockResolvedValue({ ok: true, value: account })
    const remote: RemoteGithub = { account: accountRead, repositories: async () => ({ ok: true, value: { repositories: [repository] } }) }
    const carrier = auth()
    const credentialListeners = new Map<string, () => void>()
    const unsubscribe = vi.fn()
    class RemoteService extends Service {
      constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
      $on(event: string, listener: () => void) { credentialListeners.set(event, listener); return unsubscribe }
    }
    const fixtures = { apply(fixtureCtx: Context) {
      new RemoteService(fixtureCtx)
      fixtureCtx.provide('remote.github', remote)
      fixtureCtx.provide('locale', new LocaleRuntime(fixtureCtx))
      fixtureCtx.provide('connection', { api: { authorization: carrier } })
    } }
    type OwnerProps = PropsRuntime<'root'> & PropsRenderSlots<'repository.github' | 'settings.section'>
    const Owner = ({ renderSlot }: OwnerProps) => <>{renderSlot('repository.github', { wide: true, expandSidebar: () => {}, workspaceId: null, selectWorkspace: () => {} })}{renderSlot('settings.section', { close: () => {} })}</>
    const owner = { inject: ['slots'], apply(ownerCtx: Context) {
      ownerCtx.slots.register({ name: 'root', children: { 'repository.github': { kind: 'single', scope: 'root' }, 'settings.section': { kind: 'list', scope: 'root' } } }, Owner)
    } }
    const modules = new Map<string, unknown>([['slots', SlotRegistry], ['fixtures', fixtures], ['owner', owner], ['github-ui', Plugin]])
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, JSON.stringify([{ name: 'slots' }, { name: 'fixtures' }, { name: 'github-ui' }, { name: 'owner' }]))
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    // Loader's module resolver erases heterogeneous plugin types; this fixture implements import only.
    ctx.loader.internal = { version: 'v2', async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected fixture module')
      return modules.get(specifier)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    expect(ctx.slots.entries('settings.section').filter(row => row.options.id === 'github')).toHaveLength(1)
    const entry = ctx.slots.entries('repository.github')[0]!
    expect(entry.locale).toBe('github')
    // Registry retains the heterogeneous inject entry; this package owns its fixture's concrete face.
    const face = (entry.inject as unknown as () => GithubInjected)()
    const settingsEntry = ctx.slots.entries('settings.section')[0]!
    expect(settingsEntry.locale).toBe('github')
    expect(settingsEntry.options.id).toBe('github')
    const label = settingsEntry.options.label
    expect(typeof label === 'function' ? label() : label).toBe('GitHub')
    const settingsFace = (settingsEntry.inject as unknown as () => GithubAccountInjected)()
    expect(settingsFace.hooks.github).toBe(face.hooks.github)
    expect(face.hooks).not.toHaveProperty('authorization')
    expect(face).not.toHaveProperty('begin')
    const onSettings = vi.fn(); ctx.on('settings/open-section', onSettings)
    face.openSettings(); expect(onSettings).toHaveBeenCalledWith('github')
    const unmount = settingsFace.watch()
    await face.refresh(); expect(face.hooks.github.getSnapshot()).toMatchObject({ phase: 'error', error: 'read' })
    await face.refresh(); expect(face.hooks.github.getSnapshot().account?.state).toBe('connected')
    await face.more(); await settingsFace.refresh(); await settingsFace.begin(); await settingsFace.submit('unit-human-draft'); await settingsFace.cancel()
    credentialListeners.get('credentials/reference-updated')!(); expect(face.hooks.github.getSnapshot().phase).toBe('stale')
    await face.refresh()
    credentialListeners.get('credentials/record-updated')!(); expect(face.hooks.github.getSnapshot().phase).toBe('stale')
    await face.refresh(); ctx.emit('connection/reset'); expect(face.hooks.github.getSnapshot().account).toBeNull()
    const ownerEntry = [...ctx.loader.entries()].find(row => row.options.name === 'owner')!
    await ownerEntry.fiber!.dispose()
    expect(ctx.slots.entries('repository.github')).toHaveLength(0)
    expect(ctx.slots.entries('settings.section')).toHaveLength(0)
    expect(settingsFace.hooks.authorization.getSnapshot().attempt).toBeNull()
    expect(unsubscribe).not.toHaveBeenCalled()
    const calls = accountRead.mock.calls.length; await settingsFace.refresh(); expect(accountRead).toHaveBeenCalledTimes(calls + 1)
    await settingsFace.begin(); expect(carrier.begin).toHaveBeenCalledTimes(1)
    await ctx.plugin(owner)
    await Promise.resolve(); await Promise.resolve()
    expect(ctx.slots.entries('repository.github')).toHaveLength(1)
    expect(ctx.slots.entries('settings.section').filter(row => row.options.id === 'github')).toHaveLength(1)
    const pluginEntry = [...ctx.loader.entries()].find(row => row.options.name === 'github-ui')!
    await pluginEntry.fiber!.dispose()
    expect(ctx.slots.entries('repository.github')).toHaveLength(0)
    expect(ctx.slots.spec('repository.github')).toBeDefined()
    expect(ctx.slots.entries('settings.section')).toHaveLength(0)
    expect(unsubscribe).toHaveBeenCalledTimes(2)
    const disposedReads = accountRead.mock.calls.length
    await settingsFace.refresh(); expect(accountRead).toHaveBeenCalledTimes(disposedReads)
    unmount(); nodeApply()
    const unregister = vi.fn(); const register = vi.fn((_name: string, _install: InvariantInstaller) => unregister)
    const invariantCtx = new Context(); invariantCtx.provide('invariants', { register })
    await invariantApply(invariantCtx)
    expect(register).toHaveBeenCalledWith('@arx-ai/arx-client-ui-github', expect.any(Function))
    const install = register.mock.calls[0]![1]; await install(invariantCtx, (message) => { throw new Error(message) })
    await invariantCtx.fiber.dispose()
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})

it('settings exists without repository declaration and each owner can independently remove and redeclare its contribution', async () => {
  const ctx = new Context()
  const carrier = auth()
  const repositoryRead = vi.fn(async () => ({ ok: true as const, value: { repositories: [repository] } }))
  const unsubscribe = vi.fn()
  const lateCancellation = deferred<RpcResponse<{ attempt: AuthorizationAttemptView }>>()
  class RemoteService extends Service {
    constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
    $on(_event: string, _listener: () => void) { return unsubscribe }
  }
  try {
    await ctx.plugin(SlotRegistry)
    await ctx.plugin({ apply(fixtureCtx: Context) {
      new RemoteService(fixtureCtx)
      fixtureCtx.provide('remote.github', { account: async () => ({ ok: true, value: account }), repositories: repositoryRead })
      fixtureCtx.provide('locale', new LocaleRuntime(fixtureCtx))
      fixtureCtx.provide('connection', { api: { authorization: carrier } })
    } })
    type ShellProps = PropsRuntime<'root'> & PropsRenderSlots<'sidebar.repository' | 'sidebar.settings'>
    const Shell = ({ renderSlot }: ShellProps) => <>
      {renderSlot('sidebar.repository', { wide: true, expandSidebar: () => {} })}
      {renderSlot('sidebar.settings', { wide: true })}
    </>
    type SettingsOwnerProps = PropsRuntime<'sidebar.settings'> & PropsRenderSlots<'settings.section'>
    const SettingsOwner = ({ renderSlot }: SettingsOwnerProps) => <>{renderSlot('settings.section', { close: () => {} })}</>
    type RepositoryOwnerProps = PropsRuntime<'sidebar.repository'> & PropsRenderSlots<'repository.github'>
    const RepositoryOwner = ({ renderSlot }: RepositoryOwnerProps) => <>{renderSlot('repository.github', {
      wide: true, expandSidebar: () => {}, workspaceId: null, selectWorkspace: () => {},
    })}</>
    await ctx.plugin({ inject: ['slots'], apply(rootCtx: Context) {
      rootCtx.slots.register({
        name: 'root', children: {
          'sidebar.repository': { kind: 'single', scope: 'root' },
          'sidebar.settings': { kind: 'single', scope: 'root' },
        },
      }, Shell)
    } })
    const githubFiber = ctx.plugin(Plugin)
    await githubFiber.await()
    const settingsOwner = { inject: ['slots'], apply(ownerCtx: Context) {
      ownerCtx.slots.register({
        name: 'sidebar.settings', children: { 'settings.section': { kind: 'list', scope: 'root' } },
      }, SettingsOwner)
    } }
    const repositoryOwner = { inject: ['slots'], apply(ownerCtx: Context) {
      ownerCtx.slots.register({
        name: 'sidebar.repository', children: { 'repository.github': { kind: 'single', scope: 'root' } },
      }, RepositoryOwner)
    } }
    const settingsFiber = ctx.plugin(settingsOwner); await settingsFiber.await()
    expect(ctx.slots.entries('settings.section').filter(row => row.options.id === 'github')).toHaveLength(1)
    expect(ctx.slots.spec('repository.github')).toBeUndefined()
    const settingsEntry = ctx.slots.entries('settings.section')[0]!
    const accountFace = (settingsEntry.inject as unknown as () => GithubAccountInjected)()
    const oldPage = accountFace.watch()
    await accountFace.refresh()
    expect(accountFace.hooks.github.getSnapshot().account?.state).toBe('connected')
    expect(repositoryRead).not.toHaveBeenCalled()
    await accountFace.begin()
    const repositoryFiber = ctx.plugin(repositoryOwner); await repositoryFiber.await()
    const repositoryEntry = ctx.slots.entries('repository.github')[0]!
    const repositoryFace = (repositoryEntry.inject as unknown as () => GithubInjected)()
    expect(repositoryFace.hooks.github).toBe(accountFace.hooks.github)
    await repositoryFiber.dispose()
    expect(ctx.slots.entries('repository.github')).toHaveLength(0)
    expect(ctx.slots.entries('settings.section')).toHaveLength(1)
    expect(accountFace.hooks.authorization.getSnapshot().attempt?.id).toBe(attempt.id)
    expect(carrier.cancel).not.toHaveBeenCalled()
    const freshRepositoryFiber = ctx.plugin(repositoryOwner); await freshRepositoryFiber.await()
    expect(ctx.slots.entries('repository.github')).toHaveLength(1)
    await settingsFiber.dispose()
    expect(ctx.slots.entries('settings.section')).toHaveLength(0)
    expect(ctx.slots.entries('repository.github')).toHaveLength(1)
    expect(accountFace.hooks.authorization.getSnapshot().attempt).toBeNull()
    expect(carrier.cancel).toHaveBeenCalledOnce()
    const freshSettingsFiber = ctx.plugin(settingsOwner); await freshSettingsFiber.await()
    expect(ctx.slots.entries('settings.section').filter(row => row.options.id === 'github')).toHaveLength(1)
    const currentPage = accountFace.watch()
    await accountFace.begin()
    oldPage()
    expect(carrier.cancel).toHaveBeenCalledOnce()
    carrier.cancel.mockReturnValueOnce(lateCancellation.promise)
    let disposed = false
    const disposal = githubFiber.dispose().then(() => { disposed = true })
    await vi.waitFor(() => { expect(carrier.cancel.mock.calls.length).toBeGreaterThanOrEqual(2) })
    expect(disposed).toBe(false)
    expect(carrier.cancel.mock.calls.slice(1).every(call => call[0].attemptId === attempt.id)).toBe(true)
    lateCancellation.resolve(reply({ attempt: { ...attempt, state: 'cancelled' } }))
    await disposal
    expect(ctx.slots.entries('settings.section')).toHaveLength(0)
    expect(ctx.slots.entries('repository.github')).toHaveLength(0)
    expect(ctx.slots.spec('settings.section')).toBeDefined()
    expect(ctx.slots.spec('repository.github')).toBeDefined()
    expect(unsubscribe).toHaveBeenCalledTimes(2)
    currentPage()
  } finally {
    lateCancellation.resolve(reply({ attempt: { ...attempt, state: 'cancelled' } }))
    await ctx.fiber.dispose()
  }
})
