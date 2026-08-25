import { describe, expect, it } from 'vitest'
import { Context } from '@centurionarx/cordis'
import * as PrimitivesInvariant from '@centurionarx/cxh-client-ui-primitives/invariant'
import InvariantRegistry from '@centurionarx/cxh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(PrimitivesInvariant).await()).resolves.toBeDefined()
  })
})
