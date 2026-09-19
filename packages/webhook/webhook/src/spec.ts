/** Durable webhook delivery ledger declaration. */

import { z } from 'zod'
import { defineDomain, domainTable } from '@arx-ai/arx-storage-domain'
import type { WebhookLedgerKey } from './brand.ts'
import type { WebhookLedgerRecord } from './types.ts'

/** Validates one persisted deduplication and recovery record. */
export const webhookLedgerRecord = z.object({
  key: z.string().min(1),
  source: z.string().min(1),
  deliveryId: z.string().min(1),
  ruleId: z.string().min(1),
  kind: z.string().min(1),
  projectId: z.string().min(1).optional(),
  status: z.enum(['processing', 'completed', 'uncertain']),
  receivedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  sessionId: z.string().min(1).optional(),
}).strict() as unknown as z.ZodType<WebhookLedgerRecord>

/** Version-one durable webhook domain. */
export const webhookDomainSpec = defineDomain({
  name: 'webhook',
  version: 1,
  tables: {
    deliveries: domainTable<WebhookLedgerKey, WebhookLedgerRecord>(webhookLedgerRecord),
  },
})
