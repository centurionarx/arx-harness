import { describe, expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import * as WebInvariant from '@arx-ai/arx-client-ui-settings-web/invariant'
import InvariantRegistry from '@arx-ai/arx-invariants'
import { WebSection } from '../src/client/WebSection.tsx'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(WebInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply is a no-op host placeholder', async () => {
    const { apply } = await import('@arx-ai/arx-client-ui-settings-web')
    apply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })

  it('renders null until the shell injects the section dependencies', () => {
    expect(WebSection({})).toBeNull()
  })
})
