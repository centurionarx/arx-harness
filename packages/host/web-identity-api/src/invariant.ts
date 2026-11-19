/** Package-owned identity invariant companion. */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'
import type {} from '@arx-ai/arx-web-identity'
export const name = 'host-web-identity-api-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = () => {
  // No runtime invariant: request fences are checked by the HTTP authenticator;
  // durable decisions and projection invariants belong to their authority providers.
}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@arx-ai/arx-host-web-identity-api', install))
