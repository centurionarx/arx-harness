/** Authenticated page reads over the complete replay-derived turn index. */
import { Context } from '@arx-ai/cordis'
import type { Agent } from '@arx-ai/arx-agent'
import { Remote, TypertRemoteService } from '@arx-ai/arx-typert-protocol'
import type {} from '@arx-ai/arx-session-projection'
import { outlinePage } from './page.ts'
import type { TurnOutlinePage } from './types.ts'
declare module '@arx-ai/cordis' { interface Context { turnOutlines: TurnOutlineService } }
/** Read-only paging service; the gateway supplies the accessible session owner. */
export class TurnOutlineService extends TypertRemoteService {
  static inject = ['sessionProjections']
  constructor(ctx: Context) { super(ctx, 'turnOutlines') }
  /**
   * Search complete history and return one bounded page without changing model input.
   * @param agent - session owner supplied by the authenticated gateway.
   * @param before - exclusive start sequence or null for the newest page.
   * @param query - at most 200 characters matched against turn number and preview.
   * @param signal - gateway cancellation signal.
   * @returns a page of at most 100 turns plus an older-page cursor.
   */
  @Remote
  page(agent: Agent, before: number | null, query: string, signal: AbortSignal): TurnOutlinePage {
    signal.throwIfAborted()
    if (before !== null && (!Number.isSafeInteger(before) || before < 0)) throw new Error('Invalid turn outline cursor')
    if (query.length > 200) throw new Error('Turn outline search exceeds 200 characters')
    const state = this.ctx.sessionProjections.stateOf(agent.session, 'turnOutline')
    if (state === undefined) throw new Error('Turn outline is unavailable')
    return outlinePage(state, before, query)
  }
}
