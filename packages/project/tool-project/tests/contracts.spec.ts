import { afterEach, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Context } from '@arx-ai/cordis'
import { CallId } from '@arx-ai/arx-llm'
import { SessionId } from '@arx-ai/arx-session'
import type { JsonValue } from '@arx-ai/arx-session'
import type { Agent } from '@arx-ai/arx-agent'
import type { ProjectRecord, ProjectService } from '@arx-ai/arx-project'
import type { GitSkillService } from '@arx-ai/arx-skill-git'
import type { ProjectRunner } from '@arx-ai/arx-project-runner'
import SystemPrompt from '@arx-ai/arx-system-prompt'
import Tools from '@arx-ai/arx-tools'
import * as ToolProject from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks()
})

async function fixture(direct = false) {
  const ctx = new Context()
  contexts.push(ctx)
  const project = { id: 'project', version: 7, approvedPlan: { revision: 3 },
    runs: [{ id: 'run', parentSessionId: 'parent' }],
  } as unknown as ProjectRecord
  const names = [
    'create', 'savePlan', 'updateTask', 'savePrompt', 'renderPrompt', 'saveWorkflow', 'startWorkflowRun',
    'claimWorkflowStep', 'attachWorkflowStepSession', 'settleWorkflowStep', 'reconcileWorkflowRun', 'startPromptEvaluation',
    'finalizePromptEvaluation',
  ] as const
  const mutations = Object.fromEntries(names.map(name => [name, vi.fn(async () => project)])) as
    Record<typeof names[number], Mock<(...args: unknown[]) => Promise<ProjectRecord>>>
  const service = {
    ...mutations,
    list: vi.fn(async () => [project]),
    get: vi.fn(async (): Promise<ProjectRecord | undefined> => project),
  }
  ctx.provide('projects', service as unknown as ProjectService)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools)
  if (direct) ToolProject.apply(ctx, {})
  else await ctx.plugin(ToolProject, {})
  const signal = new AbortController().signal
  const agent = { session: { id: SessionId('parent') } } as Agent
  async function invoke(action: string, input?: JsonValue, options: {
    project_id?: string
    expected_version?: number
    agent?: Agent
    omitProject?: boolean
    omitVersion?: boolean
  } = {}) {
    return await ctx.tools.execute({
      signal,
      callId: CallId('call'),
      name: 'project',
      ...(options.agent === undefined ? {} : { agent: options.agent }),
      arguments: {
        action,
        ...options.omitProject ? {} : { project_id: options.project_id ?? 'project' },
        ...options.omitVersion ? {} : { expected_version: options.expected_version ?? 7 },
        ...input === undefined ? {} : { input },
      },
    })
  }
  async function ok(action: string, input?: JsonValue, options?: Parameters<typeof invoke>[2]) {
    const result = await invoke(action, input, options)
    expect(result.isError, JSON.stringify(result)).toBe(false)
    return result
  }
  async function bad(action: string, input?: JsonValue, options?: Parameters<typeof invoke>[2]) {
    expect((await invoke(action, input, options)).isError).toBe(true)
  }
  return { ctx, service, signal, agent, invoke, ok, bad }
}

const plan = { summary: 'Plan', items: [{ id: 'step', title: 'Step', acceptance_criteria: ['verified'], depends_on: [] }] }
const prompt = { name: 'Prompt', template: '{{subject}}', variables_schema: { subject: { type: 'string', required: true } }, source_skills: [] }
const workflow = { name: 'Flow', steps: [{ id: 'step', name: 'Step', depends_on: [] }] }

it('rejects malformed action payloads at the model boundary before service mutation', async () => {
  const f = await fixture()
  await f.bad('create')
  for (const value of [null, [], 'text', 1, false]) await f.bad('create', value)
  await f.bad('create', { workspace_id: 2, name: 'P' })
  await f.bad('create', { workspace_id: 'w', name: 'P', description: false })
  for (const action of ['get', 'render_prompt', 'snapshot_skills', 'execute_workflow']) await f.bad(action, {}, { omitProject: true })
  await f.bad('save_plan', plan, { omitProject: true })
  await f.bad('save_plan', plan, { project_id: '' })
  await f.bad('save_plan', plan, { omitVersion: true })
  await f.bad('save_plan', { ...plan, items: false })
  await f.bad('save_plan', { ...plan, items: [null] })
  await f.bad('save_plan', { ...plan, items: [{ ...plan.items[0], acceptance_criteria: 'wrong' }] })
  await f.bad('save_plan', { ...plan, items: [{ ...plan.items[0], depends_on: [1] }] })
  await f.bad('save_prompt', { ...prompt, variables_schema: { subject: { type: 'unsupported', required: true } } })
  await f.bad('save_prompt', { ...prompt, variables_schema: { subject: { type: 'string', required: 'true' } } })
  await f.bad('save_prompt', { ...prompt, evaluation_cases: [{ id: 'c', name: 'Case', variables: {}, checks: { valid_json: 'yes' } }] })
  await f.bad('render_prompt', { prompt_id: 'p', prompt_revision: '1', variables: {} })
  await f.bad('update_task', { state: 'invented' })
  await f.bad('settle_workflow_step', { state: 'pending' })
  await f.bad('reconcile_workflow', { state: 'running' })
  await f.bad('execute_workflow', { run_id: 'run' })
  await f.bad('snapshot_skills', { repository: 'r', commit: 'sha', paths: ['SKILL.md'] })
  vi.mocked(f.service.get).mockResolvedValueOnce(undefined)
  await f.bad('snapshot_skills', {})
  await f.bad('start_workflow', { workflow_id: 'w', workflow_revision: 1 })
  await f.bad('start_prompt_evaluation', { prompt_id: 'p', prompt_revision: 1 })
  vi.mocked(f.service.get).mockResolvedValueOnce(undefined)
  await f.bad('start_workflow', {}, { agent: f.agent })
  vi.mocked(f.service.get).mockResolvedValueOnce({ id: 'project' } as never)
  await f.bad('start_prompt_evaluation', {}, { agent: f.agent })
  await f.bad('start_workflow', { workflow_id: 'w', workflow_revision: 1, max_steps: 'three' }, { agent: f.agent })
  await f.bad('start_workflow', { workflow_id: 'w', workflow_revision: 1, max_duration_ms: false }, { agent: f.agent })
  await f.bad('start_prompt_evaluation', { prompt_id: 'p', prompt_revision: 1, max_duration_ms: false }, { agent: f.agent })
})

it('decodes complete and minimal immutable revisions without dropping optional metadata', async () => {
  const f = await fixture()
  await f.ok('list')
  await f.ok('get')
  await f.ok('create', { workspace_id: 'workspace', name: 'Project' })
  await f.ok('create', { workspace_id: 'workspace', name: 'Project', description: 'Meaningful description' })
  expect(f.service.create).toHaveBeenLastCalledWith({ workspaceId: 'workspace', name: 'Project', description: 'Meaningful description' })
  await f.ok('save_plan', plan)
  await f.ok('save_plan', { ...plan, items: [{ ...plan.items[0], description: 'Detailed item' }] })
  expect(f.service.savePlan).toHaveBeenLastCalledWith('project', 7, { summary: 'Plan', items: [{ id: 'step', title: 'Step', acceptanceCriteria: ['verified'], dependsOn: [], description: 'Detailed item' }] })
  await f.ok('save_prompt', prompt)
  await f.ok('save_prompt', {
    ...prompt, prompt_id: 'saved-prompt', purpose: 'Instruction reuse', tags: ['test'],
    variables_schema: { subject: { type: 'string', required: true, description: 'Target' } },
    examples: [{ id: 'example', variables: { subject: 'release' }, expected_output: 'ship' }],
    evaluation_cases: [
      { id: 'one', name: 'One', variables: { subject: 'release' }, checks: { expected_substrings: ['ship'], valid_json: false } },
      { id: 'two', name: 'Two', variables: { subject: 'release' }, checks: { valid_json: true } },
      { id: 'three', name: 'Three', variables: { subject: 'release' }, checks: { expected_substrings: ['ship'] } },
    ],
    source_skills: [{ repository: 'repo', commit: 'commit', path: 'SKILL.md', content: 'Skill text' }],
  })
  expect(f.service.savePrompt).toHaveBeenLastCalledWith('project', 7, expect.objectContaining({
    promptId: 'saved-prompt', purpose: 'Instruction reuse', tags: ['test'],
    examples: [{ id: 'example', variables: { subject: 'release' }, expectedOutput: 'ship' }],
    evaluationCases: [
      { id: 'one', name: 'One', variables: { subject: 'release' }, checks: { expectedSubstrings: ['ship'], validJson: false } },
      { id: 'two', name: 'Two', variables: { subject: 'release' }, checks: { validJson: true } },
      { id: 'three', name: 'Three', variables: { subject: 'release' }, checks: { expectedSubstrings: ['ship'] } },
    ],
  }))
  await f.ok('render_prompt', { prompt_id: 'saved-prompt', prompt_revision: 2, variables: { subject: 'ship' } })
  expect(f.service.renderPrompt).toHaveBeenLastCalledWith('project', 'saved-prompt', 2, { subject: 'ship' })
  await f.ok('save_workflow', workflow)
  await f.ok('save_workflow', { ...workflow, workflow_id: 'saved-flow', steps: [{ ...workflow.steps[0], description: 'Step description', prompt: { prompt_id: 'saved-prompt', revision: 2 }, variables: { subject: 'ship' } }] })
  expect(f.service.saveWorkflow).toHaveBeenLastCalledWith('project', 7, expect.objectContaining({ workflowId: 'saved-flow', steps: [expect.objectContaining({ prompt: { promptId: 'saved-prompt', revision: 2 }, variables: { subject: 'ship' } })] }))
  await f.ok('update_task', { plan_revision: 3, item_id: 'step', state: 'running', execution: { session_id: 'session', prompt_id: 'saved-prompt', prompt_revision: 2 } })
  await f.ok('update_task', { plan_revision: 3, item_id: 'step', state: 'verified', evidence: ['tested'], result: { status: 'done' } })
  expect(f.service.updateTask).toHaveBeenLastCalledWith('project', 7, { planRevision: 3, itemId: 'step', state: 'verified', evidence: ['tested'], result: { status: 'done' } })
})

it('pins driver operations to the actual caller and forwards durable ledger commands', async () => {
  const f = await fixture()
  await f.ok('start_workflow', { workflow_id: 'flow', workflow_revision: 2 }, { agent: f.agent })
  expect(f.service.startWorkflowRun).toHaveBeenLastCalledWith('project', 7, { workflowId: 'flow', workflowRevision: 2, input: null, planRevision: 3, parentSessionId: 'parent' })
  await f.ok('start_workflow', { workflow_id: 'flow', workflow_revision: 2, run_input: { key: true }, max_steps: 2, max_duration_ms: 50, parent_session_id: 'forged', plan_revision: 99 }, { agent: f.agent })
  expect(f.service.startWorkflowRun).toHaveBeenLastCalledWith('project', 7, { workflowId: 'flow', workflowRevision: 2, input: { key: true }, maxSteps: 2, maxDurationMs: 50, planRevision: 3, parentSessionId: 'parent' })
  await f.ok('start_prompt_evaluation', { prompt_id: 'prompt', prompt_revision: 2 }, { agent: f.agent })
  await f.ok('start_prompt_evaluation', { prompt_id: 'prompt', prompt_revision: 2, max_duration_ms: 50 }, { agent: f.agent })
  expect(f.service.startPromptEvaluation).toHaveBeenLastCalledWith('project', 7, { promptId: 'prompt', promptRevision: 2, maxDurationMs: 50, planRevision: 3, parentSessionId: 'parent' })
  await f.ok('finalize_prompt_evaluation', { evaluation_id: 'evaluation' })
  expect(f.service.finalizePromptEvaluation).toHaveBeenLastCalledWith('project', 7, { evaluationId: 'evaluation' })
  await f.ok('claim_workflow_step', { run_id: 'run' }, { agent: f.agent })
  await f.ok('attach_workflow_step_session', { run_id: 'run', step_id: 'step', session_id: 'child' }, { agent: f.agent })
  expect(f.service.attachWorkflowStepSession).toHaveBeenLastCalledWith('project', 7, { runId: 'run', stepId: 'step', sessionId: 'child' })
  await f.ok('settle_workflow_step', { run_id: 'run', step_id: 'step', state: 'completed', result: { answer: 42 } }, { agent: f.agent })
  expect(f.service.settleWorkflowStep).toHaveBeenLastCalledWith('project', 7, { runId: 'run', stepId: 'step', state: 'completed', result: { answer: 42 } })
  await f.ok('settle_workflow_step', { run_id: 'run', step_id: 'step', state: 'failed', error: 'Provider failed' }, { agent: f.agent })
  await f.ok('reconcile_workflow', { run_id: 'run', state: 'pending' }, { agent: f.agent })
  await f.ok('reconcile_workflow', { run_id: 'run', state: 'failed', error: 'Stopped' }, { agent: f.agent })
  expect(f.service.reconcileWorkflowRun).toHaveBeenLastCalledWith('project', 7, { runId: 'run', state: 'failed', error: 'Stopped' })
  const snapshots = [{ repository: 'repo', commit: 'sha', path: 'SKILL.md', content: 'Text', contentHash: 'sha256:digest' }]
  const snapshot = vi.fn(async () => snapshots)
  f.ctx.provide('skillGit', { snapshot } as unknown as GitSkillService)
  await f.ok('snapshot_skills', { repository: 'repo', commit: 'sha', paths: ['SKILL.md'] })
  expect(snapshot).toHaveBeenCalledWith({ repository: 'repo', commit: 'sha', paths: ['SKILL.md'] }, f.signal)
  const execute = vi.fn(async () => ({ projectId: 'project', version: 8, run: { id: 'run' } }))
  f.ctx.provide('projectRunner', { execute } as unknown as ProjectRunner)
  await f.bad('execute_workflow', { run_id: 'run' })
  await f.ok('execute_workflow', { run_id: 'run' }, { agent: f.agent })
  expect(execute).toHaveBeenCalledWith(f.agent, 'project', 'run', f.signal)
})

it.each(['claim_workflow_step', 'attach_workflow_step_session', 'settle_workflow_step', 'reconcile_workflow'])(
  'refuses %s without the original calling agent before mutation', async (action) => {
    const f = await fixture()
    const input = { run_id: 'run', step_id: 'step', session_id: 'child', state: 'completed', result: 'done' }
    await f.bad(action, input)
    await f.bad(action, input, { agent: { session: { id: SessionId('other-parent') } } as Agent })
    await f.bad(action, { ...input, run_id: 'missing' }, { agent: f.agent })
    for (const mutation of Object.values(f.service).filter(value => value !== f.service.get)) {
      expect(mutation).not.toHaveBeenCalled()
    }
  },
)

it('presents list/read and mutation calls and rejects blank configured tool names', async () => {
  const f = await fixture()
  const tool = f.ctx.tools.get('project')!
  expect(tool.presentCall?.({ action: 'list' })).toMatchObject({ title: 'project: list', kind: 'read' })
  expect(tool.presentCall?.({ action: 'get', project_id: 'project' })).toMatchObject({ kind: 'read', rawInput: 'project' })
  expect(tool.presentCall?.({ action: 'save_prompt', input: { name: 'Prompt' } })).toMatchObject({ kind: 'other', rawInput: { name: 'Prompt' } })
  expect(() =>{  ToolProject.apply(f.ctx, { toolName: ' ' }) }).toThrow('non-empty')
  ToolProject.apply(f.ctx, { toolName: 'alternate_project' })
  expect(f.ctx.tools.get('alternate_project')).toBeDefined()
})


it('composes the default tool directly without Loader config coercion', async () => { const f = await fixture(true); await f.ok('list') })
