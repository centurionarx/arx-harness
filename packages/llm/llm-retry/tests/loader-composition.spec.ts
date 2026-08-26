import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import Loader from '@arx-ai/cordis-plugin-loader'
import Include from '@arx-ai/cordis-plugin-include'
import AgentRegistry from '@arx-ai/arx-agent'
import AgentLoop from '@arx-ai/arx-agent-loop'
import LlmRuntime, { createUserMessage, LlmAdapter, LlmError, resolveRetryPolicy  } from '@arx-ai/arx-llm'
import type { GenerateOptions, ResolvedRetryPolicy, StreamChunk } from '@arx-ai/arx-llm'
import SessionStore, { SessionId } from '@arx-ai/arx-session'
import SystemPrompt from '@arx-ai/arx-system-prompt'
import ToolRuntime from '@arx-ai/arx-tools'
import * as retry from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

class TransientOnceAdapter extends LlmAdapter {
  requests = 0
  private readonly retryPolicy = resolveRetryPolicy({
    mode: 'normal',
    maxRetries: 1,
    retryableCodes: ['RATE_LIMIT', 'SERVER'],
    backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
  }, 'loader test provider retryPolicy')

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return this.retryPolicy
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests += 1
    if (this.requests === 1) throw new LlmError('temporary outage', 'SERVER')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'recovered' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'recovered' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'arx-llm-retry-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@arx-ai/arx-llm', LlmRuntime],
    ['@arx-ai/arx-session', SessionStore],
    ['@arx-ai/arx-system-prompt', SystemPrompt],
    ['@arx-ai/arx-tools', ToolRuntime],
    ['@arx-ai/arx-agent', AgentRegistry],
    ['@arx-ai/arx-llm-retry', retry],
    ['@arx-ai/arx-agent-loop', AgentLoop],
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
  return context
}

describe('real Loader composition', () => {
  // Real-Loader composition resolves workspace packages through tsx at test
  // time; first resolution after the host/client program split is slow enough
  // to trip the default 5s budget on cold caches.
  it('loads provider-supplied policy and records recovery through the shipping loop', { timeout: 60_000 }, async () => {
    const loaded = await loadYaml([
      "- name: '@arx-ai/arx-llm'",
      "- name: '@arx-ai/arx-session'",
      "- name: '@arx-ai/arx-system-prompt'",
      "- name: '@arx-ai/arx-tools'",
      "- name: '@arx-ai/arx-agent'",
      "- name: '@arx-ai/arx-llm-retry'",
      "- name: '@arx-ai/arx-agent-loop'",
    ])

    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    expect(loaded.agents).toBeInstanceOf(AgentRegistry)

    const adapter = new TransientOnceAdapter()
    loaded.llm.registerAdapter(['mock'], adapter)
    const agent = loaded.agentLoop.create(SessionId('loader-retry'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'recover' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toBe(2)
    expect(agent.session.events.filter(event => event.type === 'llm/retry')).toHaveLength(1)
    expect(agent.session.deriveMessages().at(-1)).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'recovered' }],
    })
  })
})
