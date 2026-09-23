/**
 * The open-in-app channel over a real WebServer and the real connection
 * plugin, booted through the vendored Loader (the REAL-composition
 * requirement), asserted over HTTP: the loopback fence, the one-pass catalog
 * resolution every endpoint shares, icon data URLs with caching, payload
 * validation, the stale-launcher (ENOENT) refresh, SSH launches, and channel
 * disposal. Host commands, launches, and PATH resolution are faked through the
 * package `internals` seam; the subprocess service is a stub whose lookups
 * reject; the filesystem is real.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import Loader from '@arx-ai/cordis-plugin-loader'
import Include from '@arx-ai/cordis-plugin-include'
import HttpServer from '@arx-ai/arx-host-webserver'
import * as Connection from '@arx-ai/arx-client-connection'
import {
  ARX_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot, type LaunchEnvironmentLayerInput,
} from '@arx-ai/arx-launch-environment'
import type { NativeCommandRunner } from '@arx-ai/arx-native-command'
import * as OpenInApp from '../src/index.ts'
import { internals } from '../src/internals.ts'
import type { OpenInAppLauncher } from '../src/resolver.ts'

const OPEN_IN_APP = '@arx-ai/arx-host-open-in-app'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  internals.catalog = {}
  vi.unstubAllEnvs()
})

/** PATH-resolution fake answering from a fixed name-to-path table. */
function pathTable(entries: Record<string, string> = {}): (name: string) => Promise<string | null> {
  return name => Promise.resolve(entries[name] ?? null)
}

/** Boot webserver + connection + open-in-app rows through the real Loader; returns the base URL. */
async function boot(layers: readonly LaunchEnvironmentLayerInput[] = []): Promise<string> {
  internals.catalog = { env: {}, ...internals.catalog }
  root = await mkdtemp(join(tmpdir(), 'arx-open-in-app-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@arx-ai/arx-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@arx-ai/arx-client-connection'",
    `- name: '${OPEN_IN_APP}'`,
    '  config:',
    '    probeTimeoutMs: 5000',
    '    iconTimeoutMs: 5000',
    '    launchWatchMs: 1000',
    '',
  ].join('\n'))

  context = new Context()
  context.provide(ARX_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot(layers))
  context.baseUrl = pathToFileURL(root).href + '/'
  // The plugin resolves PATH names through the composition's subprocess
  // capability; the not-found rejection is the provider's real signal.
  context.provide('subprocess', {
    resolveExecutable: () => Promise.reject(new Error('spec host resolves nothing')),
  } as never)
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@arx-ai/arx-host-webserver', HttpServer],
    ['@arx-ai/arx-client-connection', Connection],
    [OPEN_IN_APP, OpenInApp],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  expect([...context.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
  return `http://127.0.0.1:${String(context.webServer.port)}`
}

/** One RPC exchange's HTTP status and decoded body. */
interface Exchange {
  readonly status: number
  readonly body: unknown
}

/**
 * Post one client-request envelope to an open-in-app endpoint, the way the
 * browser's connection caller does.
 * @param base - the served origin.
 * @param endpoint - channel-relative endpoint.
 * @param payload - request payload.
 * @param headers - extra request headers (a foreign Host or Origin).
 * @returns the HTTP status and the parsed body (text when not JSON).
 */
async function call(
  base: string, endpoint: string, payload: unknown, headers: Record<string, string> = {},
): Promise<Exchange> {
  // node:http rather than fetch: the Fetch standard forbids setting Host,
  // and the fence under test reads exactly that header.
  const url = new URL(`${base}/open-in-app/${endpoint}`)
  const body = JSON.stringify({ type: 'client-request', rpcId: `rpc-${endpoint}`, method: endpoint, payload })
  const { status, text } = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: url.host, ...headers },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }) })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end(body)
  })
  let decoded: unknown = text
  try {
    decoded = JSON.parse(text)
  } catch {
    // Swallows a non-JSON body (the fence's plain-text refusal): the text is the body.
  }
  return { status, body: decoded }
}

/** The RPC result an exchange carried. */
function result(exchange: Exchange): unknown {
  expect(exchange.status).toBe(200)
  return (exchange.body as { result: unknown }).result
}

/** Error code of a failed RPC result. */
function errorCode(exchange: Exchange): string {
  const answer = result(exchange) as { ok: false; error: { code: string } }
  expect(answer.ok).toBe(false)
  return answer.error.code
}

/**
 * macOS host with a Cursor bundle (carrying an icon) under the temp
 * application root; the injected launcher records every spawn.
 */
function darwinFixture(home: string, launches: string[][]): void {
  const run: NativeCommandRunner = async (command, args) => {
    if (command === 'plutil') return { stdout: JSON.stringify({ CFBundleIconFile: 'AppIcon' }), stderr: '' }
    if (command === 'sips') {
      const out = args[args.length - 1]
      if (typeof out !== 'string') throw new Error('missing sips --out')
      await writeFile(out, 'png-bytes')
      return { stdout: '', stderr: '' }
    }
    throw new Error(`fixture rejects: ${command} ${args.join(' ')}`)
  }
  const launch: OpenInAppLauncher = (command, args) => {
    launches.push([command, ...args])
    return Promise.resolve()
  }
  internals.catalog = {
    platform: 'darwin',
    applicationRoots: [join(home, 'Applications')],
    run,
    launch,
    resolveExecutable: pathTable(),
  }
}

/** Create the Cursor bundle fixture with an icns under the temp home. */
async function cursorBundle(home: string): Promise<void> {
  await mkdir(join(home, 'Applications', 'Cursor.app', 'Contents', 'Resources'), { recursive: true })
  await writeFile(join(home, 'Applications', 'Cursor.app', 'Contents', 'Resources', 'AppIcon.icns'), 'icns')
}

/** Temp home holding a workspace directory; removed after the case. */
async function tempHome(): Promise<{ home: string; workspace: string }> {
  const home = await mkdtemp(join(tmpdir(), 'arx-open-in-app-home-'))
  const workspace = join(home, "O'Neil's Project")
  await mkdir(workspace, { recursive: true })
  return { home, workspace }
}

describe('open-in-app channel (real Loader composition)', () => {
  it('keeps the function-plugin runtime surface to Loader exports and the shared constants', () => {
    expect(Object.keys(OpenInApp).sort()).toEqual(['Config', 'apply', 'inject', 'name'])
  })

  it('pins every endpoint to loopback before any resolution runs', async () => {
    const run = vi.fn<NativeCommandRunner>()
    internals.catalog = { platform: 'darwin', run, resolveExecutable: pathTable() }
    const base = await boot()

    for (const headers of [
      { host: 'harness.example:3080' },
      { origin: 'http://attacker.example' },
      { 'sec-fetch-site': 'cross-site' },
    ]) {
      expect((await call(base, 'apps', {}, headers)).status).toBe(403)
      expect((await call(base, 'icon', { app: 'finder' }, headers)).status).toBe(403)
      expect((await call(base, 'open', { app: 'finder', path: '/' }, headers)).status).toBe(403)
    }
    // Refused requests never reached the lazy catalog resolution.
    expect(run).not.toHaveBeenCalled()
    expect(result(await call(base, 'apps', {}))).toEqual({ ok: true, value: { apps: ['finder', 'terminal'] } })
  })

  it('serves the resolved catalog, one cached icon, and launches from the same resolution', async () => {
    const launches: string[][] = []
    const { home, workspace } = await tempHome()
    await cursorBundle(home)
    darwinFixture(home, launches)
    const run = vi.fn(internals.catalog.run)
    internals.catalog = { ...internals.catalog, run }
    const base = await boot()
    try {
      expect(result(await call(base, 'apps', {})))
        .toEqual({ ok: true, value: { apps: ['finder', 'cursor', 'terminal'] } })

      const iconUrl = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`
      expect(result(await call(base, 'icon', { app: 'cursor' }))).toEqual({ ok: true, value: { icon: iconUrl } })
      const extractions = run.mock.calls.length
      // The second read answers from the per-process cache: no re-extraction.
      expect(result(await call(base, 'icon', { app: 'cursor' }))).toEqual({ ok: true, value: { icon: iconUrl } })
      expect(run.mock.calls.length).toBe(extractions)

      expect(result(await call(base, 'open', { app: 'cursor', path: workspace })))
        .toEqual({ ok: true, value: { launched: true } })
      // The launcher is the resolution's verified bundle, not a re-probe.
      expect(launches).toEqual([['open', '-a', join(home, 'Applications', 'Cursor.app'), workspace]])
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('resolves the catalog once: list reads, icons, and launches share the pass', async () => {
    const launches: string[][] = []
    const { home, workspace } = await tempHome()
    await cursorBundle(home)
    darwinFixture(home, launches)
    const resolveExecutable = vi.fn(pathTable())
    internals.catalog = { ...internals.catalog, resolveExecutable }
    const base = await boot()
    try {
      // macOS resolution is filesystem-only; the PATH resolver seat is the
      // witness that no second pass started.
      await call(base, 'apps', {})
      await call(base, 'apps', {})
      await call(base, 'icon', { app: 'finder' })
      expect(result(await call(base, 'open', { app: 'cursor', path: workspace })))
        .toEqual({ ok: true, value: { launched: true } })
      expect(launches).toHaveLength(1)
      expect(resolveExecutable).not.toHaveBeenCalled()
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('refreshes one entry after a missing launcher and drops it when it no longer resolves', async () => {
    const { home, workspace } = await tempHome()
    await cursorBundle(home)
    const attempts: string[][] = []
    const enoent = (): Promise<void> => Promise.reject(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
    // First launch attempt: the resolved executable is gone; after the
    // refresh, the retried launch succeeds. Outcomes are thunks so no
    // rejection exists before the launcher consumes it.
    let launchOutcomes = [enoent, (): Promise<void> => Promise.resolve()]
    const launch: OpenInAppLauncher = (command, args) => {
      attempts.push([command, ...args])
      const next = launchOutcomes.shift()
      if (next === undefined) throw new Error('unexpected launch attempt')
      return next()
    }
    internals.catalog = {
      platform: 'darwin',
      applicationRoots: [join(home, 'Applications')],
      run: () => Promise.reject(new Error('fixture rejects')),
      launch,
      resolveExecutable: pathTable(),
    }
    const base = await boot()
    try {
      expect(result(await call(base, 'open', { app: 'cursor', path: workspace })))
        .toEqual({ ok: true, value: { launched: true } })
      // Two attempts: the stale launcher, then the freshly resolved one.
      expect(attempts).toHaveLength(2)

      // Remove the bundle: the next missing launch cannot re-resolve, the
      // endpoint reports the failure, and the entry leaves the served list.
      await rm(join(home, 'Applications', 'Cursor.app'), { recursive: true, force: true })
      launchOutcomes = [enoent]
      expect(errorCode(await call(base, 'open', { app: 'cursor', path: workspace }))).toBe('internal')
      expect(result(await call(base, 'apps', {}))).toEqual({ ok: true, value: { apps: ['finder', 'terminal'] } })
      // The unresolved entry also stops serving an icon or a launch.
      expect(errorCode(await call(base, 'icon', { app: 'cursor' }))).toBe('open-unavailable')
      expect(errorCode(await call(base, 'open', { app: 'cursor', path: workspace }))).toBe('open-unavailable')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('validates payloads: fields, catalog ids, and absolute existing directories', async () => {
    const launches: string[][] = []
    const { home } = await tempHome()
    await cursorBundle(home)
    darwinFixture(home, launches)
    const base = await boot()
    try {
      expect(errorCode(await call(base, 'nonesuch', {}))).toBe('bad-request')
      for (const payload of [null, 7, 'cursor', { app: 7 }, {}]) {
        expect(errorCode(await call(base, 'icon', payload))).toBe('bad-request')
        expect(errorCode(await call(base, 'open', payload))).toBe('bad-request')
      }
      expect(errorCode(await call(base, 'icon', { app: 'nonesuch' }))).toBe('bad-request')
      expect(errorCode(await call(base, 'open', { app: 'nonesuch', path: home }))).toBe('bad-request')
      expect(errorCode(await call(base, 'open', { app: 'cursor', path: 7 }))).toBe('bad-request')
      // vscode is a catalog entry this host did not resolve.
      expect(errorCode(await call(base, 'open', { app: 'vscode', path: home }))).toBe('open-unavailable')
      expect(result(await call(base, 'open', { app: 'cursor', path: 'relative/dir' }))).toEqual({
        ok: false,
        error: {
          code: 'workspace-invalid-path',
          message: 'path must be an absolute directory path',
          details: { path: 'relative/dir' },
        },
      })
      expect(errorCode(await call(base, 'open', { app: 'cursor', path: '' }))).toBe('workspace-invalid-path')
      const missing = join(home, 'missing')
      expect(result(await call(base, 'open', { app: 'cursor', path: missing }))).toEqual({
        ok: false,
        error: { code: 'directory-unreadable', message: `directory does not exist: ${missing}`, details: { path: missing } },
      })
      const file = join(home, 'notes.txt')
      await writeFile(file, 'text')
      expect(errorCode(await call(base, 'open', { app: 'cursor', path: file }))).toBe('directory-unreadable')
      expect(launches).toEqual([])
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('reports a failed launcher, a missing icon, and an empty catalog on a platform without entries', async () => {
    const { home, workspace } = await tempHome()
    internals.catalog = {
      platform: 'darwin',
      applicationRoots: [join(home, 'Applications')],
      run: () => Promise.reject(new Error('down')),
      launch: () => Promise.reject(new Error('down')),
      resolveExecutable: pathTable(),
    }
    const base = await boot()
    try {
      // finder resolves (a fixed entry) but its launch fails.
      expect(result(await call(base, 'open', { app: 'terminal', path: workspace }))).toEqual({
        ok: false, error: { code: 'internal', message: 'failed to launch terminal', details: {} },
      })
      // plutil and the Resources scan find no artwork for the fixed entry.
      expect(result(await call(base, 'icon', { app: 'finder' }))).toEqual({ ok: true, value: { icon: null } })
    } finally {
      await rm(home, { recursive: true, force: true })
    }

    await context?.fiber.dispose()
    context = undefined
    internals.catalog = { platform: 'aix', resolveExecutable: pathTable() }
    const emptyBase = await boot()
    expect(result(await call(emptyBase, 'apps', {}))).toEqual({ ok: true, value: { apps: [] } })
  })

  it('serves a Linux catalog resolved in-process and its desktop-entry SVG icon', async () => {
    const { home, workspace } = await tempHome()
    const applications = join(home, '.local', 'share', 'applications')
    await mkdir(applications, { recursive: true })
    const svg = join(home, 'code.svg')
    await writeFile(svg, '<svg/>')
    await writeFile(join(applications, 'code.desktop'), `[Desktop Entry]\nExec=code\nIcon=${svg}\n`)
    const launches: string[][] = []
    const launch: OpenInAppLauncher = (command, args) => {
      launches.push([command, ...args])
      return Promise.resolve()
    }
    internals.catalog = {
      platform: 'linux',
      home,
      env: { XDG_DATA_DIRS: join(home, 'xdg-empty'), DISPLAY: ':0' },
      run: () => Promise.reject(new Error('fixture rejects')),
      launch,
      resolveExecutable: pathTable({ 'xdg-open': '/usr/bin/xdg-open', code: '/usr/bin/code' }),
    }
    const base = await boot()
    try {
      expect(result(await call(base, 'apps', {}))).toEqual({ ok: true, value: { apps: ['filemanager', 'vscode'] } })
      // The icon follows the desktop entry; xdg-open declares none.
      expect(result(await call(base, 'icon', { app: 'vscode' }))).toEqual({
        ok: true, value: { icon: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}` },
      })
      expect(result(await call(base, 'icon', { app: 'filemanager' }))).toEqual({ ok: true, value: { icon: null } })

      expect(result(await call(base, 'open', { app: 'vscode', path: workspace })))
        .toEqual({ ok: true, value: { launched: true } })
      expect(launches).toEqual([['/usr/bin/code', workspace]])
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('resolves PATH names through the composition subprocess capability when the seam does not override it', async () => {
    internals.catalog = {
      platform: 'linux',
      env: { XDG_DATA_DIRS: '/nonexistent-xdg' },
      home: '/nonexistent-home',
      run: () => Promise.reject(new Error('fixture rejects')),
    }
    const base = await boot()
    // The spec host's subprocess stub rejects every lookup, which the plugin
    // reads as not-on-PATH: the catalog resolves empty instead of failing.
    expect(result(await call(base, 'apps', {}))).toEqual({ ok: true, value: { apps: [] } })
  })

  it.each([
    { SSH_CONNECTION: '10.0.0.2 55000 10.0.0.9 22' },
    { SSH_TTY: '/dev/pts/3' },
  ])('offers no applications and refuses icons and launches over SSH: %j', async (env) => {
    const run = vi.fn<NativeCommandRunner>()
    const launch = vi.fn<OpenInAppLauncher>()
    const resolveExecutable = vi.fn(pathTable())
    internals.catalog = { platform: 'darwin', env, run, launch, resolveExecutable }
    const { home, workspace } = await tempHome()
    const base = await boot([{ source: 'process', values: env }])
    try {
      expect(result(await call(base, 'apps', {}))).toEqual({ ok: true, value: { apps: [] } })
      expect(errorCode(await call(base, 'icon', { app: 'finder' }))).toBe('open-unavailable')
      expect(errorCode(await call(base, 'open', { app: 'finder', path: workspace }))).toBe('open-unavailable')
      expect(run).not.toHaveBeenCalled()
      expect(resolveExecutable).not.toHaveBeenCalled()
      expect(launch).not.toHaveBeenCalled()
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it.each(['project-env', 'user-env'] as const)('ignores SSH markers that come only from %s', async (source) => {
    internals.catalog = {
      platform: 'darwin', applicationRoots: [],
      run: () => Promise.reject(new Error('fixture rejects')), resolveExecutable: pathTable(),
    }
    const base = await boot([{ source, values: { SSH_CONNECTION: 'stale-connection', SSH_TTY: '/dev/pts/stale' } }])

    expect(result(await call(base, 'apps', {}))).toEqual({ ok: true, value: { apps: ['finder', 'terminal'] } })
  })

  it('removes the channel when the plugin row is disposed (HMR safety)', async () => {
    internals.catalog = { platform: 'aix', resolveExecutable: pathTable() }
    const base = await boot()
    expect(result(await call(base, 'apps', {}))).toEqual({ ok: true, value: { apps: [] } })
    const entry = [...(context as Context).loader.entries()]
      .find(candidate => candidate.options.name === OPEN_IN_APP)
    await entry?.fiber?.dispose()
    // The webserver and the connection survive; the channel's route is gone.
    expect((await call(base, 'apps', {})).status).toBe(404)
  })
})
