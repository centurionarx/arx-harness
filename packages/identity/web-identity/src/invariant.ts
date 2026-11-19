/** Package-owned identity invariant companion. */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'
import type {} from '@arx-ai/arx-web-identity'
export const name = 'web-identity-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = (ctx, fail) => { ctx.on('web-identity/projected', (head) => { if (!Number.isSafeInteger(head.sequence) || head.sequence < 1 || !/^[0-9a-f]{64}$/.test(head.hash))
  fail('invalid durable authority head') }, { global: true }) }
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@arx-ai/arx-web-identity', install))
