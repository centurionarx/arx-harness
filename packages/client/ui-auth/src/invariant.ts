/** Application identity trees must contain no project services. */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'
import type {} from '@arx-ai/arx-client-ui-slots/composition'
export const name = 'client-ui-auth-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('internal/dispatch', (_mode, eventName) => {
    if (eventName !== 'slots/changed') return
    const composition = ctx.get('clientComposition')
    if (composition?.kind !== 'public' && composition?.kind !== 'admin') return
    if (ctx.get('sessions') !== undefined || ctx.get('workspaces') !== undefined || ctx.get('connection') !== undefined) {
      fail('public/admin identity composition contains project services')
    }
  }, { global: true })
}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@arx-ai/arx-client-ui-auth', install))
