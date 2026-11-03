/** Package-owned identity invariant companion. */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'
import type {} from '@arx-ai/arx-web-identity'
export const name = 'web-identity-sqlite-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = (ctx, fail) => { ctx.on('web-identity/projected', (head) => { const provider = ctx.get('webIdentity'); if (provider === undefined)
  return; const actual = provider.authorityHead; if (actual.sequence !== head.sequence || actual.hash !== head.hash)
  fail('event does not match SQLite projection') }, { global: true }) }
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@arx-ai/arx-web-identity-sqlite', install))
