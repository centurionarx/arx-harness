import { describe, expect, it } from 'vitest'
import { Context } from '@centurionarx/cordis'
import InvariantRegistry from '@centurionarx/cxh-invariants'
import * as AtomicWriteInvariant from '../src/invariant.ts'

describe('atomic-write invariant companion', () => {
  it('registers its explained empty runtime invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(AtomicWriteInvariant)

    expect(() => {
      ctx.invariants.register('@centurionarx/cxh-atomic-write', () => {})
    }).toThrow(/already registered/)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
