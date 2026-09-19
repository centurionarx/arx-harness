import { useState } from 'react'
import type { SessionId } from '@arx-ai/arx-session'
import type { TeamMemberSnapshot, TeamProjectionView, TeamTaskSnapshot } from '@arx-ai/arx-experimental-agent-team'
import { IconChevronDownOutline14, IconUserOutline16, StateDot } from '@arx-ai/arx-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@arx-ai/arx-client-ui-slots'
import type {} from '@arx-ai/arx-client-ui-conversation/client'
import { NS } from './locales.ts'
import css from './TeamAction.module.css'

export interface TeamActionInjected {
  openMember: (leadId: SessionId, memberId: SessionId) => Promise<void>
}

export type TeamActionProps = PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>
  & InjectFace<TeamActionInjected>

type VisibleTask = TeamTaskSnapshot & { readonly status: Exclude<TeamTaskSnapshot['status'], 'deleted'> }

type MemberStatus = 'running' | 'idle' | 'inactive' | 'provisioning' | 'failed'

function statusOf(member: TeamMemberSnapshot | undefined, running: boolean | undefined): MemberStatus {
  if (member?.phase === 'failed') return 'failed'
  if (member?.phase === 'provisioning') return 'provisioning'
  if (running === true) return 'running'
  return running === false ? 'idle' : 'inactive'
}

function statusText(status: MemberStatus, t: TranslateNS<typeof NS>): string {
  return t(`status.${status}`)
}

function taskStatus(task: VisibleTask, t: TranslateNS<typeof NS>): string {
  return t(`task.${task.status}`)
}

function visibleToSession(team: TeamProjectionView, sessionId: SessionId): boolean {
  return sessionId === team.leadId || team.members.some(member => member.id === sessionId)
}

/** Read-only Team roster and dependency graph for the current Team member. */
export function TeamAction({ sessionId, useProjection, useSessions, openMember, t }: TeamActionProps) {
  const team = useProjection('agentTeam')
  const summaries = useSessions(state => state.byId)
  const [open, setOpen] = useState(false)
  if (team === undefined || !visibleToSession(team, sessionId)) return null

  const tasks = team.tasks.filter((task): task is VisibleTask => task.status !== 'deleted')
  if (team.members.length === 0 && tasks.length === 0) return null
  const members = [{ id: team.leadId, name: t('lead'), member: undefined }, ...team.members.map(member => ({
    id: member.id, name: member.name, member,
  }))]
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const memberNames = new Map(team.members.map(member => [member.id, member.name]))
  memberNames.set(team.leadId, t('lead'))
  const trigger = t('trigger', { members: members.length, tasks: tasks.length })

  return (
    <div className={css.root}>
      <button
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-label={trigger}
        onClick={() => { setOpen(value => !value) }}
      >
        <IconUserOutline16 size={14} />
        <span>{trigger}</span>
        <IconChevronDownOutline14 className={open ? css.chevronOpen : undefined} />
      </button>
      {open ? (
        <div className={css.panel}>
          <section aria-labelledby="agent-team-members">
            <h3 id="agent-team-members">{t('members')}</h3>
            <ul className={css.members} aria-label={t('members')}>
              {members.map(({ id, name, member }) => {
                const status = statusOf(member, summaries[id]?.running)
                return (
                  <li key={id}>
                    <button
                      type="button"
                      disabled={id === sessionId}
                      aria-label={t('open', { name })}
                      onClick={() => { void openMember(team.leadId, id) }}
                    >
                      <StateDot state={status === 'running' ? 'ongoing' : status === 'failed' ? 'error' : status === 'provisioning' ? 'warning' : 'done'} />
                      <strong>{name}</strong>
                      <span>{statusText(status, t)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
          {tasks.length > 0 ? (
            <section aria-labelledby="agent-team-tasks">
              <h3 id="agent-team-tasks">{t('tasks')}</h3>
              <ol className={css.tasks} aria-label={t('tasks')}>
                {tasks.map((task) => {
                  const blockers = task.blockedBy.map(id => tasksById.get(id)?.subject ?? id)
                  const ready = task.status === 'pending' && task.blockedBy.every(
                    id => tasksById.get(id)?.status === 'completed',
                  )
                  return (
                    <li key={task.id}>
                      <div><strong>{task.subject}</strong><span>{taskStatus(task, t)}</span></div>
                      {task.ownerId === undefined ? null : <small>{memberNames.get(task.ownerId) ?? task.ownerId}</small>}
                      {blockers.length > 0 ? <small>{t('blockedBy', { tasks: blockers.join(', ') })}</small> : null}
                      {ready ? <small>{t('ready')}</small> : null}
                    </li>
                  )
                })}
              </ol>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
