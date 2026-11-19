// @vitest-environment jsdom
import type { Context } from '@arx-ai/cordis'
import * as modulesClient from '@arx-ai/arx-client-modules/client'
import type {
  ClientBundleRegistration, ClientModuleCreateOptions, ClientModuleLoaderTarget, ClientModuleSystem, ArxWindow,
  WebBootEntry,
} from '@arx-ai/arx-client-modules/client'
import { assertCompositionManifest } from '@arx-ai/arx-client-modules/src/client/manifest.ts'
import { BrowserAuthClient, type AuthBoundary, type AuthRevocationHandoff } from '@arx-ai/arx-client-ui-auth/browser'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest'
import { AppWebEntry } from '../src/boot.ts'
import { verifiedComposition } from '../src/composition.ts'

vi.mock('@arx-ai/arx-client-modules/src/client/manifest.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('@arx-ai/arx-client-modules/src/client/manifest.ts')>()
  return { ...original, assertCompositionManifest: vi.fn() }
})

vi.mock('../src/composition.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/composition.ts')>()
  return { ...original, verifiedComposition: vi.fn(original.verifiedComposition) }
})

const MODULES_ID = '@arx-ai/arx-client-modules'
const CONNECTION_ID = '@arx-ai/arx-client-connection'
type Win = ArxWindow & { __ARX_CLIENT_ACCESS_MODE__?: unknown; __ARX_CLIENT_COMPOSITION__?: unknown }
const win = globalThis as Win
const moduleFace = modulesClient as unknown as Record<string, unknown>

const PUBLIC_STATE = { authenticated: false, audience: 'user' }
const ADMIN_STATE = {
  authenticated: true, audience: 'admin', generation: 3,
  principal: { role: 'MASTER_ADMIN', status: 'ACTIVE', mustChangePassword: false, grants: [] },
}

interface FakeAuth {
  dispose: ReturnType<typeof vi.fn>
  checkLogoutGuard: ReturnType<typeof vi.fn>
  transportConfig: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
}
interface Handoff extends AuthRevocationHandoff { settle: (value: boolean) => void; dispose: Mock<() => void> }

type Boundary = (reason: AuthBoundary, confirmation?: AuthRevocationHandoff) => void
let boundary: Boundary
let fakeLocation: { pathname: string; href: string; reload: ReturnType<typeof vi.fn>; assign: ReturnType<typeof vi.fn> }
let auth: FakeAuth
let bootstrap: MockInstance<typeof BrowserAuthClient.bootstrap>
let container: HTMLElement
let mounts: Array<{ unmount: ReturnType<typeof vi.fn> }>
let target: ClientModuleLoaderTarget

function handoff(persistent: boolean): Handoff {
  let settle!: (value: boolean) => void
  const confirmed = new Promise<boolean>((resolve) => { settle = resolve })
  return { persistent, confirmed, settle, dispose: vi.fn() }
}

function setPath(pathname: string): void {
  fakeLocation.pathname = pathname
  fakeLocation.href = `http://localhost${pathname}`
}

beforeEach(() => {
  fakeLocation = { pathname: '/', href: 'http://localhost/', reload: vi.fn(), assign: vi.fn() }
  vi.stubGlobal('location', fakeLocation)
  auth = {
    dispose: vi.fn(),
    checkLogoutGuard: vi.fn(() => 'admitted'),
    transportConfig: vi.fn(() => ({ accessMode: 'authenticated', csrfToken: 'tok' })),
    start: vi.fn(),
  }
  vi.spyOn(BrowserAuthClient, 'clearRecoveryTransfer').mockImplementation(() => {})
  bootstrap = vi.spyOn(BrowserAuthClient, 'bootstrap').mockImplementation(async (onBoundary) => {
    boundary = onBoundary
    return { state: PUBLIC_STATE as never, auth: auth as never }
  })
  container = document.createElement('div')
  document.body.append(container)
  win.__ARX_CLIENT_ACCESS_MODE__ = 'authenticated'
  win.__ARX_CLIENT_COMPOSITION__ = { kind: 'public', audience: 'user' }
  mounts = []
  installRenderer([{ id: 'renderer', url: '/renderer.js', rev: '1' }])
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.mocked(assertCompositionManifest).mockReset()
  delete win.__ARX_BOOT__
  delete win.__ModuleLoader__
  delete win.__ARX_CLIENT_ACCESS_MODE__
  delete win.__ARX_CLIENT_COMPOSITION__
  delete (globalThis as { __ARX_TRANSPORT__?: unknown }).__ARX_TRANSPORT__
  document.body.innerHTML = ''
})

/** Facade whose create drops the composition option; the real system is reused for loading. */
function installRenderer(entries: WebBootEntry[], extra: Record<string, ClientBundleRegistration['factory']> = {}): void {
  const pendingQueue: ClientBundleRegistration[] = []
  const created: ClientModuleCreateOptions[] = []
  target = {
    mode: 'queue',
    pendingQueue,
    load: (registration) => { pendingQueue.push(registration) },
    create: (options: ClientModuleCreateOptions): ClientModuleSystem => {
      created.push(options)
      const { composition: _composition, signal: _signal, ...rest } = options
      return modulesClient.createClientModuleSystem(target, { id: MODULES_ID, exports: moduleFace }, {
        ...rest,
        loadBundle: async (url: string) => {
          const id = entries.find(entry => entry.url === url)?.id ?? ''
          const factory = extra[id] ?? (id === 'renderer' ? rendererFactory : () => ({ apply: () => {} }))
          target.load({ id, factory })
        },
      })
    },
  }
  Object.assign(target, { created })
  win.__ModuleLoader__ = target
  win.__ARX_BOOT__ = { rev: 'graph', entries }
}

const rendererFactory: ClientBundleRegistration['factory'] = () => ({
  apply: (ctx: Context) => {
    ctx.reflect.provide('uiRenderer', {
      mount: (element: HTMLElement) => {
        element.textContent = 'mounted'
        const unmount = vi.fn()
        mounts.push({ unmount })
        return unmount
      },
    })
  },
})

function createdOptions(): ClientModuleCreateOptions[] {
  return (target as unknown as { created: ClientModuleCreateOptions[] }).created
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('authenticated boot admission', () => {
  it.each([
    ['a client transport hook', () => { (globalThis as { __ARX_TRANSPORT__?: unknown }).__ARX_TRANSPORT__ = {} }],
    ['a fixture query parameter', () => { fakeLocation.href = 'http://localhost/?fixture=1' }],
  ])('closes the tree when %s is present', async (_name, setup) => {
    setup()
    const entry = new AppWebEntry(container)
    await entry.run()
    expect(container.querySelector('[data-arx-auth-boundary]')?.getAttribute('data-arx-auth-boundary')).toBe('unavailable')
    expect(bootstrap).not.toHaveBeenCalled()
    await entry.dispose()
  })

  it('closes the tree when a loadBundle seam is supplied', async () => {
    const entry = new AppWebEntry(container, { loadBundle: async () => {} })
    await entry.run()
    expect(container.textContent).toContain('Não foi possível validar sua sessão')
    await entry.dispose()
  })

  it('disposes the auth client when the entry is disposed during bootstrap', async () => {
    let release!: () => void
    bootstrap.mockImplementation(async (onBoundary) => {
      boundary = onBoundary
      await new Promise<void>((resolve) => { release = resolve })
      return { state: PUBLIC_STATE as never, auth: auth as never }
    })
    const entry = new AppWebEntry(container)
    const running = entry.run()
    await entry.dispose()
    release()
    await running
    expect(auth.dispose).toHaveBeenCalledOnce()
    expect(auth.start).not.toHaveBeenCalled()
  })

  it('closes the tree when the pathname changed during bootstrap', async () => {
    bootstrap.mockImplementation(async () => {
      setPath('/elsewhere')
      return { state: PUBLIC_STATE as never, auth: auth as never }
    })
    const entry = new AppWebEntry(container)
    await entry.run()
    expect(container.textContent).toContain('Não foi possível validar sua sessão')
    expect(auth.dispose).toHaveBeenCalled()
    await entry.dispose()
  })

  it('closes the tree when the composition marker is stale', async () => {
    win.__ARX_CLIENT_COMPOSITION__ = { kind: 'admin', audience: 'admin' }
    const entry = new AppWebEntry(container)
    await entry.run()
    expect(container.textContent).toContain('Não foi possível validar sua sessão')
    await entry.dispose()
  })

  it('closes the tree when the composition does not match the boot manifest', async () => {
    vi.mocked(assertCompositionManifest).mockImplementationOnce(() => { throw new Error('rejected module') })
    const entry = new AppWebEntry(container)
    await entry.run()
    expect(container.querySelector('[data-arx-auth-boundary]')?.getAttribute('data-arx-auth-boundary')).toBe('unavailable')
    await entry.dispose()
  })

  it.each([
    [false, 'A saída anterior não foi confirmada. O acesso permanece fechado.'],
    [true, 'O acesso permanece fechado nesta página.'],
  ])('keeps access closed when the logout guard blocks admission (storageUnavailable=%s)', async (storage, text) => {
    auth.checkLogoutGuard.mockReturnValue(storage ? 'storage-unavailable' : 'blocked')
    const entry = new AppWebEntry(container)
    await entry.run()
    const notice = container.querySelector('[data-arx-auth-boundary="logout-blocked"]')
    expect(notice?.textContent).toContain(text)
    notice?.querySelector('button')?.click()
    expect(fakeLocation.assign).toHaveBeenCalledWith('/reset')
    await entry.dispose()
  })
})

describe('authenticated boot success', () => {
  it('provides the verified composition and auth client and mounts the application', async () => {
    win.__ARX_CLIENT_COMPOSITION__ = { kind: 'admin', audience: 'admin', generation: 3 }
    bootstrap.mockImplementation(async (onBoundary) => {
      boundary = onBoundary
      return { state: ADMIN_STATE as never, auth: auth as never }
    })
    const entry = new AppWebEntry(container)
    await entry.run()
    expect(container.textContent).toBe('mounted')
    expect(createdOptions()[0]?.composition).toEqual({ kind: 'admin', audience: 'admin', generation: 3, scope: 'application' })
    expect(createdOptions()[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(auth.start).toHaveBeenCalledOnce()
    await entry.dispose()
    expect(mounts[0]?.unmount).toHaveBeenCalledOnce()
    expect(auth.dispose).toHaveBeenCalled()
  })

  it('passes the auth transport configuration to the connection entry only', async () => {
    const configs: unknown[] = []
    installRenderer([
      { id: CONNECTION_ID, url: '/connection.js', rev: '1' },
      { id: 'renderer', url: '/renderer.js', rev: '1' },
    ], { [CONNECTION_ID]: () => ({ apply: (_ctx: Context, config: unknown) => { configs.push(config) } }) })
    const entry = new AppWebEntry(container)
    await entry.run()
    expect(configs).toEqual([{ accessMode: 'authenticated', csrfToken: 'tok' }])
    expect(auth.transportConfig).toHaveBeenCalledOnce()
    await entry.dispose()
  })

  describe('recovery admission callback', () => {
    async function startRecovery(path: string): Promise<(fresh: unknown, pathname: string) => void> {
      setPath(path)
      const entry = new AppWebEntry(container)
      await entry.run()
      await entry.dispose()
      return auth.start.mock.calls[0]?.[0] as (fresh: unknown, pathname: string) => void
    }

    it('admits a public application tree on the admitted recovery path', async () => {
      const admit = await startRecovery('/reset')
      vi.mocked(assertCompositionManifest).mockClear()
      expect(() => { admit(PUBLIC_STATE, '/reset') }).not.toThrow()
      expect(assertCompositionManifest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'public', scope: 'application' }))
    })

    it.each(['/', '/other'])('rejects recovery from the non-recovery path %s', async (path) => {
      const admit = await startRecovery(path)
      expect(() => { admit(PUBLIC_STATE, path) }).toThrow('recovery requires the admitted canonical pathname')
    })

    it('rejects recovery when the callback pathname differs', async () => {
      const admit = await startRecovery('/invite')
      expect(() => { admit(PUBLIC_STATE, '/reset') }).toThrow('recovery requires the admitted canonical pathname')
    })

    it('rejects recovery when the location moved', async () => {
      const admit = await startRecovery('/reset')
      setPath('/invite')
      expect(() => { admit(PUBLIC_STATE, '/reset') }).toThrow('recovery requires the admitted canonical pathname')
    })

    it('rejects recovery that is not a public application tree', async () => {
      const admit = await startRecovery('/reset')
      vi.mocked(verifiedComposition).mockReturnValueOnce({ kind: 'user', audience: 'user', scope: 'project' })
      expect(() => { admit(PUBLIC_STATE, '/reset') }).toThrow('recovery requires the public application tree')
    })
  })
})

describe('principal boundary handling', () => {
  async function mounted(): Promise<AppWebEntry> {
    const entry = new AppWebEntry(container)
    await entry.run()
    expect(container.textContent).toBe('mounted')
    return entry
  }

  it('retracts the mounted tree on pagehide without leaving a notice', async () => {
    const entry = await mounted()
    boundary('pagehide')
    expect(container.childNodes).toHaveLength(0)
    expect(mounts[0]?.unmount).toHaveBeenCalledOnce()
    expect(auth.dispose).toHaveBeenCalledOnce()
    await entry.dispose()
  })

  it('swallows a failure while disposing the retracted plugin tree', async () => {
    const entry = await mounted()
    const ctx = (entry as unknown as { ctx: Context }).ctx
    const dispose = vi.spyOn(ctx.fiber, 'dispose').mockRejectedValueOnce(new Error('teardown failed'))
    boundary('pagehide')
    await settle()
    expect(dispose).toHaveBeenCalledOnce()
    expect(container.childNodes).toHaveLength(0)
    await entry.dispose()
  })

  it('shows a retry notice and reloads on click for a logout boundary', async () => {
    const entry = await mounted()
    boundary('logout')
    expect(container.textContent).toContain('Sua sessão foi encerrada.')
    container.querySelector('button')?.click()
    expect(fakeLocation.reload).toHaveBeenCalledOnce()
    await entry.dispose()
  })

  it.each(['revoked', 'restore'] as const)('reloads the page after a %s boundary', async (reason) => {
    const entry = await mounted()
    boundary(reason)
    expect(fakeLocation.reload).not.toHaveBeenCalled()
    await settle()
    expect(fakeLocation.reload).toHaveBeenCalledOnce()
    await entry.dispose()
  })

  it('shows the blocked-logout notice when the boundary reports logout-blocked', async () => {
    const entry = await mounted()
    boundary('logout-blocked')
    expect(container.textContent).toContain('A saída anterior não foi confirmada.')
    await entry.dispose()
  })

  it('reloads after a pending logout is confirmed', async () => {
    const entry = await mounted()
    const confirmation = handoff(true)
    boundary('logout-pending', confirmation)
    expect(container.textContent).toBe('Encerrando sua sessão.')
    confirmation.settle(true)
    await settle()
    expect(fakeLocation.reload).toHaveBeenCalledOnce()
    await entry.dispose()
  })

  it('stays on the page after a non-pending logout is confirmed', async () => {
    const entry = await mounted()
    const confirmation = handoff(true)
    boundary('logout', confirmation)
    confirmation.settle(true)
    await settle()
    expect(fakeLocation.reload).not.toHaveBeenCalled()
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    expect(fakeLocation.reload).toHaveBeenCalledOnce()
    await entry.dispose()
  })

  it.each([
    [true, 'Não foi possível confirmar a saída. O acesso permanece fechado.'],
    [false, 'O acesso permanece fechado nesta página.'],
  ])('keeps access closed when the logout is unconfirmed (persistent=%s)', async (persistent, text) => {
    const entry = await mounted()
    const confirmation = handoff(persistent)
    boundary('logout-pending', confirmation)
    confirmation.settle(false)
    await settle()
    const notice = container.querySelector('[data-arx-auth-boundary]')
    expect(notice?.textContent).toContain(text)
    expect(fakeLocation.reload).not.toHaveBeenCalled()
    notice?.querySelector('button')?.click()
    expect(fakeLocation.assign).toHaveBeenCalledWith('/reset')
    await entry.dispose()
  })

  it('shows the storage notice immediately for a non-persistent handoff', async () => {
    const entry = await mounted()
    boundary('logout', handoff(false))
    expect(container.textContent).toContain('Habilite o armazenamento')
    await entry.dispose()
  })

  it('ignores a confirmation that a later boundary superseded', async () => {
    const entry = await mounted()
    const first = handoff(true)
    boundary('logout-pending', first)
    boundary('pagehide')
    first.settle(true)
    await settle()
    expect(first.dispose).toHaveBeenCalledOnce()
    expect(fakeLocation.reload).not.toHaveBeenCalled()
    await entry.dispose()
  })

  it('releases the pending revocation when the page is hidden', async () => {
    const entry = await mounted()
    const confirmation = handoff(true)
    boundary('logout-pending', confirmation)
    window.dispatchEvent(new Event('pagehide'))
    expect(confirmation.dispose).toHaveBeenCalledOnce()
    await entry.dispose()
  })

  it('reloads a restored page only while authenticated and not awaiting logout', async () => {
    const entry = await mounted()
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }))
    expect(fakeLocation.reload).not.toHaveBeenCalled()
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    expect(fakeLocation.reload).toHaveBeenCalledOnce()
    await entry.dispose()
  })

  it('does not reload a restored page while a blocked logout is awaited', async () => {
    const entry = await mounted()
    boundary('logout-blocked')
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    expect(fakeLocation.reload).not.toHaveBeenCalled()
    await entry.dispose()
  })

  it('closes a boundary raised before any tree exists without a context', async () => {
    const entry = new AppWebEntry(container)
    bootstrap.mockImplementation(async (onBoundary) => {
      onBoundary('logout')
      return { state: PUBLIC_STATE as never, auth: auth as never }
    })
    await entry.run()
    expect(container.textContent).toContain('Sua sessão foi encerrada.')
    await entry.dispose()
  })

  it('abandons the boot when a boundary fires while the loader starts', async () => {
    auth.start.mockImplementation(() => { queueMicrotask(() => { boundary('logout') }) })
    const entry = new AppWebEntry(container)
    await entry.run()
    expect(container.textContent).toContain('Sua sessão foi encerrada.')
    expect(mounts).toHaveLength(0)
    await entry.dispose()
  })

  it('abandons the boot when a boundary fires inside auth start', async () => {
    auth.start.mockImplementation(() => { boundary('logout') })
    const entry = new AppWebEntry(container)
    await entry.run()
    expect(mounts).toHaveLength(0)
    await entry.dispose()
  })
})
