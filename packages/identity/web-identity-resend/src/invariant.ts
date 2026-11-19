/** Package-owned identity invariant companion. */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'
import type {} from '@arx-ai/arx-web-identity'
export const name = 'web-identity-resend-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = () => {
  // No runtime invariant: this transport owns no authorization projection;
  // the authority provider validates and commits encrypted outbox state around delivery.
}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@arx-ai/arx-web-identity-resend', install))
