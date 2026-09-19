import { describe, expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import InvariantRegistry from '@arx-ai/arx-invariants'
import type { DomainChanged } from '@arx-ai/arx-storage-domain'
import * as WebhookInvariant from '../src/invariant.ts'

const put = (domain = 'webhook', table = 'deliveries', key = 'ledger', embeddedKey: unknown = key): DomainChanged => ({
  domain,
  table,
  key,
  operation: 'put',
  value: { key: embeddedKey },
})

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  ctx.provide('webhookRuntime', {} as never)
  await ctx.plugin(WebhookInvariant)
  return ctx
}

describe('webhook ledger identity invariant', () => {
  it('accepts matching keys and ignores unrelated changes and deletions', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('domain/changed', put()) }).not.toThrow()
    expect(() => { ctx.emit('domain/changed', put('other')) }).not.toThrow()
    expect(() => { ctx.emit('domain/changed', put('webhook', 'other')) }).not.toThrow()
    expect(() => {
      ctx.emit('domain/changed', { domain: 'webhook', table: 'deliveries', key: 'ledger', operation: 'deleted' })
    }).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('rejects a row whose embedded key differs from its table key', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('domain/changed', put('webhook', 'deliveries', 'ledger', 'other')) })
      .toThrow(/webhook ledger key 'ledger' differs from embedded key 'other'/)
    await ctx.fiber.dispose()
  })
})
