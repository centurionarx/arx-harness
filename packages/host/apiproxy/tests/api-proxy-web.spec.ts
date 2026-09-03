/**
 * The web domain: registered search providers joined with the seam's
 * configurable directory, and the selection the next search would resolve.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import AgentRegistry from '@arx-ai/arx-agent'
import LlmRuntime from '@arx-ai/arx-llm'
import SessionStore from '@arx-ai/arx-session'
import SystemPrompt from '@arx-ai/arx-system-prompt'
import UserQuestionService from '@arx-ai/arx-user-questions'
import WebRuntime from '@arx-ai/arx-web'
import type { WebSearchProvider } from '@arx-ai/arx-web'
import type { RpcRequest } from '@arx-ai/arx-host-apiproxy/api/rpc'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`web-${String(nextRpc++)}`), payload }
}

function provider(id: string, available: boolean): WebSearchProvider {
  return { id, available: () => available, search: () => Promise.resolve({ sources: [], truncated: false }) }
}

async function harness(web: ConstructorParameters<typeof WebRuntime>[1] | false = {}): Promise<{
  ctx: Context
  api: ReturnType<typeof createApiProxy>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  if (web !== false) await ctx.plugin(WebRuntime, web)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
    cwd: '/tmp',
  })
  return { ctx, api }
}

function expectValue<T>(response: { result: { ok: true; value: T } | { ok: false } }): T {
  if (!response.result.ok) throw new Error('expected successful response')
  return response.result.value
}

describe('web.providers', () => {
  it('joins the registry with the directory, in registration order, and appends dormant declarations', async () => {
    const { ctx, api } = await harness()
    ctx.web.registerSearchProvider(provider('exa', true))
    ctx.web.registerSearchProvider(provider('ghost', false))
    ctx.web.registerConfigurableSearchProviders([
      { provider: 'exa', displayName: 'Exa', settingsNs: 'web-search-exa', settingsPath: [] },
      { provider: 'dormant', displayName: 'Dormant', settingsNs: 'web-search-dormant', settingsPath: ['profile'] },
    ])

    const value = expectValue(await api.web.providers(request({})))
    expect(value.providers).toEqual([
      { provider: 'exa', displayName: 'Exa', settingsNs: 'web-search-exa', settingsPath: [], available: true },
      { provider: 'ghost', displayName: 'ghost', settingsNs: '', settingsPath: [], available: false },
      { provider: 'dormant', displayName: 'Dormant', settingsNs: 'web-search-dormant', settingsPath: ['profile'], available: false },
    ])
    expect(value.selection).toEqual({ effective: 'exa' })
  })

  it('reports the pinned selection, and the failure a search would throw', async () => {
    const pinned = await harness({ searchProvider: 'perplexity' })
    pinned.ctx.web.registerSearchProvider(provider('exa', true))
    pinned.ctx.web.registerSearchProvider(provider('perplexity', true))
    expect(expectValue(await pinned.api.web.providers(request({}))).selection)
      .toEqual({ configured: 'perplexity', effective: 'perplexity' })

    const ambiguous = await harness()
    ambiguous.ctx.web.registerSearchProvider(provider('exa', true))
    ambiguous.ctx.web.registerSearchProvider(provider('perplexity', true))
    expect(expectValue(await ambiguous.api.web.providers(request({}))).selection)
      .toEqual({ failure: 'WEB_PROVIDER_AMBIGUOUS' })

    const missing = await harness({ searchProvider: 'ghost' })
    expect(expectValue(await missing.api.web.providers(request({}))).selection)
      .toEqual({ configured: 'ghost', failure: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  })

  it('names the missing seam when the composition mounts no web service', async () => {
    const { api } = await harness(false)
    const response = await api.web.providers(request({}))
    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('internal')
    expect(response.result.error.message).toContain('web service is absent')
  })
})
