/**
 * Package-owned invariant companion for
 * `@arx-ai/arx-llm-agent-cli`.
 * @module @arx-ai/arx-llm-agent-cli/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'

const PACKAGE_NAME = '@arx-ai/arx-llm-agent-cli'

/** Cordis companion plugin name. */
export const name = 'llm-agent-cli-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: route registration belongs to the shared llm service
 * and process-tree ownership belongs to the subprocess service.
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
