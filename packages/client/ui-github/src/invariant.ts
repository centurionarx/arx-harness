/** Package-owned companion for the read-only GitHub client. */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'
/** Companion plugin name. */
export const name = 'client-ui-github-invariant'
/** Companion service dependency. */
export const inject = ['invariants']
/** No runtime invariant: browser-private snapshots own no host events or shared mutable data;
 * the host GitHub provider owns credential isolation and network reads.
 */
const install: InvariantInstaller = () => {}
/** Reserve companion ownership.
 * @param ctx - Context with the invariant registry.
 * @returns Registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@arx-ai/arx-client-ui-github', install))
