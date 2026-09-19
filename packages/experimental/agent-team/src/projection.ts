/** Durable Agent Team roster and task graph projection. */

import { z } from 'zod'
import { SessionId } from '@arx-ai/arx-session'
import type { ProjectionDefinition } from '@arx-ai/arx-session-projection'
import { applyTeamEvent, emptyTeamFoldState, teamMemberSnapshotSchema } from './fold.ts'
import { TeamId, TeamTaskId } from './types.ts'
import type { TeamFoldState } from './fold.ts'
import type { TeamProjectionView, TeamTaskSnapshot } from './types.ts'

interface AgentTeamProjectionState extends TeamProjectionView {
  readonly nextTaskNumber: number
}

const sessionId = z.string().min(1).transform(SessionId)
const teamId = z.string().min(1).transform(TeamId)
const taskId = z.string().min(1).transform(TeamTaskId)
const task = z.object({
  id: taskId,
  revision: z.number().int().positive(),
  subject: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'deleted']),
  ownerId: sessionId.optional(),
  blockedBy: z.array(taskId),
  writeScopes: z.array(z.string()),
}).strict() as z.ZodType<TeamTaskSnapshot>
const viewObjectSchema = z.object({
  teamId,
  leadId: sessionId,
  members: z.array(teamMemberSnapshotSchema),
  tasks: z.array(task),
}).strict()
const viewSchema = viewObjectSchema as z.ZodType<TeamProjectionView>
const stateSchema = viewObjectSchema.extend({
  nextTaskNumber: z.number().int().positive(),
}) as z.ZodType<AgentTeamProjectionState>

function mutableState(state: AgentTeamProjectionState): TeamFoldState {
  return {
    id: state.teamId,
    members: new Map(state.members.map(entry => [entry.id, entry])),
    memberIdsByName: new Map(state.members.map(entry => [entry.name, entry.id])),
    tasks: new Map(state.tasks.map(entry => [entry.id, entry])),
    messages: new Map(),
    delivered: new Set(),
    nextTaskNumber: state.nextTaskNumber,
  }
}

/** Projection definition reusing the Team domain's strict replay transition. */
export const agentTeamProjectionDefinition = {
  key: 'agentTeam',
  stateVersion: 1,
  stateSchema,
  init: (header, _inheritedEventCount) => {
    const leadId = header.parentSession ?? header.id
    const empty = emptyTeamFoldState(leadId)
    return { teamId: empty.id, leadId, members: [], tasks: [], nextTaskNumber: 1 }
  },
  apply: (state, event) => {
    if (event.type !== 'team/member' && event.type !== 'team/task') return state
    const next = mutableState(state)
    applyTeamEvent(next, event)
    const members = [...next.members.values()]
    const tasks = [...next.tasks.values()]
    const unchanged = next.nextTaskNumber === state.nextTaskNumber
      && members.length === state.members.length
      && tasks.length === state.tasks.length
      && members.every((entry, index) => entry === state.members[index])
      && tasks.every((entry, index) => entry === state.tasks[index])
    return unchanged ? state : {
      teamId: state.teamId,
      leadId: state.leadId,
      members,
      tasks,
      nextTaskNumber: next.nextTaskNumber,
    }
  },
  wire: {
    viewSchema,
    view: state => ({
      teamId: state.teamId,
      leadId: state.leadId,
      members: state.members,
      tasks: state.tasks.filter(task => task.status !== 'deleted'),
    }),
  },
} satisfies ProjectionDefinition<'agentTeam', AgentTeamProjectionState>

declare module '@arx-ai/arx-session-projection/types' {
  interface SessionProjectionStateMap {
    agentTeam: AgentTeamProjectionState
  }
}
