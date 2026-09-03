/**
 * Service Definition for the web access capability seam (`ctx.web`): registries and provider-selecting execution for search and
 * fetch. Duplicate ids are rejected. At execution time, a configured provider must exist and
 * be usable; without one, exactly one usable provider is required, so selection never depends
 * on registration order.
 * @module @arx-ai/arx-web
 */

import { Context, Service } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@arx-ai/arx-settings'
import type {
  WebConfigurableProvider,
  WebDirectoryRegistrationHandle,
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebProviderSelection,
  WebRegisteredSearchProvider,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSelectionFailure,
} from './types.ts'
import { WebError } from './types.ts'

export {
  WebError,
} from './types.ts'
export type {
  WebFetchBody,
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
  WebConfigurableProvider,
  WebDirectoryRegistrationHandle,
  WebProviderSelection,
  WebRegisteredSearchProvider,
  WebSelectionFailure,
} from './types.ts'

declare module '@arx-ai/cordis' {
  interface Context {
    web: WebRuntime
  }
}

/** Selection inputs for execution-time provider resolution. */
interface Selection<P> {
  /** The configured provider id for this capability, if any. */
  readonly configuredId?: string
  /** Providers registered for this capability kind. */
  readonly providers: ReadonlyMap<string, P>
}

/**
 * Settings namespace resolving {@link WebRuntimeConfig}, so a deployment's
 * provider selection is editable at runtime rather than fixed at composition.
 */
export const WEB_SETTINGS_NAMESPACE = settingsNamespace('web')

/**
 * Config for the web seam. `searchProvider` / `fetchProvider` pin which provider
 * wins for each capability; both are optional (a single registered usable
 * provider auto-selects). Operational overrides such as environment variables
 * must feed these same fields rather than introduce a hidden priority chain.
 */
export interface WebRuntimeConfig {
  /** Explicit search provider id. Omitted = auto-select when exactly one usable. */
  readonly searchProvider?: string
  /** Explicit fetch provider id. Omitted = auto-select when exactly one usable. */
  readonly fetchProvider?: string
}

/**
 * The web access service. Registered as `ctx.web` (one instance per context).
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured id that is registered and `available()` → that provider.
 * - A configured id not registered → `WEB_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable →
 *   `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `WEB_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `WEB_PROVIDER_UNAVAILABLE`.
 */
export class WebRuntime extends Service {
  /**
   * Provider selection config. Operational env overrides feed the SAME fields:
   * `$ARX_WEB_SEARCH_PROVIDER` / `$ARX_WEB_FETCH_PROVIDER` are equivalent to
   * `searchProvider` / `fetchProvider` and are NOT a hidden priority chain.
   */
  static Config: z<WebRuntimeConfig> = z.object({
    searchProvider: z.string(),
    fetchProvider: z.string(),
  })

  private searchProviders = new Map<string, WebSearchProvider>()
  private fetchProviders = new Map<string, WebFetchProvider>()
  private searchDirectory = new Map<string, WebConfigurableProvider>()
  private source: () => WebRuntimeConfig

  constructor(ctx: Context, config: WebRuntimeConfig = {}) {
    super(ctx, 'web')
    this.source = () => config
    installSettingsSection(ctx, WEB_SETTINGS_NAMESPACE, WebRuntime.Config, config, {
      setSource: (current) => {
        this.source = current
      },
      // Both selections resolve per call through the getters below, so a
      // committed change is already in force the next time a capability runs.
      // Nothing is derived from the source at attach time to rebuild here.
      onChange: () => {},
    })
  }

  /** Search provider pinned by the settings document, else by the environment. */
  private get searchProviderId(): string | undefined {
    return this.source().searchProvider ?? process.env.ARX_WEB_SEARCH_PROVIDER
  }

  /** Fetch provider pinned by the settings document, else by the environment. */
  private get fetchProviderId(): string | undefined {
    return this.source().fetchProvider ?? process.env.ARX_WEB_FETCH_PROVIDER
  }

  /**
   * Register a search provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
   * if its id is already registered for search. Returns a disposer; disposed
   * with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerSearchProvider(provider: WebSearchProvider): () => void {
    return this.registerProvider(this.searchProviders, provider, () => { this.emitProvidersUpdated() })
  }

  /**
   * Register a fetch provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
   * if its id is already registered for fetch. Returns a disposer; disposed
   * with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerFetchProvider(provider: WebFetchProvider): () => void {
    return this.registerProvider(this.fetchProviders, provider)
  }

  private registerProvider<P extends { readonly id: string }>(
    store: Map<string, P>,
    provider: P,
    notify?: () => void,
  ): () => void {
    if (store.has(provider.id)) {
      throw new WebError(`a web provider with id "${provider.id}" is already registered`, 'WEB_DUPLICATE_PROVIDER')
    }
    const dispose = this.ctx.effect(function* () {
      store.set(provider.id, provider)
      notify?.()
      yield () => {
        store.delete(provider.id)
        notify?.()
      }
    }, 'web.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * Run one search through the selected provider. Resolves the provider at call
   * time with the selection rules above; throws {@link WebError} when the
   * capability cannot run. The seam enforces `request.maxResults` on the result:
   * if the provider over-returns, `sources[]` is truncated and `truncated` set.
   * @param request - the query and optional result limit.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the provider's results, capped to `request.maxResults`.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const provider = resolveProvider({
      providers: this.searchProviders,
      ...this.searchProviderId !== undefined ? { configuredId: this.searchProviderId } : {},
    })
    const result = await provider.search(request, signal)
    return capSources(result, request.maxResults)
  }

  /**
   * Retrieve one URL through the selected provider. Resolves the provider at
   * call time with the selection rules above; throws {@link WebError} when the
   * capability cannot run. A non-2xx response is a result, not a throw.
   * @param request - the URL plus retrieval options.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the retrieval outcome; non-2xx responses resolve descriptively.
   */
  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const provider = resolveProvider({
      providers: this.fetchProviders,
      ...this.fetchProviderId !== undefined ? { configuredId: this.fetchProviderId } : {},
    })
    return provider.fetch(request, signal)
  }

  /**
   * The search selection as the next `search()` would resolve it, without
   * running one: the pinned id, the provider the rules name, and otherwise
   * the failure code a call would throw.
   * @returns the current selection, detached.
   */
  searchSelection(): WebProviderSelection {
    const configured = this.searchProviderId
    const outcome = selectProvider({
      providers: this.searchProviders,
      ...configured !== undefined ? { configuredId: configured } : {},
    })
    return 'failure' in outcome
      ? { configured, effective: undefined, failure: outcome.failure }
      : { configured, effective: outcome.provider.id }
  }

  /**
   * Describe every registered search provider with its usability answer.
   * @returns detached entries in registration order.
   */
  listSearchProviders(): WebRegisteredSearchProvider[] {
    return [...this.searchProviders.values()].map(provider => ({ id: provider.id, available: provider.available() }))
  }

  /**
   * List every declared configurable search provider.
   * @returns detached directory entries in declaration order.
   */
  listConfigurableSearchProviders(): WebConfigurableProvider[] {
    return [...this.searchDirectory.values()].map(entry => ({ ...entry, settingsPath: [...entry.settingsPath] }))
  }

  /**
   * Declare search providers a plugin makes configurable through a settings
   * section. Registration is all-or-nothing: an empty list, invalid entry, or
   * a provider already declared by any registration throws `WebError` without
   * registering the rest. Disposed with the fiber.
   * @param entries - every configurable search provider this plugin owns.
   * @returns a handle that withdraws all of them, and can atomically replace them.
   */
  registerConfigurableSearchProviders(entries: readonly WebConfigurableProvider[]): WebDirectoryRegistrationHandle {
    let held: WebConfigurableProvider[] = []
    let disposed = false
    // Validate a candidate set in full against everything this registration
    // does not already hold, then publish it. Nothing is written until the
    // whole set passes, so a refused candidate leaves the current entries in
    // place — what makes `replace` a swap rather than a delete-then-add that
    // can strand the directory empty.
    const commit = (candidates: readonly WebConfigurableProvider[]): void => {
      const detached: WebConfigurableProvider[] = []
      const own = new Set(held.map(entry => entry.provider))
      for (const entry of candidates) {
        if (entry.provider.length === 0 || entry.displayName.length === 0 || entry.settingsNs.length === 0) {
          throw new WebError('configurable search providers need a non-empty provider, displayName, and settingsNs', 'WEB_INVALID_DIRECTORY')
        }
        if (entry.settingsPath.some(segment => segment.length === 0)) {
          throw new WebError(`configurable search provider "${entry.provider}" has an empty settingsPath segment`, 'WEB_INVALID_DIRECTORY')
        }
        if ((this.searchDirectory.has(entry.provider) && !own.has(entry.provider))
          || detached.some(seen => seen.provider === entry.provider)) {
          throw new WebError(`configurable search provider "${entry.provider}" is already declared`, 'WEB_DUPLICATE_DIRECTORY')
        }
        detached.push({ ...entry, settingsPath: [...entry.settingsPath] })
      }
      for (const entry of held) this.searchDirectory.delete(entry.provider)
      for (const entry of detached) this.searchDirectory.set(entry.provider, entry)
      held = detached
      this.emitProvidersUpdated()
    }

    const dispose = this.ctx.effect(function* (this: WebRuntime) {
      if (entries.length === 0) {
        throw new WebError('a configurable-search-provider registration must declare at least one provider', 'WEB_INVALID_DIRECTORY')
      }
      commit(entries)
      yield () => {
        disposed = true
        for (const entry of held) this.searchDirectory.delete(entry.provider)
        held = []
        this.emitProvidersUpdated()
      }
    }.bind(this), 'web.registerConfigurableSearchProviders()')

    const handle = ((): void => void dispose()) as WebDirectoryRegistrationHandle
    handle.replace = (next: readonly WebConfigurableProvider[]): void => {
      if (disposed) {
        throw new WebError('this configurable-search-provider registration was disposed', 'WEB_REGISTRATION_DISPOSED')
      }
      commit(next)
    }
    return handle
  }

  /* jscpd:ignore-start -- deliberate symmetry with the llm registry's
     notification: the contained-dispatch shape is the reviewed listener-
     lifecycle contract, and sharing it would couple the two seams' events. */
  /** Notify topology observers without letting one broken listener veto the commit. */
  private emitProvidersUpdated(): void {
    let invariantFailure: unknown
    for (const listener of this.ctx.events.dispatch('emit', ['web/providers-updated']) as Array<() => unknown>) {
      try {
        const returned = listener()
        if (returned != null && typeof (returned as PromiseLike<unknown>).then === 'function') {
          // An emit listener may still be an async function; its rejection
          // cannot reach the synchronous INVARIANT rethrow below, so it is
          // contained here instead of becoming an unhandled rejection.
          void Promise.resolve(returned as PromiseLike<unknown>).then(undefined, (error: unknown) => {
            this.warnProvidersListenerFailure(error)
          })
        }
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'INVARIANT') {
          invariantFailure ??= error
          continue
        }
        this.warnProvidersListenerFailure(error)
      }
    }
    if (invariantFailure !== undefined) throw invariantFailure as Error
  }

  /** Contained-listener diagnostic shared by the sync and async failure paths. */
  private warnProvidersListenerFailure(error: unknown): void {
    this.ctx.logger.warn('web: a web/providers-updated listener failed')
    this.ctx.logger.warn(error)
  }
  /* jscpd:ignore-end */
}

interface ResolvableProvider {
  readonly id: string
  available(): boolean
}

/** The selection rules, answered without throwing: the provider, or the failure a call would raise. */
function selectProvider<P extends ResolvableProvider>(
  selection: Selection<P>,
): { provider: P } | { failure: WebSelectionFailure; message: string } {
  const { configuredId, providers } = selection
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      return { failure: 'WEB_PROVIDER_CONFIGURED_MISSING', message: `configured web provider "${configuredId}" is not registered` }
    }
    if (!provider.available()) {
      return { failure: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE', message: `configured web provider "${configuredId}" is registered but unavailable` }
    }
    return { provider }
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    return { failure: 'WEB_PROVIDER_UNAVAILABLE', message: 'no usable web provider is registered' }
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    return { failure: 'WEB_PROVIDER_AMBIGUOUS', message: `multiple usable web providers are registered (${ids}); configure one explicitly` }
  }
  return { provider: single }
}

/** Resolve the selected provider or throw the matching {@link WebError}. */
function resolveProvider<P extends ResolvableProvider>(selection: Selection<P>): P {
  const outcome = selectProvider(selection)
  if ('failure' in outcome) throw new WebError(outcome.message, outcome.failure)
  return outcome.provider
}

/** Enforce `maxResults` on a search result: truncate `sources[]` and flag it. */
function capSources(result: WebSearchResult, maxResults: number | undefined): WebSearchResult {
  if (maxResults === undefined || result.sources.length <= maxResults) return result
  return { ...result, sources: result.sources.slice(0, maxResults), truncated: true }
}

export default WebRuntime
