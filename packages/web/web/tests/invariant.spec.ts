/** The search-directory coherence check bound to `web/providers-updated`. */

import { describe, expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import WebRuntime from '@arx-ai/arx-web'
import type { WebConfigurableProvider, WebSearchProvider } from '@arx-ai/arx-web'
import * as WebInvariant from '@arx-ai/arx-web/invariant'
import InvariantRegistry from '@arx-ai/arx-invariants'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(WebInvariant)
  return ctx
}

const exa: WebSearchProvider = { id: 'exa', available: () => true, search: () => Promise.resolve({ sources: [], truncated: false }) }
const entry: WebConfigurableProvider = { provider: 'exa', displayName: 'Exa', settingsNs: 'web-search-exa', settingsPath: [] }

describe('web/providers-updated invariants', () => {
  it('accepts a coherent directory at every topology notification', async () => {
    const ctx = await setup()
    await ctx.plugin(WebRuntime)
    const dispose = ctx.web.registerSearchProvider(exa)
    const handle = ctx.web.registerConfigurableSearchProviders([entry])
    handle.replace([{ ...entry, displayName: 'Exa Neural' }])
    handle()
    dispose()
    expect(ctx.web.listSearchProviders()).toEqual([])
  })

  it('skips the check when the service store has no web entry', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('web/providers-updated') }).not.toThrow()
  })

  it('reports a notification whose directory declares a provider twice', async () => {
    class BrokenWeb extends WebRuntime {
      override listConfigurableSearchProviders(): WebConfigurableProvider[] {
        return [entry, { ...entry }]
      }
    }
    const ctx = await setup()
    await ctx.plugin(BrokenWeb)
    expect(() => ctx.web.registerSearchProvider(exa)).toThrow(/declares "exa" twice/)
  })

  it('reports a notification whose directory entry names no settings namespace', async () => {
    class BrokenWeb extends WebRuntime {
      override listConfigurableSearchProviders(): WebConfigurableProvider[] {
        return [{ ...entry, settingsNs: '' }]
      }
    }
    const ctx = await setup()
    await ctx.plugin(BrokenWeb)
    expect(() => ctx.web.registerSearchProvider(exa)).toThrow(/names no settings namespace/)
  })
})
