/** Keyless settings RPC transcript over a Loader-composed owner and file provider. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import Loader from '@arx-ai/cordis-plugin-loader'
import Include from '@arx-ai/cordis-plugin-include'
import z from '@arx-ai/schemastery'
import FileSettingsProvider from '@arx-ai/arx-settings-file'
import SessionStore from '@arx-ai/arx-session'
import SystemPrompt from '@arx-ai/arx-system-prompt'
import ToolRuntime from '@arx-ai/arx-tools'
import UserQuestionService from '@arx-ai/arx-user-questions'
import AgentRegistry from '@arx-ai/arx-agent'
import LlmRuntime from '@arx-ai/arx-llm'
import { createApiProxy, RpcId } from '@arx-ai/arx-host-apiproxy'
import { settingsNamespace } from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

it('keeps secret defaults off the wire and preserves stored secrets through safe writes', async () => {
  root = await mkdtemp(join(tmpdir(), 'arx-settings-wire-'))
  const settingsPath = join(root, 'settings.yaml')
  const configPath = join(root, 'cordis.yml')
  const fake = 'fixture-private-value'
  await writeFile(settingsPath, 'fixture:\n  token: fixture-private-value\n', { mode: 0o600 })
  await writeFile(configPath, [
    "- name: '@arx-ai/arx-session'",
    "- name: '@arx-ai/arx-system-prompt'",
    "- name: '@arx-ai/arx-tools'",
    "- name: '@arx-ai/arx-user-questions'",
    "- name: '@arx-ai/arx-agent'",
    "- name: '@arx-ai/arx-llm'",
    "- name: '@arx-ai/arx-settings-file'",
    '  config:',
    '    path: ' + JSON.stringify(settingsPath),
    '- name: fixture-owner',
    '',
  ].join('\n'))

  const owner = {
    name: 'fixture-owner',
    inject: ['settings'],
    apply(ctx: Context) {
      ctx.settings.register(settingsNamespace('fixture'), z.object({
        token: z.string().role('secret').default(fake),
        mode: z.union(['safe', 'advanced']).default('safe'),
      }), { base: { token: fake } })
    },
  }
  const ctx = context = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@arx-ai/arx-session', SessionStore],
    ['@arx-ai/arx-system-prompt', SystemPrompt],
    ['@arx-ai/arx-tools', ToolRuntime],
    ['@arx-ai/arx-user-questions', UserQuestionService],
    ['@arx-ai/arx-agent', AgentRegistry],
    ['@arx-ai/arx-llm', LlmRuntime],
    ['@arx-ai/arx-settings-file', FileSettingsProvider],
    ['fixture-owner', owner],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected settings fixture import')
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()

  const api = createApiProxy(ctx, { cwd: root, defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture' }) })
  const describe = await api.settings.describe({ rpcId: RpcId('read'), payload: {} })
  expect(describe.result.ok).toBe(true)
  if (!describe.result.ok) throw new Error('settings fixture did not load')
  const view = describe.result.value.namespaces[0]
  expect(view).toBeDefined()
  expect(JSON.stringify(describe)).not.toContain(fake)

  const update = await api.settings.update({ rpcId: RpcId('save'), payload: { ns: 'fixture', patch: { mode: 'advanced' } } })
  expect(update.result.ok).toBe(true)
  expect(JSON.stringify(update)).not.toContain(fake)
  expect(await readFile(settingsPath, 'utf8')).toContain(fake)

  const refused = await api.settings.update({ rpcId: RpcId('reject'), payload: { ns: 'fixture', patch: { mode: fake } } })
  expect(refused.result.ok).toBe(false)
  if (refused.result.ok) throw new Error('invalid fixture write was accepted')
  expect(JSON.stringify(refused)).not.toContain(fake)
  expect((ctx.settings.get(settingsNamespace('fixture')) as { mode: string }).mode).toBe('advanced')
  expect({ value: view?.value, base: view?.base, user: view?.user, secrets: view?.secrets, refusal: refused.result.error })
    .toMatchInlineSnapshot(`
      {
        "base": {},
        "refusal": {
          "code": "settings-rejected",
          "details": {
            "ns": "fixture",
          },
          "message": "settings write failed; check the registered schema and provider availability",
        },
        "secrets": [
          {
            "path": [
              "token",
            ],
            "set": true,
          },
        ],
        "user": {},
        "value": {
          "mode": "safe",
        },
      }
    `)
})
