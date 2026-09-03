/** The configurable search directory, the observable selection, and the topology event. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import WebRuntime from '@arx-ai/arx-web'
import type { WebConfigurableProvider, WebFetchProvider, WebSearchProvider } from '@arx-ai/arx-web'

function searchProvider(id: string, available = true): WebSearchProvider {
  return { id, available: () => available, search: () => Promise.resolve({ sources: [], truncated: false }) }
}

function fetchProvider(id: string): WebFetchProvider {
  return {
    id,
    available: () => true,
    fetch: () => Promise.resolve({ url: 'https://example.com', statusCode: 200, body: { kind: 'text', content: '' }, truncated: false }),
  }
}

const EXA: WebConfigurableProvider = { provider: 'exa', displayName: 'Exa', settingsNs: 'web-search-exa', settingsPath: [] }
const PERPLEXITY: WebConfigurableProvider = {
  provider: 'perplexity', displayName: 'Perplexity', settingsNs: 'web-search-perplexity', settingsPath: [],
}

async function mount(
  config: ConstructorParameters<typeof WebRuntime>[1] = {},
): Promise<{ ctx: Context; web: WebRuntime; updates: () => number }> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, config)
  let count = 0
  ctx.on('web/providers-updated', () => { count += 1 })
  return { ctx, web: ctx.web, updates: () => count }
}

describe('configurable search directory', () => {
  it('lists declared entries as detached copies in declaration order', async () => {
    const { web } = await mount()
    const nested: WebConfigurableProvider = { ...EXA, settingsPath: ['providers', 'exa'] }
    web.registerConfigurableSearchProviders([PERPLEXITY, nested])
    const listed = web.listConfigurableSearchProviders()
    expect(listed.map(entry => entry.provider)).toEqual(['perplexity', 'exa'])
    expect(listed[1]!.settingsPath).toEqual(['providers', 'exa'])
    expect(listed[1]!.settingsPath).not.toBe(nested.settingsPath)
    expect(listed[1]).not.toBe(web.listConfigurableSearchProviders()[1])
  })

  it.each<[WebConfigurableProvider[], string, string]>([
    [[], 'at least one provider', 'WEB_INVALID_DIRECTORY'],
    [[{ ...EXA, provider: '' }], 'non-empty provider', 'WEB_INVALID_DIRECTORY'],
    [[{ ...EXA, displayName: '' }], 'non-empty provider', 'WEB_INVALID_DIRECTORY'],
    [[{ ...EXA, settingsNs: '' }], 'non-empty provider', 'WEB_INVALID_DIRECTORY'],
    [[{ ...EXA, settingsPath: ['providers', ''] }], 'empty settingsPath segment', 'WEB_INVALID_DIRECTORY'],
    [[EXA, { ...EXA, displayName: 'Again' }], 'already declared', 'WEB_DUPLICATE_DIRECTORY'],
  ])('refuses an invalid registration whole (%j)', async (entries, message, code) => {
    const { web, updates } = await mount()
    expect(() => web.registerConfigurableSearchProviders(entries)).toThrow(expect.objectContaining({ code }))
    expect(() => web.registerConfigurableSearchProviders(entries)).toThrow(message)
    expect(web.listConfigurableSearchProviders()).toEqual([])
    expect(updates()).toBe(0)
  })

  it('refuses a provider another registration already declares', async () => {
    const { web } = await mount()
    web.registerConfigurableSearchProviders([EXA])
    expect(() => web.registerConfigurableSearchProviders([EXA]))
      .toThrow(expect.objectContaining({ code: 'WEB_DUPLICATE_DIRECTORY' }))
    expect(web.listConfigurableSearchProviders()).toHaveLength(1)
  })

  it('replaces atomically: a refused set leaves the held entries serving', async () => {
    const { web, updates } = await mount()
    const other = web.registerConfigurableSearchProviders([PERPLEXITY])
    const handle = web.registerConfigurableSearchProviders([EXA])
    expect(updates()).toBe(2)
    expect(() => { handle.replace([{ ...EXA, displayName: 'Exa Neural' }, PERPLEXITY]) })
      .toThrow(expect.objectContaining({ code: 'WEB_DUPLICATE_DIRECTORY' }))
    expect(web.listConfigurableSearchProviders().find(entry => entry.provider === 'exa')?.displayName).toBe('Exa')
    expect(updates()).toBe(2)

    handle.replace([{ ...EXA, displayName: 'Exa Neural' }])
    expect(web.listConfigurableSearchProviders().find(entry => entry.provider === 'exa')?.displayName).toBe('Exa Neural')
    handle.replace([])
    expect(web.listConfigurableSearchProviders().map(entry => entry.provider)).toEqual(['perplexity'])
    expect(updates()).toBe(4)
    other()
  })

  it('withdraws its entries on dispose and refuses a later replace', async () => {
    const { web, updates } = await mount()
    const handle = web.registerConfigurableSearchProviders([EXA])
    handle()
    expect(web.listConfigurableSearchProviders()).toEqual([])
    expect(updates()).toBe(2)
    expect(() => { handle.replace([EXA]) }).toThrow(expect.objectContaining({ code: 'WEB_REGISTRATION_DISPOSED' }))
  })

  it('disposes with the contributing fiber (HMR safety)', async () => {
    const { ctx, web } = await mount()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.web.registerConfigurableSearchProviders([EXA])
    }, { inject: ['web'] }))
    expect(web.listConfigurableSearchProviders()).toHaveLength(1)
    await fiber.dispose()
    expect(web.listConfigurableSearchProviders()).toEqual([])
  })
})

describe('web/providers-updated', () => {
  it('fires on search registration and disposal, never on fetch', async () => {
    const { web, updates } = await mount()
    const dispose = web.registerSearchProvider(searchProvider('exa'))
    expect(updates()).toBe(1)
    web.registerFetchProvider(fetchProvider('http'))
    expect(updates()).toBe(1)
    dispose()
    expect(updates()).toBe(2)
  })

  it('contains a throwing or rejecting listener and warns', async () => {
    const { ctx, web } = await mount()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ctx.on('web/providers-updated', () => { throw new Error('sync boom') })
    // Typed as returning unknown so the listener is not a Promise-returning
    // function type: the point is exactly that an async one may slip in.
    const rejecting = (): unknown => Promise.reject(new Error('async boom'))
    ctx.on('web/providers-updated', rejecting)
    let reached = 0
    ctx.on('web/providers-updated', () => { reached += 1 })
    expect(() => web.registerSearchProvider(searchProvider('exa'))).not.toThrow()
    expect(reached).toBe(1)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(warn.mock.calls.filter(call => call[0] === 'web: a web/providers-updated listener failed')).toHaveLength(2)
  })

  it('rethrows an INVARIANT-coded listener failure after every listener ran', async () => {
    const { ctx, web } = await mount()
    let reached = 0
    ctx.on('web/providers-updated', () => { throw Object.assign(new Error('violated'), { code: 'INVARIANT' }) })
    ctx.on('web/providers-updated', () => { reached += 1 })
    expect(() => web.registerSearchProvider(searchProvider('exa'))).toThrow('violated')
    expect(reached).toBe(1)
  })
})

describe('searchSelection() and listSearchProviders()', () => {
  it('describes registered providers with their usability', async () => {
    const { web } = await mount()
    web.registerSearchProvider(searchProvider('exa'))
    web.registerSearchProvider(searchProvider('perplexity', false))
    expect(web.listSearchProviders()).toEqual([{ id: 'exa', available: true }, { id: 'perplexity', available: false }])
  })

  it('names the provider the rules select, and the pinned id', async () => {
    const pinned = await mount({ searchProvider: 'perplexity' })
    pinned.web.registerSearchProvider(searchProvider('exa'))
    pinned.web.registerSearchProvider(searchProvider('perplexity'))
    expect(pinned.web.searchSelection()).toEqual({ configured: 'perplexity', effective: 'perplexity' })

    const single = await mount()
    single.web.registerSearchProvider(searchProvider('exa'))
    single.web.registerSearchProvider(searchProvider('perplexity', false))
    expect(single.web.searchSelection()).toEqual({ configured: undefined, effective: 'exa' })
  })

  it.each([
    [{}, [], 'WEB_PROVIDER_UNAVAILABLE'],
    [{}, [searchProvider('exa'), searchProvider('perplexity')], 'WEB_PROVIDER_AMBIGUOUS'],
    [{ searchProvider: 'ghost' }, [searchProvider('exa')], 'WEB_PROVIDER_CONFIGURED_MISSING'],
    [{ searchProvider: 'exa' }, [searchProvider('exa', false)], 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE'],
  ])('reports the failure a call would throw (%j → %s)', async (config, providers, failure) => {
    const { web } = await mount(config)
    for (const provider of providers) web.registerSearchProvider(provider)
    const selection = web.searchSelection()
    expect(selection.effective).toBeUndefined()
    expect(selection.failure).toBe(failure)
    await expect(web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: failure }))
  })
})
