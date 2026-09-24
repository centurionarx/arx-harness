/** Package-owned native account invariant companion. */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'
/** Companion plugin name. */
export const name = 'native-accounts-invariant'
/** Required invariant registry. */
export const inject = ['invariants']
/** No runtime invariant: private attempt capabilities expose no event stream; subprocess owns process-tree lifetime. */
const install: InvariantInstaller = () => {}
/** Register package ownership without publishing private account attempts.
 * @param ctx - plugin context carrying the invariant registry.
 * @returns registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@arx-ai/arx-native-accounts', install))
