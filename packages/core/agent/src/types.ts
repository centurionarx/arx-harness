/**
 * Durable agent session-event vocabulary shared with type-only consumers.
 *
 * @module @arx-ai/arx-agent/types
 */

import type { ReasoningEffortId } from '@arx-ai/arx-llm/brand'
import type { UserMessage } from '@arx-ai/arx-llm/types'

/** One of the two ordered pending-message lists owned by an agent. */
export type InboxTarget = 'next-turn' | 'next-step'

/** Complete provider, model, and optional reasoning effort selected for one live Agent. */
export interface ModelSelection {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: ReasoningEffortId
}

declare module '@arx-ai/arx-session/types' {
  interface SessionEventMap {
    /**
     * One normalized mutation of an agent's durable pending-message lists.
     * Live dispatch precedes projection mutation, so synchronous observers may
     * read the pre-splice inbox to recover the removed messages.
     */
    'agent/inbox/spliced': {
      target: InboxTarget
      start: number
      removedCount?: number
      inserted: UserMessage[]
      outcome?: 'canceled'
    }
    /**
     * A provider, model, and optional reasoning effort accepted for this
     * session (validated against the live route before this event is
     * appended). Log-only: it never enters the derived model transcript, and
     * the config a step actually sent stays recorded by `request/header`. The
     * session's effective selection is whichever of this event and
     * `request/header` was logged last, so a request built under a different
     * config supersedes an unconsumed pick, and a later pick supersedes an
     * earlier request.
     */
    'model/selection': ModelSelection
  }
}
