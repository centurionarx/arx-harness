/** Browser Agent Team roster, dependency graph, and session navigation. */

import type { ClientContext, ISessions } from '@arx-ai/arx-client-runtime/client'
import type {} from '@arx-ai/arx-client-locale/client'
import type {} from '@arx-ai/arx-client-ui-conversation/client'
import type {} from '@arx-ai/arx-experimental-agent-team'
import { TeamAction, type TeamActionInjected } from './TeamAction.tsx'
import { en, NS, pt, type TeamKey } from './locales.ts'

declare module '@arx-ai/arx-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent Team roster and task dependency copy. */
    agentTeam: TeamKey
  }
}

export type { TeamActionInjected, TeamActionProps } from './TeamAction.tsx'
export type { TeamKey } from './locales.ts'

export const inject = ['sessions', 'slots', 'locale']

export function apply(ctx: ClientContext): void {
  const sessions = ctx.sessions as unknown as ISessions
  ctx.effect(() => ctx.locale.register(NS, { en, pt }), 'ui-agent-team: dictionaries')
  const injected = (): TeamActionInjected => ({
    openMember: async (leadId, memberId) => {
      if (leadId === memberId) {
        sessions.open(leadId)
        return
      }
      await sessions.refreshSubagents(leadId)
      const address = sessions.subagentAddress(memberId)
      if (address === undefined) sessions.open(memberId)
      else sessions.openSubagent(address)
    },
  })
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'agent-team',
    order: 15,
    locale: NS,
    inject: injected,
  }, TeamAction))
}
