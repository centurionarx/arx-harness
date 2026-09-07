/**
 * The key a search provider resolves through a credential reference. An
 * inlined value wins; otherwise the managed credential store, then every
 * launch-environment layer — the product trusts the project it is launched
 * in. The store answers asynchronously, so its value is cached here and
 * refreshed on every commit that can change it, which keeps a provider's
 * `available()` the cheap synchronous answer the seam requires.
 * @module @arx-ai/arx-web/provider-key
 */

import type { Context } from '@arx-ai/cordis'
import { credentialRef, isCredentialRefName } from '@arx-ai/arx-credentials'
import { launchEnvironmentOf } from '@arx-ai/arx-launch-environment'

/** What a provider plugin hands {@link providerKeySource}. */
export interface ProviderKeyOptions {
  /** The plugin's registered name, which prefixes its diagnostics. */
  readonly plugin: string
  /** The key inlined in the current configuration, when one is. */
  inline(): string | undefined
  /** The credential reference the current configuration names. */
  ref(): string
}

/** The live key answer of one provider. */
export interface ProviderKeySource {
  /**
   * The key as of the last refresh: the inlined value, else the cached store
   * value, else the launch environment; empty when none answers.
   * @returns the key to send, possibly empty.
   */
  current(): string
  /**
   * Re-read the store under the current reference. A failure warns and leaves
   * the launch environment answering until a later refresh succeeds; the
   * provider plugin calls this when its settings section commits.
   */
  refresh(): void
}

/**
 * Bind a provider's key to the credential seam and the launch environment.
 * The store is re-read at once, on every `refresh()`, and whenever a
 * credential is written under the watched reference; a reference outside the
 * seam's grammar can never have been stored, so it skips the store. Subscribed
 * through the plugin's own context, so it is disposed with the plugin.
 * @param ctx - the provider plugin's context.
 * @param options - where the inlined key and the reference come from.
 * @returns the source the provider reads its key from at each call.
 */
export function providerKeySource(ctx: Context, options: ProviderKeyOptions): ProviderKeySource {
  let stored: string | undefined
  const readStore = async (): Promise<void> => {
    const ref = options.ref()
    const credentials = ctx.get('credentials')
    stored = credentials !== undefined && isCredentialRefName(ref)
      ? (await credentials.resolve(credentialRef(ref)))?.value
      : undefined
  }
  const refresh = (): void => {
    readStore().catch((error: unknown) => {
      ctx.logger.warn(`${options.plugin}: resolving credential "${options.ref()}" failed; the launch environment answers until it succeeds`)
      ctx.logger.warn(error)
    })
  }
  ctx.on('credentials/reference-updated', (ref) => {
    if (ref === options.ref()) refresh()
  })
  refresh()
  return {
    current: () => options.inline() ?? stored ?? launchEnvironmentOf(ctx).get(options.ref())?.value ?? '',
    refresh,
  }
}
