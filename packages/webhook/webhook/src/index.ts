/** Durable bounded webhook rule runtime. */

import { createHash } from 'node:crypto'
import { Context, Service } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import type {} from '@arx-ai/arx-agent'
import type {} from '@arx-ai/arx-agent-default-model'
import type {} from '@arx-ai/arx-agent-presets'
import type {} from '@arx-ai/arx-permission-presets'
import type {} from '@arx-ai/arx-project'
import type {} from '@arx-ai/arx-session'
import type {} from '@arx-ai/arx-session-title'
import type { KvTable } from '@arx-ai/arx-storage-domain'
import type {} from '@arx-ai/arx-workspace'
import { WebhookLedgerKey } from './brand-internal.ts'
import { createWebhookSession } from './session.ts'
import { webhookDomainSpec } from './spec.ts'
import type {
  VerifiedWebhookDelivery, WebhookAdmission, WebhookLedgerRecord, WebhookRule, WebhookSessionRequest,
} from './types.ts'
import type {
  WebhookRuleId, WebhookSourceId, WebhookDeliveryId, WebhookLedgerKey as WebhookLedgerKeyBrand,
} from './brand.ts'

export * from './brand.ts'
export type * from './types.ts'
export { webhookDomainSpec, webhookLedgerRecord } from './spec.ts'

/** Runtime worker and in-memory queue ceilings. */
export interface Config {
  /** Maximum number of webhook delivery callbacks that may execute concurrently in this process. */
  readonly maxActiveWorkers: number
  /** Maximum number of durably reserved deliveries that may wait in the process-local queue. */
  readonly maxQueuedDeliveries: number
}

export const Config: z<Config> = z.object({
  maxActiveWorkers: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxQueuedDeliveries: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).required(),
})

declare module '@arx-ai/cordis' { interface Context { webhookRuntime: WebhookRuntime } }

interface ErasedRule {
  readonly id: WebhookRuleId
  readonly kind: string
  readonly source: WebhookSourceId
  run(delivery: Readonly<VerifiedWebhookDelivery>, signal: AbortSignal):
    WebhookSessionRequest | null | Promise<WebhookSessionRequest | null>
}

interface Registration {
  readonly rule: ErasedRule
  readonly controller: AbortController
  readonly active: Set<Promise<void>>
  disposal?: Promise<void>
}

interface PendingJob {
  readonly key: WebhookLedgerKeyBrand
  readonly registration: Registration
  readonly delivery: Readonly<VerifiedWebhookDelivery>
}

const settle = (promise: Promise<unknown>): Promise<void> => promise.then(() => {}, () => {})

/** Provider-neutral durable admission, deduplication, and bounded worker service. */
export class WebhookRuntime extends Service {
  static inject = ['storageDomain', 'agents', 'sessions', 'agentDefaultModel', 'agentPresets', 'permissionPresets', 'projects', 'sessionTitle', 'workspaceRegistry']

  private table?: KvTable<WebhookLedgerKeyBrand, WebhookLedgerRecord>
  private readonly registrations = new Map<WebhookRuleId, Registration>()
  private readonly queue: PendingJob[] = []
  private admissionTail: Promise<void> = Promise.resolve()
  private activeWorkers = 0
  private closing = false

  constructor(ctx: Context, private readonly config: Config) { super(ctx, 'webhookRuntime') }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(webhookDomainSpec)
    this.ctx.effect(() => async () => {
      this.closing = true
      await Promise.all([...this.registrations.values()].map(registration => this.disposeRegistration(registration)))
      await this.admissionTail
      await domain.close()
    }, 'webhook.lifecycle')
    this.table = domain.table('deliveries')
    const now = Date.now()
    for (const [key, record] of this.table.entries()) {
      if (record.status !== 'processing') continue
      await this.table.put(key, { ...record, status: 'uncertain', updatedAt: now })
    }
  }

  /**
   * Register one exact provider-source rule.
   * @param rule - trusted callback and unique rule id.
   * @returns an awaitable disposer that aborts and drains pending reservations, queued work, and active work.
   */
  register<K extends string>(rule: WebhookRule<K>): () => Promise<void> {
    if (this.closing) throw new Error('webhook runtime is closing')
    for (const [field, value] of [['id', rule.id], ['kind', rule.kind], ['source', rule.source]] as const) {
      if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`webhook rule ${field} must be non-empty`)
    }
    if (this.registrations.has(rule.id)) throw new Error(`webhook rule '${rule.id}' is already registered`)
    const registration: Registration = {
      rule,
      controller: new AbortController(),
      active: new Set(),
    }
    this.registrations.set(rule.id, registration)
    return async () => { await this.disposeRegistration(registration) }
  }

  /**
   * Durably reserve and enqueue one verified delivery.
   * @param delivery - authenticated, parsed provider data.
   * @returns the admission outcome after required ledger writes; a rule unloaded during reservation yields no-rule.
   */
  accept<K extends string>(delivery: VerifiedWebhookDelivery<K>): Promise<WebhookAdmission> {
    return this.serializeAdmission(async () => {
      const registration = [...this.registrations.values()].find(candidate =>
        !candidate.controller.signal.aborted && candidate.rule.kind === delivery.kind && candidate.rule.source === delivery.source)
      if (registration === undefined) return 'no-rule'
      const snapshot = Object.freeze(structuredClone(delivery)) as Readonly<VerifiedWebhookDelivery>
      const key = webhookLedgerKey(delivery.source, delivery.deliveryId, registration.rule.id)
      if (this.requireTable().get(key) !== undefined) return 'duplicate'
      if (this.activeWorkers + this.queue.length >= this.config.maxActiveWorkers + this.config.maxQueuedDeliveries) {
        return 'overflow'
      }
      const now = Date.now()
      await this.requireTable().put(key, {
        key,
        source: delivery.source,
        deliveryId: delivery.deliveryId,
        ruleId: registration.rule.id,
        kind: delivery.kind,
        status: 'processing',
        receivedAt: delivery.receivedAt,
        updatedAt: now,
      })
      if (registration.controller.signal.aborted) {
        await this.markUncertain(key)
        return 'no-rule'
      }
      this.queue.push({ key, registration, delivery: snapshot })
      this.pump()
      return 'accepted'
    })
  }

  /**
   * Read detached durable ledger rows for operator inspection.
   * @returns detached durable ledger rows in storage order.
   */
  records(): readonly WebhookLedgerRecord[] {
    return [...this.requireTable().entries()].map(([, record]) => structuredClone(record))
  }

  /**
   * Resolve one uncertain delivery after an operator verifies its external outcome.
   * @param source - adapter instance.
   * @param deliveryId - provider delivery id.
   * @param ruleId - rule reservation.
   * @param resolution - completed prevents replay; release permits a later signed redelivery.
   */
  async reconcile(
    source: WebhookSourceId,
    deliveryId: WebhookDeliveryId,
    ruleId: WebhookRuleId,
    resolution: 'completed' | 'release',
  ): Promise<void> {
    const key = webhookLedgerKey(source, deliveryId, ruleId)
    await this.serializeAdmission(async () => {
      const record = this.requireTable().get(key)
      if (record === undefined) throw new Error('webhook delivery reservation does not exist')
      if (record.status !== 'uncertain') throw new Error(`webhook delivery is ${record.status}, not uncertain`)
      if (resolution === 'release') await this.requireTable().delete(key)
      else await this.requireTable().put(key, { ...record, status: 'completed', updatedAt: Date.now() })
    })
  }

  private pump(): void {
    while (!this.closing && this.activeWorkers < this.config.maxActiveWorkers && this.queue.length > 0) {
      const job = this.queue.shift() as PendingJob
      this.activeWorkers += 1
      const running = this.runJob(job).finally(() => {
        job.registration.active.delete(running)
        this.activeWorkers -= 1
        this.pump()
      })
      job.registration.active.add(running)
    }
  }

  private async runJob(job: PendingJob): Promise<void> {
    const { signal } = job.registration.controller
    try {
      signal.throwIfAborted()
      const request = await job.registration.rule.run(job.delivery, signal)
      signal.throwIfAborted()
      const sessionId = request === null
        ? undefined
        : await createWebhookSession(this.ctx, job.delivery, job.registration.rule.id, request, signal)
      const record = this.requireTable().get(job.key)
      if (record === undefined) return
      await this.requireTable().put(job.key, {
        ...record,
        status: 'completed',
        updatedAt: Date.now(),
        ...request === null ? {} : { projectId: request.projectId },
        ...sessionId === undefined ? {} : { sessionId },
      })
    } catch (error: unknown) {
      try { await this.markUncertain(job.key) } catch (ledgerError: unknown) {
        this.ctx.logger.warn(`webhook ledger settlement failed: ${String(ledgerError)}`)
      }
      this.ctx.logger.warn(`webhook delivery processing became uncertain: ${String(error)}`)
    }
  }

  private disposeRegistration(registration: Registration): Promise<void> {
    return registration.disposal ??= this.drainRegistration(registration)
  }

  private async drainRegistration(registration: Registration): Promise<void> {
    registration.controller.abort(new Error(`webhook rule '${registration.rule.id}' was disposed`))
    await this.admissionTail
    const removed = this.queue.filter(job => job.registration === registration)
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index]?.registration === registration) this.queue.splice(index, 1)
    }
    await Promise.allSettled(removed.map(job => this.markUncertain(job.key)))
    await Promise.allSettled([...registration.active])
    this.registrations.delete(registration.rule.id)
  }

  private async markUncertain(key: WebhookLedgerKeyBrand): Promise<void> {
    const record = this.requireTable().get(key)
    if (record?.status === 'processing') {
      await this.requireTable().put(key, { ...record, status: 'uncertain', updatedAt: Date.now() })
    }
  }

  private serializeAdmission<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.admissionTail.then(() => {
      if (this.closing) throw new Error('webhook runtime is closing')
      return operation()
    })
    this.admissionTail = settle(result)
    return result
  }

  private requireTable(): KvTable<WebhookLedgerKeyBrand, WebhookLedgerRecord> {
    if (this.table === undefined) throw new Error('webhook runtime is not initialized')
    return this.table
  }
}

/**
 * Derive the durable reservation key for one exact rule delivery.
 * @param source - adapter instance.
 * @param deliveryId - provider delivery identity.
 * @param ruleId - matching rule identity.
 * @returns a collision-resistant opaque ledger key.
 */
export function webhookLedgerKey(
  source: WebhookSourceId,
  deliveryId: WebhookDeliveryId,
  ruleId: WebhookRuleId,
): WebhookLedgerKeyBrand {
  return WebhookLedgerKey(createHash('sha256').update(JSON.stringify([source, deliveryId, ruleId])).digest('hex'))
}

export default WebhookRuntime
