/** Authenticated GitHub event values supplied to webhook rules. */

import type { JsonValue } from '@arx-ai/arx-session/types'

/** Signed GitHub JSON object; event-specific interpretation belongs to the configured rule. */
export type GitHubJsonObject = { readonly [key: string]: JsonValue }

/** Provider event after HMAC verification and JSON parsing. */
export interface GitHubWebhookEvent {
  readonly name: string
  readonly repository: string
  readonly payload: GitHubJsonObject
}

declare module '@arx-ai/arx-webhook' {
  interface WebhookEventMap { github: GitHubWebhookEvent }
}
