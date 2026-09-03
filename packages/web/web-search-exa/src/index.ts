/**
 * `@arx-ai/arx-web-search-exa`: registers an Exa-backed `WebSearchProvider`
 * with `ctx.web`. A function/namespace plugin (NOT a default-export service):
 * a search provider does not own the `ctx.web` key — it registers INTO the
 * seam's provider registry, exactly as `@arx-ai/arx-llm-pi-ai`
 * registers an adapter into `ctx.llm`. The key is owned by `@arx-ai/arx-web`.
 *
 * @module @arx-ai/arx-web-search-exa
 */

import type { Context } from '@arx-ai/cordis'
import { launchEnvironmentOf } from '@arx-ai/arx-launch-environment'
import { credentialRef, isCredentialRefName } from '@arx-ai/arx-credentials'
import { installSettingsSection, settingsNamespace } from '@arx-ai/arx-settings'
import z from '@arx-ai/schemastery'
import type {} from '@arx-ai/arx-web'
import {
  EXA_DEFAULT_BASE_URL,
  EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
  EXA_DEFAULT_SEARCH_TYPE,
  EXA_PROVIDER_ID,
  ExaSearchProvider,
} from './provider.ts'

export {
  EXA_DEFAULT_BASE_URL,
  EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
  EXA_DEFAULT_SEARCH_TYPE,
  EXA_PROVIDER_ID,
  ExaSearchProvider,
} from './provider.ts'
export type { ExaSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-exa'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Exa API key inlined in the composition; set, it wins over every other source. */
  apiKey?: string
  /**
   * Credential reference the key resolves through when `apiKey` is not
   * inlined: the managed credential store first, then the launch environment.
   * Defaults to `EXA_API_KEY`; an empty result makes the provider unavailable.
   */
  apiKeyEnv?: string
  /** Endpoint base; `/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Retrieval mode sent as Exa's `type`. Defaults to `auto`. */
  searchType?: 'auto' | 'keyword' | 'neural'
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
  /** Highlight sentences requested per result. Defaults to 1. */
  highlightsPerResult?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string(),
  apiKeyEnv: z.string(),
  baseURL: z.string(),
  searchType: z.union(['auto', 'keyword', 'neural'] as const),
  numResults: z.number().step(1).min(1),
  highlightsPerResult: z.number().step(1).min(1),
})

/** Settings namespace whose section is this plugin's own `Config`. */
const NS = settingsNamespace('web-search-exa')

/** Credential reference the key resolves through when the section names none. */
const DEFAULT_API_KEY_ENV = 'EXA_API_KEY'

/**
 * Register the Exa search provider with `ctx.web`, declare it configurable
 * through the `web-search-exa` settings section, and keep its key current.
 * The provider reads its options at every search, so a committed settings
 * change is in force at the next call without re-registering.
 * @param ctx - the plugin context.
 * @param config - the composition entry, which becomes the section's `base` layer.
 */
export function apply(ctx: Context, config: Config): void {
  let source: () => Config = () => config
  // The managed store answers asynchronously, so its value is cached here and
  // refreshed on every commit that can change it; `available()` then stays
  // the cheap synchronous answer the seam requires.
  let storedKey: string | undefined
  const keyRef = (): string => source().apiKeyEnv ?? DEFAULT_API_KEY_ENV
  const refreshStoredKey = async (): Promise<void> => {
    const ref = keyRef()
    const credentials = ctx.get('credentials')
    storedKey = credentials !== undefined && isCredentialRefName(ref)
      ? (await credentials.resolve(credentialRef(ref)))?.value
      : undefined
  }
  const refresh = (): void => {
    refreshStoredKey().catch((error: unknown) => {
      ctx.logger.warn(`web-search-exa: resolving credential "${keyRef()}" failed; the launch environment answers until it succeeds`)
      ctx.logger.warn(error)
    })
  }

  ctx.web.registerSearchProvider(new ExaSearchProvider(() => {
    const current = source()
    return {
      // An inlined key wins; otherwise the managed store, then every launch
      // environment layer — the product trusts the project it is launched in.
      apiKey: current.apiKey ?? storedKey ?? launchEnvironmentOf(ctx).get(keyRef())?.value ?? '',
      baseURL: current.baseURL ?? EXA_DEFAULT_BASE_URL,
      searchType: current.searchType ?? EXA_DEFAULT_SEARCH_TYPE,
      highlightsPerResult: current.highlightsPerResult ?? EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
      ...current.numResults !== undefined ? { numResults: current.numResults } : {},
    }
  }))
  ctx.web.registerConfigurableSearchProviders([
    { provider: EXA_PROVIDER_ID, displayName: 'Exa', settingsNs: NS, settingsPath: [] },
  ])
  ctx.on('credentials/reference-updated', (ref) => {
    if (ref === keyRef()) refresh()
  })
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (current) => {
      source = current
    },
    // Only the cached store value can be stale after a commit, and only when
    // the reference it was read through moved; re-reading is cheaper than
    // diffing the section for that one field.
    onChange: refresh,
  })
  refresh()
}
