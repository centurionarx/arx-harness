import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import Storage from '@arx-ai/arx-storage'
import * as StorageJson from '@arx-ai/arx-storage-json'
import * as StorageDomain from '@arx-ai/arx-storage-domain'
import WebhookRuntime, { WebhookDeliveryId, WebhookRuleId, WebhookSourceId } from '../src/index.ts'

it('joins the active callback and marks queued work uncertain before ancestor storage closure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arx-webhook-active-review-'))
  const ctx = new Context()
  const release = Promise.withResolvers<undefined>()
  const started = Promise.withResolvers<undefined>()
  const events: string[] = []
  const errors: unknown[] = []
  ctx.logger.error = ((error: unknown) => { errors.push(error) }) as typeof ctx.logger.error
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    for (const service of ['agents', 'sessions', 'agentDefaultModel', 'agentPresets', 'permissionPresets', 'projects', 'sessionTitle', 'workspaceRegistry']) {
      ctx.provide(service as never, {} as never)
    }
    await ctx.plugin(WebhookRuntime, { maxActiveWorkers: 1, maxQueuedDeliveries: 1 })
    const runtime = ctx.webhookRuntime
    const source = WebhookSourceId('critic')
    const run = vi.fn(async () => {
      events.push('callback started'); started.resolve(undefined)
      await release.promise
      events.push('callback settled')
      return null
    })
    runtime.register({ id: WebhookRuleId('critic'), kind: 'test', source, run })
    expect(await runtime.accept({ kind: 'test', source, deliveryId: WebhookDeliveryId('active'), event: {}, receivedAt: 1 })).toBe('accepted')
    await started.promise
    expect(await runtime.accept({ kind: 'test', source, deliveryId: WebhookDeliveryId('queued'), event: {}, receivedAt: 2 })).toBe('accepted')
    let disposed = false
    const unloading = ctx.fiber.dispose().then(() => { disposed = true; events.push('root disposed') })
    try {
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(disposed).toBe(false)
      expect(run).toHaveBeenCalledOnce()
    } finally {
      release.resolve(undefined)
      await unloading
    }
    expect(events).toEqual(['callback started', 'callback settled', 'root disposed'])
    expect(run).toHaveBeenCalledOnce()
    expect(errors).toEqual([])
    const disk: unknown = JSON.parse(await readFile(join(root, 'webhook.json'), 'utf8'))
    expect(JSON.stringify(disk).match(/"status":"uncertain"/g)).toHaveLength(2)
    await expect(runtime.accept({ kind: 'test', source, deliveryId: WebhookDeliveryId('late'), event: {}, receivedAt: 3 })).rejects.toThrow('closing')
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(run).toHaveBeenCalledOnce()
  } finally {
    release.resolve(undefined)
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
