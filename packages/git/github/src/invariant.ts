/** Package-owned invariant companion for GitHub reads and authorization delegation. */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'
/** Cordis companion name. */
export const name = 'github-invariant'
/** Reversible invariant registry dependency. */
export const inject = ['invariants']
/** No runtime invariant: GitHub retains no account or repository domain state;
 * credentials and authorization owners assert committed record relationships. */
const install: InvariantInstaller = () => {}
/**
 * Reserve the package registration.
 * @param ctx - Invariant registry context.
 * @returns Registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@arx-ai/arx-github', install))
