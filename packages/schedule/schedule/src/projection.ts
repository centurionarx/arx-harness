/** Strict client-visible projection of active Session-owned reminders. */

import { z } from 'zod'
import type { ProjectionDefinition } from '@arx-ai/arx-session-projection'
import { applyScheduleChanges, decodeScheduleChange } from './domain.ts'
import type { FoldedSchedules } from './domain.ts'
import type { ScheduleChange, ScheduleId, ScheduleRecord } from './types.ts'

/** Persisted fold plus the immutable fork prefix excluded from ownership. */
export interface ScheduleProjectionState extends FoldedSchedules {
  readonly inheritedEventCount: number
}

const scheduleId = z.unknown().transform((value, context): ScheduleId => {
  try {
    const change = decodeScheduleChange({ version: 1, operation: 'delete', id: value }) as Extract<
      ScheduleChange,
      { operation: 'delete' }
    >
    return change.id
  } catch {
    context.addIssue({ code: 'custom', message: 'invalid Schedule id' })
    return z.NEVER
  }
})

const scheduleRecord = z.unknown().transform((value, context): ScheduleRecord => {
  try {
    const change = decodeScheduleChange({ version: 1, operation: 'create', schedule: value }) as Extract<
      ScheduleChange,
      { operation: 'create' }
    >
    return change.schedule
  } catch {
    context.addIssue({ code: 'custom', message: 'invalid Schedule record' })
    return z.NEVER
  }
})

const scheduleRecords = z.array(scheduleRecord) as unknown as z.ZodType<readonly ScheduleRecord[]>

const stateSchema = z.object({
  inheritedEventCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  active: scheduleRecords,
  seenIds: z.array(scheduleId),
}).strict().superRefine((state, context) => {
  const seen = new Set(state.seenIds)
  if (seen.size !== state.seenIds.length) {
    context.addIssue({ code: 'custom', message: 'seen Schedule ids must be unique' })
  }
  const active = new Set<ScheduleId>()
  for (const record of state.active) {
    if (!seen.has(record.id)) context.addIssue({ code: 'custom', message: 'active Schedule id was not seen' })
    if (active.has(record.id)) context.addIssue({ code: 'custom', message: 'active Schedule ids must be unique' })
    active.add(record.id)
  }
}) as unknown as z.ZodType<ScheduleProjectionState>

/** Projection definition sharing the domain's strict transition authority. */
export const scheduleProjectionDefinition = {
  key: 'schedule',
  stateVersion: 1,
  stateSchema,
  init: (_header, inheritedEventCount) => ({ inheritedEventCount, active: [], seenIds: [] }),
  apply: (state, event) => {
    if (event.seq < state.inheritedEventCount || event.type !== 'schedule/change') return state
    return {
      inheritedEventCount: state.inheritedEventCount,
      ...applyScheduleChanges(state, [decodeScheduleChange(event.data)]),
    }
  },
  wire: { viewSchema: scheduleRecords, view: state => state.active },
} satisfies ProjectionDefinition<'schedule', ScheduleProjectionState>

declare module '@arx-ai/arx-session-projection/types' {
  interface SessionProjectionStateMap {
    schedule: ScheduleProjectionState
  }
}
