/**
 * Package-owned invariant companion.
 * @module @arx-ai/arx-isolated-project-runtime/invariant
 */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'
/** Companion registration name. */
export const name = 'isolated-project-runtime-invariant'
/** Invariant service injection. */
export const inject = ['invariants']
/**
 * No runtime invariant: worker process quiescence is observed only across the remote protocol; an in-process service-presence
 * check cannot prove OS or network isolation.
 */
const install: InvariantInstaller = () => {}
/**
 * Register this package companion.
 * @param ctx - Invariant service context.
 * @returns Disposer of package ownership registration.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@arx-ai/arx-isolated-project-runtime', install))
