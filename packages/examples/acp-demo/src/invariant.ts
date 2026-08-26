/**
 * Package-owned invariant companion for `@centurionarx/cxh-acp-demo`.
 * @module @centurionarx/cxh-acp-demo/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@centurionarx/cordis'
import type { InvariantInstaller } from '@centurionarx/cxh-invariants'

const PACKAGE_NAME = '@centurionarx/cxh-acp-demo'

/** Cordis companion plugin name. */
export const name = 'acp-demo-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this composition package owns no independent event stream or mutable data;
 * Loader and built-entry tests cover its wiring.
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
