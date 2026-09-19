// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectControls } from '../src/client/ProjectControls.tsx'
import { PromptVariables } from '../src/client/PromptVariables.tsx'
import { PlanEditor } from '../src/client/PlanEditor.tsx'
import { ProjectsBoard } from '../src/client/ProjectsEntry.tsx'
import type {} from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'
import type { ProjectRecord, ProjectSummary } from '@arx-ai/arx-api-remotes/client'

afterEach(cleanup)
type EditorProps = Parameters<typeof PlanEditor>[0]
type BoardProps = Parameters<typeof ProjectsBoard>[0]
const t = ((key: keyof typeof en) => en[key]) as EditorProps['t']
const first = 'task-a' as NonNullable<EditorProps['latest']>['items'][number]['id']
const second = 'task-b' as typeof first
const latest = {
  revision: 2,
  summary: 'Ship a reliable change',
  items: [
    { id: first, title: 'Implement', acceptanceCriteria: ['Pass regression tests'], dependsOn: [] },
    { id: second, title: 'Review', acceptanceCriteria: ['Review evidence'], dependsOn: [first] },
  ],
}
const record: ProjectRecord = {
  evaluations: [],
  budget: { maxActiveRuns: 4, maxStepsPerRun: 100, maxRunDurationMs: 3600000 },
  id: 'project-a' as ProjectRecord['id'],
  workspaceId: 'workspace-a' as ProjectRecord['workspaceId'],
  version: 4,
  name: 'Harness',
  plans: [{ ...latest, createdAt: '2026-09-12T00:00:00.000Z' }],
  tasks: [],
  prompts: [],
  workflows: [],
  runs: [],
  createdAt: '2026-09-12T00:00:00.000Z',
  updatedAt: '2026-09-12T00:00:00.000Z',
}
const catalog: ProjectSummary[] = [
  {
    id: record.id,
    workspaceId: record.workspaceId,
    version: record.version,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  },
]
function board(overrides: Partial<BoardProps> = {}): BoardProps {
  return {
    t,
    list: vi.fn(async () => catalog),
    get: vi.fn(async () => record),
    create: vi.fn(async () => record),
    savePlan: vi.fn(async () => record),
    approvePlan: vi.fn(async () => record),
    savePrompt: vi.fn(async () => record),
    finalizeEvaluation: vi.fn(async () => record),
    configureBudget: vi.fn(async () => record),
    resumeRun: vi.fn(async () => record),
    reconcileRun: vi.fn(async () => record),
    openSession: vi.fn(),
    useWorkspaces: selector =>
      selector({
        items: [
          {
            workspaceId: record.workspaceId,
            title: 'Workspace',
            path: '/project',
            sessionIds: [],
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          },
        ],
        archivedSessionIds: [],
        state: 'idle',
        phase: 'ready',
        error: null,
        baselinesReady: true,
        recentWorkspaceId: record.workspaceId,
      }),
    ...overrides,
  }
}

describe('stable project plan editing', () => {
  it('keeps identity when renaming and removes only dependencies on a deleted task', async () => {
    const save = vi.fn<EditorProps['save']>(async () => {})
    render(<PlanEditor latest={latest} busy={false} t={t} save={save} />)
    fireEvent.change(screen.getAllByLabelText(en.items)[1]!, { target: { value: 'Independent review' } })
    fireEvent.click(screen.getAllByRole('button', { name: en.removeTask })[0]!)
    fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.savePlan }))
    await waitFor(() => {
      expect(save).toHaveBeenCalledOnce()
    })
    expect(save.mock.calls[0]).toEqual([
      {
        summary: latest.summary,
        items: [
          {
            id: second,
            title: 'Independent review',
            acceptanceCriteria: ['Review evidence'],
            dependsOn: [],
          },
        ],
      },
    ])
    expect(latest.items[1]!.dependsOn).toEqual([first])
  })

  it('adds a new stable item and passes named dependencies to validation', async () => {
    const save = vi.fn<EditorProps['save']>(async () => {})
    render(<PlanEditor latest={latest} busy={false} t={t} save={save} />)
    fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.addTask }))
    fireEvent.change(screen.getAllByLabelText(en.items)[2]!, { target: { value: 'Deploy' } })
    const selector = screen.getAllByLabelText(en.dependencies)[2]! as HTMLSelectElement
    selector.options[1]!.selected = true
    fireEvent.change(selector)
    fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.savePlan }))
    await waitFor(() => {
      expect(save).toHaveBeenCalledOnce()
    })
    const request = save.mock.calls[0]![0] as unknown as NonNullable<EditorProps['latest']>
    expect(request.items[2]!.id).not.toBe(first)
    expect(request.items[2]!.id).not.toBe(second)
    expect(request.items[2]!.dependsOn).toEqual([second])
  })

  it('does not submit empty tasks or while a write is pending', () => {
    const save = vi.fn<EditorProps['save']>(async () => {})
    const view = render(<PlanEditor latest={undefined} busy={false} t={t} save={save} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.savePlan }).disabled).toBe(true)
    view.rerender(<PlanEditor latest={latest} busy t={t} save={save} />)
    fireEvent.submit(screen.getByRole<HTMLButtonElement>('button', { name: en.savePlan }).closest('form')!)
    expect(save).not.toHaveBeenCalled()
  })
})

describe('project workspace requests', () => {
  it('approves the displayed exact revision with the current aggregate version', async () => {
    const props = board()
    render(<ProjectsBoard {...props} />)
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull()
    })
    fireEvent.change(screen.getByLabelText(en.select), { target: { value: record.id } })
    fireEvent.click(await screen.findByRole('button', { name: en.approve + ' 2' }))
    await waitFor(() => {
      expect(props.approvePlan).toHaveBeenCalledWith(record.id, 4, 2)
    })
  })

  it('preserves the draft after a conflicting write and reloads explicitly', async () => {
    const props = board({
      savePlan: vi.fn(async () => {
        throw new Error('Project changed concurrently')
      }),
    })
    render(<ProjectsBoard {...props} />)
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull()
    })
    fireEvent.change(screen.getByLabelText(en.select), { target: { value: record.id } })
    const input = await screen.findByLabelText(en.summary)
    fireEvent.change(input, { target: { value: 'My draft' } })
    fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.savePlan }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>(en.summary).value).toBe('My draft')
    fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.refresh }))
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>(en.summary).value).toBe(latest.summary)
    })
  })

  it('ignores a response arriving after the board unmounts', async () => {
    const pending = Promise.withResolvers<readonly ProjectSummary[]>()
    const props = board({ list: () => pending.promise })
    const view = render(<ProjectsBoard {...props} />)
    view.unmount()
    await act(async () => {
      pending.resolve(catalog)
    })
    expect(screen.queryByText(record.name)).toBeNull()
  })

  it('creates projects only against a selected registered workspace', async () => {
    const props = board()
    render(<ProjectsBoard {...props} />)
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull()
    })
    fireEvent.change(screen.getByLabelText(en.name), { target: { value: 'New project' } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.create }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(en.workspace), { target: { value: record.workspaceId } })
    fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.create }))
    await waitFor(() => {
      expect(props.create).toHaveBeenCalledWith({ name: 'New project', workspaceId: record.workspaceId })
    })
    expect(within(screen.getByLabelText(en.select)).getByRole('option', { name: record.name })).toBeTruthy()
  })
})

it('edits typed prompt variables without losing required flags', () => {
  const change = vi.fn()
  render(<PromptVariables initial={{ target: { type: 'string', required: true } }} disabled={false} change={change} />)
  fireEvent.change(screen.getByLabelText('Variable type'), { target: { value: 'number' } })
  expect(change).toHaveBeenLastCalledWith({ target: { type: 'number', required: true } })
  fireEvent.click(screen.getByLabelText('Required'))
  expect(change).toHaveBeenLastCalledWith({ target: { type: 'number', required: false } })
})

it('requires explicit uncertainty review and refuses a budget resume above project limits', () => {
  const props = board()
  const run = {
    id: 'run' as ProjectRecord['runs'][number]['id'],
    workflowId: 'wf' as ProjectRecord['runs'][number]['workflowId'],
    workflowRevision: 1,
    state: 'uncertain',
    input: null,
    steps: [],
    launchedSteps: 1,
    maxSteps: 1,
    startedAt: record.createdAt,
    deadlineAt: record.createdAt,
  } as ProjectRecord['runs'][number]
  const project = { ...record, budget: { ...record.budget, maxStepsPerRun: 1 }, runs: [run] }
  const view = render(
    <ProjectControls
      {...props}
      project={project}
      busy={false}
      mutate={async (operation) => {
        await operation()
      }}
    />,
  )
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Release pending steps' }).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText('I checked the previous attempt and authorize retrying uncertain steps.'))
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: 'Release pending steps' }))
  expect(props.reconcileRun).toHaveBeenCalledWith(record.id, record.version, { runId: 'run', state: 'pending' })
  view.rerender(
    <ProjectControls
      {...props}
      project={{ ...project, runs: [{ ...run, state: 'failed', error: 'workflow run step budget exhausted' }] }}
      busy={false}
      mutate={async (operation) => {
        await operation()
      }}
    />,
  )
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Resume pending steps' }).disabled).toBe(true)
})

it.each(['completed', 'failed'] as const)(
  'scores a %s evaluation through the current project version and labels unknown results',
  async (state) => {
    const run = {
      id: 'eval-run' as ProjectRecord['runs'][number]['id'],
      workflowId: 'eval-workflow' as ProjectRecord['runs'][number]['workflowId'],
      workflowRevision: 1,
      state,
      input: null,
      steps: [],
      launchedSteps: 1,
      maxSteps: 1,
      startedAt: record.createdAt,
      deadlineAt: record.createdAt,
    } as ProjectRecord['runs'][number]
    const evaluation = {
      id: 'eval' as ProjectRecord['evaluations'][number]['id'],
      promptId: 'prompt' as ProjectRecord['evaluations'][number]['promptId'],
      promptRevision: 1,
      workflowId: run.workflowId,
      workflowRevision: 1,
      runId: run.id,
      caseSteps: [],
      createdAt: record.createdAt,
    } as ProjectRecord['evaluations'][number]
    const saved = { ...record, runs: [run], evaluations: [evaluation] }
    const finalized: ProjectRecord = {
      ...saved,
      version: saved.version + 1,
      evaluations: [
        {
          ...evaluation,
          result: {
            accepted: null,
            runState: state,
            finalizedAt: record.updatedAt,
            cases: [
              {
                caseId: 'case' as ProjectRecord['evaluations'][number]['caseSteps'][number]['caseId'],
                stepId: 'step' as ProjectRecord['runs'][number]['steps'][number]['stepId'],
                accepted: null,
                expectedSubstringMatches: [],
                validJson: null,
                latencyMs: null,
                tokens: null,
                outputTruncated: true,
              },
            ],
          },
        },
      ],
    }
    const props = board({ get: vi.fn(async () => saved), finalizeEvaluation: vi.fn(async () => finalized) })
    render(<ProjectsBoard {...props} />)
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull()
    })
    fireEvent.change(screen.getByLabelText(en.select), { target: { value: record.id } })
    fireEvent.click(await screen.findByRole('button', { name: 'Score recorded results' }))
    await waitFor(() => {
      expect(props.finalizeEvaluation).toHaveBeenCalledWith(record.id, record.version, { evaluationId: 'eval' })
    })
    expect(await screen.findByText('Unknown (incomplete output)')).toBeTruthy()
    const table = screen.getByRole('table')
    expect(within(table).getAllByText('Unknown')).toHaveLength(2)
  },
)

it('clears duplicate variable validity after the conflicting row is removed', () => {
  render(
    <PromptVariables
      initial={{ first: { type: 'string', required: true }, second: { type: 'string', required: false } }}
      disabled={false}
      change={vi.fn()}
    />,
  )
  const names = screen.getAllByLabelText<HTMLInputElement>('Variable name')
  fireEvent.change(names[1]!, { target: { value: 'first' } })
  expect(names[1]!.checkValidity()).toBe(false)
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove variable' })[0]!)
  expect(screen.getByLabelText<HTMLInputElement>('Variable name').checkValidity()).toBe(true)
})

async function selectProject(props: BoardProps): Promise<void> {
  render(<ProjectsBoard {...props} />)
  await waitFor(() => {
    expect(screen.queryByRole('status')).toBeNull()
  })
  fireEvent.change(screen.getByLabelText(en.select), { target: { value: record.id } })
  await screen.findByRole('heading', { name: record.name })
}

it('saves prompt purpose, normalized tags and typed variables as a new immutable revision', async () => {
  const props = board()
  await selectProject(props)
  fireEvent.change(screen.getByLabelText(en.promptName), { target: { value: 'Review' } })
  fireEvent.change(screen.getByLabelText(en.template), { target: { value: 'Review {{subject}}' } })
  fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: '  Code review  ' } })
  fireEvent.change(screen.getByLabelText('Tags (comma separated)'), { target: { value: ' audit, , backend ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add variable' }))
  fireEvent.change(screen.getByLabelText('Variable name'), { target: { value: 'subject' } })
  fireEvent.click(screen.getByRole('button', { name: en.savePrompt }))
  await waitFor(() => {
    expect(props.savePrompt).toHaveBeenCalledWith(record.id, 4, {
      name: 'Review',
      template: 'Review {{subject}}',
      purpose: 'Code review',
      tags: ['audit', 'backend'],
      variablesSchema: { subject: { type: 'string', required: true } },
      sourceSkills: [],
    })
  })
})

it('loads an existing prompt, preserves pinned sources and uses its name as an empty-purpose fallback', async () => {
  const skill = {
    repository: 'https://example.test/skills',
    commit: 'a'.repeat(40),
    path: 'review/SKILL.md',
    content: 'Review',
    contentHash: 'b'.repeat(64),
  }
  const prompt: ProjectRecord['prompts'][number] = {
    id: 'prompt' as ProjectRecord['prompts'][number]['id'],
    name: 'Reviewer',
    revisions: [
      {
        revision: 1,
        template: 'Original',
        purpose: 'Original purpose',
        tags: ['quality'],
        variablesSchema: {},
        sourceSkills: [skill],
        examples: [],
        evaluationCases: [],
        createdAt: record.createdAt,
      },
    ],
  }
  const props = board({ get: async () => ({ ...record, prompts: [prompt] }) })
  await selectProject(props)
  fireEvent.change(screen.getByLabelText(en.prompts), { target: { value: prompt.id } })
  expect(screen.getByLabelText<HTMLInputElement>(en.promptName).readOnly).toBe(true)
  expect(screen.getByText(/review\/SKILL.md/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText(en.template), { target: { value: 'Updated' } })
  fireEvent.click(screen.getByRole('button', { name: en.savePrompt }))
  await waitFor(() => {
    expect(props.savePrompt).toHaveBeenCalledWith(
      record.id,
      4,
      expect.objectContaining({
        promptId: prompt.id,
        name: 'Reviewer',
        template: 'Updated',
        purpose: 'Reviewer',
        sourceSkills: [skill],
      }),
    )
  })
  fireEvent.change(screen.getByLabelText(en.prompts), { target: { value: '' } })
  expect(screen.getByLabelText<HTMLInputElement>(en.promptName).value).toBe('')
})

it('displays read failures and ignores rejected reads after unmounting', async () => {
  const pending = Promise.withResolvers<readonly ProjectSummary[]>()
  const view = render(<ProjectsBoard {...board({ list: () => pending.promise })} />)
  await act(async () => {
    pending.reject(new Error('Connection unavailable'))
  })
  expect(screen.getByRole('alert').textContent).toContain('Connection unavailable')
  view.unmount()
  const late = Promise.withResolvers<readonly ProjectSummary[]>()
  const next = render(<ProjectsBoard {...board({ list: () => late.promise })} />)
  next.unmount()
  await act(async () => {
    late.reject(new Error('Late failure'))
  })
  expect(screen.queryByRole('alert')).toBeNull()
})

it.each(['resolve', 'reject'] as const)('ignores a %s mutation after the dialog unmounts', async (outcome) => {
  const pending = Promise.withResolvers<ProjectRecord>()
  const props = board({ savePlan: () => pending.promise })
  await selectProject(props)
  fireEvent.click(screen.getByRole('button', { name: en.savePlan }))
  cleanup()
  await act(async () => {
    if (outcome === 'resolve') pending.resolve(record)
    else pending.reject(new Error('Late write'))
  })
  expect(screen.queryByRole('alert')).toBeNull()
})

it('updates execution budgets through versioned operator requests', () => {
  const props = board()
  render(
    <ProjectControls
      {...props}
      project={record}
      busy={false}
      mutate={async (operation) => {
        await operation()
      }}
    />,
  )
  fireEvent.change(screen.getByLabelText('Concurrent runs'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Steps per run'), { target: { value: '10' } })
  fireEvent.change(screen.getByLabelText('Duration per run (seconds)'), { target: { value: '120' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save execution limits' }))
  expect(props.configureBudget).toHaveBeenCalledWith(record.id, record.version, {
    maxActiveRuns: 2,
    maxStepsPerRun: 10,
    maxRunDurationMs: 120000,
  })
})

it('resumes a budget-stopped run with valid new limits and permits stopping an uncertain run', () => {
  const props = board()
  const run: ProjectRecord['runs'][number] = {
    id: 'retry' as ProjectRecord['runs'][number]['id'],
    workflowId: 'wf' as ProjectRecord['runs'][number]['workflowId'],
    workflowRevision: 1,
    state: 'failed',
    input: null,
    steps: [],
    launchedSteps: 1,
    maxSteps: 1,
    startedAt: record.createdAt,
    deadlineAt: record.createdAt,
    error: 'workflow run deadline elapsed',
  }
  const project = { ...record, runs: [run], workflows: [{ id: run.workflowId, name: 'Saved work', revisions: [] }] }
  const view = render(
    <ProjectControls
      {...props}
      project={project}
      busy={false}
      mutate={async (operation) => {
        await operation()
      }}
    />,
  )
  fireEvent.change(screen.getByLabelText('New total step allowance'), { target: { value: '3' } })
  fireEvent.change(screen.getByLabelText('Additional duration (seconds)'), { target: { value: '30' } })
  fireEvent.click(screen.getByRole('button', { name: 'Resume pending steps' }))
  expect(props.resumeRun).toHaveBeenCalledWith(record.id, record.version, {
    runId: run.id,
    maxSteps: 3,
    maxDurationMs: 30000,
  })
  view.rerender(
    <ProjectControls
      {...props}
      project={{ ...project, runs: [{ ...run, state: 'uncertain' }] }}
      busy={false}
      mutate={async (operation) => {
        await operation()
      }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Stop this run' }))
  expect(props.reconcileRun).toHaveBeenCalledWith(record.id, record.version, {
    runId: run.id,
    state: 'failed',
    error: 'Stopped after operator review',
  })
  view.rerender(
    <ProjectControls
      {...props}
      project={{ ...project, runs: [{ ...run, error: 'child failure' }] }}
      busy={false}
      mutate={async (operation) => {
        await operation()
      }}
    />,
  )
  expect(screen.queryByRole('button', { name: 'Resume pending steps' })).toBeNull()
})

it('rejects reserved prompt variable names and edits acceptance criteria without replacing identity', async () => {
  const view = render(<PromptVariables initial={{}} disabled={false} change={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Add variable' }))
  fireEvent.change(screen.getByLabelText('Variable name'), { target: { value: '__proto__' } })
  expect(screen.getByLabelText<HTMLInputElement>('Variable name').validationMessage).toContain('another')
  view.unmount()
  const save = vi.fn<EditorProps['save']>(async () => {})
  render(<PlanEditor latest={latest} busy={false} save={save} t={t} />)
  fireEvent.change(screen.getAllByLabelText(en.criteria)[0]!, { target: { value: ' First\n \n Second ' } })
  fireEvent.click(screen.getByRole('button', { name: en.savePlan }))
  await waitFor(() => { expect(save).toHaveBeenCalledOnce() })
  expect(save.mock.calls[0]?.[0].items[0]).toEqual({
    id: first, title: 'Implement', acceptanceCriteria: ['First', 'Second'], dependsOn: [],
  })
})

it('shows task, run and evaluation evidence and opens the recorded execution', async () => {
  const raw: unknown = {
    ...record,
    approvedPlan: { revision: 2, approvedAt: record.createdAt },
    prompts: [
      {
        id: 'p',
        name: 'Reviewer',
        revisions: [
          {
            revision: 1,
            purpose: 'Audit',
            tags: [],
            examples: [],
            evaluationCases: [
              { id: 'valid', name: 'Valid JSON', variables: {}, checks: { validJson: true } },
              { id: 'invalid', name: 'Invalid JSON', variables: {}, checks: { validJson: true } },
              { id: 'unknown', name: 'Missing output', variables: {}, checks: { validJson: false } },
            ],
            template: 'Review',
            variablesSchema: {},
            sourceSkills: [],
            createdAt: record.createdAt,
          },
        ],
      },
    ],
    workflows: [{ id: 'wf', name: 'Review workflow', revisions: [] }],
    tasks: [
      {
        planRevision: 2,
        itemId: first,
        state: 'verified',
        execution: { sessionId: 'child', prompt: { promptId: 'p', revision: 1 } },
        evidence: ['Tests passed'],
        updatedAt: record.updatedAt,
      },
      { planRevision: 2, itemId: second, state: 'pending', evidence: [], updatedAt: record.updatedAt },
    ],
    runs: [
      {
        id: 'r',
        workflowId: 'wf',
        workflowRevision: 1,
        state: 'completed',
        input: null,
        launchedSteps: 3,
        maxSteps: 3,
        startedAt: record.createdAt,
        deadlineAt: record.createdAt,
        steps: [
          { stepId: 's1', state: 'completed', attempt: 1, sessionId: 'child', result: { output: '{}', tokens: 7 } },
          { stepId: 's2', state: 'failed', attempt: 1 },
          { stepId: 's3', state: 'pending', attempt: 0 },
        ],
      },
    ],
    evaluations: [
      {
        id: 'e',
        promptId: 'p',
        promptRevision: 1,
        workflowId: 'wf',
        workflowRevision: 1,
        runId: 'r',
        caseSteps: [],
        createdAt: record.createdAt,
        result: {
          accepted: false,
          runState: 'completed',
          finalizedAt: record.createdAt,
          cases: [
            {
              caseId: 'valid',
              stepId: 's1',
              accepted: true,
              expectedSubstringMatches: [],
              validJson: true,
              latencyMs: 2,
              tokens: 7,
              outputTruncated: false,
            },
            {
              caseId: 'invalid',
              stepId: 's2',
              accepted: false,
              expectedSubstringMatches: [],
              validJson: false,
              latencyMs: 3,
              tokens: 8,
              outputTruncated: false,
              error: 'Invalid document',
            },
            {
              caseId: 'unknown',
              stepId: 's3',
              accepted: null,
              expectedSubstringMatches: [],
              validJson: null,
              latencyMs: null,
              tokens: null,
              outputTruncated: false,
            },
          ],
        },
      },
    ],
  }
  const populated = raw as ProjectRecord
  const props = board({ get: async () => populated })
  await selectProject(props)
  expect(screen.getByText('Tests passed')).toBeTruthy()
  expect(screen.getByText('Valid', { exact: true })).toBeTruthy()
  expect(screen.getByText('Invalid', { exact: true })).toBeTruthy()
  expect(screen.getByText('Invalid document')).toBeTruthy()
  expect(screen.getByText('Pass', { exact: true })).toBeTruthy()
  expect(screen.getByText('Fail', { exact: true })).toBeTruthy()
  for (const button of screen.getAllByRole('button', { name: en.openSession })) fireEvent.click(button)
  expect(props.openSession).toHaveBeenCalledTimes(3)
  expect(props.openSession).toHaveBeenLastCalledWith('child')
  expect(screen.getByText(/"tokens": 7/)).toBeTruthy()
})

it('opens and closes the project dialog from both sidebar widths', async () => {
  const { ProjectsEntry } = await import('../src/client/ProjectsEntry.tsx')
  const props = { ...board(), wide: true } as Parameters<typeof ProjectsEntry>[0]
  const view = render(<ProjectsEntry {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en.title }))
  expect(await screen.findByRole('dialog', { name: en.title })).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  view.rerender(<ProjectsEntry {...props} wide={false} />)
  fireEvent.click(screen.getByRole('button', { name: en.title }))
  fireEvent.click(screen.getByRole('button', { name: en.close }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('creates a new catalog entry while preserving existing projects and the exact approval summary', async () => {
  const created: ProjectRecord = {
    ...record,
    id: 'new-project' as ProjectRecord['id'],
    name: 'Second project',
    approvedPlan: { revision: 2, approvedAt: record.createdAt },
  }
  let currentCatalog: readonly ProjectSummary[] = catalog
  const props = board({
    list: async () => currentCatalog,
    create: vi.fn(async () => {
      currentCatalog = [
        ...catalog,
        {
          id: created.id,
          workspaceId: created.workspaceId,
          name: created.name,
          version: created.version,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        },
      ]
      return created
    }),
    savePlan: vi.fn(async () => created),
    get: async id => (id === created.id ? created : record),
  })
  render(<ProjectsBoard {...props} />)
  await waitFor(() => {
    expect(screen.queryByRole('status')).toBeNull()
  })
  const form = screen.getByRole('button', { name: en.create }).closest('form')!
  fireEvent.submit(form)
  expect(props.create).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText(en.name), { target: { value: created.name } })
  fireEvent.change(screen.getByLabelText(en.workspace), { target: { value: created.workspaceId } })
  fireEvent.submit(form)
  await screen.findByRole('heading', { name: created.name })
  expect(within(screen.getByLabelText(en.select)).getAllByRole('option')).toHaveLength(3)
  expect(screen.getByText('Approved revision: 2')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.savePlan }))
  await waitFor(() => {
    expect(props.savePlan).toHaveBeenCalledOnce()
  })
})

it('ignores another submission while a write is pending', async () => {
  const pending = Promise.withResolvers<ProjectRecord>()
  const props = board({ savePlan: () => pending.promise })
  await selectProject(props)
  fireEvent.click(screen.getByRole('button', { name: en.savePlan }))
  fireEvent.submit(screen.getByRole('button', { name: 'Save execution limits' }).closest('form')!)
  expect(props.configureBudget).not.toHaveBeenCalled()
  await act(async () => {
    pending.resolve(record)
  })
})

it('preserves sibling variables while changing one definition and adding another', () => {
  const change = vi.fn()
  render(
    <PromptVariables
      initial={{ first: { type: 'string', required: true }, second: { type: 'boolean', required: false } }}
      disabled={false}
      change={change}
    />,
  )
  fireEvent.change(screen.getAllByLabelText('Variable type')[0]!, { target: { value: 'json' } })
  expect(change).toHaveBeenLastCalledWith({
    first: { type: 'json', required: true },
    second: { type: 'boolean', required: false },
  })
  fireEvent.click(screen.getAllByLabelText('Required')[0]!)
  expect(change).toHaveBeenLastCalledWith({
    first: { type: 'json', required: false },
    second: { type: 'boolean', required: false },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add variable' }))
  expect(screen.getAllByLabelText('Variable name')).toHaveLength(3)
})

it('closes the dialog when an execution is opened and retains an unresolved task identifier', async () => {
  const { ProjectsEntry } = await import('../src/client/ProjectsEntry.tsx')
  const sessionId = 'linked' as Parameters<BoardProps['openSession']>[0]
  const saved: ProjectRecord = {
    ...record,
    tasks: [
      {
        planRevision: 1,
        itemId: 'retained-item' as typeof first,
        state: 'verified',
        execution: { sessionId, prompt: { promptId: 'p' as ProjectRecord['prompts'][number]['id'], revision: 1 } },
        evidence: ['Review recorded'],
        updatedAt: record.updatedAt,
      },
    ],
  }
  const props = { ...board({ get: async () => saved }), wide: true } as Parameters<typeof ProjectsEntry>[0]
  render(<ProjectsEntry {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en.title }))
  await waitFor(() => {
    expect(screen.queryByRole('status')).toBeNull()
  })
  fireEvent.change(screen.getByLabelText(en.select), { target: { value: record.id } })
  expect(await screen.findByText('retained-item')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.openSession }))
  expect(props.openSession).toHaveBeenCalledWith(sessionId)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('requires saving the displayed draft before approving its revision', async () => {
  const props = board()
  render(<ProjectsBoard {...props} />)
  await waitFor(() => { expect(screen.queryByRole('status')).toBeNull() })
  fireEvent.change(screen.getByLabelText(en.select), { target: { value: record.id } })
  const summary = await screen.findByLabelText(en.summary)
  const approve = screen.getByRole<HTMLButtonElement>('button', { name: en.approve + ' 2' })
  fireEvent.change(summary, { target: { value: 'A different plan requiring review' } })
  expect(approve.disabled).toBe(true)
  fireEvent.click(approve)
  expect(props.approvePlan).not.toHaveBeenCalled()
  fireEvent.change(summary, { target: { value: latest.summary } })
  expect(approve.disabled).toBe(false)
  fireEvent.change(screen.getAllByLabelText(en.items)[0]!, { target: { value: 'Different work' } })
  expect(approve.disabled).toBe(true)
})
