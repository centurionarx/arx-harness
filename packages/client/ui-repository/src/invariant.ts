/** Package-owned companion for the read-only repository client. */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'
/** Companion plugin name. */
export const name = 'client-ui-repository-invariant'
/** Companion service dependency. */
export const inject = ['invariants']
/** No runtime invariant: browser-private snapshots own no host events or shared mutable data;
 * the host repository provider owns read-only filesystem enforcement.
 */
const install: InvariantInstaller = () => {}
/** Reserve companion ownership.
 * @param ctx - Context with the invariant registry.
 * @returns Registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@arx-ai/arx-client-ui-repository', install))
