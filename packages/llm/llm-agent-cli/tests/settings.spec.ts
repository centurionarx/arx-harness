import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import LlmRuntime from '@arx-ai/arx-llm'
import { settingsNamespace } from '@arx-ai/arx-settings'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'
import * as plugin from '../src/index.ts'
import { resolveRoutes } from '../src/config.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function boot() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(MemorySettings)
  ctx.provide('subprocess', { spawn: () => { throw new Error('No model call expected') } } as never)
  const fiber = await ctx.plugin(plugin, {})
  return { ctx, fiber }
}

const ns = settingsNamespace('llm-agent-cli')
const first = { providers: { 'claude-subscription': { displayName: 'Claude Max', models: [{ id: 'claude-sonnet-5' }] } } }

describe('subscription settings', () => {
  it('enables a dormant subscription route, updates its label and removes it live', async () => {
    const { ctx, fiber } = await boot()
    expect(ctx.llm.listProviders()).toEqual([])
    await ctx.settings.replace(ns, first)
    expect(ctx.llm.listProviders()).toEqual([{ id: 'claude-subscription', name: 'Claude Max' }])
    const prepared = await ctx.llm.prepareCall({ provider: 'claude-subscription', model: 'claude-sonnet-5' })
    expect(prepared.context?.contextWindow).toBeGreaterThan(0)
    await ctx.settings.replace(ns, { providers: { 'claude-subscription': { displayName: 'Renamed account', models: [{ id: 'custom', contextWindow: 12345 }] } } })
    expect(ctx.llm.listProviders()[0]?.name).toBe('Renamed account')
    expect(prepared.config.model).toBe('claude-sonnet-5')
    await ctx.settings.replace(ns, { providers: {} })
    expect(ctx.llm.listProviders()).toEqual([])
    await ctx.settings.replace(ns, first)
    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('rejects unknown capacity before changing the persisted settings or active route', async () => {
    const { ctx } = await boot()
    await ctx.settings.replace(ns, first)
    await expect(ctx.settings.replace(ns, { providers: { 'claude-subscription': { models: [{ id: 'unknown-model' }] } } })).rejects.toThrow(/contextWindow/)
    expect(ctx.llm.listProviders()).toEqual([{ id: 'claude-subscription', name: 'Claude Max' }])
  })

  it('preserves explicit capacity and image overrides over catalog metadata', () => {
    const model = resolveRoutes({ test: { models: [{ id: 'claude-sonnet-5', contextWindow: 50000, acceptsImages: false, maxTokens: 1200 }] } }).get('test')?.models.get('claude-sonnet-5')
    expect(model).toMatchObject({ contextWindow: 50000, acceptsImages: false, maxTokens: 1200 })
  })
})

