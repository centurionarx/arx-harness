/**
 * Package-owned invariant companion for `@arx-ai/arx-client-ui-settings-web`.
 * @module @arx-ai/arx-client-ui-settings-web/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'

const PACKAGE_NAME = '@arx-ai/arx-client-ui-settings-web'

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-web-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a settings section that reads the host through the
 * wire and writes back through it — it emits no cordis events and owns no
 * cross-plugin mutable relation of its own.
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
