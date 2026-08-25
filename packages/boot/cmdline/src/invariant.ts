/**
 * Package-owned invariant companion for `@centurionarx/cxh-cmdline`.
 * @module @centurionarx/cxh-cmdline/invariant
 */

import type { Context } from '@centurionarx/cordis'
import type { InvariantInstaller } from '@centurionarx/cxh-invariants'

const PACKAGE_NAME = '@centurionarx/cxh-cmdline'

/** Cordis companion plugin name. */
export const name = 'cmdline-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: `cmdlineArgs` is an immutable launcher fact that any
 * number of ordinary plugins may read. App-owned providers and consumers use
 * normal Cordis service injection, whose missing dependencies are already
 * reported by Loader settlement.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
