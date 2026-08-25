/**
 * Package-owned invariant companion for `@centurionarx/cxh-session-title-all-prompts-llm`.
 * @module @centurionarx/cxh-session-title-all-prompts-llm/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@centurionarx/cordis'
import type { InvariantInstaller } from '@centurionarx/cxh-invariants'

const PACKAGE_NAME = '@centurionarx/cxh-session-title-all-prompts-llm'

/** Cordis companion plugin name. */
export const name = 'session-title-all-prompts-llm-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this thin provider delegates request and result validation to the shared
 * title service and LLM helper and retains no independent mutable state.
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
