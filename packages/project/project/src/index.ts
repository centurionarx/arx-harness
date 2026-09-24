/**
 * Durable project orchestration service. One storage-domain record contains
 * each project's plans, task progress, prompt history, workflow definitions,
 * and run ledger so every mutation has one atomic commit point.
 * @module @arx-ai/arx-project
 */

import { createHash, randomUUID } from 'node:crypto'
import { Context } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import type { JsonValue, SessionHeader, SessionId } from '@arx-ai/arx-session'
import type {} from '@arx-ai/arx-session-persistence'
import type { KvTable } from '@arx-ai/arx-storage-domain'
import { Remote, TypertRemoteService } from '@arx-ai/arx-typert-protocol'
import { realpathNormalize } from '@arx-ai/arx-workspace'
import type { Workspace } from '@arx-ai/arx-workspace'
import { projectDomainSpec } from './spec.ts'
import type {
  AttachWorkflowStepSessionRequest,
  ClaimWorkflowStepResult,
  ConfigureProjectBudgetRequest,
  CreateProjectRequest,
  EffectivePromptSnapshot,
  FinalizePromptEvaluationRequest,
  InterruptWorkflowRunRequest,
  ProjectId as ProjectIdBrand,
  ProjectPlanItem,
  ProjectPrompt,
  ProjectPromptEvaluation,
  ProjectPromptEvaluationCase,
  ProjectPromptEvaluationCaseResult,
  ProjectPromptEvaluationId as ProjectPromptEvaluationIdBrand,
  ProjectPromptId as ProjectPromptIdBrand,
  ProjectPromptRef,
  ProjectRecord,
  ProjectSummary,
  ProjectTask,
  ProjectWorkflow,
  ProjectWorkflowId as ProjectWorkflowIdBrand,
  ProjectWorkflowRevision,
  ProjectWorkflowRun,
  ProjectWorkflowRunId as ProjectWorkflowRunIdBrand,
  ProjectWorkflowStep,
  ProjectWorkflowStepRun,
  ProjectWorkflowStepId,
  PromptSkillSnapshot,
  PromptVariableDefinition,
  ReconcileWorkflowRunRequest,
  ResumeWorkflowRunRequest,
  SavePlanRequest,
  SavePromptRequest,
  SaveWorkflowRequest,
  SettleWorkflowStepRequest,
  StartWorkflowRunRequest,
  StartPromptEvaluationRequest,
  UpdateProjectTaskRequest,
} from './types.ts'

export type * from './types.ts'
export { projectDomainSpec, projectRecord } from './spec.ts'

/**
 * Brand a raw string as a project id.
 * @param value - Raw project identifier.
 * @returns Branded project identifier.
 */
export function ProjectId(value: string): ProjectIdBrand {
  return value as ProjectIdBrand
}

/**
 * Brand a raw string as a reusable prompt id.
 * @param value - Raw prompt identifier.
 * @returns Branded prompt identifier.
 */
export function ProjectPromptId(value: string): ProjectPromptIdBrand {
  return value as ProjectPromptIdBrand
}

/**
 * Brand a raw string as a reusable workflow id.
 * @param value - Raw workflow identifier.
 * @returns Branded workflow identifier.
 */
export function ProjectWorkflowId(value: string): ProjectWorkflowIdBrand {
  return value as ProjectWorkflowIdBrand
}
/**
 * Brand a raw string as a prompt evaluation id.
 * @param value - Raw evaluation identifier.
 * @returns Branded evaluation identifier.
 */
export function ProjectPromptEvaluationId(value: string): ProjectPromptEvaluationIdBrand {
  return value as ProjectPromptEvaluationIdBrand
}

/**
 * Brand a raw string as a workflow run id.
 * @param value - Raw workflow run identifier.
 * @returns Branded workflow run identifier.
 */
export function ProjectWorkflowRunId(value: string): ProjectWorkflowRunIdBrand {
  return value as ProjectWorkflowRunIdBrand
}

/** A mutation used an aggregate version other than the current committed version. */
export class ProjectConflictError extends Error {
  constructor(
    readonly projectId: ProjectIdBrand,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(`project '${projectId}' version conflict: expected ${expectedVersion}, current ${actualVersion}`)
    this.name = 'ProjectConflictError'
  }
}

/** A requested project id has no durable aggregate. */
export class ProjectNotFoundError extends Error {
  constructor(readonly projectId: ProjectIdBrand) {
    super(`project '${projectId}' not found`)
    this.name = 'ProjectNotFoundError'
  }
}

/** A project request violates a domain rule before any write occurs. */
export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectValidationError'
  }
}

/** Runtime limits for persisted workflow reservations. */
export interface Config {
  /** Maximum pending, running, or uncertain workflow runs across all projects. */
  maxActiveRuns?: number
  /** Maximum named-step launches reserved by one run. */
  maxStepsPerRun?: number
  /** Maximum elapsed time accepted for one run. */
  maxRunDurationMs?: number
}

interface ResolvedConfig {
  readonly maxActiveRuns: number
  readonly maxStepsPerRun: number
  readonly maxRunDurationMs: number
}

declare module '@arx-ai/cordis' {
  interface Context {
    projects: ProjectService
  }

  interface Events {
    /**
     * Announces a project snapshot after the aggregate committed.
     * @param project Fresh durable snapshot.
     * @mode emit
     */
    'projects/changed'(project: ProjectRecord): void
  }
}

type ProjectMutation = (current: ProjectRecord, now: string) => ProjectRecord

const ACTIVE_RUN_STATES = new Set(['pending', 'running', 'uncertain'])
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/
const TEMPLATE_VARIABLE = /{{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*}}/g
const GRAPH_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_PLAN_REVISIONS = 100
const MAX_PLAN_ITEMS = 1_000
const MAX_PROMPT_REVISIONS = 100
const MAX_WORKFLOW_REVISIONS = 100
const MAX_PROMPT_TEMPLATE_CHARS = 100_000
const MAX_SKILL_CONTENT_CHARS = 1_000_000
const MAX_PROMPT_SKILLS = 32
const MAX_PROMPT_VARIABLES = 100
const MAX_PROJECT_RECORD_BYTES = 8 * 1024 * 1024
const MAX_PROMPT_PURPOSE_CHARS = 4_000
const MAX_PROMPT_TAGS = 16
const MAX_PROMPT_TAG_CHARS = 64
const MAX_PROMPT_EXAMPLES = 16
const MAX_PROMPT_EXAMPLE_OUTPUT_CHARS = 16_000
const MAX_PROMPT_CASE_VARIABLE_BYTES = 64 * 1024
const MAX_PROMPT_EVALUATION_CASES = 16
const MAX_PROMPT_EVALUATION_SUBSTRINGS = 16
const MAX_PROMPT_EVALUATION_SUBSTRING_CHARS = 1_000
const MAX_PROMPT_EVALUATIONS = 100

function clone<T>(value: T): T {
  return structuredClone(value)
}

function requireBoundedRecord(record: ProjectRecord): void {
  const bytes = Buffer.byteLength(JSON.stringify(record), 'utf8')
  if (bytes > MAX_PROJECT_RECORD_BYTES) {
    throw new ProjectValidationError(`project aggregate exceeds ${MAX_PROJECT_RECORD_BYTES} serialized bytes`)
  }
}

function nowIso(): string {
  return new Date().toISOString()
}
function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key] as JsonValue)).join(',') + '}'
  }
  return JSON.stringify(value)
}

function semanticEvaluationCase(value: ProjectPromptEvaluationCase): string {
  return canonicalJson({ name: value.name, variables: value.variables, checks: value.checks } as unknown as JsonValue)
}

function requireText(value: string, subject: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new ProjectValidationError(`${subject} must be non-empty`)
  return trimmed
}

function requirePositiveSafeInteger(value: number, subject: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ProjectValidationError(`${subject} must be a positive safe integer`)
  }
}

function summaryOf(project: ProjectRecord): ProjectSummary {
  return {
    id: project.id,
    version: project.version,
    workspaceId: project.workspaceId,
    name: project.name,
    ...project.approvedPlan === undefined ? {} : { approvedPlanRevision: project.approvedPlan.revision },
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

function validateGraph<Id extends string>(
  values: readonly { readonly id: Id; readonly dependsOn: readonly Id[] }[],
  subject: string,
): void {
  if (values.length === 0) throw new ProjectValidationError(`${subject} must contain at least one item`)
  const ids = new Set<Id>()
  for (const value of values) {
    if (!GRAPH_ID.test(value.id) || DANGEROUS_KEYS.has(value.id)) throw new ProjectValidationError(subject + ' contains unsafe id')
    if (ids.has(value.id)) throw new ProjectValidationError(`${subject} contains duplicate id '${value.id}'`)
    ids.add(value.id)
  }
  for (const value of values) {
    const dependencies = new Set<Id>()
    for (const dependency of value.dependsOn) {
      if (!ids.has(dependency)) {
        throw new ProjectValidationError(`${subject} item '${value.id}' depends on unknown id '${dependency}'`)
      }
      if (dependency === value.id) {
        throw new ProjectValidationError(`${subject} item '${value.id}' cannot depend on itself`)
      }
      if (dependencies.has(dependency)) {
        throw new ProjectValidationError(`${subject} item '${value.id}' repeats dependency '${dependency}'`)
      }
      dependencies.add(dependency)
    }
  }
  const visiting = new Set<Id>()
  const visited = new Set<Id>()
  const byId = new Map(values.map(value => [value.id, value]))
  const visit = (id: Id): void => {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new ProjectValidationError(`${subject} dependency graph contains a cycle at '${id}'`)
    visiting.add(id)
    for (const dependency of (byId.get(id) as typeof values[number]).dependsOn) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of ids) visit(id)
}

function validatePlanItems(items: readonly ProjectPlanItem[]): void {
  validateGraph(items, 'plan')
  for (const item of items) {
    requireText(item.id, 'plan item id')
    requireText(item.title, `plan item '${item.id}' title`)
    if (item.acceptanceCriteria.length === 0) {
      throw new ProjectValidationError(`plan item '${item.id}' requires acceptance criteria`)
    }
    for (const criterion of item.acceptanceCriteria) {
      requireText(criterion, `plan item '${item.id}' acceptance criterion`)
    }
  }
}

function validateWorkflowSteps(steps: readonly ProjectWorkflowStep[]): void {
  validateGraph(steps, 'workflow')
  for (const step of steps) {
    requireText(step.id, 'workflow step id')
    requireText(step.name, `workflow step '${step.id}' name`)
  }
}

function promptRevision(prompt: ProjectPrompt, revision: number) {
  const value = prompt.revisions.find(candidate => candidate.revision === revision)
  if (value === undefined) {
    throw new ProjectValidationError(`prompt '${prompt.id}' has no revision ${revision}`)
  }
  return value
}

function requirePrompt(project: ProjectRecord, reference: ProjectPromptRef): ProjectPrompt['revisions'][number] {
  const prompt = project.prompts.find(candidate => candidate.id === reference.promptId)
  if (prompt === undefined) throw new ProjectValidationError(`unknown prompt '${reference.promptId}'`)
  return promptRevision(prompt, reference.revision)
}

function workflowRevision(
  project: ProjectRecord,
  workflowId: ProjectWorkflowIdBrand,
  revision: number,
): ProjectWorkflowRevision {
  const workflow = project.workflows.find(candidate => candidate.id === workflowId)
  if (workflow === undefined) throw new ProjectValidationError(`unknown workflow '${workflowId}'`)
  const value = workflow.revisions.find(candidate => candidate.revision === revision)
  if (value === undefined) throw new ProjectValidationError(`workflow '${workflowId}' has no revision ${revision}`)
  return value
}

function resetUncertainStep(step: ProjectWorkflowStepRun): ProjectWorkflowStepRun {
  return step.state === 'uncertain'
    ? { stepId: step.stepId, state: 'pending', attempt: step.attempt }
    : step
}

function activeRun(run: ProjectWorkflowRun): boolean {
  return ACTIVE_RUN_STATES.has(run.state)
}

/**
 * Project aggregate authority and `projects/*` Remote namespace. Every write
 * uses storage-domain's per-domain chain and compare-and-set occurs inside the
 * queued transform, before backend durability and publication.
 */
export class ProjectService extends TypertRemoteService {
  static inject = ['storageDomain', 'workspaceRegistry', 'sessionPersistence']

  static Config: z<Config> = z.object({
    maxActiveRuns: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8),
    maxStepsPerRun: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(100),
    maxRunDurationMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(3_600_000),
  })

  private readonly limits: ResolvedConfig
  private table?: KvTable<ProjectIdBrand, ProjectRecord>

  constructor(ctx: Context, config: Config) {
    super(ctx, 'projects')
    this.limits = {
      maxActiveRuns: config.maxActiveRuns ?? 8,
      maxStepsPerRun: config.maxStepsPerRun ?? 100,
      maxRunDurationMs: config.maxRunDurationMs ?? 3_600_000,
    }
    requirePositiveSafeInteger(this.limits.maxActiveRuns, 'maxActiveRuns')
    requirePositiveSafeInteger(this.limits.maxStepsPerRun, 'maxStepsPerRun')
    requirePositiveSafeInteger(this.limits.maxRunDurationMs, 'maxRunDurationMs')
  }

  /** Open the project domain and conservatively recover in-flight state. */
  protected async [TypertRemoteService.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(projectDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'projects.domainClose')
    this.table = domain.table('projects')
    await this.recoverInterruptedWork()
  }

  /**
 * Return compact project snapshots in creation order.
 * @returns Fresh project summaries after service initialization.
 */
  @Remote
  async list(): Promise<readonly ProjectSummary[]> {
    return await Promise.resolve([...this.requireTable().entries()]
      .map(([, project]) => clone(summaryOf(project)))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || String(left.id).localeCompare(String(right.id))))
  }

  /**
 * Return one fresh aggregate snapshot, or undefined for an unknown id.
 * @param projectId - Stable project identifier.
 * @returns A detached aggregate snapshot when the project exists.
 */
  @Remote
  async get(projectId: ProjectIdBrand): Promise<ProjectRecord | undefined> {
    const record = this.requireTable().get(projectId)
    return await Promise.resolve(record === undefined ? undefined : clone(record))
  }

  /**
 * Create a project only for a registered workspace whose directory exists now.
 * @param request - Workspace, name, and optional description.
 * @returns The committed initial aggregate.
 */
  @Remote
  async create(request: CreateProjectRequest): Promise<ProjectRecord> {
    await this.requireLiveWorkspace(request.workspaceId)
    const name = requireText(request.name, 'project name')
    const description = request.description === undefined
      ? undefined
      : requireText(request.description, 'project description')
    const table = this.requireTable()
    let id = ProjectId(randomUUID())
    while (table.get(id) !== undefined) id = ProjectId(randomUUID())
    const now = nowIso()
    const record: ProjectRecord = {
      id,
      version: 1,
      workspaceId: request.workspaceId,
      name,
      ...description === undefined ? {} : { description },
      plans: [],
      tasks: [],
      prompts: [],
      evaluations: [],
      workflows: [],
      budget: {
        maxActiveRuns: this.limits.maxActiveRuns,
        maxStepsPerRun: this.limits.maxStepsPerRun,
        maxRunDurationMs: this.limits.maxRunDurationMs,
      },
      runs: [],
      createdAt: now,
      updatedAt: now,
    }
    requireBoundedRecord(record)
    await table.put(id, record)
    const snapshot = clone(record)
    this.publish(snapshot)
    return snapshot
  }

  /**
 * Append one validated immutable plan revision and its pending task rows.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Complete immutable plan revision input.
 * @returns The committed aggregate snapshot.
 */
  @Remote
  async savePlan(
    projectId: ProjectIdBrand,
    expectedVersion: number,
    request: SavePlanRequest,
  ): Promise<ProjectRecord> {
    requireText(request.summary, 'plan summary')
    if (request.items.length > MAX_PLAN_ITEMS) throw new ProjectValidationError(`plan exceeds ${MAX_PLAN_ITEMS} items`)
    validatePlanItems(request.items)
    return await this.mutate(projectId, expectedVersion, (current, now) => {
      if (current.plans.length >= MAX_PLAN_REVISIONS) throw new ProjectValidationError(`plan revision limit ${MAX_PLAN_REVISIONS} reached`)
      const revision = current.plans.length + 1
      const items = clone(request.items)
      const tasks: ProjectTask[] = items.map(item => ({
        planRevision: revision,
        itemId: item.id,
        state: 'pending',
        evidence: [],
        updatedAt: now,
      }))
      return {
        ...current,
        plans: [...current.plans, { revision, summary: request.summary.trim(), items, createdAt: now }],
        tasks: [...current.tasks, ...tasks],
      }
    })
  }

  /**
   * Bind approval to one exact immutable plan revision.
   * @param projectId - Stable project identifier.
   * @param expectedVersion - Required aggregate CAS version.
   * @param planRevision - Exact immutable plan revision approved by the operator.
   * @returns The committed aggregate snapshot.
   */
  @Remote
  async approvePlan(
    projectId: ProjectIdBrand,
    expectedVersion: number,
    planRevision: number,
  ): Promise<ProjectRecord> {
    requirePositiveSafeInteger(planRevision, 'plan revision')
    return await this.mutate(projectId, expectedVersion, (current, now) => {
      if (!current.plans.some(plan => plan.revision === planRevision)) {
        throw new ProjectValidationError(`project '${projectId}' has no plan revision ${planRevision}`)
      }
      return { ...current, approvedPlan: { revision: planRevision, approvedAt: now } }
    })
  }

  /**
   * Replace one approved-plan task state. Starting work requires a known
   * workspace-owned session and an existing exact prompt revision; verified
   * state additionally requires non-empty evidence.
   * @param projectId - Stable project identifier.
   * @param expectedVersion - Required aggregate CAS version.
   * @param request - Requested task state, evidence, and execution attribution.
   * @returns The committed aggregate snapshot.
   */
  @Remote
  async updateTask(
    projectId: ProjectIdBrand,
    expectedVersion: number,
    request: UpdateProjectTaskRequest,
  ): Promise<ProjectRecord> {
    requirePositiveSafeInteger(request.planRevision, 'task plan revision')
    if (request.state !== 'running' && request.execution !== undefined) {
      throw new ProjectValidationError('task execution provenance can only be set when entering running')
    }
    const before = this.requireProject(projectId)
    const currentTask = before.tasks.find(task =>
      task.planRevision === request.planRevision && task.itemId === request.itemId)
    if (currentTask === undefined) {
      throw new ProjectValidationError(`plan revision ${request.planRevision} has no task '${request.itemId}'`)
    }
    const execution = request.execution ?? currentTask.execution
    if (request.state !== 'pending' && execution === undefined) {
      throw new ProjectValidationError(`task '${request.itemId}' state '${request.state}' requires execution attribution`)
    }
    if (request.state === 'running') {
      if (request.execution === undefined) {
        throw new ProjectValidationError(`starting task '${request.itemId}' requires a session and prompt revision`)
      }
      await this.requireTaskSession(before, request.execution.sessionId)
    }
    return await this.mutate(projectId, expectedVersion, (current, now) => {
      if (current.approvedPlan?.revision !== request.planRevision) {
        throw new ProjectValidationError(`plan revision ${request.planRevision} is not the project's approved revision`)
      }
      const index = current.tasks.findIndex(task =>
        task.planRevision === request.planRevision && task.itemId === request.itemId)
      const prior = current.tasks[index] as ProjectTask
      this.validateTaskTransition(prior, request.state)
      // Every permitted transition has attribution: entering running requires it
      // above; terminal transitions inherit the recorded running attempt.
      const nextExecution = (request.execution ?? prior.execution) as NonNullable<ProjectTask['execution']>
      requirePrompt(current, nextExecution.prompt)
      const evidence = request.evidence === undefined ? prior.evidence : [...request.evidence]
      if (request.state === 'verified') {
        if (evidence.length === 0 || evidence.some(item => item.trim().length === 0)) {
          throw new ProjectValidationError(`verified task '${request.itemId}' requires non-empty evidence`)
        }
      }
      const nextTask: ProjectTask = {
        planRevision: prior.planRevision,
        itemId: prior.itemId,
        state: request.state,
        execution: clone(nextExecution),
        evidence,
        ...request.result === undefined ? {} : { result: clone(request.result) },
        updatedAt: now,
      }
      const tasks = [...current.tasks]
      tasks[index] = nextTask
      return { ...current, tasks }
    })
  }

  /**
 * Append one immutable prompt revision after snapshotting skill content hashes.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Prompt content, metadata, cases, and selected source skills.
 * @returns The committed aggregate snapshot.
 */
  @Remote
  async savePrompt(
    projectId: ProjectIdBrand,
    expectedVersion: number,
    request: SavePromptRequest,
  ): Promise<ProjectRecord> {
    const name = requireText(request.name, 'prompt name')
    requireText(request.template, 'prompt template')
    if (request.template.length > MAX_PROMPT_TEMPLATE_CHARS) throw new ProjectValidationError(`prompt template exceeds ${MAX_PROMPT_TEMPLATE_CHARS} characters`)
    if (Object.keys(request.variablesSchema).length > MAX_PROMPT_VARIABLES) throw new ProjectValidationError(`prompt exceeds ${MAX_PROMPT_VARIABLES} variables`)
    if (request.sourceSkills.length > MAX_PROMPT_SKILLS) throw new ProjectValidationError(`prompt exceeds ${MAX_PROMPT_SKILLS} selected skills`)
    this.validateVariables(request.variablesSchema)
    const sourceSkills = request.sourceSkills.map((source): PromptSkillSnapshot => {
      if (source.content.length > MAX_SKILL_CONTENT_CHARS) throw new ProjectValidationError(`skill content exceeds ${MAX_SKILL_CONTENT_CHARS} characters`)
      requireText(source.repository, 'skill repository')
      requireText(source.commit, 'skill commit')
      requireText(source.path, 'skill path')
      requireText(source.content, 'skill content')
      return {
        ...clone(source),
        contentHash: `sha256:${createHash('sha256').update(source.content).digest('hex')}`,
      }
    })
    return await this.mutate(projectId, expectedVersion, (current, now) => {
      const id = request.promptId ?? ProjectPromptId(randomUUID())
      const index = current.prompts.findIndex(candidate => candidate.id === id)
      const existing = index < 0 ? undefined : current.prompts[index]
      if (existing !== undefined && existing.name !== name) {
        throw new ProjectValidationError(`prompt '${id}' name is immutable`)
      }
      if (existing === undefined && current.prompts.some(candidate => candidate.name === name)) {
        throw new ProjectValidationError(`project already has a prompt named '${name}'`)
      }
      if ((existing?.revisions.length ?? 0) >= MAX_PROMPT_REVISIONS) throw new ProjectValidationError(`prompt revision limit ${MAX_PROMPT_REVISIONS} reached`)
      const revision = (existing?.revisions.length ?? 0) + 1
      const previous = existing?.revisions.at(-1)
      const purpose = requireText(request.purpose ?? previous?.purpose ?? name, 'prompt purpose')
      const tags = (request.tags ?? previous?.tags ?? []).map((tag, index) => requireText(tag, `prompt tag ${index}`))
      const examples = clone(request.examples ?? previous?.examples ?? [])
      const evaluationCases = clone(request.evaluationCases ?? previous?.evaluationCases ?? [])
      this.validatePromptMetadata(
        request.template,
        request.variablesSchema,
        purpose,
        tags,
        examples,
        evaluationCases,
        existing,
      )
      const next: ProjectPrompt = {
        id,
        name,
        revisions: [
          ...(existing?.revisions ?? []),
          {
            revision,
            purpose,
            tags,
            examples,
            evaluationCases,
            template: request.template,
            variablesSchema: clone(request.variablesSchema),
            sourceSkills,
            createdAt: now,
          },
        ],
      }
      const prompts = [...current.prompts]
      if (index < 0) prompts.push(next)
      else prompts[index] = next
      return { ...current, prompts }
    })
  }

  /**
 * Render one exact prompt revision for return through a logged tool result.
 * @param projectId - Stable project identifier.
 * @param promptId - Stable reusable prompt identifier.
 * @param revision - Exact immutable prompt revision.
 * @param variables - Declared values substituted without code execution.
 * @returns Effective text and exact selected skill snapshots.
 */
  @Remote
  async renderPrompt(
    projectId: ProjectIdBrand,
    promptId: ProjectPromptIdBrand,
    revision: number,
    variables: Readonly<Record<string, JsonValue>>,
  ): Promise<EffectivePromptSnapshot> {
    const project = this.requireProject(projectId)
    const prompt = project.prompts.find(candidate => candidate.id === promptId)
    if (prompt === undefined) throw new ProjectValidationError(`unknown prompt '${promptId}'`)
    const selected = promptRevision(prompt, revision)
    const renderedPrompt = this.renderPromptRevision(selected, variables)
    return await Promise.resolve(clone({
      promptId,
      promptRevision: revision,
      renderedPrompt,
      variables,
      sourceSkills: selected.sourceSkills,
    }))
  }

  /**
 * Append one immutable workflow revision with a validated dependency DAG.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Complete named workflow step definition.
 * @returns The committed aggregate snapshot.
 */
  @Remote
  async saveWorkflow(
    projectId: ProjectIdBrand,
    expectedVersion: number,
    request: SaveWorkflowRequest,
  ): Promise<ProjectRecord> {
    const name = requireText(request.name, 'workflow name')
    validateWorkflowSteps(request.steps)
    const currentProject = this.requireProject(projectId)
    for (const step of request.steps) {
      if (step.variables !== undefined && step.prompt === undefined) throw new ProjectValidationError('workflow step variables require a prompt revision')
      if (step.prompt !== undefined) {
        const selected = requirePrompt(currentProject, step.prompt)
        this.renderPromptRevision(selected, step.variables ?? {})
      }
    }
    return await this.mutate(projectId, expectedVersion, (current, now) => {
      const id = request.workflowId ?? ProjectWorkflowId(randomUUID())
      const index = current.workflows.findIndex(candidate => candidate.id === id)
      const existing = index < 0 ? undefined : current.workflows[index]
      if (existing !== undefined && existing.name !== name) {
        throw new ProjectValidationError(`workflow '${id}' name is immutable`)
      }
      if (existing === undefined && current.workflows.some(candidate => candidate.name === name)) {
        throw new ProjectValidationError(`project already has a workflow named '${name}'`)
      }
      if ((existing?.revisions.length ?? 0) >= MAX_WORKFLOW_REVISIONS) throw new ProjectValidationError(`workflow revision limit ${MAX_WORKFLOW_REVISIONS} reached`)
      const revision = (existing?.revisions.length ?? 0) + 1
      const next: ProjectWorkflow = {
        id,
        name,
        revisions: [...(existing?.revisions ?? []), {
          revision,
          steps: clone(request.steps),
          createdAt: now,
        }],
      }
      const workflows = [...current.workflows]
      if (index < 0) workflows.push(next)
      else workflows[index] = next
      return { ...current, workflows }
    })
  }

  /**
 * Set project workflow ceilings within the host safety ceilings.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Per-project active, step, and duration ceilings.
 * @returns The committed aggregate snapshot.
 */
  @Remote
  async configureBudget(
    projectId: ProjectIdBrand,
    expectedVersion: number,
    request: ConfigureProjectBudgetRequest,
  ): Promise<ProjectRecord> {
    requirePositiveSafeInteger(request.maxActiveRuns, 'project maxActiveRuns')
    requirePositiveSafeInteger(request.maxStepsPerRun, 'project maxStepsPerRun')
    requirePositiveSafeInteger(request.maxRunDurationMs, 'project maxRunDurationMs')
    if (request.maxActiveRuns > this.limits.maxActiveRuns || request.maxStepsPerRun > this.limits.maxStepsPerRun
      || request.maxRunDurationMs > this.limits.maxRunDurationMs) throw new ProjectValidationError('project budget exceeds a host safety ceiling')
    return await this.mutate(projectId, expectedVersion, (current) => {
      if (current.runs.filter(activeRun).length > request.maxActiveRuns) throw new ProjectValidationError('project budget is below its active run reservations')
      return { ...current, budget: clone(request) }
    })
  }

  /**
 * Reserve one bounded workflow run without launching any external task.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Exact workflow revision, inputs, provenance, and limits.
 * @returns The committed aggregate snapshot.
 */
  @Remote
  async startWorkflowRun(projectId: ProjectIdBrand, expectedVersion: number, request: StartWorkflowRunRequest): Promise<ProjectRecord> {
    requirePositiveSafeInteger(request.workflowRevision, 'workflow revision')
    const driverFields = request.planRevision !== undefined || request.parentSessionId !== undefined
    if (driverFields && (request.planRevision === undefined || request.parentSessionId === undefined)) {
      throw new ProjectValidationError('driver workflow runs require planRevision and parentSessionId together')
    }
    const before = this.requireProject(projectId)
    if (request.parentSessionId !== undefined) await this.requireTaskSession(before, request.parentSessionId)
    return await this.mutate(projectId, expectedVersion, (current, now) => {
      const maxSteps = request.maxSteps ?? current.budget.maxStepsPerRun
      const maxDurationMs = request.maxDurationMs ?? current.budget.maxRunDurationMs
      requirePositiveSafeInteger(maxSteps, 'workflow run maxSteps')
      requirePositiveSafeInteger(maxDurationMs, 'workflow run maxDurationMs')
      if (maxSteps > current.budget.maxStepsPerRun || maxDurationMs > current.budget.maxRunDurationMs) throw new ProjectValidationError('workflow run budget exceeds the project ceiling')
      if (current.runs.filter(activeRun).length >= current.budget.maxActiveRuns) throw new ProjectValidationError('project active workflow run limit reached')
      if (this.activeRunCount() >= this.limits.maxActiveRuns) throw new ProjectValidationError('host active workflow run limit reached')
      if (request.planRevision !== undefined && current.approvedPlan?.revision !== request.planRevision) {
        throw new ProjectValidationError('driver workflow run must pin the exact approved plan revision')
      }
      const definition = workflowRevision(current, request.workflowId, request.workflowRevision)
      const run: ProjectWorkflowRun = {
        id: ProjectWorkflowRunId(randomUUID()), workflowId: request.workflowId, workflowRevision: request.workflowRevision,
        ...request.planRevision === undefined ? {} : { planRevision: request.planRevision },
        ...request.parentSessionId === undefined ? {} : { parentSessionId: request.parentSessionId },
        state: 'pending', input: clone(request.input),
        steps: definition.steps.map(step => ({ stepId: step.id, state: 'pending', attempt: 0 })),
        launchedSteps: 0, maxSteps, startedAt: now,
        deadlineAt: new Date(Date.parse(now) + maxDurationMs).toISOString(),
      }
      return { ...current, runs: [...current.runs, run] }
    })
  }
  /**
 * Atomically create an ordinary driver workflow for exact prompt evaluation cases.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Exact prompt, approved plan, parent session, and duration.
 * @returns The committed aggregate containing the evaluation and driver run.
 */
  @Remote
  async startPromptEvaluation(
    projectId: ProjectIdBrand,
    expectedVersion: number,
    request: StartPromptEvaluationRequest,
  ): Promise<ProjectRecord> {
    requirePositiveSafeInteger(request.promptRevision, 'prompt evaluation revision')
    requirePositiveSafeInteger(request.planRevision, 'prompt evaluation plan revision')
    if (request.maxDurationMs !== undefined) requirePositiveSafeInteger(request.maxDurationMs, 'prompt evaluation maxDurationMs')
    const before = this.requireProject(projectId)
    await this.requireTaskSession(before, request.parentSessionId)
    return await this.mutate(projectId, expectedVersion, (current, now) => {
      if (current.approvedPlan?.revision !== request.planRevision) throw new ProjectValidationError('prompt evaluation must pin the exact approved plan revision')
      const prompt = current.prompts.find(candidate => candidate.id === request.promptId)
      if (prompt === undefined) throw new ProjectValidationError(`unknown prompt '${request.promptId}'`)
      const selected = promptRevision(prompt, request.promptRevision)
      if (selected.evaluationCases.length === 0) throw new ProjectValidationError('prompt revision has no evaluation cases')
      if (current.evaluations.length >= MAX_PROMPT_EVALUATIONS) throw new ProjectValidationError('project prompt evaluation limit reached')
      if (selected.evaluationCases.length > current.budget.maxStepsPerRun) throw new ProjectValidationError('evaluation cases exceed the project step ceiling')
      if (current.runs.filter(activeRun).length >= current.budget.maxActiveRuns) throw new ProjectValidationError('project active workflow run limit reached')
      if (this.activeRunCount() >= this.limits.maxActiveRuns) throw new ProjectValidationError('host active workflow run limit reached')
      const maxDurationMs = request.maxDurationMs ?? current.budget.maxRunDurationMs
      if (maxDurationMs > current.budget.maxRunDurationMs) throw new ProjectValidationError('prompt evaluation duration exceeds the project ceiling')

      const evaluationId = ProjectPromptEvaluationId(randomUUID())
      const workflowId = ProjectWorkflowId(randomUUID())
      const runId = ProjectWorkflowRunId(randomUUID())
      const caseSteps = selected.evaluationCases.map(evaluation => ({
        caseId: evaluation.id,
        stepId: randomUUID() as ProjectWorkflowStepId,
      }))
      const steps: ProjectWorkflowStep[] = selected.evaluationCases.map((evaluation, index) => ({
        id: (caseSteps[index] as { stepId: ProjectWorkflowStepId }).stepId,
        name: evaluation.name,
        description: `Prompt evaluation ${evaluation.id}`,
        dependsOn: [],
        prompt: { promptId: request.promptId, revision: request.promptRevision },
        variables: clone(evaluation.variables),
      }))
      const workflow: ProjectWorkflow = {
        id: workflowId,
        name: `Evaluation ${prompt.name} revision ${request.promptRevision} (${evaluationId})`,
        revisions: [{ revision: 1, steps, createdAt: now }],
      }
      const run: ProjectWorkflowRun = {
        id: runId,
        workflowId,
        workflowRevision: 1,
        planRevision: request.planRevision,
        parentSessionId: request.parentSessionId,
        state: 'pending',
        input: { evaluationId, promptId: request.promptId, promptRevision: request.promptRevision },
        steps: steps.map(step => ({ stepId: step.id, state: 'pending', attempt: 0 })),
        launchedSteps: 0,
        maxSteps: steps.length,
        startedAt: now,
        deadlineAt: new Date(Date.parse(now) + maxDurationMs).toISOString(),
      }
      const evaluation: ProjectPromptEvaluation = {
        id: evaluationId,
        promptId: request.promptId,
        promptRevision: request.promptRevision,
        workflowId,
        workflowRevision: 1,
        runId,
        caseSteps,
        createdAt: now,
      }
      return {
        ...current,
        workflows: [...current.workflows, workflow],
        runs: [...current.runs, run],
        evaluations: [...current.evaluations, evaluation],
      }
    })
  }

  /**
 * Persist deterministic checks from the bounded output of a terminal driver run.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Evaluation ledger identifier to finalize once.
 * @returns The committed aggregate containing comparable case results.
 */
  @Remote
  async finalizePromptEvaluation(
    projectId: ProjectIdBrand,
    expectedVersion: number,
    request: FinalizePromptEvaluationRequest,
  ): Promise<ProjectRecord> {
    return await this.mutate(projectId, expectedVersion, (current, now) => {
      const evaluationIndex = current.evaluations.findIndex(candidate => candidate.id === request.evaluationId)
      if (evaluationIndex < 0) throw new ProjectValidationError('unknown prompt evaluation')
      const evaluation = current.evaluations[evaluationIndex] as ProjectPromptEvaluation
      if (evaluation.result !== undefined) throw new ProjectValidationError('prompt evaluation is already finalized')
      const run = current.runs.find(candidate => candidate.id === evaluation.runId)
      if (run === undefined) throw new ProjectValidationError('prompt evaluation run is missing')
      if (run.state !== 'completed' && run.state !== 'failed') throw new ProjectValidationError('prompt evaluation run must be terminal before finalization')
      const prompt = current.prompts.find(candidate => candidate.id === evaluation.promptId)
      if (prompt === undefined) throw new ProjectValidationError('prompt evaluation revision is missing')
      const selected = promptRevision(prompt, evaluation.promptRevision)
      const cases: ProjectPromptEvaluationCaseResult[] = evaluation.caseSteps.map((link) => {
        const definition = selected.evaluationCases.find(candidate => candidate.id === link.caseId)
        const step = run.steps.find(candidate => candidate.stepId === link.stepId)
        if (definition === undefined || step === undefined) throw new ProjectValidationError('prompt evaluation case mapping is invalid')
        const latency = step.startedAt === undefined || step.finishedAt === undefined
          ? null
          : Date.parse(step.finishedAt) - Date.parse(step.startedAt)
        const latencyMs = latency === null || !Number.isSafeInteger(latency) || latency < 0 ? null : latency
        const record = step.result !== null && typeof step.result === 'object' && !Array.isArray(step.result)
          ? step.result as Record<string, JsonValue>
          : undefined
        const rawUsage = record?.['usage']
        const usage = rawUsage !== null && typeof rawUsage === 'object' && !Array.isArray(rawUsage)
          ? rawUsage as Record<string, JsonValue>
          : undefined
        const tokens = usage?.['complete'] === true && Number.isSafeInteger(usage['tokens']) && (usage['tokens'] as number) >= 0
          ? usage['tokens'] as number
          : null
        const output = typeof record?.['output'] === 'string' ? record['output'] : undefined
        const outputTruncated = record?.['truncated'] === true
        const unavailable = (error: string, accepted: boolean | null): ProjectPromptEvaluationCaseResult => ({
          caseId: link.caseId,
          stepId: link.stepId,
          accepted,
          expectedSubstringMatches: (definition.checks.expectedSubstrings ?? []).map(() => null),
          validJson: null,
          latencyMs,
          tokens,
          outputTruncated,
          error,
        })
        if (step.state === 'failed') return unavailable(step.error ?? 'evaluation child failed', false)
        if (step.state !== 'completed' || output === undefined) return unavailable('evaluation child output is unavailable', null)
        if (outputTruncated) return unavailable('evaluation output was truncated; deterministic checks are inconclusive', null)
        const expectedSubstringMatches = (definition.checks.expectedSubstrings ?? []).map(expected => output.includes(expected))
        let validJson = false
        try { JSON.parse(output); validJson = true } catch {}
        const checks = [
          ...expectedSubstringMatches,
          ...definition.checks.validJson === undefined ? [] : [validJson === definition.checks.validJson],
        ]
        return {
          caseId: link.caseId,
          stepId: link.stepId,
          accepted: checks.every(Boolean),
          expectedSubstringMatches,
          validJson,
          latencyMs,
          tokens,
          outputTruncated: false,
        }
      })
      const accepted = cases.some(candidate => candidate.accepted === false)
        ? false
        : cases.some(candidate => candidate.accepted === null) ? null : true
      const evaluations = [...current.evaluations]
      evaluations[evaluationIndex] = {
        ...evaluation,
        result: { accepted, runState: run.state, cases, finalizedAt: now },
      }
      return { ...current, evaluations }
    })
  }
  /**
 * Attach a direct child of the pinned parent to its committed running claim.
 * The parent must remain attached to the project workspace; both session cwds
 * must resolve to that workspace. Child sessions need no top-level membership.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Run, step, and direct child session identifiers.
 * @returns The committed aggregate snapshot.
 */
  @Remote
  async attachWorkflowStepSession(
    projectId: ProjectIdBrand,
    expectedVersion: number,
    request: AttachWorkflowStepSessionRequest,
  ): Promise<ProjectRecord> {
    const before = this.requireProject(projectId)
    const beforeRun = before.runs.find(run => run.id === request.runId)
    if (beforeRun?.parentSessionId === undefined) throw new ProjectValidationError('workflow run has no pinned parent session')
    await this.requireTaskSession(before, beforeRun.parentSessionId)
    const { header } = await this.requireSessionWorkspace(before, request.sessionId)
    if (header.parentSession !== beforeRun.parentSessionId) throw new ProjectValidationError('workflow step session is not a child of the pinned parent session')
    return await this.mutate(projectId, expectedVersion, (current) => {
      const runIndex = current.runs.findIndex(run => run.id === request.runId)
      // The preflight found this immutable run id; runs are never deleted.
      const run = current.runs[runIndex] as ProjectWorkflowRun
      if (run.state !== 'running') throw new ProjectValidationError('workflow run is not running')
      const stepIndex = run.steps.findIndex(step => step.stepId === request.stepId)
      const step = run.steps[stepIndex]
      if (stepIndex < 0 || step?.state !== 'running') throw new ProjectValidationError('workflow step is not running')
      if (step.sessionId !== undefined) throw new ProjectValidationError('workflow step session is already attached')
      const steps = [...run.steps]
      steps[stepIndex] = { ...step, sessionId: request.sessionId }
      const runs = [...current.runs]
      runs[runIndex] = { ...run, steps }
      return { ...current, runs }
    })
  }

  /**
 * Conservatively interrupt an active run and retain its reservation.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Run identifier and recorded interruption reason.
 * @returns The committed uncertain aggregate snapshot.
 */
  @Remote
  async interruptWorkflowRun(
    projectId: ProjectIdBrand,
    expectedVersion: number,
    request: InterruptWorkflowRunRequest,
  ): Promise<ProjectRecord> {
    const reason = requireText(request.reason, 'workflow interruption reason')
    return await this.mutate(projectId, expectedVersion, (current) => {
      const index = current.runs.findIndex(run => run.id === request.runId)
      if (index < 0) throw new ProjectValidationError('unknown workflow run')
      const run = current.runs[index] as ProjectWorkflowRun
      if (!activeRun(run)) throw new ProjectValidationError('workflow run is not active')
      const runs = [...current.runs]
      runs[index] = { ...run, state: 'uncertain', error: reason, steps: run.steps.map(step => step.state === 'running' ? { ...step, state: 'uncertain' } : step) }
      return { ...current, runs }
    })
  }

  /**
 * Trusted operator increase for a run stopped by its persisted budget.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Run identifier and strictly increased applicable budget.
 * @returns The committed pending aggregate snapshot.
 */
  @Remote
  async resumeWorkflowRun(projectId: ProjectIdBrand, expectedVersion: number, request: ResumeWorkflowRunRequest): Promise<ProjectRecord> {
    if (request.maxSteps === undefined && request.maxDurationMs === undefined) throw new ProjectValidationError('resume requires a budget increase')
    return await this.mutate(projectId, expectedVersion, (current, now) => {
      const index = current.runs.findIndex(run => run.id === request.runId)
      if (index < 0) throw new ProjectValidationError('unknown workflow run')
      const run = current.runs[index] as ProjectWorkflowRun
      if (run.state !== 'failed' || (run.error !== 'workflow run deadline elapsed' && run.error !== 'workflow run step budget exhausted')) {
        throw new ProjectValidationError('only a run failed by its service budget can resume')
      }
      if (run.error === 'workflow run deadline elapsed' && request.maxDurationMs === undefined) throw new ProjectValidationError('deadline resume requires maxDurationMs')
      if (run.error === 'workflow run step budget exhausted'
        && (request.maxSteps === undefined || request.maxSteps <= run.maxSteps)) {
        throw new ProjectValidationError('step-budget resume requires a larger maxSteps')
      }
      const maxSteps = request.maxSteps ?? run.maxSteps
      if (maxSteps < run.maxSteps || maxSteps > current.budget.maxStepsPerRun) throw new ProjectValidationError('resume maxSteps must increase within the project ceiling')
      if (request.maxDurationMs !== undefined) requirePositiveSafeInteger(request.maxDurationMs, 'resume maxDurationMs')
      if (request.maxDurationMs !== undefined && request.maxDurationMs > current.budget.maxRunDurationMs) throw new ProjectValidationError('resume duration exceeds the project ceiling')
      const deadlineAt = request.maxDurationMs === undefined
        ? run.deadlineAt
        : new Date(Date.parse(now) + request.maxDurationMs).toISOString()
      if (maxSteps === run.maxSteps && deadlineAt === run.deadlineAt) throw new ProjectValidationError('resume requires a budget increase')
      if (current.runs.filter(activeRun).length >= current.budget.maxActiveRuns) {
        throw new ProjectValidationError('project active workflow run limit reached')
      }
      if (this.activeRunCount() >= this.limits.maxActiveRuns) {
        throw new ProjectValidationError('host active workflow run limit reached')
      }
      const runs = [...current.runs]
      const { error: _error, finishedAt: _finishedAt, ...rest } = run
      runs[index] = { ...rest, maxSteps, deadlineAt, state: 'pending' }
      return { ...current, runs }
    })
  }
  /**
   * Claim at most one dependency-ready step in definition order. The claim,
   * attempt number, inputs, and budget consumption commit before publication;
   * callers must launch the external work after this method resolves.
   * @param projectId - Stable project identifier.
   * @param expectedVersion - Required aggregate CAS version.
   * @param runId - Reserved workflow run to advance deterministically.
   * @returns The committed aggregate and optional newly claimed step.
   */
  @Remote
  async claimWorkflowStep(
    projectId: ProjectIdBrand,
    expectedVersion: number,
    runId: ProjectWorkflowRunIdBrand,
  ): Promise<ClaimWorkflowStepResult> {
    let claimedId: ProjectWorkflowStepId | undefined
    const project = await this.mutate(projectId, expectedVersion, (current, now) => {
      const runIndex = current.runs.findIndex(candidate => candidate.id === runId)
      if (runIndex < 0) throw new ProjectValidationError(`unknown workflow run '${runId}'`)
      const run = current.runs[runIndex] as ProjectWorkflowRun
      if (run.state === 'uncertain') {
        throw new ProjectValidationError(`workflow run '${runId}' is uncertain and requires explicit reconciliation`)
      }
      if (run.state === 'completed' || run.state === 'failed') {
        throw new ProjectValidationError(`workflow run '${runId}' is already ${run.state}`)
      }
      const deadlineExpired = Date.parse(now) >= Date.parse(run.deadlineAt)
      if (run.steps.some(step => step.state === 'running')) {
        throw new ProjectValidationError('workflow run already has a running step')
      }
      const completed = run.steps.every(step => step.state === 'completed')
      if (deadlineExpired || (!completed && run.launchedSteps >= run.maxSteps)) {
        const reason = deadlineExpired ? 'workflow run deadline elapsed' : 'workflow run step budget exhausted'
        const runs = [...current.runs]
        runs[runIndex] = { ...run, state: 'failed', error: reason, finishedAt: now }
        return { ...current, runs }
      }
      const definition = workflowRevision(current, run.workflowId, run.workflowRevision)
      const byStep = new Map(run.steps.map(step => [step.stepId, step]))
      const ready = definition.steps.find((step) => {
        const state = byStep.get(step.id)
        return state?.state === 'pending'
          && step.dependsOn.every(dependency => byStep.get(dependency)?.state === 'completed')
      })
      if (ready === undefined) {
        if (completed) {
          const runs = [...current.runs]
          runs[runIndex] = { ...run, state: 'completed', finishedAt: now }
          return { ...current, runs }
        }
        return current
      }
      claimedId = ready.id
      const dependencies = Object.fromEntries(ready.dependsOn.map(dependency => [
        dependency,
        byStep.get(dependency)?.result ?? null,
      ])) as Record<string, JsonValue>
      const steps = run.steps.map(step => step.stepId === ready.id ? {
        ...step,
        state: 'running' as const,
        attempt: step.attempt + 1,
        input: {
          runId,
          stepId: ready.id,
          run: run.input,
          dependencies,
          prompt: ready.prompt === undefined ? null : {
            promptId: ready.prompt.promptId,
            revision: ready.prompt.revision,
          },
          variables: ready.variables ?? {},
        },
        startedAt: now,
      } : step)
      const runs = [...current.runs]
      runs[runIndex] = { ...run, state: 'running', steps, launchedSteps: run.launchedSteps + 1 }
      return { ...current, runs }
    })
    const run = project.runs.find(candidate => candidate.id === runId)
    const step = claimedId === undefined ? undefined : run?.steps.find(candidate => candidate.stepId === claimedId)
    return { project, ...step === undefined ? {} : { step: clone(step) } }
  }

  /**
 * Settle one claimed step and retain its reported outcome. A settlement at or after the run deadline fails the run;
 * a reported failure keeps its own error. Terminal runs release their reservation.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Terminal state and result or error for the running step.
 * @returns The committed aggregate snapshot.
 */
  @Remote
  async settleWorkflowStep(
    projectId: ProjectIdBrand,
    expectedVersion: number,
    request: SettleWorkflowStepRequest,
  ): Promise<ProjectRecord> {
    if (request.state === 'completed' && request.result === undefined) {
      throw new ProjectValidationError('completed workflow step requires a result')
    }
    if (request.state === 'failed') requireText(request.error ?? '', 'failed workflow step error')
    return await this.mutate(projectId, expectedVersion, (current, now) => {
      const runIndex = current.runs.findIndex(candidate => candidate.id === request.runId)
      if (runIndex < 0) throw new ProjectValidationError(`unknown workflow run '${request.runId}'`)
      const run = current.runs[runIndex] as ProjectWorkflowRun
      if (run.state === 'completed' || run.state === 'failed') {
        throw new ProjectValidationError('workflow run is already ' + run.state)
      }
      const stepIndex = run.steps.findIndex(candidate => candidate.stepId === request.stepId)
      if (stepIndex < 0) throw new ProjectValidationError(`workflow run '${request.runId}' has no step '${request.stepId}'`)
      const step = run.steps[stepIndex]
      if (step?.state !== 'running') {
        throw new ProjectValidationError(`workflow step '${request.stepId}' is not running`)
      }
      if (run.parentSessionId !== undefined && step.sessionId === undefined) throw new ProjectValidationError('driver workflow step requires attached child session')
      const steps = [...run.steps]
      steps[stepIndex] = request.state === 'completed'
        ? { ...step, state: 'completed', result: clone(request.result as JsonValue), finishedAt: now }
        : { ...step, state: 'failed', error: (request.error as string).trim(), finishedAt: now }
      const completed = steps.every(candidate => candidate.state === 'completed')
      const error = request.state === 'failed' ? (request.error as string).trim()
        : Date.parse(now) >= Date.parse(run.deadlineAt) ? 'workflow run deadline elapsed' : undefined
      const state = error !== undefined ? 'failed' : completed ? 'completed' : 'running'
      const runs = [...current.runs]
      runs[runIndex] = {
        ...run,
        steps,
        state,
        ...error !== undefined ? { error, finishedAt: now }
          : state === 'completed' ? { finishedAt: now } : {},
      }
      return { ...current, runs }
    })
  }

  /**
 * Resolve restart uncertainty without silently retrying the interrupted step.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Explicit retry or terminal failure decision.
 * @returns The committed aggregate snapshot.
 */
  @Remote
  async reconcileWorkflowRun(
    projectId: ProjectIdBrand,
    expectedVersion: number,
    request: ReconcileWorkflowRunRequest,
  ): Promise<ProjectRecord> {
    if (request.state === 'failed') requireText(request.error ?? '', 'failed workflow run error')
    return await this.mutate(projectId, expectedVersion, (current, now) => {
      const runIndex = current.runs.findIndex(candidate => candidate.id === request.runId)
      if (runIndex < 0) throw new ProjectValidationError(`unknown workflow run '${request.runId}'`)
      const run = current.runs[runIndex] as ProjectWorkflowRun
      if (run.state !== 'uncertain') throw new ProjectValidationError(`workflow run '${request.runId}' is not uncertain`)
      const runs = [...current.runs]
      if (request.state === 'failed') {
        runs[runIndex] = { ...run, state: 'failed', error: (request.error as string).trim(), finishedAt: now }
      } else {
        const { error: _error, finishedAt: _finishedAt, ...resumable } = run
        runs[runIndex] = { ...resumable, state: 'pending', steps: run.steps.map(resetUncertainStep) }
      }
      return { ...current, runs }
    })
  }

  private requireTable(): KvTable<ProjectIdBrand, ProjectRecord> {
    if (this.table === undefined) throw new Error('projects service is not initialized')
    return this.table
  }

  private requireProject(projectId: ProjectIdBrand): ProjectRecord {
    const project = this.requireTable().get(projectId)
    if (project === undefined) throw new ProjectNotFoundError(projectId)
    return project
  }

  private async requireLiveWorkspace(workspaceId: CreateProjectRequest['workspaceId']): Promise<Workspace> {
    const workspace = this.ctx.workspaceRegistry.get(workspaceId)
    if (workspace === undefined) throw new ProjectValidationError(`unknown workspace '${workspaceId}'`)
    if (await workspace.status() !== 'ok') {
      throw new ProjectValidationError(`workspace '${workspaceId}' directory is unavailable at '${workspace.path}'`)
    }
    return workspace
  }

  private async requireTaskSession(project: ProjectRecord, sessionId: SessionId): Promise<SessionHeader> {
    const { workspace, header } = await this.requireSessionWorkspace(project, sessionId)
    if (!workspace.sessionIds.includes(sessionId)) {
      throw new ProjectValidationError(`task session '${sessionId}' is not attached to workspace '${workspace.id}'`)
    }
    return header
  }

  private async requireSessionWorkspace(
    project: ProjectRecord,
    sessionId: SessionId,
  ): Promise<{ workspace: Workspace; header: SessionHeader }> {
    const workspace = this.ctx.workspaceRegistry.get(project.workspaceId)
    if (workspace === undefined) throw new ProjectValidationError(`project workspace '${project.workspaceId}' is no longer registered`)
    const live = this.ctx.get('sessions')?.get(sessionId)
    const header = live?.header ?? (await this.ctx.sessionPersistence.list()).find(candidate => candidate.id === sessionId)
    if (header === undefined) throw new ProjectValidationError(`unknown task session '${sessionId}'`)
    if (header.cwd === undefined) throw new ProjectValidationError(`task session '${sessionId}' has no cwd`)
    let canonicalCwd: string
    try { canonicalCwd = await realpathNormalize(header.cwd) } catch {
      throw new ProjectValidationError(`task session '${sessionId}' cwd is unavailable`)
    }
    if (canonicalCwd !== workspace.path) {
      throw new ProjectValidationError(`task session '${sessionId}' cwd does not match workspace '${workspace.id}'`)
    }
    return { workspace, header }
  }
  private validateTaskTransition(task: ProjectTask, next: ProjectTask['state']): void {
    const permitted: Record<ProjectTask['state'], readonly ProjectTask['state'][]> = {
      pending: ['running'],
      running: ['verified', 'failed'],
      verified: [],
      failed: ['running'],
      uncertain: ['running', 'failed'],
    }
    if (!permitted[task.state].includes(next)) {
      throw new ProjectValidationError(`task '${task.itemId}' cannot transition from ${task.state} to ${next}`)
    }
  }

  private validateVariables(schema: Readonly<Record<string, PromptVariableDefinition>>): void {
    for (const [name, definition] of Object.entries(schema)) {
      if (!VARIABLE_NAME.test(name) || DANGEROUS_KEYS.has(name)) throw new ProjectValidationError(`invalid prompt variable name '${name}'`)
      if (!['string', 'number', 'boolean', 'json'].includes(definition.type)) {
        throw new ProjectValidationError(`prompt variable '${name}' has unsupported type '${definition.type}'`)
      }
    }
  }

  private validatePromptMetadata(
    template: string,
    variablesSchema: Readonly<Record<string, PromptVariableDefinition>>,
    purpose: string,
    tags: readonly string[],
    examples: ProjectPrompt['revisions'][number]['examples'],
    evaluationCases: readonly ProjectPromptEvaluationCase[],
    existing?: ProjectPrompt,
  ): void {
    if (purpose.length > MAX_PROMPT_PURPOSE_CHARS) throw new ProjectValidationError(`prompt purpose exceeds ${MAX_PROMPT_PURPOSE_CHARS} characters`)
    if (tags.length > MAX_PROMPT_TAGS) throw new ProjectValidationError(`prompt exceeds ${MAX_PROMPT_TAGS} tags`)
    if (tags.some(tag => tag.length > MAX_PROMPT_TAG_CHARS)) throw new ProjectValidationError(`prompt tag exceeds ${MAX_PROMPT_TAG_CHARS} characters`)
    if (new Set(tags).size !== tags.length) throw new ProjectValidationError('prompt tags must be unique')
    if (examples.length > MAX_PROMPT_EXAMPLES) throw new ProjectValidationError(`prompt exceeds ${MAX_PROMPT_EXAMPLES} examples`)
    const exampleIds = new Set<string>()
    const selected = { template, variablesSchema }
    for (const example of examples) {
      if (!GRAPH_ID.test(example.id) || DANGEROUS_KEYS.has(example.id) || exampleIds.has(example.id)) {
        throw new ProjectValidationError('prompt examples contain an unsafe or duplicate id')
      }
      exampleIds.add(example.id)
      if (example.expectedOutput.length > MAX_PROMPT_EXAMPLE_OUTPUT_CHARS) throw new ProjectValidationError('prompt example output exceeds configured limit')
      if (Buffer.byteLength(JSON.stringify(example.variables), 'utf8') > MAX_PROMPT_CASE_VARIABLE_BYTES) throw new ProjectValidationError('prompt example variables exceed configured limit')
      this.renderPromptRevision(selected, example.variables)
    }
    if (evaluationCases.length > MAX_PROMPT_EVALUATION_CASES) throw new ProjectValidationError(`prompt exceeds ${MAX_PROMPT_EVALUATION_CASES} evaluation cases`)
    const caseIds = new Set<string>()
    for (const evaluation of evaluationCases) {
      if (!GRAPH_ID.test(evaluation.id) || DANGEROUS_KEYS.has(evaluation.id) || caseIds.has(evaluation.id)) {
        throw new ProjectValidationError('prompt evaluation cases contain an unsafe or duplicate id')
      }
      caseIds.add(evaluation.id)
      requireText(evaluation.name, `prompt evaluation case '${evaluation.id}' name`)
      const substrings = evaluation.checks.expectedSubstrings ?? []
      if (substrings.length === 0 && evaluation.checks.validJson === undefined) throw new ProjectValidationError('prompt evaluation case requires at least one deterministic check')
      if (substrings.length > MAX_PROMPT_EVALUATION_SUBSTRINGS) throw new ProjectValidationError('prompt evaluation case has too many substrings')
      for (const substring of substrings) {
        requireText(substring, 'prompt evaluation substring')
        if (substring.length > MAX_PROMPT_EVALUATION_SUBSTRING_CHARS) throw new ProjectValidationError('prompt evaluation substring exceeds configured limit')
      }
      if (Buffer.byteLength(JSON.stringify(evaluation.variables), 'utf8') > MAX_PROMPT_CASE_VARIABLE_BYTES) throw new ProjectValidationError('prompt evaluation variables exceed configured limit')
      this.renderPromptRevision(selected, evaluation.variables)
      for (const revision of existing?.revisions ?? []) {
        const prior = revision.evaluationCases.find(candidate => candidate.id === evaluation.id)
        if (prior !== undefined && semanticEvaluationCase(prior) !== semanticEvaluationCase(evaluation)) {
          throw new ProjectValidationError(`prompt evaluation case '${evaluation.id}' semantics are immutable across revisions`)
        }
      }
    }
  }

  private renderPromptRevision(
    selected: Pick<ProjectPrompt['revisions'][number], 'template' | 'variablesSchema'>,
    variables: Readonly<Record<string, JsonValue>>,
  ): string {
    for (const key of Object.keys(variables)) {
      if (!Object.hasOwn(selected.variablesSchema, key)) throw new ProjectValidationError(`prompt variable '${key}' is not declared`)
    }
    for (const [key, definition] of Object.entries(selected.variablesSchema)) {
      const value = variables[key]
      if (value === undefined) {
        if (definition.required) throw new ProjectValidationError(`prompt variable '${key}' is required`)
        continue
      }
      this.validateVariableValue(key, definition, value)
    }
    return selected.template.replace(TEMPLATE_VARIABLE, (_match, key: string) => {
      const value = variables[key]
      if (value === undefined) throw new ProjectValidationError(`template variable '${key}' was not supplied`)
      return typeof value === 'string' ? value : JSON.stringify(value)
    })
  }

  private validateVariableValue(name: string, definition: PromptVariableDefinition, value: JsonValue): void {
    if (definition.type === 'json') return
    if (typeof value !== definition.type) {
      throw new ProjectValidationError(`prompt variable '${name}' must be ${definition.type}`)
    }
  }

  private activeRunCount(): number {
    let count = 0
    for (const [, project] of this.requireTable().entries()) {
      for (const run of project.runs) if (activeRun(run)) count += 1
    }
    return count
  }

  private async mutate(
    projectId: ProjectIdBrand,
    expectedVersion: number,
    mutation: ProjectMutation,
  ): Promise<ProjectRecord> {
    requirePositiveSafeInteger(expectedVersion, 'expected project version')
    this.requireProject(projectId)
    const committed = await this.requireTable().update(projectId, (current) => {
      if (current.version !== expectedVersion) {
        throw new ProjectConflictError(projectId, expectedVersion, current.version)
      }
      const now = nowIso()
      const changed = mutation(current, now)
      requireBoundedRecord(changed)
      return {
        ...changed,
        id: current.id,
        version: current.version + 1,
        createdAt: current.createdAt,
        updatedAt: now,
      }
    })
    const snapshot = clone(committed)
    this.publish(snapshot)
    return snapshot
  }

  private publish(project: ProjectRecord): void {
    try {
      this.ctx.emit('projects/changed', clone(project))
    } catch (error: unknown) {
      this.ctx.logger.warn(`projects: projects/changed listener failed after commit: ${String(error)}`)
    }
  }

  private async recoverInterruptedWork(): Promise<void> {
    for (const [projectId, record] of this.requireTable().entries()) {
      const hasRunningTask = record.tasks.some(task => task.state === 'running')
      const hasRunningRun = record.runs.some(run => run.state === 'running')
      if (!hasRunningTask && !hasRunningRun) continue
      const now = nowIso()
      const committed = await this.requireTable().update(projectId, current => ({
        ...current,
        version: current.version + 1,
        updatedAt: now,
        tasks: current.tasks.map(task => task.state === 'running'
          ? { ...task, state: 'uncertain', updatedAt: now }
          : task),
        runs: current.runs.map(run => run.state === 'running'
          ? {
            ...run,
            state: 'uncertain',
            steps: run.steps.map(step => step.state === 'running' ? { ...step, state: 'uncertain' } : step),
          }
          : run),
      }))
      this.publish(clone(committed))
    }
  }
}

export default ProjectService
