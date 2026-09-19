import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import Storage from '@arx-ai/arx-storage'
import { DomainFacility, type Domain } from '@arx-ai/arx-storage-domain'
import { JsonStorageBackend } from '@arx-ai/arx-storage-json'
import WebhookRuntime, {
  WebhookDeliveryId, WebhookRuleId, WebhookSourceId, webhookDomainSpec,
  webhookLedgerKey,
} from '../src/index.ts'
import type { VerifiedWebhookDelivery, WebhookLedgerRecord } from '../src/types.ts'

const active: { ctx: Context; backend: JsonStorageBackend; root: string }[] = []

afterEach(async () => {
  for (const harness of active.splice(0)) {
    await harness.ctx.fiber.dispose()
    await harness.backend.close()
    await rm(harness.root, { recursive: true, force: true })
  }
})

async function harness(config = { maxActiveWorkers: 1, maxQueuedDeliveries: 1 }) {
  const root = await mkdtemp(join(tmpdir(), 'arx-webhook-'))
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(root)
  ctx.storage.backend.register('json', backend)
  const facility = new DomainFacility(ctx, { backend: 'json', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  for (const service of ['agents', 'sessions', 'agentDefaultModel', 'agentPresets', 'permissionPresets', 'projects', 'sessionTitle', 'workspaceRegistry']) {
    ctx.provide(service as never, {} as never)
  }
  const open = vi.spyOn(facility, 'open')
  await ctx.plugin(WebhookRuntime, config)
  await vi.waitFor(() => { expect(ctx.get('webhookRuntime')).toBeInstanceOf(WebhookRuntime) })
  active.push({ ctx, backend, root })
  return { ctx, backend, root, runtime: ctx.webhookRuntime, domain: await open.mock.results[0]!.value as Domain<typeof webhookDomainSpec> }
}

function delivery(id: string): VerifiedWebhookDelivery {
  return {
    kind: 'test',
    source: WebhookSourceId('source'),
    deliveryId: WebhookDeliveryId(id),
    event: { value: id },
    receivedAt: 100,
  }
}

describe('WebhookRuntime durable admission', () => {
  it('persists before work, completes once, and deduplicates the same provider delivery', async () => {
    const { runtime, root } = await harness()
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    let calls = 0
    runtime.register({
      id: WebhookRuleId('rule'), kind: 'test', source: WebhookSourceId('source'),
      run: async () => { calls += 1; await blocked; return null },
    })

    await expect(runtime.accept(delivery('one'))).resolves.toBe('accepted')
    expect(runtime.records()).toHaveLength(1)
    expect(runtime.records()[0]?.status).toBe('processing')
    const storedBeforeWork = await readFile(join(root, 'webhook.json'), 'utf8')
    expect(storedBeforeWork).toContain('processing')
    await expect(runtime.accept(delivery('one'))).resolves.toBe('duplicate')
    expect(calls).toBe(1)
    release()
    await vi.waitFor(() => { expect(runtime.records()[0]?.status).toBe('completed') })
    expect(runtime.records()).toHaveLength(1)
  })

  it('refuses overflow without creating a ledger record', async () => {
    const { runtime } = await harness({ maxActiveWorkers: 1, maxQueuedDeliveries: 0 })
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    runtime.register({
      id: WebhookRuleId('rule'), kind: 'test', source: WebhookSourceId('source'),
      run: async () => { await blocked; return null },
    })
    await expect(runtime.accept(delivery('one'))).resolves.toBe('accepted')
    await expect(runtime.accept(delivery('two'))).resolves.toBe('overflow')
    expect(runtime.records().map(record => record.deliveryId)).toEqual(['one'])
    release()
  })

  it('does not acknowledge a reservation when JSON persistence fails', async () => {
    const { runtime, backend } = await harness()
    runtime.register({
      id: WebhookRuleId('rule'), kind: 'test', source: WebhookSourceId('source'), run: () => null,
    })
    await backend.close()
    await expect(runtime.accept(delivery('failed'))).rejects.toBeDefined()
    expect(runtime.records()).toHaveLength(0)
  })

  it('changes a persisted processing record to uncertain on restart and requires reconciliation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arx-webhook-restart-'))
    const seedCtx = new Context()
    await seedCtx.plugin(Storage)
    const seedBackend = new JsonStorageBackend(root)
    seedCtx.storage.backend.register('json', seedBackend)
    const seedFacility = new DomainFacility(seedCtx, { backend: 'json', routes: {} })
    seedCtx.storage.mount('domain', seedFacility)
    const domain = await seedFacility.open(webhookDomainSpec)
    const record: WebhookLedgerRecord = {
      key: webhookLedgerKey(WebhookSourceId('source'), WebhookDeliveryId('delivery'), WebhookRuleId('rule')),
      source: WebhookSourceId('source'),
      deliveryId: WebhookDeliveryId('delivery'),
      ruleId: WebhookRuleId('rule'),
      kind: 'test',
      status: 'processing',
      receivedAt: 1,
      updatedAt: 1,
    }
    await domain.table('deliveries').put(record.key, record)
    await domain.close()
    await seedCtx.fiber.dispose()
    await seedBackend.close()

    const ctx = new Context()
    await ctx.plugin(Storage)
    const backend = new JsonStorageBackend(root)
    ctx.storage.backend.register('json', backend)
    const facility = new DomainFacility(ctx, { backend: 'json', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    for (const service of ['agents', 'sessions', 'agentDefaultModel', 'agentPresets', 'permissionPresets', 'projects', 'sessionTitle', 'workspaceRegistry']) {
      ctx.provide(service as never, {} as never)
    }
    await ctx.plugin(WebhookRuntime, { maxActiveWorkers: 1, maxQueuedDeliveries: 1 })
    await vi.waitFor(() => { expect(ctx.webhookRuntime.records()[0]?.status).toBe('uncertain') })
    active.push({ ctx, backend, root })
    await ctx.webhookRuntime.reconcile(record.source, record.deliveryId, record.ruleId, 'completed')
    expect(ctx.webhookRuntime.records()[0]?.status).toBe('completed')
  })
})

describe('WebhookRuntime recovery and rule lifecycle', () => {
  it('rejects missing and duplicate registrations and returns no-rule without persistence', async () => {
    const { runtime } = await harness()
    const rule = { id: WebhookRuleId('valid'), kind: 'test', source: WebhookSourceId('source'), run: () => null }
    for (const field of ['id', 'kind', 'source'] as const) {
      expect(() => runtime.register({ ...rule, [field]: ' ' })).toThrow('must be non-empty')
    }
    runtime.register(rule)
    expect(() => runtime.register(rule)).toThrow('already registered')
    await expect(runtime.accept({ ...delivery('foreign'), source: WebhookSourceId('other') })).resolves.toBe('no-rule')
    expect(runtime.records()).toEqual([])
    await expect(runtime.reconcile(rule.source, WebhookDeliveryId('missing'), rule.id, 'release')).rejects.toThrow('does not exist')
    await runtime.accept(delivery('done'))
    await vi.waitFor(() => { expect(runtime.records()[0]?.status).toBe('completed') })
    await expect(runtime.reconcile(rule.source, WebhookDeliveryId('done'), rule.id, 'release')).rejects.toThrow('not uncertain')
  })

  it('drains active and queued jobs on rule disposal and requires explicit release before retry', async () => {
    const { runtime } = await harness({ maxActiveWorkers: 1, maxQueuedDeliveries: 2 })
    const blocker = Promise.withResolvers<null>()
    const rule = { id: WebhookRuleId('rule'), kind: 'test', source: WebhookSourceId('source'), run: () => blocker.promise }
    const dispose = runtime.register(rule)
    runtime.register({ id: WebhookRuleId('other-rule'), kind: 'test', source: WebhookSourceId('other'), run: () => null })
    await runtime.accept(delivery('active'))
    await runtime.accept(delivery('queued'))
    await runtime.accept({ ...delivery('other'), source: WebhookSourceId('other') })
    const disposing = dispose()
    const again = dispose()
    blocker.resolve(null)
    await Promise.all([disposing, again])
    await vi.waitFor(() => { expect(runtime.records().find(row => row.deliveryId === 'other')?.status).toBe('completed') })
    expect(runtime.records().filter(row => row.source === 'source').every(row => row.status === 'uncertain')).toBe(true)
    await runtime.reconcile(rule.source, WebhookDeliveryId('queued'), rule.id, 'release')
    runtime.register({ ...rule, run: () => null })
    await expect(runtime.accept(delivery('queued'))).resolves.toBe('accepted')
    await vi.waitFor(() => { expect(runtime.records().find(row => row.deliveryId === 'queued')?.status).toBe('completed') })
  })

  it('contains settlement storage failure and refuses new calls after context disposal', async () => {
    const { ctx, runtime, backend } = await harness()
    const blocker = Promise.withResolvers<null>()
    const rule = { id: WebhookRuleId('rule'), kind: 'test', source: WebhookSourceId('source'), run: () => blocker.promise }
    const dispose = runtime.register(rule)
    await runtime.accept(delivery('lost-settlement'))
    await backend.close()
    blocker.reject(new Error('callback failed'))
    await dispose()
    expect(runtime.records()[0]?.status).toBe('processing')
    await ctx.fiber.dispose()
    expect(() => runtime.register(rule)).toThrow('closing')
    await expect(runtime.accept(delivery('late'))).rejects.toThrow('closing')
  })

  it('refuses ledger access before the storage initialization completes', () => {
    const runtime = new WebhookRuntime(new Context(), { maxActiveWorkers: 1, maxQueuedDeliveries: 0 })
    expect(() => runtime.records()).toThrow('not initialized')
  })
})

it('does not recreate an out-of-band removed reservation during late completion or failure', async () => {
  const { runtime, domain } = await harness()
  const pending = [Promise.withResolvers<null>(), Promise.withResolvers<null>()]
  let index = 0
  const dispose = runtime.register({ id: WebhookRuleId('rule'), kind: 'test', source: WebhookSourceId('source'), run: () => pending[index++]!.promise })
  // Inject a storage fault through the captured domain; the runtime remains its sole owner.
  try {
    await runtime.accept(delivery('removed-completion'))
    await domain.table('deliveries').delete(runtime.records()[0]!.key)
    pending[0]!.resolve(null)
    await vi.waitFor(() => { expect(index).toBe(1) })
    await runtime.accept(delivery('removed-failure'))
    await vi.waitFor(() => { expect(index).toBe(2) })
    await domain.table('deliveries').delete(runtime.records()[0]!.key)
    pending[1]!.reject(new Error('late failure'))
    await dispose()
    expect(runtime.records()).toEqual([])
  } finally { await dispose() }
})


it.each(['rule', 'runtime'] as const)('drains an in-flight durable reservation before %s disposal completes', async (owner) => {
  const { ctx, runtime, domain, root } = await harness()
  const table = domain.table('deliveries')
  const put = table.put.bind(table)
  const writing = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const run = vi.fn(() => null)
  const dispose = runtime.register({ id: WebhookRuleId('rule'), kind: 'test', source: WebhookSourceId('source'), run })
  vi.spyOn(table, 'put').mockImplementationOnce(async (key, record) => {
    writing.resolve(undefined)
    await release.promise
    await put(key, record)
  })
  const admission = runtime.accept(delivery('during-unload'))
  await writing.promise
  const disposing = owner === 'rule' ? dispose() : ctx.fiber.dispose()
  const again = owner === 'rule' ? dispose() : disposing
  let settled = false
  void Promise.all([disposing, again]).then(() => { settled = true })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
  } finally {
    release.resolve(undefined)
    await Promise.allSettled([admission, disposing, again])
  }
  await expect(admission).resolves.toBe('no-rule')
  expect(run).not.toHaveBeenCalled()
  const persisted = await readFile(join(root, 'webhook.json'), 'utf8')
  expect(persisted).toContain('uncertain')
  expect(persisted).not.toContain('processing')
})
