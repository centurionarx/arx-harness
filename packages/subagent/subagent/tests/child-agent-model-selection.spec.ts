/**
 * `resolveChildAgentOptions()` follows the parent's LIVE model selection
 * over its construction-time `options`, the fix for a subagent spawning on
 * whichever session's pick last touched the shared default rather than its
 * own delegating parent's.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import { installModelSelection } from '@arx-ai/arx-agent'
import type { Agent, ModelSelectionRef } from '@arx-ai/arx-agent'
import { resolveChildAgentOptions } from '../src/child-agent.ts'

/** A bare parent Agent with fixed construction-time options and a scoped ctx. */
function parentAgent(options: Agent['options']): { ctx: Context; parent: Agent } {
  const ctx = new Context()
  const parent = { options } as Agent
  const agentCtx = ctx.extend({ agent: parent })
  Object.assign(parent, { ctx: agentCtx })
  return { ctx, parent }
}

describe('resolveChildAgentOptions()', () => {
  it('falls back to the parent\'s fixed options when no live selection is installed', () => {
    const { parent } = parentAgent({ provider: 'fixed-provider', model: 'fixed-model', maxTokens: 4000 })

    expect(resolveChildAgentOptions(parent, undefined, 1)).toEqual({
      provider: 'fixed-provider', model: 'fixed-model', maxTokens: 4000, subagentDepth: 1,
    })
  })

  it('prefers the parent\'s live selection over its construction-time options for provider/model', () => {
    const { parent } = parentAgent({ provider: 'fixed-provider', model: 'fixed-model', maxTokens: 4000 })
    const selection: ModelSelectionRef = {
      current: { provider: 'live-provider', model: 'live-model' },
      assembled: undefined,
    }
    installModelSelection(parent.ctx, selection)

    // Provider/model come from the live pick; maxTokens has no live-selection
    // counterpart and always comes from the parent's fixed options.
    expect(resolveChildAgentOptions(parent, undefined, 2)).toEqual({
      provider: 'live-provider', model: 'live-model', maxTokens: 4000, subagentDepth: 2,
    })
  })

  it('tracks a live selection that changes after install, and drops out again once cleared', () => {
    const { parent } = parentAgent({ provider: 'fixed-provider', model: 'fixed-model' })
    const selection: ModelSelectionRef = { current: undefined, assembled: undefined }
    installModelSelection(parent.ctx, selection)

    expect(resolveChildAgentOptions(parent, undefined, 0)).toMatchObject({
      provider: 'fixed-provider', model: 'fixed-model',
    })
    selection.current = { provider: 'switched-provider', model: 'switched-model' }
    expect(resolveChildAgentOptions(parent, undefined, 0)).toMatchObject({
      provider: 'switched-provider', model: 'switched-model',
    })
    selection.current = undefined
    expect(resolveChildAgentOptions(parent, undefined, 0)).toMatchObject({
      provider: 'fixed-provider', model: 'fixed-model',
    })
  })

  it('still lets a per-request override win over both the live selection and the fixed options', () => {
    const { parent } = parentAgent({ provider: 'fixed-provider', model: 'fixed-model' })
    installModelSelection(parent.ctx, { current: { provider: 'live-provider', model: 'live-model' }, assembled: undefined })

    expect(resolveChildAgentOptions(parent, { provider: 'requested-provider', model: 'requested-model' }, 3))
      .toEqual({ provider: 'requested-provider', model: 'requested-model', subagentDepth: 3 })
  })
})
