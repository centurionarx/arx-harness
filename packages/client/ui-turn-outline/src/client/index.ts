/** Optional conversation view contribution for the whole-session outline. */
import type {} from '@arx-ai/arx-api-remotes/client'
import type { ClientContext } from '@arx-ai/arx-client-runtime/client'
import type {} from '@arx-ai/arx-client-locale/client'
import type {} from '@arx-ai/arx-client-ui-conversation/client'
import { TurnOutline, type OutlineInjected } from './TurnOutline.tsx'
import { en, pt, type OutlineKey } from './locales.ts'

declare module '@arx-ai/arx-client-ui-slots' {
  interface LocaleNamespaceMap { /** Whole-session turn navigation copy. */ turnOutline: OutlineKey }
}
/** Slot and localization services required by the contribution. */
export const inject = ['slots', 'locale', 'remote', 'remote.turnOutlines']
/** Register into the existing view seat independently of owner load order. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('turnOutline', { en, pt }), 'turn outline: dictionaries')
  const t = ctx.locale.bind('turnOutline')
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'turn-outline', order: 20, locale: 'turnOutline',
    label: () => t('title'),
    inject: (sessionId): OutlineInjected => ({ readPage: async (before, query) => {
      const result = await ctx.remote.turnOutlines.page(sessionId, before, query)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    } }),
  }, TurnOutline))
}
