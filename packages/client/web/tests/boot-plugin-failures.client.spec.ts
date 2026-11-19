// @vitest-environment jsdom
import type { Context } from '@arx-ai/cordis'
import * as modulesClient from '@arx-ai/arx-client-modules/client'
import type {
  ClientBundleRegistration, ClientModuleCreateOptions, ClientModuleLoaderTarget, ClientModuleSystem, ArxWindow,
  WebBootEntry,
} from '@arx-ai/arx-client-modules/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Loader from '@arx-ai/cordis-plugin-loader'
import { BootPage } from '../src/boot-page.ts'
import { AppWebEntry } from '../src/boot.ts'

const MODULES_ID = '@arx-ai/arx-client-modules'
const win = globalThis as ArxWindow
const moduleFace = modulesClient as unknown as Record<string, unknown>
type Factory = ClientBundleRegistration['factory']

afterEach(() => {
  vi.restoreAllMocks()
  delete win.__ARX_BOOT__
  delete win.__ModuleLoader__
  delete (globalThis as { __ARX_TRANSPORT__?: unknown }).__ARX_TRANSPORT__
  document.body.innerHTML = ''
})

const renderer: Factory = () => ({
  apply: (ctx: Context) => {
    ctx.reflect.provide('uiRenderer', {
      mount: (element: HTMLElement) => { element.textContent = 'mounted'; return () => {} },
    })
  },
})

interface Setup {
  factories: Record<string, Factory>
  loadBundle?: ClientModuleCreateOptions['loadBundle']
  wrap?: (system: ClientModuleSystem) => ClientModuleSystem
  entries?: WebBootEntry[]
}

/** Install a facade whose bundles resolve from `factories`; an absent factory makes the import fail. */
function install(setup: Setup): { options: ClientModuleCreateOptions[]; target: ClientModuleLoaderTarget } {
  const options: ClientModuleCreateOptions[] = []
  const entries = setup.entries ?? Object.keys(setup.factories).map(id => ({ id, url: `/${id}.js`, rev: '1' }))
  let current!: ClientModuleLoaderTarget
  /** Each create call gets its own queue-mode facade, as each module system boots once. */
  const fresh = (): ClientModuleLoaderTarget => {
    const pendingQueue: ClientBundleRegistration[] = []
    return {
      mode: 'queue',
      pendingQueue,
      load: (registration) => { pendingQueue.push(registration) },
      create: () => { throw new Error('unused') },
    }
  }
  const target: ClientModuleLoaderTarget = {
    mode: 'queue',
    pendingQueue: [],
    load: (registration) => { current.load(registration) },
    create: (given) => {
      options.push(given)
      const local = fresh()
      current = local
      const system = modulesClient.createClientModuleSystem(local, { id: MODULES_ID, exports: moduleFace }, {
        ...given,
        loadBundle: setup.loadBundle ?? (async (url) => {
          const id = entries.find(entry => entry.url === url)?.id ?? ''
          const factory = setup.factories[id]
          if (factory === undefined) throw new Error(`import failed for ${id}`)
          local.load({ id, factory })
        }),
      })
      return setup.wrap === undefined ? system : setup.wrap(system)
    },
  }
  win.__ModuleLoader__ = target
  win.__ARX_BOOT__ = { rev: 'graph', entries }
  return { options, target }
}

async function boot(): Promise<{ text: string; entry: AppWebEntry }> {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const container = document.createElement('div')
  document.body.append(container)
  const entry = new AppWebEntry(container)
  await entry.run()
  return { text: container.textContent, entry }
}

describe('entry activation audit', () => {
  it('reports a bundle that failed to import with the loader message', async () => {
    install({ factories: { renderer, broken: undefined as never } })
    const { text, entry } = await boot()
    expect(text).toContain('failed to import loader entry')
    expect(text).toContain('import failed for broken')
    await entry.dispose()
  })

  it('names the single service a pending entry waits for', async () => {
    install({ factories: { renderer, waiter: () => ({ inject: ['absent'], apply: () => {} }) } })
    const { text, entry } = await boot()
    expect(text).toContain('waiter: pending (waiting for service: absent)')
    expect(text).toContain('1 entry did not activate')
    await entry.dispose()
  })

  it('pluralises the services a pending entry waits for', async () => {
    install({ factories: { renderer, waiter: () => ({ inject: ['absentA', 'absentB'], apply: () => {} }) } })
    const { text, entry } = await boot()
    expect(text).toContain('waiter: pending (waiting for services: absentA, absentB)')
    await entry.dispose()
  })

  it('reports an entry whose apply threw', async () => {
    install({
      factories: { renderer, thrower: () => ({ apply: () => { throw new Error('apply exploded') } }) },
    })
    const { text, entry } = await boot()
    expect(text).toContain('apply exploded')
    await entry.dispose()
  })

  it('fails when no plugin provides the UI renderer', async () => {
    install({ factories: { plain: () => ({ apply: () => {} }) } })
    const { text, entry } = await boot()
    expect(text).toContain('UI renderer did not provide its mount service')
    await entry.dispose()
  })

  it('renders a non-Error failure as text', async () => {
    install({ factories: { renderer } })
    win.__ModuleLoader__ = { ...win.__ModuleLoader__!, create: () => { throw 'plain string failure' } }
    const { text, entry } = await boot()
    expect(text).toContain('plain string failure')
    await entry.dispose()
  })

  it('reports entries that are disposed or detached from the loader as not activated', async () => {
    install({
      factories: {
        renderer,
        disposed: () => ({ apply: (ctx: Context) => { void ctx.fiber.dispose() } }),
        detached: () => ({
          apply: (ctx: Context) => {
            const own = [...ctx.loader.entries()].find(candidate => candidate.options.name === 'detached')!
            void own._dispose()
          },
        }),
      },
    })
    const { text, entry } = await boot()
    expect(text).toContain('2 entries did not activate')
    expect(text).toContain('disposed: disposed')
    expect(text).toContain('detached: import failed (see console for the import error)')
    await entry.dispose()
  })

  it('reports a pending entry whose required service is withheld by its provider as waiting for unknown', async () => {
    install({
      factories: {
        renderer,
        gated: () => ({ apply: (ctx: Context) => { ctx.reflect.provide('gated', {}, () => false) } }),
        user: () => ({ inject: ['gated'], apply: () => {} }),
      },
    })
    const { text, entry } = await boot()
    expect(text).toContain('user: pending (waiting for services: unknown)')
    await entry.dispose()
  })
})

describe('transport hook and prefetch', () => {
  it('uses the injected transport loadBundle and skips HTTP prefetch', async () => {
    const prefetch = vi.fn(async () => {})
    const loadBundle = vi.fn(async (url: string) => {
      const target = win.__ModuleLoader__!
      target.load({ id: 'renderer', factory: renderer })
      expect(url).toBe('/renderer.js')
    })
    ;(globalThis as { __ARX_TRANSPORT__?: unknown }).__ARX_TRANSPORT__ = { loadBundle }
    install({
      factories: { renderer },
      entries: [{ id: 'renderer', url: '/renderer.js', rev: '1', immediately: true }],
      wrap: system => Object.assign(system, { prefetch }),
    })
    const { text, entry } = await boot()
    expect(text).toBe('mounted')
    expect(prefetch).not.toHaveBeenCalled()
    await entry.dispose()
  })

  it('keeps explicit seams ahead of the transport loadBundle', async () => {
    ;(globalThis as { __ARX_TRANSPORT__?: unknown }).__ARX_TRANSPORT__ = { loadBundle: async () => {} }
    const { options } = install({ factories: { renderer } })
    const seam = async (): Promise<void> => {}
    const container = document.createElement('div')
    const entry = new AppWebEntry(container, { loadBundle: seam })
    await entry.run()
    expect(options[0]?.loadBundle).toBe(seam)
    await entry.dispose()
  })

  it('keeps HTTP prefetch when the transport carries no loadBundle, swallowing prefetch failures', async () => {
    const prefetch = vi.fn(async () => { throw new Error('prefetch down') })
    ;(globalThis as { __ARX_TRANSPORT__?: unknown }).__ARX_TRANSPORT__ = {}
    install({
      factories: { renderer },
      entries: [
        { id: 'renderer', url: '/renderer.js', rev: '1', immediately: true },
        { id: 'later', url: '/later.js', rev: '1' },
      ],
      wrap: system => Object.assign(system, { prefetch }),
    })
    const { text, entry } = await boot()
    expect(prefetch).toHaveBeenCalledOnce()
    expect(prefetch).toHaveBeenCalledWith('renderer')
    expect(text).toContain('import failed for later')
    await entry.dispose()
  })
})

describe('supersession during boot', () => {
  it('stops after prefetch when the entry was disposed meanwhile', async () => {
    let release!: () => void
    const prefetch = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    install({
      factories: { renderer },
      entries: [{ id: 'renderer', url: '/renderer.js', rev: '1', immediately: true }],
      wrap: system => Object.assign(system, { prefetch }),
    })
    const container = document.createElement('div')
    const entry = new AppWebEntry(container)
    const running = entry.run()
    await Promise.resolve()
    await entry.dispose()
    release()
    await running
    expect(container.textContent).toBe('')
  })

  it('stops quietly when disposal races a bundle that is still loading', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    install({
      factories: { renderer },
      loadBundle: async (url) => {
        await gate
        win.__ModuleLoader__!.load({ id: url === '/renderer.js' ? 'renderer' : url, factory: renderer })
      },
      entries: [{ id: 'renderer', url: '/renderer.js', rev: '1' }],
    })
    const container = document.createElement('div')
    const entry = new AppWebEntry(container)
    const running = entry.run()
    await Promise.resolve()
    await entry.dispose()
    release()
    await running
    expect(container.textContent).toBe('')
  })

  it('abandons a boot that a newer run superseded while the loader was mounting', async () => {
    install({ factories: { renderer } })
    const container = document.createElement('div')
    document.body.append(container)
    const entry = new AppWebEntry(container)
    const first = entry.run()
    const second = entry.run()
    await Promise.all([first, second])
    expect(container.textContent).toBe('mounted')
    await entry.dispose()
  })

  it('abandons a boot that a newer run superseded while it awaited prefetch', async () => {
    install({ factories: { renderer } })
    const container = document.createElement('div')
    document.body.append(container)
    const entry = new AppWebEntry(container)
    let second: Promise<void> | undefined
    const original = Reflect.get(BootPage.prototype, 'setTotal')
    vi.spyOn(BootPage.prototype, 'setTotal').mockImplementationOnce(function (this: BootPage, total: number) {
      original.call(this, total)
      second = entry.run()
    })
    await entry.run()
    await second
    expect(container.textContent).toBe('mounted')
    await entry.dispose()
  })

  it('skips the remaining entries when a newer run starts while the first one is being created', async () => {
    install({ factories: { renderer, second: () => ({ apply: () => {} }) } })
    const container = document.createElement('div')
    document.body.append(container)
    const entry = new AppWebEntry(container)
    let newer: Promise<void> | undefined
    const original = Reflect.get(BootPage.prototype, 'setState')
    vi.spyOn(BootPage.prototype, 'setState').mockImplementation(function (this: BootPage, id, state) {
      original.call(this, id, state)
      if (state === 'loading' && newer === undefined) newer = entry.run()
    })
    await entry.run()
    await newer
    expect(container.textContent).toBe('mounted')
    await entry.dispose()
  })

  it('abandons a boot that a newer run superseded while the loader reached quiescence', async () => {
    install({ factories: { renderer } })
    const container = document.createElement('div')
    document.body.append(container)
    const entry = new AppWebEntry(container)
    let second: Promise<void> | undefined
    const original = Reflect.get(Loader.prototype, 'await')
    vi.spyOn(Loader.prototype, 'await').mockImplementationOnce(function (this: Loader) {
      second = entry.run()
      return original.call(this)
    })
    await entry.run()
    await second
    expect(container.textContent).toBe('mounted')
    await entry.dispose()
  })

  it('ignores the failure of a boot superseded by disposal', async () => {
    let fail!: (error: Error) => void
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    install({
      factories: { renderer },
      entries: [{ id: 'renderer', url: '/renderer.js', rev: '1', immediately: true }],
      wrap: system => Object.assign(system, {
        prefetch: () => new Promise<void>((_resolve, reject) => { fail = reject }),
      }),
    })
    const container = document.createElement('div')
    const entry = new AppWebEntry(container)
    const running = entry.run()
    await Promise.resolve()
    await entry.dispose()
    fail(new Error('late'))
    await running
    expect(error).not.toHaveBeenCalled()
  })

  it('remounts the application when the UI renderer entry restarts', async () => {
    let mounted = 0
    let unmounted = 0
    const counting: Factory = () => ({
      apply: (ctx: Context) => {
        ctx.reflect.provide('uiRenderer', {
          mount: () => { mounted++; return () => { unmounted++ } },
        })
      },
    })
    install({ factories: { renderer: counting } })
    const container = document.createElement('div')
    document.body.append(container)
    const entry = new AppWebEntry(container)
    await entry.run()
    expect([mounted, unmounted]).toEqual([1, 0])
    const ctx = (entry as unknown as { ctx: Context }).ctx
    const loaderEntry = [...ctx.loader.entries()][0]!
    await loaderEntry._dispose()
    expect(unmounted).toBe(1)
    await loaderEntry.refresh()
    await Promise.resolve()
    expect([mounted, unmounted]).toEqual([2, 1])
    await entry.dispose()
    expect(unmounted).toBe(2)
  })
})
