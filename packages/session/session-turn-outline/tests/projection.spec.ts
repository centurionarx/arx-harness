import { afterEach, expect, it } from 'vitest'
import { createMessage } from '@arx-ai/arx-llm'
import { Context } from '@arx-ai/cordis'
import SessionStore, { SessionId } from '@arx-ai/arx-session'
import SessionProjectionRegistry from '@arx-ai/arx-session-projection'
import * as Outline from '../src/index.ts'

let ctx: Context | undefined
afterEach(async () => { await ctx?.fiber.dispose() })
async function setup() {
  ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  return ctx
}

it('replays the complete log when installed late and retains first direct user text', async () => {
  const context = await setup()
  const session = context.sessions.create(SessionId('outline'))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '  First\n request  ' }] }), { surfaceOp: 'append' })
  session.append('user/message', createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'later steering' }] }), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  session.append('user/message', createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '😀'.repeat(140) }] }), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 2, reason: { kind: 'interrupted' } })
  const original = [...session.events]
  await context.plugin(Outline)
  const projection = context.sessionProjections.snapshot(session).values.turnOutline
  expect(projection).toEqual({ total: 2, hasMore: false, turns: [
    { turn: 1, startSeq: 0, endSeq: 3, preview: 'First request', status: 'completed' },
    { turn: 2, startSeq: 4, endSeq: 6, preview: '😀'.repeat(120), status: 'interrupted' },
  ] })
  expect(session.events).toEqual(original)
  const fork = context.sessions.fork(session, 3, SessionId('outline-fork'))
  expect(context.sessionProjections.snapshot(fork).values.turnOutline?.turns).toEqual(projection?.turns.slice(0, 1))
  fork.append('turn/start', { turn: 2 })
  expect(context.sessionProjections.snapshot(fork).values.turnOutline?.turns.at(-1))
    .toMatchObject({ turn: 2, status: 'running', preview: '' })
  expect(context.sessionProjections.snapshot(session).values.turnOutline).toEqual(projection)
})

it('publishes an empty index, ignores non-turn data, and unloads cleanly', async () => {
  const context = await setup()
  const plugin = context.plugin(Outline)
  await plugin
  const session = context.sessions.create()
  expect(context.sessionProjections.snapshot(session).values.turnOutline).toEqual({ turns: [], total: 0, hasMore: false })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  expect(context.sessionProjections.snapshot(session).values.turnOutline?.turns).toHaveLength(1)
  await plugin.dispose()
  expect(context.sessionProjections.snapshot(session).values.turnOutline).toBeUndefined()
})

it('skips empty and non-text input until the first meaningful preview and validates persisted chunks', async () => {
  const context = await setup(); await context.plugin(Outline)
  const session = context.sessions.create()
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createMessage({ role: 'user', source: { kind: 'user' }, content: [] }), { surfaceOp: 'append' })
  session.append('user/message', createMessage({ role: 'user', source: { kind: 'user' }, content: [
    { type: 'reasoning', text: 'non-text block' },
    { type: 'text', text: '  ' },
  ] }), { surfaceOp: 'append' })
  const { turnOutlineDefinition } = await import('../src/projection.ts')
  const state = context.sessionProjections.stateOf(session, 'turnOutline')
  expect(turnOutlineDefinition.stateSchema.parse(state)).toEqual(state)
  expect(context.sessionProjections.snapshot(session).values.turnOutline?.turns[0]?.preview).toBe('')
})
it('refuses page requests when the projection is not installed', async () => {
  const context = await setup()
  const service = new Outline.TurnOutlineService(context)
  const agent = { session: context.sessions.create() } as import('@arx-ai/arx-agent').Agent
  expect(() => service.page(agent, null, '', new AbortController().signal)).toThrow('unavailable')
})
