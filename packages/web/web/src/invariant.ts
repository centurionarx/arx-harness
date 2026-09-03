/**
 * Package-owned invariant companion for `@arx-ai/arx-web`.
 * @module @arx-ai/arx-web/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'
// Type-only: the `ctx.web` Context merge and the `web/providers-updated` event key.
import type {} from './index.ts'
import type {} from './types.ts'

const PACKAGE_NAME = '@arx-ai/arx-web'

/** Cordis companion plugin name. */
export const name = 'web-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']
/* jscpd:ignore-end */

/**
 * Every `web/providers-updated` promises a coherent search directory: the
 * registry validates each commit, so an entry declared twice or naming no
 * settings namespace can only mean the notification fired outside a commit
 * point. Fetch publishes no notification, so nothing here observes it.
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('web/providers-updated', () => {
    // A disposer-time emit can outlive the service-store entry during whole-
    // context teardown; only a live service promises a readable directory.
    const web = ctx.get('web')
    if (web === undefined) return
    const seen = new Set<string>()
    for (const entry of web.listConfigurableSearchProviders()) {
      if (seen.has(entry.provider)) {
        fail(`web/providers-updated fired while the search directory declares "${entry.provider}" twice`)
      }
      seen.add(entry.provider)
      if (entry.settingsNs.length === 0) {
        fail(`web/providers-updated fired while directory entry "${entry.provider}" names no settings namespace`)
      }
    }
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
