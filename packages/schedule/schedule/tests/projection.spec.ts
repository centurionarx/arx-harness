import { describe, expect, it } from 'vitest'
import { SessionId } from '@arx-ai/arx-session'
import type { SessionEvent, SessionHeader } from '@arx-ai/arx-session'
import { Context } from '@arx-ai/cordis'
import SessionProjectionRegistry from '@arx-ai/arx-session-projection'
import { ScheduleId } from '../src/domain.ts'
import { scheduleProjectionDefinition } from '../src/projection.ts'
import type { ScheduleRecord } from '../src/types.ts'

const rootHeader: SessionHeader = {
  version: 1,
  id: SessionId('root'),
  createdAt: 0,
}

const forkHeader: SessionHeader = {
  version: 1,
  id: SessionId('child'),
  createdAt: 1,
  parentSession: rootHeader.id,
  seedLength: 1,
  origin: 'subagent',
}

function record(id: string, prompt: string): ScheduleRecord {
  return {
    id: ScheduleId(id),
    kind: 'at',
    prompt,
    scheduledAt: '2026-09-13T00:00:00.000Z',
  }
}

function created(schedule: ScheduleRecord, seq: number): SessionEvent<'schedule/change'> {
  return {
    type: 'schedule/change',
    seq,
    time: seq,
    data: { version: 1, operation: 'create', schedule },
  }
}

describe('Schedule projection', () => {
  it('excludes a fork inherited prefix and survives checkpoint restart', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    ctx.sessionProjections.register(scheduleProjectionDefinition)
    const events = [created(record('schedule-1', 'parent'), 0), created(record('schedule-2', 'child'), 1)]

    const first = ctx.sessionProjections.restore({}, events, 0, forkHeader, 1)
    expect(first.snapshot.values.schedule).toEqual([record('schedule-2', 'child')])
    expect(first.checkpoint.schedule?.val).toMatchObject({ inheritedEventCount: 1 })

    const restarted = ctx.sessionProjections.restore(first.checkpoint, [], 2, forkHeader, 1)
    expect(restarted.snapshot.values.schedule).toEqual([record('schedule-2', 'child')])
    await ctx.fiber.dispose()
  })

  it('keeps the same state reference for unrelated events', () => {
    const state = scheduleProjectionDefinition.init(rootHeader, 0)
    const unrelated: SessionEvent<'turn/start'> = {
      type: 'turn/start', seq: 0, time: 0, data: { turn: 1 },
    }
    expect(scheduleProjectionDefinition.apply(state, unrelated)).toBe(state)
  })
})

it('rejects malformed checkpoints rather than publishing impossible reminder ownership', () => {
  const schema = scheduleProjectionDefinition.stateSchema
  const item = record('schedule-1', 'valid')
  expect(schema.safeParse({ inheritedEventCount: 0, active: [], seenIds: [''] }).success).toBe(false)
  expect(schema.safeParse({ inheritedEventCount: 0, active: [{}], seenIds: [] }).success).toBe(false)
  expect(schema.safeParse({ inheritedEventCount: 0, active: [], seenIds: [item.id, item.id] }).success).toBe(false)
  expect(schema.safeParse({ inheritedEventCount: 0, active: [item], seenIds: [] }).success).toBe(false)
  expect(schema.safeParse({ inheritedEventCount: 0, active: [item, item], seenIds: [item.id] }).success).toBe(false)
})
