/** Node-half registry: package declarations, incremental rescans, rebuild notices, bundle route, and native index renderer. */

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@arx-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RequestIndexUnavailableError, type WebRoute, type WebServer } from '@arx-ai/arx-host-webserver'
import { parseAuthState } from '@arx-ai/arx-web-identity/contract'
import { ClientModuleRegistry, bootInjections } from '../src/index.ts'
import { APPLICATION_PLUGIN_IDS } from '../src/client/manifest.ts'
import type { WebBootGraph } from '../src/client/index.ts'

let root: string | undefined

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

/** Write a resolvable package; `metadata` overrides package.json fields, `bundle` (when set) is the built client file content. */
function writePackage(name: string, metadata: Record<string, unknown>, bundle?: string): string {
  root ??= realpathSync(mkdtempSync(join(tmpdir(), 'arx-client-registry-')))
  const pkgRoot = join(root, 'node_modules', ...name.split('/'))
  const clientPath = join(pkgRoot, 'lib', 'client.js')
  mkdirSync(dirname(clientPath), { recursive: true })
  writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({
    name,
    exports: { './client': './lib/client.js', './package.json': './package.json' },
    ...metadata,
  }))
  if (bundle !== undefined) writeFileSync(clientPath, bundle)
  return clientPath
}

/** Write a built web client package. */
function built(name: string, client: Record<string, unknown> = {}, bundle = 'module.exports = {}\n'): string {
  return writePackage(name, { arx: { client: { platform: 'web', ...client } } }, bundle)
}

interface Harness {
  ctx: Context
  entries: Array<{ options: { name: string }; fiber: object | undefined; disabled: boolean }>
  routes: WebRoute[]
  renderers: Array<(html: string, request: IncomingMessage) => Promise<string>>
}

/** Build a context over a mutable fake loader and a fake webServer; nothing is constructed yet. */
function harness(names: string[], accessMode: 'local' | 'authenticated' = 'local'): Harness {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root!).href + '/'
  const entries = names.map(name => ({ options: { name }, fiber: {} as object | undefined, disabled: false }))
  const routes: WebRoute[] = []
  const renderers: Harness['renderers'] = []
  ctx.provide('loader', { entries: () => entries.values() })
  ctx.provide('webServer', {
    port: 0,
    accessMode,
    register: (route: WebRoute) => { routes.push(route); return () => {} },
    registerRequestIndexRenderer: (renderer: Harness['renderers'][number]) => { renderers.push(renderer); return () => {} },
  } as unknown as WebServer)
  return { ctx, entries, routes, renderers }
}

/** Collected response of a fake ServerResponse. */
function respond(): { res: ServerResponse; out: { status: number; headers?: Record<string, string> | undefined; body: string } } {
  const out: { status: number; headers?: Record<string, string> | undefined; body: string } = { status: 0, body: '' }
  const res = {
    writeHead(status: number, headers?: Record<string, string>) { out.status = status; out.headers = headers; return res },
    end(chunk?: Uint8Array) { out.body = chunk === undefined ? '' : Buffer.from(chunk).toString('utf8') },
  } as unknown as ServerResponse
  return { res, out }
}

describe('arx.client declaration validation', () => {
  it.each([
    ['a non-object declaration', { arx: { client: 'web' } }, 'has a non-object arx.client declaration'],
    ['a null declaration', { arx: { client: null } }, 'has a non-object arx.client declaration'],
    ['a non-string platform', { arx: { client: { platform: 3 } } }, 'arx.client.platform must be a string'],
    ['a non-boolean immediately', { arx: { client: { platform: 'web', immediately: 'yes' } } }, 'arx.client.immediately must be a boolean'],
    ['exports without a client bundle entry', { arx: { client: { platform: 'web' } }, exports: { '.': './x.js', './package.json': './package.json' } }, 'exports no "./client" bundle'],
    ['a package without an exports field', { arx: { client: { platform: 'web' } }, exports: undefined }, 'exports no "./client" bundle'],
    ['a client export that is neither string nor object', { arx: { client: { platform: 'web' } }, exports: { './client': 7, './package.json': './package.json' } }, 'exports["./client"] must be a string or an object with a string default'],
    ['a null client export', { arx: { client: { platform: 'web' } }, exports: { './client': null, './package.json': './package.json' } }, 'exports["./client"] must be a string or an object with a string default'],
    ['a conditional client export without a string default', { arx: { client: { platform: 'web' } }, exports: { './client': { import: './x.js' }, './package.json': './package.json' } }, 'exports["./client"] must be a string or an object with a string default'],
  ])('fails activation for %s', (_label, metadata, message) => {
    writePackage('@fixture/bad-declaration', metadata)
    const { ctx } = harness(['@fixture/bad-declaration'])
    expect(() => new ClientModuleRegistry(ctx)).toThrow(message)
  })

  it('fails activation without the config-tree anchor', () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'arx-client-registry-')))
    const { ctx } = harness([])
    ctx.baseUrl = undefined as unknown as string
    expect(() => new ClientModuleRegistry(ctx)).toThrow('ctx.baseUrl is unset')
  })

  it('ignores packages without a web client declaration and caches the verdict', () => {
    writePackage('@fixture/no-arx', {})
    writePackage('@fixture/null-arx', { arx: null })
    writePackage('@fixture/node-only', { arx: { client: { platform: 'node' } } })
    const { ctx } = harness(['@fixture/no-arx', '@fixture/null-arx', '@fixture/node-only', '@fixture/unresolvable'])
    expect(new ClientModuleRegistry(ctx).graph().entries).toEqual([])
  })

  it('accepts a conditional client export with a string default and carries inject and immediately', () => {
    const clientPath = writePackage('@fixture/conditional', {
      arx: { client: { platform: 'web', inject: ['@fixture/dep'], immediately: true } },
      exports: { './client': { default: './lib/client.js' }, './package.json': './package.json' },
    }, 'module.exports = {}\n')
    const { ctx } = harness(['@fixture/conditional'])
    const service = new ClientModuleRegistry(ctx)
    expect(service.graph().entries).toEqual([expect.objectContaining({ id: '@fixture/conditional', inject: ['@fixture/dep'], immediately: true })])
    expect(service.clientPath('@fixture/conditional')).toBe(clientPath)
    expect(service.clientPath('@fixture/unknown')).toBeUndefined()
  })
})

describe('incremental rescans', () => {
  it('adds a row after an entry fiber appears, notifies graph listeners, and drops it when the entry is disabled', async () => {
    built('@fixture/late')
    const { ctx, entries } = harness([])
    const service = new ClientModuleRegistry(ctx)
    const changed = vi.fn()
    const stop = service.onGraphChanged(changed)
    entries.push({ options: { name: '@fixture/late' }, fiber: {}, disabled: false })
    ctx.emit('internal/plugin', { entry: { options: { name: '@fixture/late' } } } as never)
    ctx.emit('internal/plugin', { entry: { options: { name: '@fixture/late' } } } as never)
    ctx.emit('internal/plugin', { entry: undefined } as never)
    expect(service.graph().entries).toEqual([])
    await Promise.resolve()
    expect(service.graph().entries.map(row => row.id)).toEqual(['@fixture/late'])
    expect(changed).toHaveBeenCalledTimes(1)

    entries[0]!.disabled = true
    ctx.emit('internal/plugin', { entry: { options: { name: '@fixture/late' } } } as never)
    await Promise.resolve()
    expect(service.graph().entries).toEqual([])
    expect(changed).toHaveBeenCalledTimes(2)

    stop()
    entries[0]!.disabled = false
    ctx.emit('internal/plugin', { entry: { options: { name: '@fixture/late' } } } as never)
    await Promise.resolve()
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('reuses the row of an entry already in the table and ignores entries without a fiber', async () => {
    built('@fixture/steady')
    const { ctx, entries } = harness(['@fixture/steady'])
    const service = new ClientModuleRegistry(ctx)
    const before = service.graph()
    ctx.emit('internal/plugin', { entry: { options: { name: '@fixture/steady' } } } as never)
    await Promise.resolve()
    expect(service.graph()).toBe(before)
    entries[0]!.fiber = undefined
    ctx.emit('internal/plugin', { entry: { options: { name: '@fixture/steady' } } } as never)
    await Promise.resolve()
    expect(service.graph().entries).toEqual([])
  })

  it('logs a failing package without disturbing the served graph, and contains a throwing graph listener', async () => {
    built('@fixture/good')
    writePackage('@fixture/broken', { arx: { client: { platform: 'web', immediately: 1 } } })
    const { ctx, entries } = harness(['@fixture/good'])
    const service = new ClientModuleRegistry(ctx)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
    entries.push({ options: { name: '@fixture/broken' }, fiber: {}, disabled: false })
    ctx.emit('internal/plugin', { entry: { options: { name: '@fixture/broken' } } } as never)
    await Promise.resolve()
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('immediately must be a boolean') as string }))
    expect(service.graph().entries.map(row => row.id)).toEqual(['@fixture/good'])

    const boom = new Error('listener failed')
    service.onGraphChanged(() => { throw boom })
    const later = vi.fn()
    service.onGraphChanged(later)
    built('@fixture/extra')
    entries.push({ options: { name: '@fixture/extra' }, fiber: {}, disabled: false })
    ctx.emit('internal/plugin', { entry: { options: { name: '@fixture/extra' } } } as never)
    await Promise.resolve()
    expect(error).toHaveBeenCalledWith(boom)
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('keeps the last orderable graph when a later package closes a cycle', async () => {
    built('@fixture/cycle-a', { external: ['@fixture/cycle-b'] })
    const { ctx, entries } = harness(['@fixture/cycle-a'])
    const service = new ClientModuleRegistry(ctx)
    const served = service.graph()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    built('@fixture/cycle-b', { external: ['@fixture/cycle-a'] })
    entries.push({ options: { name: '@fixture/cycle-b' }, fiber: {}, disabled: false })
    ctx.emit('internal/plugin', { entry: { options: { name: '@fixture/cycle-b' } } } as never)
    await Promise.resolve()
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('module graph cycle') as string }))
    expect(service.graph()).toBe(served)
  })
})

describe('loader failures during a rescan', () => {
  it('wraps a non-Error thrown by the loader into a logged Error', async () => {
    built('@fixture/steady')
    const { ctx, entries } = harness(['@fixture/steady'])
    const service = new ClientModuleRegistry(ctx)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ;(ctx.loader as unknown as { entries: () => never }).entries = () => { throw 'loader unavailable' }
    ctx.emit('internal/plugin', { entry: { options: { name: entries[0]!.options.name } } } as never)
    await Promise.resolve()
    expect(warn).toHaveBeenCalledWith(new Error('loader unavailable'))
    expect(service.graph().entries.map(row => row.id)).toEqual(['@fixture/steady'])
  })
})

describe('bundle rebuild notices', () => {
  it('re-hashes a changed bundle, recomposes the graph, and notifies rebuild and graph subscribers', () => {
    const clientPath = built('@fixture/hmr')
    const { ctx } = harness(['@fixture/hmr'])
    const service = new ClientModuleRegistry(ctx)
    const error = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
    const [first] = service.graph().entries
    const rebuilt = vi.fn()
    const graphChanged = vi.fn()
    const stopRebuilt = service.onRebuilt(rebuilt)
    const stopGraph = service.onGraphChanged(graphChanged)
    const boom = new Error('rebuild subscriber failed')
    const stopThrowing = service.onRebuilt(() => { throw boom })
    const last = vi.fn()
    service.onRebuilt(last)

    expect(service.rebuilt('@fixture/missing')).toBeUndefined()
    expect(service.rebuilt('@fixture/hmr')).toBe(first!.rev)
    expect(rebuilt).not.toHaveBeenCalled()

    writeFileSync(clientPath, 'module.exports = { changed: true }\n')
    const rev = service.rebuilt('@fixture/hmr')
    expect(rev).not.toBe(first!.rev)
    expect(service.graph().entries[0]).toMatchObject({ id: '@fixture/hmr', rev, url: `/plugins/@fixture/hmr/client.js?rev=${rev}` })
    expect(rebuilt).toHaveBeenCalledWith('@fixture/hmr', rev)
    expect(last).toHaveBeenCalledWith('@fixture/hmr', rev)
    expect(error).toHaveBeenCalledWith(boom)
    expect(graphChanged).toHaveBeenCalledTimes(1)

    stopRebuilt(); stopGraph(); stopThrowing()
    writeFileSync(clientPath, 'module.exports = { changed: 2 }\n')
    service.rebuilt('@fixture/hmr')
    expect(rebuilt).toHaveBeenCalledTimes(1)
    expect(graphChanged).toHaveBeenCalledTimes(1)
  })
})

describe('bundle route', () => {
  const request = (method: string, url: string): IncomingMessage => ({ method, url }) as IncomingMessage

  it('serves bundles for GET and HEAD, rejects other methods, and answers 404 for unknown or unreadable bundles', async () => {
    const clientPath = built('@fixture/route', {}, 'module.exports = { served: true }\n')
    const { ctx, routes } = harness(['@fixture/route'])
    new ClientModuleRegistry(ctx)
    const handler = routes.find(route => route.path === '/plugins')!.handler

    for (const method of ['GET', 'HEAD']) {
      const { res, out } = respond()
      await handler(request(method, '/plugins/@fixture/route/client.js?rev=1'), res)
      expect(out.status).toBe(200)
      expect(out.headers).toEqual({ 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' })
      expect(out.body).toBe(readFileSync(clientPath, 'utf8'))
    }

    const post = respond()
    await handler(request('POST', '/plugins/@fixture/route/client.js'), post.res)
    expect(post.out.status).toBe(405)

    for (const url of ['/plugins', '/plugins/events', '/plugins/@fixture/unknown/client.js', '/plugins/@fixture/route/client.js.map.x']) {
      const { res, out } = respond()
      await handler(request('GET', url), res)
      expect(out.status).toBe(404)
    }

    rmSync(clientPath)
    const unreadable = respond()
    await handler(request('GET', '/plugins/@fixture/route/client.js'), unreadable.res)
    expect(unreadable.out.status).toBe(404)
  })
})

describe('local index injection', () => {
  it('appends the boot rows for the composed graph to the webserver index table', () => {
    built('@fixture/indexed')
    const { ctx } = harness(['@fixture/indexed'])
    const service = new ClientModuleRegistry(ctx)
    const table: unknown[] = []
    ctx.emit('webserver/index-inject', table as never)
    expect(table).toEqual(bootInjections(service.graph()))
    expect(table).toContainEqual({ kind: 'global', name: '__ARX_BOOT__', value: service.graph() })
  })
})

describe('boot injection access rows', () => {
  const graph: WebBootGraph = { rev: 'g', entries: [] }

  it('refuses an authenticated boot without a composition view', () => {
    expect(() => bootInjections(graph, { accessMode: 'authenticated' })).toThrow('authenticated boot requires a composition view')
  })

  it('emits the access mode without a composition global for a local profile', () => {
    const rows = bootInjections(graph, { accessMode: 'local' })
    expect(rows.filter(row => row.kind === 'global').map(row => row.name)).toEqual(['__ARX_BOOT__', '__ARX_CLIENT_ACCESS_MODE__'])
  })
})

describe('native request index renderer', () => {
  /** Fixture packages mirroring the real application plugin declarations. */
  function applicationPackages(): string[] {
    return APPLICATION_PLUGIN_IDS.map((id) => {
      const real = JSON.parse(readFileSync(join('packages', 'client', id.replace('@arx-ai/arx-client-', ''), 'package.json'), 'utf8')) as {
        arx: { client: Record<string, unknown> }
      }
      built(id, real.arx.client)
      return id
    })
  }

  async function authenticatedRenderer(stateOf: (call: number) => unknown, authenticate: () => unknown = () => ({ token: 'fixture' })) {
    const names = applicationPackages()
    const h = harness(names, 'authenticated')
    let call = 0
    h.ctx.provide('webIdentityApi', { audience: 'user', authenticateRequest: () => Promise.resolve(authenticate()) } as never)
    h.ctx.provide('webIdentity', { state: () => Promise.resolve(stateOf(call++)) } as never)
    await h.ctx.plugin(ClientModuleRegistry)
    expect(h.renderers).toHaveLength(1)
    return h.renderers[0]!
  }

  const html = '<html><head></head><body></body></html>'
  const anonymous = (audience: 'user' | 'admin' = 'user') => parseAuthState({ authenticated: false, audience })

  it('renders the application boot rows for an anonymous request, defaulting a missing url to the root path', async () => {
    const render = await authenticatedRenderer(() => anonymous())
    const page = await render(html, {} as IncomingMessage)
    expect(page).toContain('"kind":"public"')
    expect(page).toContain('__ARX_CLIENT_ACCESS_MODE__')
  })

  it('refuses the page when authentication state changes between the two checks', async () => {
    const render = await authenticatedRenderer(call => anonymous(call === 0 ? 'user' : 'admin'))
    await expect(render(html, { url: '/' } as IncomingMessage)).rejects.toBeInstanceOf(RequestIndexUnavailableError)
  })

  it('maps an unauthorized authentication failure to the public audience page', async () => {
    const render = await authenticatedRenderer(() => anonymous(), () => { throw Object.assign(new Error('nope'), { status: 401 }) })
    await expect(render(html, { url: '/' } as IncomingMessage)).resolves.toContain('"kind":"public"')
  })

  it.each([
    ['an authentication failure that is not a 401', Object.assign(new Error('down'), { status: 500 })],
    ['a thrown non-object', 'down'],
    ['a thrown null', null],
  ])('refuses the page for %s', async (_label, failure) => {
    const render = await authenticatedRenderer(() => anonymous(), () => { throw failure })
    await expect(render(html, { url: '/' } as IncomingMessage)).rejects.toBeInstanceOf(RequestIndexUnavailableError)
  })
})
