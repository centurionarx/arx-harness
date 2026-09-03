/**
 * web domain contract: the search-provider topology for configuration
 * surfaces. `web.providers` joins the seam's registered search providers with
 * its configurable directory (which providers a settings section configures,
 * and where their profiles live) and carries the selection the next search
 * would resolve. Clients invalidate from the forwarded `web/providers-updated`,
 * `settings/document-updated`, and `credentials/reference-updated` owner events.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Wire view of one search provider the seam knows. */
export interface WebProviderView {
  /** Registered provider id (`exa`, `perplexity`, …). */
  provider: string
  /** Human-readable name for configuration surfaces; the id when no directory entry names one. */
  displayName: string
  /** Settings namespace whose section configures this provider; empty when it declared none. */
  settingsNs: string
  /** Path from that section's root to the provider's profile object (empty = whole section). */
  settingsPath: string[]
  /** The provider's own cheap usability answer; false for a directory entry with no registration. */
  available: boolean
}

/** Why the selection rules name no search provider: the code a search would throw. */
export type WebSelectionFailureView =
  | 'WEB_PROVIDER_CONFIGURED_MISSING'
  | 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE'
  | 'WEB_PROVIDER_UNAVAILABLE'
  | 'WEB_PROVIDER_AMBIGUOUS'

/** Wire view of the search selection as the next search would resolve it. */
export interface WebSelectionView {
  /** The id the settings document or the environment pins, when one does. */
  configured?: string
  /** The provider the rules name, when they name one. */
  effective?: string
  /** Why none serves, when none does. */
  failure?: WebSelectionFailureView
}

/** Web-domain unary methods (the map keys web.* of RpcMethodMap). */
export interface WebApi {
  /**
   * List every registered search provider with its usability, in registration
   * order, each joined with its directory entry when it declared one; a
   * directory entry whose provider is not registered is appended, unavailable.
   * `selection` is what the next search would resolve.
   */
  providers(request: RpcRequest<{}>): Promise<RpcResponse<{ providers: WebProviderView[]; selection: WebSelectionView }>>
}
