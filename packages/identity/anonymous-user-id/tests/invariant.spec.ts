import { describe, expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import InvariantRegistry from '@arx-ai/arx-invariants'
import * as UserIdInvariant from '@arx-ai/arx-anonymous-user-id/invariant'

describe('invariant companion', () => {
  it('registers the package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(UserIdInvariant).await()).resolves.toBeDefined()
  })
})
