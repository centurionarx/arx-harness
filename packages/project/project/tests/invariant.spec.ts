import { afterEach, expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import Invariants, { InvariantError } from '@arx-ai/arx-invariants'
import type { ProjectService } from '../src/index.ts'
import * as Companion from '../src/invariant.ts'
import type { DomainChanged } from '@arx-ai/arx-storage-domain'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
it('checks project record identities and ignores unrelated storage announcements', async () => {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Invariants, { enabled: true })
  ctx.provide('projects', {} as ProjectService)
  await ctx.plugin(Companion)
  const value = { domain: 'project', table: 'projects', operation: 'put', key: 'project', value: { id: 'project' } } as const
  expect(() =>{  ctx.emit('domain/changed', value) }).not.toThrow()
  for (const change of [{ ...value, domain: 'other' }, { ...value, table: 'other' }, { ...value, operation: 'deleted' }]) {
    expect(() =>{  ctx.emit('domain/changed', change as DomainChanged) }).not.toThrow()
  }
  expect(() =>{  ctx.emit('domain/changed', { ...value, value: { id: 'different' } }) }).toThrow(InvariantError)
})
