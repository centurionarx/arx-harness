/**
 * Package-owned invariant companion for
 * `@centurionarx/cxh-claude-agent-sdk-process`.
 * @module @centurionarx/cxh-claude-agent-sdk-process/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@centurionarx/cordis'
import type { InvariantInstaller } from '@centurionarx/cxh-invariants'

const PACKAGE_NAME = '@centurionarx/cxh-claude-agent-sdk-process'

/** Cordis companion plugin name. */
export const name = 'claude-agent-sdk-process-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package registers nothing and owns no lifecycle.
 * Process-tree ownership belongs to the subprocess service.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - plugin context carrying the invariant registry.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
