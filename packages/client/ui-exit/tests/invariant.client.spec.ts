import { Context } from '@arx-ai/cordis'
import InvariantRegistry from '@arx-ai/arx-invariants'
import { describe, expect, it } from 'vitest'
import * as ExitInvariant from '../src/invariant.ts'
import { apply as nodeApply } from '../src/index.ts'

describe('exit-seat invariant companion', () => {
  it('reserves package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(ExitInvariant).await()).resolves.toBeDefined()
  })

  it('keeps the node half as an inert Loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
