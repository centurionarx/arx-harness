/**
 * Package-owned invariant companion for `@arx-ai/arx-client-ui-turn-outline`.
 * @module @arx-ai/arx-client-ui-turn-outline/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'

const PACKAGE_NAME = '@arx-ai/arx-client-ui-turn-outline'

/** Cordis companion plugin name. */
export const name = 'client-ui-turn-outline-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: this read-only slot consumes the schema-validated host
 * projection and delegates navigation to the conversation owner; it writes no log data. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
