import { Context } from '@arx-ai/cordis'
import Invariants from '@arx-ai/arx-invariants'
import { expect, it } from 'vitest'
import * as Host from '../src/index.ts'
import * as Companion from '../src/invariant.ts'

it('loads its host bridge and registers an owned invariant companion through the lifecycle', async () => {
  const ctx = new Context()
  await ctx.plugin(Invariants, { enabled: true })
  const host = ctx.plugin(Host)
  const invariant = ctx.plugin(Companion)
  await Promise.all([host, invariant])
  expect(ctx.invariants).toBeTruthy()
  await invariant.dispose()
  await host.dispose()
  await ctx.fiber.dispose()
})
