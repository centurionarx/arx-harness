/**
 * Vocabulary for the web capability seam (`ctx.web`). Search and fetch deliberately share one
 * seam so provider selection, cancellation, errors, and product configuration have one owner,
 * while retaining separate request and result types.
 * @module @arx-ai/arx-web/types
 */

import { HarnessError } from '@arx-ai/arx-llm'

/**
 * What one search-capable backend is asked to search. Each request carries one
 * query; a consumer may issue several requests. `maxResults` is a
 * `arx-tool-web`-layer bound passed through unchanged and enforced on the way
 * back by the seam (see {@link WebSearchResult}).
 */
export interface WebSearchRequest {
  readonly query: string
  /**
   * Upper bound on returned sources; the seam truncates to it. Omitted = no
   * bound. `arx-tool-web` always sets it. A provider whose API supports a
   * result-count control (Exa's `numResults`) should apply it at the request
   * layer as a cost/latency optimization; the seam enforces the bound
   * regardless.
   */
  readonly maxResults?: number
}

/**
 * Normalized search outcome. `content` is optional provider-generated answer
 * text or summary (Exa returns none; Perplexity returns a generated answer).
 * `sources[]` is the portable citation shape. `truncated` is set by the seam
 * when it cut `sources[]` down to `maxResults`.
 */
export interface WebSearchResult {
  /** Optional provider-generated answer text, search context, or summary. */
  readonly content?: string
  /** Citeable sources, already truncated to the request's `maxResults`. */
  readonly sources: readonly WebSearchSource[]
  /** True when the seam dropped sources to honor `maxResults`. */
  readonly truncated: boolean
}

/**
 * One citeable source. A source always has a URL; `title`, `snippet`, and
 * `publishedAt` are optional because not every provider returns them — forcing
 * adapters to invent them would make the seam lie (Perplexity citations may be
 * URL-only). `arx-tool-web` renders `title ?? hostname(url)` for display.
 */
export interface WebSearchSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  /** Publication/crawl timestamp as a provider-supplied ISO-8601 string. */
  readonly publishedAt?: string
}

/**
 * What one fetch-capable backend is asked to retrieve. The request deliberately
 * omits timeout, format, prompt, and extraction controls: cancellation is a
 * direct execution argument, while presentation and higher-level LLM concerns
 * belong outside safe retrieval.
 */
export interface WebFetchRequest {
  readonly url: string
}

/**
 * Normalized fetch outcome. A successful network fetch of a non-2xx response is
 * a result, not an error: the status code is part of the fetched resource
 * state. {@link WebError} is reserved for failures to safely retrieve or
 * represent the resource.
 */
export interface WebFetchResult {
  /** The final URL after allowed redirects (the request URL is in the request). */
  readonly url: string
  /** HTTP status code of the fetched response. */
  readonly statusCode: number
  /** Decoded body, classified by content kind. */
  readonly body: WebFetchBody
  /** True when the provider capped the decoded body. */
  readonly truncated: boolean
}

/**
 * The decoded body of a fetched resource. A CLOSED discriminated union owned by
 * `arx-web`: the provider decodes the kind and `arx-tool-web` renders it, so a
 * new kind is a coordinated change across known packages, not a plugin
 * extension. Consumers `switch` on `kind` ending in `default: assertNever(...)`
 * so adding a kind breaks compilation at every consumer until handled. Each arm
 * stays its own object literal even where fields coincide, so an arm can gain
 * fields the others lack.
 */
export type WebFetchBody =
  | { readonly kind: 'html'; readonly content: string }
  | { readonly kind: 'text'; readonly content: string }

/**
 * A search-capable backend. Registered with `ctx.web.registerSearchProvider`.
 * `id` is a stable string, unique within the search capability kind.
 */
export interface WebSearchProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /** Run one search; honor `signal` for cancellation. */
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
}

/**
 * A fetch-capable backend. Registered with `ctx.web.registerFetchProvider`.
 * `id` is a stable string, unique within the fetch capability kind.
 */
export interface WebFetchProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /** Retrieve one URL; honor `signal` for cancellation. */
  fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>
}

/**
 * Typed web error with a machine-routable, open-string `code` and chained `cause`.
 * Consumers must tolerate provider-specific codes. Shared codes cover unavailable,
 * missing, unusable, ambiguous, or duplicate providers, cancellation, and provider failure;
 * the local fetch provider additionally distinguishes invalid or blocked URLs, redirects,
 * size and timeout limits, and unsupported content types. Tool execution exposes the code in
 * structured error metadata.
 */
export class WebError extends HarnessError {}

/** Why the selection rules name no search provider; the `WebError` code `search()` would throw. */
export type WebSelectionFailure =
  | 'WEB_PROVIDER_CONFIGURED_MISSING'
  | 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE'
  | 'WEB_PROVIDER_UNAVAILABLE'
  | 'WEB_PROVIDER_AMBIGUOUS'

/**
 * The search selection as the next `search()` call would resolve it, computed
 * without running one. `configured` is the id the settings document or the
 * environment pins; `effective` is the provider the rules name, absent when
 * `failure` says why none serves.
 */
export interface WebProviderSelection {
  readonly configured: string | undefined
  readonly effective: string | undefined
  readonly failure?: WebSelectionFailure
}

/** One registered search provider and its current cheap usability answer. */
export interface WebRegisteredSearchProvider {
  readonly id: string
  readonly available: boolean
}

/**
 * One search provider a plugin declares as configurable through a settings
 * section: where a configuration surface finds its profile, and how to name
 * it. Declared beside the provider registration, never inferred from it, so a
 * provider mounted without a settings section stays selectable but shows no
 * configuration address.
 */
export interface WebConfigurableProvider {
  /** The registered search provider id this entry describes. */
  provider: string
  /** Human-readable provider name for configuration surfaces. */
  displayName: string
  /** User-settings namespace whose section configures this provider. */
  settingsNs: string
  /**
   * Path from that namespace's section root to this provider's profile
   * object; empty when the whole section is the profile.
   */
  settingsPath: readonly string[]
}

/**
 * A live configurable-provider registration, disposable and atomically
 * replaceable. Calling it withdraws every entry it holds; `replace` validates
 * the whole candidate set before publishing, so a refused set leaves the
 * current entries serving.
 */
export interface WebDirectoryRegistrationHandle {
  (): void
  /**
   * Replace this registration's entries with `entries`. An entry another
   * registration already declares, a duplicate within the set, or invalid
   * metadata throws `WebError` and leaves the current entries untouched; an
   * empty array is legal here, unlike an empty initial registration.
   * @param entries - the complete next entry set for this registration.
   */
  replace(entries: readonly WebConfigurableProvider[]): void
}

declare module '@arx-ai/cordis' {
  interface Events {
    /**
     * The search-provider topology changed: a search provider registered or
     * unregistered, or the configurable directory gained, lost, or replaced
     * entries. This payload-free registry notification fires at each commit
     * point, registration disposal included; consumers re-read
     * `listSearchProviders()`, `listConfigurableSearchProviders()`, or
     * `searchSelection()` for the new state. Observer failures are contained
     * and cannot veto the registry mutation.
     * @mode emit
     */
    'web/providers-updated'(): void
  }
}
