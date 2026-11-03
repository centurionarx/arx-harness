/**
 * Package-owned invariant companion.
 * @module @arx-ai/arx-project-storage/invariant
 */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'
/** Companion registration name. */
export const name = 'project-storage-invariant'
/** Invariant service injection. */
export const inject = ['invariants']
/**
 * No runtime invariant: the physical log/index commit ordering and identity mapping are verified by database round-trip and crash
 * recovery; no independent in-process event stream represents a persisted index.
 */
const install: InvariantInstaller = () => {}
/**
 * Register this package companion.
 * @param ctx - Invariant service context.
 * @returns Disposer of package ownership registration.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@arx-ai/arx-project-storage', install))
