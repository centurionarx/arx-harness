/**
 * Package-owned invariant companion for `@arx-ai/arx-host-open-in-app`.
 * @module @arx-ai/arx-host-open-in-app/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'

const PACKAGE_NAME = '@arx-ai/arx-host-open-in-app'

/** Cordis companion plugin name. */
export const name = 'open-in-app-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin serves one host resolution pass through a
 * stateless RPC channel and owns no event stream or session data; the
 * channel registration proves disposal through its HMR-safety spec, and the
 * resolution and launch behavior is enforced by unit tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
