/** Package-owned invariant companion for the read-only repository BFF. */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'

/** Cordis companion plugin name. */
export const name = 'repository-invariant'
/** Registry dependency for reversible package ownership. */
export const inject = ['invariants']
/** No runtime invariant: repository reads retain no domain state or authoritative event stream.
 * Containment and limits are enforced in each request. */
const install: InvariantInstaller = () => {}
/**
 * Reserve the repository package's invariant registration.
 * @param ctx - Context carrying the invariant registry.
 * @returns Registration disposer after successful setup.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@arx-ai/arx-repository', install))
