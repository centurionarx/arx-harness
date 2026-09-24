import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import Loader from '@arx-ai/cordis-plugin-loader'
import Include from '@arx-ai/cordis-plugin-include'
import LlmRuntime from '@arx-ai/arx-llm'
import FileSettingsProvider from '@arx-ai/arx-settings-file'
import { settingsNamespace } from '@arx-ai/arx-settings'
import * as AgentCli from '../src/index.ts'

let root: string | undefined
let ctx: Context | undefined
afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) {
    const target = resolve(root)
    if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error('Fixture outside temporary directory')
    await rm(target, { recursive: true, force: true })
  }
  root = undefined
})

it('loads the dormant CLI adapter through Loader and offers models immediately after Settings enables it', async () => {
  root = await mkdtemp(join(tmpdir(), 'arx-cli-settings-'))
  const settingsPath = join(root, 'settings.yaml')
  await writeFile(settingsPath, '# fixture settings\n')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- name: fixture-llm',
    '- name: fixture-subprocess',
    '- name: fixture-settings',
    '  config:',
    `    path: ${JSON.stringify(settingsPath)}`,
    '- name: fixture-agent-cli',
  ].join('\n'))
  ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['fixture-llm', LlmRuntime],
    ['fixture-settings', FileSettingsProvider],
    ['fixture-agent-cli', AgentCli],
    ['fixture-subprocess', { apply(context: Context) { context.provide('subprocess', { spawn() { throw new Error('Model execution not expected') } } as never) } }],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected fixture import: ${specifier}`)
      return modules.get(specifier)
    },
  } as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const app = ctx
  expect(app.llm.listProviders()).toEqual([])
  await app.settings.replace(settingsNamespace('llm-agent-cli'), {
    providers: { 'claude-subscription': { displayName: 'Claude subscription', models: [{ id: 'claude-sonnet-5' }] } },
  })
  await vi.waitFor(() =>{  expect(app.llm.listProviders()).toEqual([{ id: 'claude-subscription', name: 'Claude subscription' }]); })
  const prepared = await app.llm.prepareCall({ provider: 'claude-subscription', model: 'claude-sonnet-5' })
  expect(prepared.context?.contextWindow).toBeGreaterThan(0)
  await app.settings.replace(settingsNamespace('llm-agent-cli'), { providers: {} })
  expect(app.llm.listProviders()).toEqual([])
})
