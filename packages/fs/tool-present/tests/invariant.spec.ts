import { Context } from '@arx-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import SessionStore, { type SessionEventMap } from '@arx-ai/arx-session'
import { CallId } from '@arx-ai/arx-llm'
import InvariantRegistry from '@arx-ai/arx-invariants'
import * as PresentInvariant from '../src/invariant.ts'
import type {} from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function setup(install = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  if (install) await ctx.plugin(PresentInvariant)
  return ctx
}

describe('delivery event invariants', () => {
  it('accepts references in their open turn and rejects a different turn before append', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('deliverables/presented', { turn: 1, callId: CallId('ok'), files: [{ path: 'x.txt' }] })
    expect(() => session.append('deliverables/presented', {
      turn: 2, callId: CallId('bad'), files: [{ path: 'x.txt' }],
    })).toThrow('open turn')
    expect(session.events).toHaveLength(2)
  })

  it.each([
    { callId: '', files: [{ path: 'x' }] },
    { callId: 'bad', files: [] },
    { callId: 'bad', files: [null] },
    { callId: 'bad', files: [{ path: ' ' }] },
    { callId: 'bad', files: [{ path: 'x', description: 42 }] },
  ])('rejects malformed persisted data', async (data) => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    expect(() => session.append('deliverables/presented', {
      turn: 1, ...data,
    } as unknown as SessionEventMap['deliverables/presented'])).toThrow('deliverables/presented')
    expect(session.events).toHaveLength(1)
  })

  it('validates historical ownership when installed late', async () => {
    const ctx = await setup(false)
    ctx.sessions.create().append('deliverables/presented', {
      turn: 1, callId: CallId('orphan'), files: [{ path: 'x.txt' }],
    })
    await expect(ctx.plugin(PresentInvariant).then(() => undefined)).rejects.toThrow('open turn')
  })

  it('replays valid history and removes checks when disposed', async () => {
    const ctx = await setup(false)
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('deliverables/presented', {
      turn: 1, callId: CallId('ok'), files: [{ path: 'x.txt', description: 'test' }],
    })
    const plugin = ctx.plugin(PresentInvariant)
    await plugin
    await plugin.dispose()
    expect(() => session.append('deliverables/presented', {
      turn: 9, callId: CallId('outside'), files: [{ path: 'x.txt' }],
    })).not.toThrow()
  })
})
