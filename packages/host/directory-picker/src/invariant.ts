/** Package-owned invariant companion for the directory-picker seam. @module @centurionarx/cxh-host-directory-picker/invariant */

import type { Context } from '@centurionarx/cordis'
import type { InvariantInstaller } from '@centurionarx/cxh-invariants'

const PACKAGE_NAME = '@centurionarx/cxh-host-directory-picker'

/** Cordis companion plugin name. */
export const name = 'host-directory-picker-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this stateless Service Definition owns the capability
 * vocabulary, while backends and the RPC consumer own observations.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the directory-picker invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
