import { describe, expect, it } from 'vitest'
import { Context } from '@centurionarx/cordis'
import * as GeneralInvariant from '@centurionarx/cxh-client-ui-settings-general/invariant'
import InvariantRegistry from '@centurionarx/cxh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(GeneralInvariant).await()).resolves.toBeDefined()
  })
})
