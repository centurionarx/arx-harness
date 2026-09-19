import { describe, expect, it } from 'vitest'
import { SessionId } from '@arx-ai/arx-session'
import type { SessionEvent, SessionHeader } from '@arx-ai/arx-session'
import { agentTeamProjectionDefinition } from '../src/projection.ts'
import { TeamId, TeamTaskId } from '../src/types.ts'

const leadId = SessionId('lead')
const memberId = SessionId('member')
const root: SessionHeader = { version: 1, id: leadId, createdAt: 0 }
const child: SessionHeader = {
  version: 1,
  id: memberId,
  createdAt: 1,
  parentSession: leadId,
  seedLength: 2,
  origin: 'subagent',
}

function memberEvent(teamId = TeamId(leadId)): SessionEvent<'team/member'> {
  return {
    type: 'team/member',
    seq: 0,
    time: 0,
    data: {
      version: 1,
      teamId,
      member: {
        id: memberId,
        name: 'reviewer',
        description: 'Reviews the patch',
        provider: 'spawn',
        context: 'fresh',
        phase: 'provisioning',
      },
    },
  }
}

describe('Agent Team projection', () => {
  it('uses the parent as Team lead for an inherited teammate transcript', () => {
    const state = agentTeamProjectionDefinition.init(child, child.seedLength ?? 0)
    const projected = agentTeamProjectionDefinition.apply(state, memberEvent())
    expect(projected.leadId).toBe(leadId)
    expect(agentTeamProjectionDefinition.wire.view(projected).members).toHaveLength(1)
  })

  it('ignores another Team with the same state reference', () => {
    const state = agentTeamProjectionDefinition.init(root, 0)
    expect(agentTeamProjectionDefinition.apply(state, memberEvent(TeamId('other')))).toBe(state)
  })

  it('retains tombstones internally but omits deleted tasks from the wire view', () => {
    const initial = agentTeamProjectionDefinition.init(root, 0)
    const task = {
      id: TeamTaskId('task-1'), revision: 1, subject: 'Inspect', description: 'Inspect output',
      status: 'deleted' as const, blockedBy: [], writeScopes: [],
    }
    const event: SessionEvent<'team/task'> = {
      type: 'team/task', seq: 0, time: 0, data: { version: 1, teamId: TeamId(leadId), task },
    }
    const projected = agentTeamProjectionDefinition.apply(initial, event)
    expect(projected.tasks).toEqual([task])
    expect(agentTeamProjectionDefinition.wire.view(projected).tasks).toEqual([])
  })
})

it('preserves populated immutable state across foreign and unrelated events, then updates a task', () => {
  const memberState = agentTeamProjectionDefinition.apply(agentTeamProjectionDefinition.init(root, 0), memberEvent())
  const task = { id: TeamTaskId('task-1'), revision: 1, subject: 'Inspect', description: 'Inspect output', status: 'pending' as const, blockedBy: [], writeScopes: [] }
  const taskEvent: SessionEvent<'team/task'> = { type: 'team/task', seq: 1, time: 1, data: { version: 1, teamId: TeamId(leadId), task } }
  const populated = agentTeamProjectionDefinition.apply(memberState, taskEvent)
  expect(agentTeamProjectionDefinition.apply(populated, memberEvent(TeamId('other')))).toBe(populated)
  expect(agentTeamProjectionDefinition.apply(populated, { type: 'turn/start', seq: 2, time: 2, data: { turn: 1 } })).toBe(populated)
  expect(agentTeamProjectionDefinition.wire.view(populated).tasks).toEqual([task])
  const updated = agentTeamProjectionDefinition.apply(populated, { ...taskEvent, seq: 3, data: { ...taskEvent.data, task: { ...task, revision: 2, status: 'completed' } } })
  expect(updated.tasks[0]?.status).toBe('completed')
  expect(populated.tasks[0]?.status).toBe('pending')
})
