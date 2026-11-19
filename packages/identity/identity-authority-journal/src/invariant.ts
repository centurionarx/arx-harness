/** Package-owned identity invariant companion. */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'
import type {} from '@arx-ai/arx-web-identity'
export const name = 'identity-authority-journal-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = (ctx, fail) => { ctx.on('web-identity/projected', (head) => { const journal = ctx.get('identityAuthorityJournal'); if (journal === undefined)
  return; const actual = journal.head; if (actual.sequence !== head.sequence || actual.hash !== head.hash)
  fail('projection does not match durable journal') }, { global: true }) }
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@arx-ai/arx-identity-authority-journal', install))
