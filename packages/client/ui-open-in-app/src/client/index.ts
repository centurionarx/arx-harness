/**
 * Open-in-app browser half: registers the session-header split button that
 * opens the session's workspace directory in a host application. The list,
 * icons, and launches come from the loopback-only `/open-in-app` channel of
 * `@arx-ai/arx-host-open-in-app`; the last choice persists in the browser.
 */

import type { ConnectionHandle } from '@arx-ai/arx-client-connection/client'
import type { ClientContext } from '@arx-ai/arx-client-runtime/client'
import type {} from '@arx-ai/arx-client-locale/client'
import { OpenInAppController } from './controller.ts'
import { OpenInAppAction, type OpenInAppActionInjected } from './OpenInAppAction.tsx'
import { en, NS, pt, type OpenInAppKey } from './locales.ts'

declare module '@arx-ai/arx-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session-header "open workspace in application" copy. */
    'open-in-app': OpenInAppKey
  }
}

export type { OpenInAppActionInjected, OpenInAppActionProps } from './OpenInAppAction.tsx'

/** Required services: the slot registry, copy, and the connection carrying the host channel. */
export const inject = ['slots', 'locale', 'connection']

/**
 * Client plugin body: register the dictionary and the header split button,
 * and start the once-per-page application read.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new OpenInAppController(ctx.get('connection') as ConnectionHandle)
  void controller.load()
  ctx.effect(() => ctx.locale.register(NS, { en, pt }), 'open-in-app: dictionaries')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'open-in-app',
    order: -10,
    locale: NS,
    inject: (): OpenInAppActionInjected => ({
      hooks: {
        openInAppApps: controller.apps,
        openInAppIcons: controller.icons,
        openInAppChoice: controller.choice,
      },
      launch: (appId, path) => controller.launch(appId, path),
      choose: (appId) => { controller.choose(appId) },
    }),
  }, OpenInAppAction))
}
