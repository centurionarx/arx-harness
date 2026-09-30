/**
 * Web search settings plugin, browser half. It registers the Web search
 * section, whose page joins the seam's provider topology with the settings
 * mirror and the credential domain, and keeps it fresh on every pushed
 * invalidation.
 */

import type { ClientContext } from '@arx-ai/arx-client-runtime/client'
import type { ConnectionHandle } from '@arx-ai/arx-api-remotes/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry)
// and the ctx.settingsScope Context merge.
import type {} from '@arx-ai/arx-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@arx-ai/arx-client-locale/client'
// Type-only: the forwarded-event key face of ctx.remote.$on.
import type {} from '@arx-ai/arx-api-remotes/client'
import { WebSection } from './WebSection.tsx'
import type { WebSectionInjected } from './WebSection.tsx'
import { WebSettingsStore } from './store.ts'
import { en, pt, type WebKey } from './locales.ts'

declare module '@arx-ai/arx-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This section's own copy. */
    'settings.web': WebKey
  }
}

export type { WebSectionInjected, WebSectionProps } from './WebSection.tsx'
export type { ProviderRow, WebSettingsState } from './store.ts'
export type { WebKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.web'

/**
 * Refetch the page snapshot only after its first load: an unopened section
 * must not fetch on background invalidations.
 * @param controller - the page store.
 */
export function refreshIfLoaded(controller: WebSettingsStore): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on the slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/**
 * Register the Web search section once the `settings.section` declaration is
 * on the ledger, wire its store to the connection, and keep it fresh on every
 * pushed invalidation (settings, credentials, or search-provider topology).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en, pt }), 'ui-settings-web: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new WebSettingsStore(connection.api, ctx.settingsScope.describe())
  const t = ctx.locale.bind(NS) as WebSectionInjected['t']
  const injected = (): WebSectionInjected => ({
    controller,
    hooks: { snapshot: controller.store },
    t,
  })

  // Pushed invalidations converge the open page without polling. The
  // settingsScope injection makes ui-settings activate first, and remote
  // dispatch preserves listener order, so the mirror refresh starts before
  // this store joins it.
  ctx.effect(() => {
    const refresh = (): void => { refreshIfLoaded(controller) }
    const disposers = [
      ctx.remote.$on('settings/document-updated', refresh),
      ctx.remote.$on('credentials/reference-updated', refresh),
      ctx.remote.$on('web/providers-updated', refresh),
      ctx.on('connection/reset', refresh),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'ui-settings-web: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'web',
    order: 11,
    label: () => t('nav'),
    inject: injected,
  }, WebSection))
}
