/** Provider-neutral verified deliveries, rules, Session requests, and ledger rows. */

import type { JsonValue, SessionId } from '@arx-ai/arx-session/types'
import type { ProjectId } from '@arx-ai/arx-project/types'
import type { WorkspaceId } from '@arx-ai/arx-workspace/types'
import type { WebhookDeliveryId, WebhookLedgerKey, WebhookRuleId, WebhookSourceId } from './brand.ts'

/** Provider adapters add their normalized event value through declaration merging. */
export interface WebhookEventMap {}

/** Event value for a known provider or generic JSON for an external adapter. */
export type WebhookEventOf<K extends string> = K extends keyof WebhookEventMap
  ? WebhookEventMap[K]
  : JsonValue

/** One authenticated provider delivery after raw-body verification. */
export interface VerifiedWebhookDelivery<K extends string = string> {
  readonly kind: K
  readonly source: WebhookSourceId
  readonly deliveryId: WebhookDeliveryId
  readonly event: WebhookEventOf<K>
  readonly receivedAt: number
}

/** Optional explicit model route for a webhook-created Agent. */
export interface WebhookModelSelection {
  readonly provider: string
  readonly model: string
  readonly maxTokens?: number
}

/** The only built-in webhook side effect: one root Session in a configured project Workspace. */
export interface WebhookSessionRequest {
  readonly projectId: ProjectId
  readonly workspaceId: WorkspaceId
  readonly title: string
  readonly prompt: string
  readonly agentPreset: string
  readonly permissionPreset: string
  readonly model?: WebhookModelSelection
}

/** Trusted code that optionally requests one Session for an authenticated delivery. */
export interface WebhookRule<K extends string = string> {
  readonly id: WebhookRuleId
  readonly kind: K
  readonly source: WebhookSourceId
  /**
   * @param delivery - immutable authenticated provider data.
   * @param signal - aborts during rule disposal or runtime shutdown.
   * @returns one Session request, or null for a durably consumed no-op.
   */
  run(delivery: Readonly<VerifiedWebhookDelivery<K>>, signal: AbortSignal):
    WebhookSessionRequest | null | Promise<WebhookSessionRequest | null>
}

/** Durable state of one deduplicated rule delivery. */
export interface WebhookLedgerRecord {
  readonly key: WebhookLedgerKey
  readonly source: WebhookSourceId
  readonly deliveryId: WebhookDeliveryId
  readonly ruleId: WebhookRuleId
  readonly kind: string
  readonly projectId?: ProjectId
  readonly status: 'processing' | 'completed' | 'uncertain'
  readonly receivedAt: number
  readonly updatedAt: number
  readonly sessionId?: SessionId
}

/** Synchronous admission outcome returned after any required ledger write. */
export type WebhookAdmission = 'accepted' | 'duplicate' | 'overflow' | 'no-rule'

declare module '@arx-ai/arx-llm' {
  interface MessageSourceMap {
    /** Initial untrusted event notice created from an authenticated webhook. */
    webhook: {
      readonly kind: 'webhook'
      readonly provider: string
      readonly source: WebhookSourceId
      readonly deliveryId: WebhookDeliveryId
      readonly ruleId: WebhookRuleId
      readonly projectId: ProjectId
    }
  }
}
