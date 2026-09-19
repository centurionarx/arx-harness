import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import Storage from '@arx-ai/arx-storage'
import * as StorageJson from '@arx-ai/arx-storage-json'
import * as StorageDomain from '@arx-ai/arx-storage-domain'
import type { Domain } from '@arx-ai/arx-storage-domain'
import WebhookRuntime, { WebhookDeliveryId, WebhookRuleId, WebhookSourceId, webhookDomainSpec } from '../src/index.ts'

it('drains an admitted webhook before real storage plugins close on ancestor disposal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arx-webhook-root-review-'))
  const ctx = new Context()
  const release = Promise.withResolvers<undefined>()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    for (const service of ['agents', 'sessions', 'agentDefaultModel', 'agentPresets', 'permissionPresets', 'projects', 'sessionTitle', 'workspaceRegistry']) {
      ctx.provide(service as never, {} as never)
    }
    await ctx.plugin(WebhookRuntime, { maxActiveWorkers: 1, maxQueuedDeliveries: 1 })
    const runtime = ctx.webhookRuntime
    const domain = ctx.storageDomain.get('webhook') as unknown as Domain<typeof webhookDomainSpec>
    const table = domain.table('deliveries')
    const put = table.put.bind(table)
    const writing = Promise.withResolvers<undefined>()
    const run = vi.fn(() => null)
    runtime.register({ id: WebhookRuleId('rule'), kind: 'test', source: WebhookSourceId('source'), run })
    vi.spyOn(table, 'put').mockImplementationOnce(async (key, record) => {
      writing.resolve(undefined)
      await release.promise
      await put(key, record)
    })
    const admission = runtime.accept({ kind: 'test', source: WebhookSourceId('source'), deliveryId: WebhookDeliveryId('during-root-unload'), event: {}, receivedAt: 100 })
    await writing.promise
    const unloading = ctx.fiber.dispose()
    try {
      await new Promise<void>(resolve => setImmediate(resolve))
    } finally {
      release.resolve(undefined)
      await Promise.allSettled([admission, unloading])
    }
    await expect(admission).resolves.toBe('no-rule')
    expect(run).not.toHaveBeenCalled()
    expect(await readFile(join(root, 'webhook.json'), 'utf8')).toContain('uncertain')
  } finally {
    release.resolve(undefined)
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
