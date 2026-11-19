/** Closed native roster checked against the real package declarations. */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import HttpServer from '@arx-ai/arx-host-webserver'
import IdentityApi from '@arx-ai/arx-host-web-identity-api'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'
import { runInNewContext } from 'node:vm'
import ClientModuleRegistry, { bootInjections } from '../src/index.ts'
import { describe, expect, it } from 'vitest'
import { AUTH_HEADER, parseAuthState } from '@arx-ai/arx-web-identity/contract'
import { authenticatedGraph, nativeComposition, USER_PROJECT_BASE, USER_RUNTIME_FEATURES, AUTH_STATIC_WORDS } from '../src/authenticated-graph.ts'
import { APPLICATION_PLUGIN_IDS, assertCompositionManifest, parseBootManifest, type WebBootEntry } from '../src/client/manifest.ts'
import { PLATFORM_MODULES } from '../../web/src/platform.ts'

const packages = new Map<string, string>()
for (const category of readdirSync('packages', { withFileTypes: true })) {
  if (!category.isDirectory()) continue
  for (const directory of readdirSync(join('packages', category.name), { withFileTypes: true })) {
    if (!directory.isDirectory()) continue
    const path = join('packages', category.name, directory.name, 'package.json')
    if (existsSync(path)) packages.set((JSON.parse(readFileSync(path, 'utf8')) as { name: string }).name, path)
  }
}
function installed(id: string): WebBootEntry {
  const pkg = JSON.parse(readFileSync(packages.get(id)!, 'utf8')) as {
    arx: { client: { inject?: string[]; external?: string[]; immediately?: boolean } }
  }
  const decl = pkg.arx.client
  return { id, url: '/plugins/' + id + '/client.js', rev: 'fixture', ...decl }
}
function state(role: 'USER' | 'MASTER_ADMIN', audience: 'user' | 'admin', grants: string[], mustChangePassword = false) {
  return parseAuthState({ authenticated: true, audience, generation: 4, csrfToken: 'fixture-only', expiresAt: Date.now() + 60_000,
    principal: { userId: '00000000-0000-4000-8000-000000000001', username: 'fixture', email: 'fixture@example.test',
      role, status: 'ACTIVE', mustChangePassword, grants } })
}
const full = { rev: 'fixture', entries: [...new Set([...USER_PROJECT_BASE, ...USER_RUNTIME_FEATURES])].map(installed) }
describe('native request graph', () => {
  it('strips recovery before the first native bundle and exposes only a one-use callback handle', () => {
    const composition = nativeComposition(parseAuthState({ authenticated: false, audience: 'user' }))
    const graph = { rev: 'fixture', entries: authenticatedGraph(full, composition) }
    const injections = bootInjections(graph, { accessMode: 'authenticated', composition })
    const first = injections[0]!
    expect(first.kind).toBe('script')
    if (first.kind !== 'script') throw new Error('first native row is not inline script')
    const replacements: unknown[][] = [], handlers: Array<() => void> = [], events = new EventTarget()
    const location = { hash: '#reset=fixture-only-token', pathname: '/reset', search: '' }
    const sandbox = { location, history: { replaceState(...args: unknown[]) { replacements.push(args); location.hash = '' } },
      Event,
      addEventListener(name: string, listener: EventListener, options?: AddEventListenerOptions) {
        events.addEventListener(name, listener, options)
        // Existing teardown observations dispatch the real lifecycle event, not arbitrary callbacks.
        if (name === 'pagehide') handlers.push(() => { events.dispatchEvent(new Event('pagehide')) })
      },
      removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
      __ARX_RECOVERY_FRAGMENT__: undefined as { take(): string | undefined; clear(): void } | undefined }
    runInNewContext(first.text, sandbox)
    expect(location.hash).toBe('')
    expect(replacements).toEqual([[null, '', '/reset']])
    const handle = sandbox.__ARX_RECOVERY_FRAGMENT__!
    expect(Object.keys(handle).sort()).toEqual(['clear', 'take'])
    expect(JSON.stringify(handle)).toBe('{}')
    expect(handle.take()).toBe('#reset=fixture-only-token')
    expect(handle.take()).toBeUndefined()
    expect(sandbox.__ARX_RECOVERY_FRAGMENT__).toBeUndefined()
    expect(injections.findIndex(row => row.kind === 'script-src')).toBeGreaterThan(0)
    const invitation = { ...sandbox, location: { ...location, hash: '#invite=fixture-only-invite' } }
    runInNewContext(first.text, invitation)
    expect(invitation.__ARX_RECOVERY_FRAGMENT__).toBeDefined()
    handlers.forEach((listener) => { listener() })
    expect(invitation.__ARX_RECOVERY_FRAGMENT__).toBeUndefined()
  })
  it('pins static carrier words to the actual browser platform', () => { expect(AUTH_STATIC_WORDS).toEqual(PLATFORM_MODULES) })
  it('contains only six neutral rows for anonymous, MASTER and USER without runtime', () => {
    for (const current of [parseAuthState({ authenticated: false, audience: 'user' }),
      state('MASTER_ADMIN', 'admin', []), state('USER', 'user', ['storage']), state('MASTER_ADMIN', 'admin', [], true)]) {
      const composition = nativeComposition(current), rows = authenticatedGraph(full, composition)
      expect(rows.map(row => row.id).sort()).toEqual([...APPLICATION_PLUGIN_IDS].sort())
      expect(composition.scope).toBe('application')
      assertCompositionManifest(parseBootManifest({ rev: 'fixture', entries: rows }), composition)
      expect(JSON.stringify(rows)).not.toMatch(/connection|settingsScope|runtime\/client/)
    }
  })
  it('keeps active USER and MASTER recovery paths public while preserving real audience and generation', () => {
    for (const current of [state('USER', 'user', ['runtime', 'storage']), state('MASTER_ADMIN', 'admin', [])]) {
      for (const pathname of ['/reset', '/invite']) {
        const composition = nativeComposition(current, pathname)
        expect(composition).toEqual({ kind: 'public', audience: current.audience, generation: current.authenticated ? current.generation : undefined, scope: 'application' })
        expect(authenticatedGraph(full, composition).map(row => row.id).sort()).toEqual([...APPLICATION_PLUGIN_IDS].sort())
      }
      expect(nativeComposition(current, '/reset/').kind).not.toBe('public')
    }
    expect(() => nativeComposition(state('MASTER_ADMIN', 'user', ['runtime']), '/reset')).toThrow('audience mismatch')
  })
  it('uses the reviewed USER closure without arbitrary loaders or native pickers', () => {
    const composition = nativeComposition(state('USER', 'user', ['runtime', 'storage']))
    const rows = authenticatedGraph(full, composition)
    expect(composition.scope).toBe('project')
    expect(rows.map(row => row.id)).toEqual(full.entries.map(row => row.id))
    expect(rows.map(row => row.id).join('\n')).not.toMatch(/ui-workspace|ui-projects|ui-repository|ui-schedule|hmr|native-open|inventory|plugin-install/)
  })
  it('passes a project row without declared dependencies through without inventing inject or external', () => {
    const composition = nativeComposition(state('USER', 'user', ['runtime', 'storage']))
    const bare = '@arx-ai/arx-client-ui-brand-official'
    const entries = full.entries.map(row => row.id === bare ? { id: row.id, url: row.url, rev: row.rev } : row)
    expect(authenticatedGraph({ ...full, entries }, composition).find(row => row.id === bare))
      .toEqual({ id: bare, url: '/plugins/' + bare + '/client.js', rev: 'fixture' })
  })
  it('fails closed for missing required rows and an unknown declared dependency', () => {
    const composition = nativeComposition(state('USER', 'user', ['runtime', 'storage']))
    expect(() => authenticatedGraph({ ...full, entries: full.entries.filter(row => row.id !== '@arx-ai/arx-client-connection') }, composition))
      .toThrow('missing required plugin')
    const entries = full.entries.map(row => row.id === '@arx-ai/arx-client-ui-conversation'
      ? { ...row, external: [...(row.external ?? []), '@arx-ai/unknown-private-package/client'] } : row)
    expect(() => authenticatedGraph({ ...full, entries }, composition)).toThrow('rejects dependency')
  })
  it('rejects an application graph that claims project hooks through metadata', () => {
    const rows = authenticatedGraph(full, nativeComposition(parseAuthState({ authenticated: false, audience: 'admin' })))
    const poisoned = rows.map(row => row.id === '@arx-ai/arx-client-ui-auth'
      ? { ...row, inject: [...(row.inject ?? []), '@arx-ai/arx-client-runtime'] } : row)
    expect(() =>{  assertCompositionManifest(parseBootManifest({ rev: 'fixture', entries: poisoned }),
      { kind: 'public', audience: 'admin', scope: 'application' }) }).toThrow('rejects plugin dependency')
  })
  it('refuses a server audience and principal role mismatch', () => {
    expect(() => nativeComposition(state('MASTER_ADMIN', 'user', ['runtime']))).toThrow('audience mismatch')
    expect(() => nativeComposition(state('USER', 'admin', []))).toThrow('audience mismatch')
  })
})

// This resolver is fixture assembly over real workspace packages, not an install proof.
describe('native renderer scope lifetime over real identity HTTP', () => {
  it('owns one renderer in each audience and retracts only the disposed scoped API', async () => {
    const anchor = await mkdtemp(join(tmpdir(), 'arx-native-index-scope-'))
    await writeFile(join(anchor, 'package.json'), JSON.stringify({ type: 'module' }))
    await mkdir(join(anchor, 'node_modules', '@arx-ai'), { recursive: true })
    for (const id of APPLICATION_PLUGIN_IDS) {
      const pkg = packages.get(id)
      if (pkg === undefined) throw new Error('fixture package declaration absent')
      await symlink(resolve(pkg, '..'), join(anchor, 'node_modules', ...id.split('/')), 'dir')
    }
    const require = createRequire(pathToFileURL(join(anchor, 'package.json')))
    const plugins = APPLICATION_PLUGIN_IDS.map((id) => {
      if (id === '@arx-ai/arx-client-modules') return { name: id, plugin: ClientModuleRegistry }
      const entry: unknown = require(id)
      const plugin = typeof entry === 'object' && entry !== null && 'default' in entry ? entry.default : entry
      if (typeof plugin !== 'function' && !(typeof plugin === 'object' && plugin !== null && 'apply' in plugin && typeof plugin.apply === 'function')) throw new Error('real fixture plugin is not executable')
      return { name: id, plugin }
    })
    const harness = await identityHarness({ api: 'user', accessMode: 'authenticated', readyUsers: 1,
      packageBaseUrl: pathToFileURL(join(anchor, 'package.json')).href, extraPlugins: plugins })
    try {
      if (harness.master === undefined || harness.url === undefined) throw new Error('real fixture authority unavailable')
      await harness.ctx.webIdentity.setModules(harness.master, harness.users[0]!.userId, ['storage'])
      const admin = harness.ctx.isolate('webServer').isolate('webIdentityApi').isolate('clientModules')
      await admin.plugin(HttpServer, { host: '127.0.0.1', port: 0, accessMode: 'authenticated' })
      const adminUrl = 'http://127.0.0.1:' + String(admin.webServer.port)
      const adminApi = await admin.plugin(IdentityApi, { audience: 'admin', origin: adminUrl,
        allowInsecureLoopbackFixture: true, invalidationTimeoutMs: 100, minimumRecoveryResponseMs: 0,
        publicRateLimitAttempts: 100 })
      await admin.plugin(ClientModuleRegistry)
      for (const context of [harness.ctx, admin]) context.effect(() => context.webServer.register({
        kind: 'exact', path: '/', handler: async (request, response) => {
          try {
            const html = await context.webServer.renderRequestIndex('<html><head></head><body></body></html>', request)
            response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); response.end(html)
          } catch { response.writeHead(503, { 'Cache-Control': 'no-store' }); response.end() }
        },
      }), 'fixture: original request index')
      for (const origin of [harness.url, adminUrl]) {
        const response = await fetch(origin + '/')
        expect(response.status).toBe(200)
        expect((await response.text()).includes('"kind":"public"')).toBe(true)
      }
      const login = async (origin: string, identifier: string, password: string): Promise<string> => {
        const response = await fetch(origin + '/auth/login', { method: 'POST',
          headers: { Origin: origin, [AUTH_HEADER]: '1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, password }) })
        expect(response.status).toBe(200)
        const cookies = response.headers.getSetCookie()
        expect(cookies.length).toBe(1)
        return cookies[0]!.split(';')[0]!
      }
      const userCookie = await login(harness.url, harness.users[0]!.username, harness.passwords.users[0]!)
      const adminCookie = await login(adminUrl, 'arxadmin', harness.passwords.master)
      const userIndex = await fetch(harness.url + '/', { headers: { Cookie: userCookie } })
      const adminIndex = await fetch(adminUrl + '/', { headers: { Cookie: adminCookie } })
      expect(userIndex.status).toBe(200); expect(adminIndex.status).toBe(200)
      expect((await userIndex.text()).includes('"kind":"user"')).toBe(true)
      expect((await adminIndex.text()).includes('"kind":"admin"')).toBe(true)
      await adminApi.dispose()
      expect((await fetch(adminUrl + '/')).status).toBe(503)
      expect((await fetch(harness.url + '/', { headers: { Cookie: userCookie } })).status).toBe(200)
    } finally { await harness.close(); await rm(anchor, { recursive: true, force: true }) }
  })
})
