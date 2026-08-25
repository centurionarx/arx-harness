/**
 * Package-owned invariant companion for `@centurionarx/cxh-client-ui-commands`.
 * @module @centurionarx/cxh-client-ui-commands/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@centurionarx/cordis'
import type { InvariantInstaller } from '@centurionarx/cxh-invariants'

const PACKAGE_NAME = '@centurionarx/cxh-client-ui-commands'

/** Cordis companion plugin name. */
export const name = 'client-ui-commands-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a browser-side source over the wire command
 * directory — it emits no cordis events and owns no cross-plugin mutable
 * state; dispatch and cache behavior are asserted by this package's specs.
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
