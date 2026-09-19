/** Browser half of the read-only Schedule catalog. */

import type { Context as ClientContext } from '@arx-ai/cordis'
import type {} from '@arx-ai/arx-client-locale/client'
import type {} from '@arx-ai/arx-client-ui-conversation/client'
import type {} from '@arx-ai/arx-schedule'
import { ScheduleCatalogAction } from './ScheduleCatalogAction.tsx'
import { en, NS, type ScheduleCatalogKey } from './locales.ts'

declare module '@arx-ai/arx-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Read-only active Schedule catalog copy. */
    'schedule.catalog': ScheduleCatalogKey
  }
}

/** Required services for locale registration and header-slot contribution. */
export const inject = ['slots', 'locale']

/** Register the dictionaries and Session-header catalog action. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en }), 'ui-schedule: dictionaries')
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'schedule-catalog',
      // Static Session identity precedes this entry; background jobs follow it.
      order: 10,
      locale: NS,
    }, ScheduleCatalogAction),
  )
}
