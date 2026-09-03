/**
 * `@arx-ai/arx-web-search-perplexity`: registers a Perplexity-backed
 * `WebSearchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): it registers INTO the seam's provider registry, the
 * way a model adapter package registers into `ctx.llm`.
 *
 * @module @arx-ai/arx-web-search-perplexity
 */

import type { Context } from '@arx-ai/cordis'
import { launchEnvironmentOf } from '@arx-ai/arx-launch-environment'
import { credentialRef, isCredentialRefName } from '@arx-ai/arx-credentials'
import { installSettingsSection, settingsNamespace } from '@arx-ai/arx-settings'
import z from '@arx-ai/schemastery'
import type {} from '@arx-ai/arx-web'
import {
  PERPLEXITY_DEFAULT_BASE_URL,
  PERPLEXITY_DEFAULT_MAX_TOKENS,
  PERPLEXITY_DEFAULT_MODEL,
  PERPLEXITY_PROVIDER_ID,
  PerplexitySearchProvider,
} from './provider.ts'

export {
  PERPLEXITY_DEFAULT_BASE_URL,
  PERPLEXITY_DEFAULT_MAX_TOKENS,
  PERPLEXITY_DEFAULT_MODEL,
  PERPLEXITY_PROVIDER_ID,
  PerplexitySearchProvider,
} from './provider.ts'
export type { PerplexityRecency, PerplexitySearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-perplexity'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Perplexity API key inlined in the composition; set, it wins over every other source. */
  apiKey?: string
  /**
   * Credential reference the key resolves through when `apiKey` is not
   * inlined: the managed credential store first, then the launch environment.
   * Defaults to `PERPLEXITY_API_KEY`; an empty result makes the provider unavailable.
   */
  apiKeyEnv?: string
  /** Endpoint base; `/chat/completions` is appended. Defaults to the public API. */
  baseURL?: string
  /** Search model name. Defaults to `sonar`. */
  model?: string
  /** Upper bound on generated answer tokens. Defaults to 1024. */
  maxTokens?: number
  /** Recency window sent as `search_recency_filter`. Omitted = no filter. */
  searchRecency?: 'day' | 'week' | 'month' | 'year'
}

export const Config: z<Config> = z.object({
  apiKey: z.string(),
  apiKeyEnv: z.string(),
  baseURL: z.string(),
  model: z.string(),
  maxTokens: z.number().step(1).min(1),
  searchRecency: z.union(['day', 'week', 'month', 'year'] as const),
})

/** Settings namespace whose section is this plugin's own `Config`. */
const NS = settingsNamespace('web-search-perplexity')

/** Credential reference the key resolves through when the section names none. */
const DEFAULT_API_KEY_ENV = 'PERPLEXITY_API_KEY'

/**
 * Register the Perplexity search provider with `ctx.web`, declare it
 * configurable through the `web-search-perplexity` settings section, and keep
 * its key current. The provider reads its options at every search, so a
 * committed settings change is in force at the next call without
 * re-registering.
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
      ctx.logger.warn(`web-search-perplexity: resolving credential "${keyRef()}" failed; the launch environment answers until it succeeds`)
      ctx.logger.warn(error)
    })
  }

  ctx.web.registerSearchProvider(new PerplexitySearchProvider(() => {
    const current = source()
    return {
      // An inlined key wins; otherwise the managed store, then every launch
      // environment layer — the product trusts the project it is launched in.
      apiKey: current.apiKey ?? storedKey ?? launchEnvironmentOf(ctx).get(keyRef())?.value ?? '',
      baseURL: current.baseURL ?? PERPLEXITY_DEFAULT_BASE_URL,
      model: current.model ?? PERPLEXITY_DEFAULT_MODEL,
      maxTokens: current.maxTokens ?? PERPLEXITY_DEFAULT_MAX_TOKENS,
      ...current.searchRecency !== undefined ? { searchRecency: current.searchRecency } : {},
    }
  }))
  ctx.web.registerConfigurableSearchProviders([
    { provider: PERPLEXITY_PROVIDER_ID, displayName: 'Perplexity', settingsNs: NS, settingsPath: [] },
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
