/**
 * The plugin over a real llm registry and a real settings provider: what it
 * offers while dormant, what a settings section makes it serve, and what it
 * refuses without dropping the routes already serving.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@arx-ai/arx-llm'
import { settingsNamespace } from '@arx-ai/arx-settings'
import { FileSettingsProvider } from '@arx-ai/arx-settings-file'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@arx-ai/arx-subprocess'

const queryMock = vi.fn()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => queryMock(...args) as unknown,
}))

// Imported after the mock is declared: the plugin reaches the vendor SDK
// through discovery, and the factory above closes over `queryMock`.
const AgentCli = await import('@arx-ai/arx-llm-agent-cli')
type Config = import('@arx-ai/arx-llm-agent-cli').Config

const NS = settingsNamespace('llm-agent-cli')

/** A route configuration the adapter can actually serve. */
const ROUTE = {
  displayName: 'Claude (subscription)',
  models: [{ id: 'claude-sonnet-5', contextWindow: 200_000 }],
}

/** Minimal foreign adapter: it only needs to own a route this plugin then wants. */
class StubAdapter extends LlmAdapter {
  override async * stream(): AsyncIterable<never> {
    throw new Error('stub adapter must never stream')
  }
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
  vi.restoreAllMocks()
  queryMock.mockReset()
})

async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'arx-agent-cli-plugin-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** A spawn seam recording every spec it is handed. */
function recordingSpawn(): { spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle; specs: SubprocessSpawnSpec[] } {
  const specs: SubprocessSpawnSpec[] = []
  return {
    specs,
    spawn: (spec) => {
      specs.push(spec)
      return {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        done: new Promise(() => {}),
        terminate: () => {},
      } as unknown as SubprocessHandle
    },
  }
}

/** The plugin over a live llm registry and a live settings document. */
async function boot(
  dir: string,
  config: Config = {},
  spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
    = () => { throw new Error('no request in this spec spawns a CLI') },
): Promise<Context> {
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LlmRuntime)
  ctx.provide('subprocess', { spawn } as never)
  await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
  await ctx.plugin(AgentCli, config)
  return ctx
}

/** A vendor run that spawns its CLI and answers a roster, as the real one does. */
function rosterRun(rows: readonly { value: string; displayName?: string }[]): void {
  queryMock.mockImplementation((request: unknown) => {
    const options = (request as { options: Record<string, unknown> }).options
    void (options['spawnClaudeCodeProcess'] as (o: unknown) => unknown)({
      command: '/usr/bin/claude', args: [], cwd: options['cwd'], env: {},
    })
    return { supportedModels: () => Promise.resolve(rows), interrupt: () => Promise.resolve() }
  })
}

/** The working directory the one run of a test was started in. */
function startedIn(): unknown {
  expect(queryMock).toHaveBeenCalledOnce()
  return (queryMock.mock.calls[0]?.[0] as { options: Record<string, unknown> }).options['cwd']
}

/** Write the settings section and let the provider commit it. */
async function writeSection(ctx: Context, dir: string, providers: object): Promise<void> {
  await writeFile(join(dir, 'settings.yaml'), '', 'utf8')
  await ctx.settings.update(NS, { providers })
}

describe('the dormant mount', () => {
  it('offers its routes by name while serving none', async () => {
    const ctx = await boot(await home())

    expect(ctx.llm.listProviders()).toEqual([])
    expect(ctx.llm.listConfigurableProviders()).toEqual([{
      provider: 'claude-subscription',
      displayName: 'Claude (subscription)',
      settingsNs: 'llm-agent-cli',
      settingsPath: ['providers', 'claude-subscription'],
      declared: false,
    }])
  })

  it('registers a route the composition entry configured, with no settings section', async () => {
    const ctx = await boot(await home(), { providers: { 'claude-subscription': ROUTE } })

    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['claude-subscription'])
  })
})

describe('the settings section', () => {
  it('registers a route it supplies and drops it when the user layer is replaced away', async () => {
    const dir = await home()
    const ctx = await boot(dir)

    await writeSection(ctx, dir, { 'claude-subscription': ROUTE })
    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['claude-subscription'])

    // `update` merges, so emptying a section is a replace: the user layer goes
    // away and only the composition entry — here, nothing — is left.
    await ctx.settings.replace(NS, {})
    expect(ctx.llm.listProviders()).toEqual([])
    // The offer survives the route: a page must still be able to add it back.
    expect(ctx.llm.listConfigurableProviders().map(entry => entry.provider)).toEqual(['claude-subscription'])
  })

  it('renames a route on the page that renamed it', async () => {
    const dir = await home()
    const ctx = await boot(dir)

    await writeSection(ctx, dir, { 'claude-subscription': { ...ROUTE, displayName: 'My subscription' } })

    expect(ctx.llm.listConfigurableProviders()[0]?.displayName).toBe('My subscription')
  })

  it('marks a route the package does not offer as declared by configuration', async () => {
    const dir = await home()
    const ctx = await boot(dir)

    await writeSection(ctx, dir, { 'team-subscription': ROUTE })

    expect(ctx.llm.listConfigurableProviders()).toEqual([
      expect.objectContaining({ provider: 'claude-subscription', declared: false }),
      expect.objectContaining({ provider: 'team-subscription', declared: true }),
    ])
    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['team-subscription'])
  })

  it('refuses a model whose default effort it does not serve, at the write', async () => {
    const dir = await home()
    const ctx = await boot(dir)

    await expect(writeSection(ctx, dir, {
      'claude-subscription': {
        models: [{ id: 'claude-sonnet-5', contextWindow: 200_000, efforts: ['low'], defaultEffort: 'high' }],
      },
    })).rejects.toThrow()
    // Nothing was stored, so nothing was withdrawn either.
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('keeps the routes already serving when a new section collides with another adapter', async () => {
    const dir = await home()
    const ctx = await boot(dir)
    await writeSection(ctx, dir, { 'claude-subscription': ROUTE })
    ctx.llm.registerAdapter(['taken'], new StubAdapter())
    const error = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})

    await ctx.settings.update(NS, { providers: { 'claude-subscription': ROUTE, taken: ROUTE } })

    expect(error).toHaveBeenCalledOnce()
    expect(String(error.mock.calls[0]?.[0])).toContain('previous routes still serving')
    expect(ctx.llm.listProviders().map(provider => provider.id).sort()).toEqual(['claude-subscription', 'taken'])
  })

  it('stores a section that configures only the working directory, registering no route', async () => {
    const dir = await home()
    const { spawn } = recordingSpawn()
    const ctx = await boot(dir, {}, spawn)
    rosterRun([])

    // A page may write the directory without naming a route; the section holds
    // no `providers` at all, which is a valid configuration, not an empty one.
    await writeFile(join(dir, 'settings.yaml'), '', 'utf8')
    await ctx.settings.update(NS, { cwd: '/from-settings' })

    expect(ctx.llm.listProviders()).toEqual([])
    await ctx.llm.discoverModels(NS, { provider: 'claude-subscription' })
    expect(startedIn()).toBe('/from-settings')
  })

  it('overlays the composition entry rather than replacing it, and falls back when the provider detaches', async () => {
    const dir = await home()
    const ctx = new Context()
    cleanups.push(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(LlmRuntime)
    ctx.provide('subprocess', { spawn: () => { throw new Error('unused') } } as never)
    const settings = ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
    await settings.await()
    await ctx.plugin(AgentCli, { providers: { 'entry-route': ROUTE } })
    await ctx.settings.update(NS, { providers: { 'section-route': ROUTE } })
    // The composition entry is the section's `base`: a deployment adding a
    // route from the page does not lose the one its composition pinned.
    expect(ctx.llm.listProviders().map(provider => provider.id).sort())
      .toEqual(['entry-route', 'section-route'])

    await settings.dispose()

    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['entry-route'])
  })
})

describe('model discovery', () => {
  it('answers the namespace by running one CLI under the harness subprocess seam', async () => {
    const { spawn, specs } = recordingSpawn()
    const ctx = await boot(await home(), {}, spawn)
    rosterRun([{ value: 'claude-sonnet-5', displayName: 'Claude Sonnet 5' }, { value: 'claude-opus-5' }])

    // Offered for the namespace, not a route: the route being added has no
    // adapter entry yet, which is the case a configuration surface is in.
    await expect(ctx.llm.discoverModels(NS, { provider: 'claude-subscription' })).resolves.toEqual([
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
      { id: 'claude-opus-5' },
    ])
    expect(specs.map(spec => spec.argv[0])).toEqual(['/usr/bin/claude'])
    // No configured directory, so the run inherits the process's own.
    expect(startedIn()).toBe(process.cwd())
  })

  it('runs in the directory the composition entry configured', async () => {
    const { spawn } = recordingSpawn()
    const ctx = await boot(await home(), { cwd: '/srv/project' }, spawn)
    rosterRun([])

    await ctx.llm.discoverModels(NS, { provider: 'claude-subscription' })

    expect(startedIn()).toBe('/srv/project')
  })
})

describe('the plugin disposer', () => {
  it('withdraws every route and every offer', async () => {
    const dir = await home()
    const ctx = new Context()
    cleanups.push(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(LlmRuntime)
    ctx.provide('subprocess', { spawn: () => { throw new Error('unused') } } as never)
    await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
    const fiber = ctx.plugin(AgentCli, { providers: { 'claude-subscription': ROUTE } })
    await fiber.await()
    expect(ctx.llm.listProviders()).toHaveLength(1)
    expect(ctx.llm.listConfigurableProviders()).toHaveLength(1)

    await fiber.dispose()

    expect(ctx.llm.listProviders()).toEqual([])
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
  })
})

describe('the settings document', () => {
  it('is what a configuration surface writes, and the plugin reads it back', async () => {
    const dir = await home()
    const ctx = await boot(dir)

    await writeSection(ctx, dir, { 'claude-subscription': ROUTE })

    const document = await readFile(join(dir, 'settings.yaml'), 'utf8')
    expect(document).toContain('llm-agent-cli:')
    expect(document).toContain('claude-sonnet-5')
    // No credential reference anywhere: this route authenticates through the
    // host CLI's own login, and nothing here holds a key.
    expect(document).not.toContain('apiKeyEnv')
  })
})
