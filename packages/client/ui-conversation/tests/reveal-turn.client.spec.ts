import { expect, it, vi } from 'vitest'
import type { ConversationSnapshot, TurnLocation } from '@arx-ai/arx-client-runtime/client'
import { revealTurnNode } from '../src/client/reveal-turn.ts'

function snapshot(startSeq: number, hasMore = true, visible = true): ConversationSnapshot {
  const turn = { turn: startSeq + 1, start: { seq: startSeq } } as TurnLocation
  return {
    openState: 'open', removed: false, hasMore, loadingOlder: false,
    chat: {
      timeline: { turnOrder: [turn.turn], turns: new Map([[turn.turn, turn]]) },
      order: ['row'], locations: { getTurn: () => ['row'] },
      nodes: { get: () => ({ anchorSeq: startSeq + 1, visibility: visible ? 'visible' : 'hidden' }) },
    },
  } as unknown as ConversationSnapshot
}

it('loads sequential pages until the exact boundary and resolves a row in that turn', async () => {
  let current = snapshot(100)
  const loadOlder = vi.fn(async () => { current = snapshot(current.chat.timeline.turnOrder[0]! - 51) })
  expect(await revealTurnNode({ getSnapshot: () => current, loadOlder }, 0, () => true)).toBe('row')
  expect(loadOlder).toHaveBeenCalledTimes(2)
})

it.each(['no-progress', 'closed', 'busy', 'exhausted', 'no-row', 'failure', 'limit'])(
  'declines unavailable navigation: %s', async (reason) => {
    let current = snapshot(reason === 'no-row' ? 0 : 100, reason !== 'exhausted', reason !== 'no-row')
    if (reason === 'closed') current = { ...current, openState: 'closed' as ConversationSnapshot['openState'] }
    if (reason === 'busy') current = { ...current, loadingOlder: true }
    const loadOlder = vi.fn(async () => { if (reason === 'failure') throw new Error('offline') })
    expect(await revealTurnNode({ getSnapshot: () => current, loadOlder }, 0, () => true, reason === 'limit' ? 0 : 20)).toBeNull()
    expect(loadOlder.mock.calls.length).toBeLessThanOrEqual(1)
  },
)

it.each(['cancelled', 'session switched'])('does not navigate after %s during a history request', async () => {
  let active = true
  let current = snapshot(100)
  const loadOlder = vi.fn(async () => { current = snapshot(0); active = false })
  expect(await revealTurnNode({ getSnapshot: () => current, loadOlder }, 0, () => active)).toBeNull()
  expect(loadOlder).toHaveBeenCalledTimes(1)
})

it('rejects invalid addresses and cancellation before requesting history', async () => {
  const loadOlder = vi.fn()
  for (const seq of [-1, NaN, 0.5]) {
    expect(await revealTurnNode({ getSnapshot: () => snapshot(100), loadOlder }, seq, () => true)).toBeNull()
  }
  expect(await revealTurnNode({ getSnapshot: () => snapshot(100), loadOlder }, 0, () => false)).toBeNull()
  expect(loadOlder).not.toHaveBeenCalled()
})
