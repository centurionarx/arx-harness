/**
 * Harness exit plugin, browser half: fills the sidebar's `sidebar.exit` seat
 * with the foot row below Settings, and owns the `exit` dictionaries. The
 * shutdown belongs to the launcher — this package only asks for it, over
 * `host.exit`, and reports the one refusal a deployment can answer with.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@arx-ai/arx-client-runtime/client'
import type { ConnectionHandle } from '@arx-ai/arx-api-remotes/client'
// Type-only: the SlotMap merge declaring `sidebar.exit`.
import type {} from '@arx-ai/arx-client-ui-sidebar/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@arx-ai/arx-client-locale/client'
import type { ExitRowInjected } from './ExitRow.tsx'
import { ExitRow } from './ExitRow.tsx'
import { en, zh, type ExitKey } from './locales.ts'

export type { ExitRowInjected, ExitRowProps } from './ExitRow.tsx'
export type { ExitKey } from './locales.ts'

declare module '@arx-ai/arx-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Exit row and confirmation copy. */
    exit: ExitKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'exit'

/** Required services (cordis fiber inject): slot registry, dictionaries, wire handle. */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the `exit` dictionaries and the exit seat's occupant, the latter
 * once ui-sidebar's declaration is on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-exit: dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle
  const injected = (): ExitRowInjected => ({
    stop: async () => {
      try {
        return (await connection.api.host.exit({})).result.ok
      } catch {
        // The wire client throws on a transport failure, and the server may
        // die before its answer flushes. After the ask, that is the shutdown
        // working, not refusing it.
        return true
      }
    },
  })
  ctx.slots.inject('sidebar.exit', () =>
    ctx.slots.register({ name: 'sidebar.exit', locale: NS, inject: injected }, ExitRow))
}
