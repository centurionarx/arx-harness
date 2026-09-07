/** The `web` settings section layered over the seam's composition entry. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import { SettingsProvider } from '@arx-ai/arx-settings'
import type { SettingsNamespace } from '@arx-ai/arx-settings'
import WebRuntime, { WEB_SETTINGS_NAMESPACE } from '@arx-ai/arx-web'
import type {
  WebFetchProvider, WebFetchResult, WebSearchProvider, WebSearchResult,
} from '@arx-ai/arx-web'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

function searchProvider(id: string): WebSearchProvider {
  return {
    id,
    available: () => true,
    search: () => Promise.resolve({ content: id, sources: [], truncated: false } satisfies WebSearchResult),
  }
}

function fetchProvider(id: string): WebFetchProvider {
  return {
    id,
    available: () => true,
    fetch: () => Promise.resolve({
      url: 'https://example.com',
      statusCode: 200,
      body: { kind: 'text', content: id },
      truncated: false,
    } satisfies WebFetchResult),
  }
}

/** Both providers registered, so selection is the only thing that decides. */
async function boot(config: ConstructorParameters<typeof WebRuntime>[1] = {}): Promise<{
  ctx: Context
  web: WebRuntime
  settings: MemorySettings
}> {
  const ctx = new Context()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  await ctx.plugin(WebRuntime, config)
  const web = ctx.web
  web.registerSearchProvider(searchProvider('exa'))
  web.registerSearchProvider(searchProvider('perplexity'))
  web.registerFetchProvider(fetchProvider('http'))
  web.registerFetchProvider(fetchProvider('headless'))
  return { ctx, web, settings: ctx.get('settings') as MemorySettings }
}

const originalSearch = process.env.ARX_WEB_SEARCH_PROVIDER
const originalFetch = process.env.ARX_WEB_FETCH_PROVIDER

afterEach(() => {
  if (originalSearch === undefined) Reflect.deleteProperty(process.env, 'ARX_WEB_SEARCH_PROVIDER')
  else process.env.ARX_WEB_SEARCH_PROVIDER = originalSearch
  if (originalFetch === undefined) Reflect.deleteProperty(process.env, 'ARX_WEB_FETCH_PROVIDER')
  else process.env.ARX_WEB_FETCH_PROVIDER = originalFetch
})

describe('web settings section', () => {
  it('resolves the user layer over the composition entry', async () => {
    const bench = await boot({ searchProvider: 'exa' })
    await expect(bench.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'exa' })

    await bench.ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'perplexity' })

    await expect(bench.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'perplexity' })
    await bench.ctx.fiber.dispose()
  })

  it('selects the fetch provider from the same section', async () => {
    const bench = await boot({ fetchProvider: 'http' })
    await bench.ctx.settings.update(WEB_SETTINGS_NAMESPACE, { fetchProvider: 'headless' })

    await expect(bench.web.fetch({ url: 'https://example.com' }))
      .resolves.toMatchObject({ body: { content: 'headless' } })
    await bench.ctx.fiber.dispose()
  })

  it('a replaced-empty section returns selection to the composition entry', async () => {
    const bench = await boot({ searchProvider: 'exa' })
    await bench.ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'perplexity' })
    await expect(bench.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'perplexity' })

    await bench.ctx.settings.replace(WEB_SETTINGS_NAMESPACE, {})

    await expect(bench.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'exa' })
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the environment when neither layer names a provider', async () => {
    process.env.ARX_WEB_SEARCH_PROVIDER = 'perplexity'
    process.env.ARX_WEB_FETCH_PROVIDER = 'headless'
    const bench = await boot()

    await expect(bench.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'perplexity' })
    await expect(bench.web.fetch({ url: 'https://example.com' }))
      .resolves.toMatchObject({ body: { content: 'headless' } })
    await bench.ctx.fiber.dispose()
  })

  it('a stored selection outranks the environment', async () => {
    process.env.ARX_WEB_SEARCH_PROVIDER = 'perplexity'
    const bench = await boot()
    await bench.ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'exa' })

    await expect(bench.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'exa' })
    await bench.ctx.fiber.dispose()
  })
})
