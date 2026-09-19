/** Opaque webhook identities shared by adapters, rules, and the durable ledger. */

import type { Branded } from '@arx-ai/arx-brand'

/** Identifies one trusted webhook rule. */
export type WebhookRuleId = Branded<'WebhookRuleId'>
/** Identifies one configured provider adapter. */
export type WebhookSourceId = Branded<'WebhookSourceId'>
/** Identifies one provider delivery. */
export type WebhookDeliveryId = Branded<'WebhookDeliveryId'>
/** Deterministic key for one source, delivery, and rule reservation. */
export type WebhookLedgerKey = Branded<'WebhookLedgerKey'>

/**
 * Brand one validated trusted-rule identity.
 * @param value - validated rule id.
 * @returns the branded value.
 */
export function WebhookRuleId(value: string): WebhookRuleId { return value as WebhookRuleId }
/**
 * Brand one validated configured-adapter identity.
 * @param value - validated source id.
 * @returns the branded value.
 */
export function WebhookSourceId(value: string): WebhookSourceId { return value as WebhookSourceId }
/**
 * Brand one validated provider-delivery identity.
 * @param value - validated delivery id.
 * @returns the branded value.
 */
export function WebhookDeliveryId(value: string): WebhookDeliveryId { return value as WebhookDeliveryId }
