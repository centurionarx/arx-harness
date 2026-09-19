/**
 * Package-owned invariant companion for `@arx-ai/arx-client-ui-file-preview`.
 * @module @arx-ai/arx-client-ui-file-preview/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'

const PACKAGE_NAME = '@arx-ai/arx-client-ui-file-preview'

/** Cordis companion plugin name. */
export const name = 'client-ui-file-preview-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: presentation owns transient resources only; request validation
 * and byte bounds belong to the host file-preview service. Teardown is component-tested. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
