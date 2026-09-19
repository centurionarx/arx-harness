// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@arx-ai/arx-client-test-runtime'
import { SessionId } from '@arx-ai/arx-session'
import { TeamId, TeamTaskId } from '@arx-ai/arx-experimental-agent-team'
import type { TeamProjectionView } from '@arx-ai/arx-experimental-agent-team'
import { TeamAction, type TeamActionProps } from '../src/client/TeamAction.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const leadId = SessionId('lead')
const memberId = SessionId('member')
const team: TeamProjectionView = {
  teamId: TeamId(leadId),
  leadId,
  members: [{
    id: memberId, name: 'reviewer', description: 'Review', provider: 'spawn', context: 'fresh', phase: 'active',
  }],
  tasks: [
    { id: TeamTaskId('task-1'), revision: 1, subject: 'Implement', description: 'Implement', status: 'completed', blockedBy: [], writeScopes: [] },
    { id: TeamTaskId('task-2'), revision: 1, subject: 'Review', description: 'Review', status: 'pending', ownerId: memberId, blockedBy: [TeamTaskId('task-1')], writeScopes: [] },
  ],
}

function props(value: TeamProjectionView | undefined, sessionId = leadId): TeamActionProps {
  return {
    sessionId,
    useProjection: (() => value),
    useSessions: (select: (state: unknown) => unknown) => select({
      byId: { [leadId]: { running: true }, [memberId]: { running: false } },
    }),
    openMember: vi.fn(() => Promise.resolve()),
    t: makeTranslate(en),
  } as unknown as TeamActionProps
}

describe('TeamAction', () => {
  it('is absent when the experimental projection is not composed', () => {
    expect(render(<TeamAction {...props(undefined)} />).container.innerHTML).toBe('')
  })

  it('shows lead, teammate status, task dependencies, and navigates a teammate', () => {
    const input = props(team)
    render(<TeamAction {...input} />)
    fireEvent.click(screen.getByRole('button', { name: /Team: 2 members, 2 tasks/ }))

    const roster = screen.getByRole('list', { name: en.members })
    expect(within(roster).getByText('running')).toBeTruthy()
    expect(within(roster).getByText('idle')).toBeTruthy()
    expect(screen.getByText('Blocked by: Implement')).toBeTruthy()
    expect(screen.getByText(en.ready)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Open reviewer session' }))
    expect(input.openMember).toHaveBeenCalledWith(leadId, memberId)
  })

  it('does not expose a Team to an unrelated Session', () => {
    expect(render(<TeamAction {...props(team, SessionId('outsider'))} />).container.innerHTML).toBe('')
  })
})

it('shows failed, provisioning, and unloaded teammates without inventing runtime activity', () => {
  const value: TeamProjectionView = {
    ...team,
    members: [
      { ...team.members[0]!, phase: 'failed' },
      { ...team.members[0]!, id: SessionId('starting'), name: 'starting', phase: 'provisioning' },
      { ...team.members[0]!, id: SessionId('offline'), name: 'offline', phase: 'active' },
    ],
    tasks: [{ ...team.tasks[1]!, ownerId: SessionId('absent-owner'), blockedBy: [TeamTaskId('absent-task')] }],
  }
  render(<TeamAction {...props(value, memberId)} />)
  fireEvent.click(screen.getByRole('button', { name: /Team: 4 members/ }))
  expect(screen.getByText(en['status.failed'])).toBeTruthy()
  expect(screen.getByText(en['status.provisioning'])).toBeTruthy()
  expect(screen.getByText(en['status.inactive'])).toBeTruthy()
  expect(screen.getByText('absent-owner')).toBeTruthy()
  expect(screen.getByText('Blocked by: absent-task')).toBeTruthy()
  expect(screen.queryByText(en.ready)).toBeNull()
})

it('hides an empty roster and deleted tasks, but keeps a roster without tasks usable', () => {
  const view = render(<TeamAction {...props({ ...team, members: [], tasks: [] })} />)
  expect(view.container.innerHTML).toBe('')
  view.rerender(<TeamAction {...props({ ...team, members: [], tasks: [{ ...team.tasks[0]!, status: 'deleted' }] })} />)
  expect(view.container.innerHTML).toBe('')
  view.rerender(<TeamAction {...props({ ...team, tasks: [] })} />)
  fireEvent.click(screen.getByRole('button', { name: /Team: 2 members, 0 tasks/ }))
  expect(screen.getByRole('list', { name: en.members })).toBeTruthy()
  expect(screen.queryByRole('list', { name: en.tasks })).toBeNull()
})
