/**
 * Model-facing project orchestration tool. Its results are the logged channel
 * for effective rendered prompts and selected skill source snapshots.
 * @module @arx-ai/arx-tool-project
 */

import type { Context } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import type { JsonValue } from '@arx-ai/arx-session'
import { SessionId } from '@arx-ai/arx-session'
import { defineTool } from '@arx-ai/arx-tools'
import type { GenericCallView } from '@arx-ai/arx-tools'
import {
  ProjectId,
  ProjectPromptId,
  ProjectPromptEvaluationId,
  ProjectWorkflowId,
  ProjectWorkflowRunId,
} from '@arx-ai/arx-project'
import type {
  PlanItemId,
  ProjectPromptEvaluationCaseId,
  ProjectPromptExampleId,
  ProjectTaskState,
  ProjectWorkflowStepId,
  PromptVariableDefinition,
  SavePlanRequest,
  SavePromptRequest,
  SaveWorkflowRequest,
  SettleWorkflowStepRequest,
  StartWorkflowRunRequest,
  UpdateProjectTaskRequest,
} from '@arx-ai/arx-project'
import { WorkspaceId } from '@arx-ai/arx-workspace'
import type {} from '@arx-ai/arx-system-prompt'
import type { GitSkillSnapshotRequest } from '@arx-ai/arx-skill-git'
import type {} from '@arx-ai/arx-project-runner'

export const name = 'tool-project'
export const inject = ['projects', 'tools', 'systemPrompt']

/** Model-facing tool name configuration. */
export interface Config {
  /** Registered tool name; default `project`. */
  toolName?: string
}

/** Loader validator for the model-facing tool name. */
export const Config: z<Config> = z.object({ toolName: z.string().default('project') })

const ACTIONS = [
  'list',
  'get',
  'create',
  'save_plan',
  'update_task',
  'save_prompt',
  'render_prompt',
  'start_prompt_evaluation',
  'finalize_prompt_evaluation',
  'snapshot_skills',
  'save_workflow',
  'start_workflow',
  'execute_workflow',
  'claim_workflow_step',
  'settle_workflow_step',
  'reconcile_workflow',
] as const

type Action = typeof ACTIONS[number]
type InputRecord = Record<string, JsonValue>

const DESCRIPTION = `Manage durable projects linked to registered workspaces. Read before mutating and copy the exact project version into expected_version; concurrent writes reject stale versions. Plans are immutable revisions with stable item ids, explicit acceptance criteria, and dependencies. Approval is granted only through a trusted operator surface for one exact revision; this model tool cannot approve plans. update_task starts only approved-plan tasks and requires a workspace-owned session plus an exact saved prompt revision; verified also requires evidence.

Prompts retain purpose, tags, examples, and small deterministic evaluation cases across immutable revisions. start_prompt_evaluation creates an ordinary bounded driver run over real child sessions; execute it, then finalize_prompt_evaluation records substring/JSON acceptance, latency, and only known token usage. Truncated output remains explicitly inconclusive. snapshot_skills reads exact files from a 40-hex Git commit through the optional skill-git service and returns logged provenance. save_prompt snapshots the template, variable schema, and each selected skill's repository, commit, path, and full content. render_prompt returns the effective rendered prompt together with those skill snapshots in this tool result, making the actual model-visible material reconstructable from the session log.

Workflows are immutable revisions of explicitly named dependency steps. start_workflow reserves a bounded driver run pinned to the current exact approved plan and the actual calling agent; it never accepts a caller-supplied parent session. execute_workflow asks the optional project runner to drive that run through owned child agents. claim_workflow_step persists one deterministic ready-step claim, attempt, and inputs before returning it; the claim action does not launch a session or continue automatically. After executing that step, call settle_workflow_step, then claim again. A restart changes running work to uncertain; reconcile_workflow must explicitly retry or fail it.`

function fail(subject: string): never {
  throw new TypeError(`project tool: ${subject}`)
}

function record(value: JsonValue | undefined, subject = 'input'): InputRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${subject} must be an object`)
  return value
}

function stringField(input: InputRecord, field: string): string {
  const value = input[field]
  if (typeof value !== 'string') fail(`${field} must be a string`)
  return value
}

function optionalString(input: InputRecord, field: string): string | undefined {
  const value = input[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string') fail(`${field} must be a string when supplied`)
  return value
}

function numberField(input: InputRecord, field: string): number {
  const value = input[field]
  if (typeof value !== 'number') fail(`${field} must be a number`)
  return value
}

function optionalNumber(input: InputRecord, field: string): number | undefined {
  const value = input[field]
  if (value === undefined) return undefined
  if (typeof value !== 'number') fail(`${field} must be a number when supplied`)
  return value
}

function arrayField(input: InputRecord, field: string): JsonValue[] {
  const value = input[field]
  if (!Array.isArray(value)) fail(`${field} must be an array`)
  return value
}

function stringArray(value: JsonValue | undefined, subject: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) fail(`${subject} must be a string array`)
  return value as string[]
}

function projectArgs(
  projectId: string | undefined,
  expectedVersion: number | undefined,
): { projectId: ReturnType<typeof ProjectId>; expectedVersion: number } {
  if (projectId === undefined || projectId.length === 0) fail('project_id is required for this action')
  if (expectedVersion === undefined) fail('expected_version is required for this action')
  return { projectId: ProjectId(projectId), expectedVersion }
}

function decodePlan(input: InputRecord): SavePlanRequest {
  return {
    summary: stringField(input, 'summary'),
    items: arrayField(input, 'items').map((value, index) => {
      const item = record(value, `items[${index}]`)
      const description = optionalString(item, 'description')
      return {
        id: stringField(item, 'id') as PlanItemId,
        title: stringField(item, 'title'),
        ...description === undefined ? {} : { description },
        acceptanceCriteria: stringArray(item['acceptance_criteria'], `items[${index}].acceptance_criteria`),
        dependsOn: stringArray(item['depends_on'], `items[${index}].depends_on`) as PlanItemId[],
      }
    }),
  }
}

function decodeVariables(value: JsonValue | undefined): Record<string, PromptVariableDefinition> {
  const source = record(value, 'variables_schema')
  const result: Record<string, PromptVariableDefinition> = {}
  for (const [key, raw] of Object.entries(source)) {
    const definition = record(raw, `variables_schema.${key}`)
    const type = stringField(definition, 'type')
    if (!['string', 'number', 'boolean', 'json'].includes(type)) fail(`variables_schema.${key}.type is unsupported`)
    const required = definition['required']
    if (typeof required !== 'boolean') fail(`variables_schema.${key}.required must be boolean`)
    const description = optionalString(definition, 'description')
    result[key] = {
      type: type as PromptVariableDefinition['type'],
      required,
      ...description === undefined ? {} : { description },
    }
  }
  return result
}

function decodePrompt(input: InputRecord): SavePromptRequest {
  const promptId = optionalString(input, 'prompt_id')
  const purpose = optionalString(input, 'purpose')
  const tags = input['tags'] === undefined ? undefined : stringArray(input['tags'], 'tags')
  const examples = input['examples'] === undefined ? undefined : arrayField(input, 'examples').map((value, index) => {
    const example = record(value, `examples[${index}]`)
    return {
      id: stringField(example, 'id') as ProjectPromptExampleId,
      variables: record(example['variables'], `examples[${index}].variables`),
      expectedOutput: stringField(example, 'expected_output'),
    }
  })
  const evaluationCases = input['evaluation_cases'] === undefined ? undefined : arrayField(input, 'evaluation_cases').map((value, index) => {
    const evaluation = record(value, `evaluation_cases[${index}]`)
    const checks = record(evaluation['checks'], `evaluation_cases[${index}].checks`)
    const validJson = checks['valid_json']
    if (validJson !== undefined && typeof validJson !== 'boolean') fail(`evaluation_cases[${index}].checks.valid_json must be boolean`)
    return {
      id: stringField(evaluation, 'id') as ProjectPromptEvaluationCaseId,
      name: stringField(evaluation, 'name'),
      variables: record(evaluation['variables'], `evaluation_cases[${index}].variables`),
      checks: {
        ...checks['expected_substrings'] === undefined ? {} : {
          expectedSubstrings: stringArray(checks['expected_substrings'], `evaluation_cases[${index}].checks.expected_substrings`),
        },
        ...validJson === undefined ? {} : { validJson },
      },
    }
  })
  return {
    ...promptId === undefined ? {} : { promptId: ProjectPromptId(promptId) },
    name: stringField(input, 'name'),
    ...purpose === undefined ? {} : { purpose },
    ...tags === undefined ? {} : { tags },
    ...examples === undefined ? {} : { examples },
    ...evaluationCases === undefined ? {} : { evaluationCases },
    template: stringField(input, 'template'),
    variablesSchema: decodeVariables(input['variables_schema']),
    sourceSkills: arrayField(input, 'source_skills').map((value, index) => {
      const skill = record(value, `source_skills[${index}]`)
      return {
        repository: stringField(skill, 'repository'),
        commit: stringField(skill, 'commit'),
        path: stringField(skill, 'path'),
        content: stringField(skill, 'content'),
      }
    }),
  }
}

function decodeWorkflow(input: InputRecord): SaveWorkflowRequest {
  const workflowId = optionalString(input, 'workflow_id')
  return {
    ...workflowId === undefined ? {} : { workflowId: ProjectWorkflowId(workflowId) },
    name: stringField(input, 'name'),
    steps: arrayField(input, 'steps').map((value, index) => {
      const step = record(value, `steps[${index}]`)
      const description = optionalString(step, 'description')
      const rawPrompt = step['prompt']
      const prompt = rawPrompt === undefined ? undefined : record(rawPrompt, `steps[${index}].prompt`)
      const variables = step['variables'] === undefined ? undefined : record(step['variables'], `steps[${index}].variables`)
      return {
        id: stringField(step, 'id') as ProjectWorkflowStepId,
        name: stringField(step, 'name'),
        ...description === undefined ? {} : { description },
        dependsOn: stringArray(step['depends_on'], `steps[${index}].depends_on`) as ProjectWorkflowStepId[],
        ...prompt === undefined ? {} : { prompt: {
          promptId: ProjectPromptId(stringField(prompt, 'prompt_id')),
          revision: numberField(prompt, 'revision'),
        } },
        ...variables === undefined ? {} : { variables },
      }
    }),
  }
}

function decodeTask(input: InputRecord): UpdateProjectTaskRequest {
  const state = stringField(input, 'state')
  if (!['pending', 'running', 'verified', 'failed', 'uncertain'].includes(state)) fail(`unsupported task state '${state}'`)
  const rawExecution = input['execution']
  let execution: UpdateProjectTaskRequest['execution']
  if (rawExecution !== undefined) {
    const value = record(rawExecution, 'execution')
    execution = {
      sessionId: SessionId(stringField(value, 'session_id')),
      prompt: {
        promptId: ProjectPromptId(stringField(value, 'prompt_id')),
        revision: numberField(value, 'prompt_revision'),
      },
    }
  }
  const evidence = input['evidence'] === undefined ? undefined : stringArray(input['evidence'], 'evidence')
  return {
    planRevision: numberField(input, 'plan_revision'),
    itemId: stringField(input, 'item_id') as PlanItemId,
    state: state as ProjectTaskState,
    ...execution === undefined ? {} : { execution },
    ...evidence === undefined ? {} : { evidence },
    ...input['result'] === undefined ? {} : { result: input['result'] },
  }
}

function present(action: Action, rawInput?: unknown): GenericCallView {
  return {
    card: 'generic',
    title: `project: ${action.replaceAll('_', ' ')}`,
    kind: action === 'list' || action === 'get' ? 'read' : 'other',
    ...rawInput === undefined ? {} : { rawInput },
  }
}

function json(value: unknown): JsonValue {
  return value as JsonValue
}

/** Register the single action-based project orchestration tool and its guidance. */
export function apply(ctx: Context, config: Config): void {
  const toolName = config.toolName ?? 'project'
  if (toolName.trim().length === 0) throw new TypeError('project tool name must be non-empty')
  ctx.systemPrompt.section({
    name: `tool:${toolName}`,
    order: 116,
    text: `Use ${toolName} for durable work that the user organizes as a project: read the current record before mutations, preserve stable item and step ids across revisions, wait for exact revision approval through the trusted project UI before executing a plan, and attach evidence before marking a task verified. Render a saved prompt before using it so its effective text and selected skill sources are recorded in the tool result. Workflow claims reserve work only; execute the returned step explicitly, settle it, then claim again. Never assume an uncertain run is safe to retry.`,
  })
  ctx.tools.register(defineTool({
    name: toolName,
    description: DESCRIPTION,
    parameters: {
      action: { type: 'string', required: true, enum: [...ACTIONS], description: 'Project operation to perform.' },
      project_id: { type: 'string', description: 'Project id for every action except list and create.' },
      expected_version: { type: 'number', description: 'Exact project version for every mutating action except create.' },
      input: {
        type: 'json',
        description: 'Action-specific JSON object. Field names use snake_case as documented in the tool description.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const action = args.action
      if (action === 'list') return json(await ctx.projects.list())
      if (action === 'get') {
        if (args.project_id === undefined) fail('project_id is required for get')
        return json(await ctx.projects.get(ProjectId(args.project_id)))
      }
      const input = record(args.input)
      if (action === 'create') {
        const description = optionalString(input, 'description')
        return json(await ctx.projects.create({
          workspaceId: WorkspaceId(stringField(input, 'workspace_id')),
          name: stringField(input, 'name'),
          ...description === undefined ? {} : { description },
        }))
      }
      if (action === 'render_prompt') {
        if (args.project_id === undefined) fail('project_id is required for render_prompt')
        return json(await ctx.projects.renderPrompt(
          ProjectId(args.project_id),
          ProjectPromptId(stringField(input, 'prompt_id')),
          numberField(input, 'prompt_revision'),
          record(input['variables'], 'variables'),
        ))
      }
      if (action === 'snapshot_skills') {
        if (args.project_id === undefined) fail('project_id is required for snapshot_skills')
        if (await ctx.projects.get(ProjectId(args.project_id)) === undefined) fail('snapshot_skills requires an existing project')
        const skillGit = ctx.get('skillGit')
        if (skillGit === undefined) fail('snapshot_skills is unavailable because skill-git is not composed')
        const request: GitSkillSnapshotRequest = {
          repository: stringField(input, 'repository'),
          commit: stringField(input, 'commit'),
          paths: stringArray(input['paths'], 'paths'),
        }
        return json(await skillGit.snapshot(request, exec.signal))
      }
      if (action === 'execute_workflow') {
        if (args.project_id === undefined) fail('project_id is required for execute_workflow')
        const runner = ctx.get('projectRunner')
        if (runner === undefined) fail('execute_workflow is unavailable because project-runner is not composed')
        if (exec.agent === undefined) fail('execute_workflow requires an agent-owned tool call')
        return json(await runner.execute(
          exec.agent,
          ProjectId(args.project_id),
          ProjectWorkflowRunId(stringField(input, 'run_id')),
          exec.signal,
        ))
      }
      const { projectId, expectedVersion } = projectArgs(args.project_id, args.expected_version)
      switch (action) {
        case 'save_plan':
          return json(await ctx.projects.savePlan(projectId, expectedVersion, decodePlan(input)))
        case 'update_task':
          return json(await ctx.projects.updateTask(projectId, expectedVersion, decodeTask(input)))
        case 'save_prompt':
          return json(await ctx.projects.savePrompt(projectId, expectedVersion, decodePrompt(input)))
        case 'save_workflow':
          return json(await ctx.projects.saveWorkflow(projectId, expectedVersion, decodeWorkflow(input)))
        case 'start_prompt_evaluation': {
          if (exec.agent === undefined) fail('start_prompt_evaluation requires an agent-owned tool call')
          const project = await ctx.projects.get(projectId)
          if (project?.approvedPlan === undefined) fail('start_prompt_evaluation requires an exact approved plan')
          const maxDurationMs = optionalNumber(input, 'max_duration_ms')
          return json(await ctx.projects.startPromptEvaluation(projectId, expectedVersion, {
            promptId: ProjectPromptId(stringField(input, 'prompt_id')),
            promptRevision: numberField(input, 'prompt_revision'),
            planRevision: project.approvedPlan.revision,
            parentSessionId: exec.agent.session.id,
            ...maxDurationMs === undefined ? {} : { maxDurationMs },
          }))
        }
        case 'finalize_prompt_evaluation':
          return json(await ctx.projects.finalizePromptEvaluation(projectId, expectedVersion, {
            evaluationId: ProjectPromptEvaluationId(stringField(input, 'evaluation_id')),
          }))
        case 'start_workflow': {
          if (exec.agent === undefined) fail('start_workflow requires an agent-owned tool call')
          const project = await ctx.projects.get(projectId)
          if (project?.approvedPlan === undefined) fail('start_workflow requires an exact approved plan')
          const maxSteps = optionalNumber(input, 'max_steps')
          const maxDurationMs = optionalNumber(input, 'max_duration_ms')
          const request: StartWorkflowRunRequest = {
            workflowId: ProjectWorkflowId(stringField(input, 'workflow_id')),
            workflowRevision: numberField(input, 'workflow_revision'),
            input: input['run_input'] ?? null,
            planRevision: project.approvedPlan.revision,
            parentSessionId: exec.agent.session.id,
            ...maxSteps === undefined ? {} : { maxSteps },
            ...maxDurationMs === undefined ? {} : { maxDurationMs },
          }
          return json(await ctx.projects.startWorkflowRun(projectId, expectedVersion, request))
        }
        case 'claim_workflow_step':
          return json(await ctx.projects.claimWorkflowStep(
            projectId,
            expectedVersion,
            ProjectWorkflowRunId(stringField(input, 'run_id')),
          ))
        case 'settle_workflow_step': {
          const state = stringField(input, 'state')
          if (state !== 'completed' && state !== 'failed') fail('workflow step state must be completed or failed')
          const error = optionalString(input, 'error')
          const request: SettleWorkflowStepRequest = {
            runId: ProjectWorkflowRunId(stringField(input, 'run_id')),
            stepId: stringField(input, 'step_id') as ProjectWorkflowStepId,
            state,
            ...input['result'] === undefined ? {} : { result: input['result'] },
            ...error === undefined ? {} : { error },
          }
          return json(await ctx.projects.settleWorkflowStep(projectId, expectedVersion, request))
        }
        case 'reconcile_workflow': {
          const state = stringField(input, 'state')
          if (state !== 'pending' && state !== 'failed') fail('reconciled workflow state must be pending or failed')
          const error = optionalString(input, 'error')
          return json(await ctx.projects.reconcileWorkflowRun(projectId, expectedVersion, {
            runId: ProjectWorkflowRunId(stringField(input, 'run_id')),
            state,
            ...error === undefined ? {} : { error },
          }))
        }
      }
    },
    presentCall: args => present(args.action, args.project_id ?? args.input),
  }))
}
