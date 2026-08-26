import { describe, expect, it } from 'vitest'
import { Context } from '@centurionarx/cordis'
import * as WorkspaceInvariant from '@centurionarx/cxh-client-ui-workspace/invariant'
import InvariantRegistry from '@centurionarx/cxh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(WorkspaceInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply is a no-op host placeholder', async () => {
    const { apply } = await import('@centurionarx/cxh-client-ui-workspace')
    apply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })
})
