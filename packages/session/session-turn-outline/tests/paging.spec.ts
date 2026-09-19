import { expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import SessionStore from '@arx-ai/arx-session'
import SessionProjectionRegistry from '@arx-ai/arx-session-projection'
import type { Agent } from '@arx-ai/arx-agent'
import { createMessage } from '@arx-ai/arx-llm'
import * as Outline from '../src/index.ts'
it('bounds wire pages while retaining and searching every historical turn', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry); await ctx.plugin(Outline)
    const session = ctx.sessions.create()
    for (let turn = 1; turn <= 351; turn += 1) {
      session.append('turn/start', { turn })
      if (turn === 1) session.append('user/message', createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'historical needle' }] }), { surfaceOp: 'append' })
      session.append('turn/end', { turn, reason: { kind: 'completed' } })
    }
    expect(ctx.sessionProjections.stateOf(session, 'turnOutline')?.total).toBe(351)
    const wire = ctx.sessionProjections.snapshot(session).values.turnOutline!
    expect(wire).toMatchObject({ total: 351, hasMore: true })
    expect(wire.turns).toHaveLength(100)
    const agent = { session } as Agent
    const signal = new AbortController().signal
    let page = wire
    const entries = [...page.turns]
    while (page.hasMore) {
      page = ctx.turnOutlines.page(agent, page.nextBefore!, '', signal)
      expect(page.turns.length).toBeLessThanOrEqual(100)
      entries.push(...page.turns)
    }
    expect(new Set(entries.map(entry => entry.startSeq)).size).toBe(351)
    expect(ctx.turnOutlines.page(agent, null, 'historical needle', signal).turns.map(entry => entry.turn)).toEqual([1])
    expect(() => ctx.turnOutlines.page(agent, -1, '', signal)).toThrow('cursor')
    expect(() => ctx.turnOutlines.page(agent, null, 'x'.repeat(201), signal)).toThrow('200')
    expect(() => ctx.turnOutlines.page(agent, null, '', AbortSignal.abort())).toThrow()
  } finally { await ctx.fiber.dispose() }
})

it('does not mutate borrowed states or published pages across chunk boundaries', async () => {
  const { turnOutlineDefinition } = await import('../src/projection.ts')
  const { outlinePage } = await import('../src/page.ts')
  let state = turnOutlineDefinition.init()
  for (let turn = 1; turn <= 256; turn += 1) state = turnOutlineDefinition.apply(state, { type: 'turn/start', data: { turn }, seq: turn } as import('@arx-ai/arx-session').SessionEvent)
  const borrowed = state
  const before = JSON.stringify(borrowed)
  const published = outlinePage(state)
  state = turnOutlineDefinition.apply(state, { type: 'turn/start', data: { turn: 257 }, seq: 257 } as import('@arx-ai/arx-session').SessionEvent)
  expect(state.head?.previous).toBe(borrowed.head)
  expect(JSON.stringify(borrowed)).toBe(before)
  expect(published.turns.at(-1)?.turn).toBe(256)
  expect(outlinePage(state).turns.at(-1)?.turn).toBe(257)
})
