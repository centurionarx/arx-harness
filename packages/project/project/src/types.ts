/**
 * Public project, plan, prompt, task, and workflow data. This module contains
 * types only; identifier factories live at the package root.
 * @module @arx-ai/arx-project/src/types
 */

import type { Branded } from '@arx-ai/arx-brand'
import type { JsonValue } from '@arx-ai/arx-session/types'
import type { SessionId } from '@arx-ai/arx-session/types'
import type { WorkspaceId } from '@arx-ai/arx-workspace/types'

/** Stable identity of one project aggregate. */
export type ProjectId = Branded<'ProjectId'>
/** Stable identity of one plan item across immutable plan revisions. */
export type PlanItemId = Branded<'PlanItemId'>
/** Stable identity of one reusable prompt. */
export type ProjectPromptId = Branded<'ProjectPromptId'>
/** Stable identity of one reusable workflow. */
export type ProjectWorkflowId = Branded<'ProjectWorkflowId'>
/** Stable identity of one persisted workflow run. */
export type ProjectWorkflowRunId = Branded<'ProjectWorkflowRunId'>
/** Stable identity of one named workflow step. */
export type ProjectWorkflowStepId = Branded<'ProjectWorkflowStepId'>
/** Stable semantic identity of one prompt example. */
export type ProjectPromptExampleId = Branded<'ProjectPromptExampleId'>
/** Stable semantic identity of one prompt evaluation case. */
export type ProjectPromptEvaluationCaseId = Branded<'ProjectPromptEvaluationCaseId'>
/** Stable identity of one prompt evaluation run. */
export type ProjectPromptEvaluationId = Branded<'ProjectPromptEvaluationId'>

/** Supported scalar values for one reusable prompt variable. */
export type PromptVariableType = 'string' | 'number' | 'boolean' | 'json'

/** Validation and documentation for one prompt variable. */
export interface PromptVariableDefinition {
  readonly type: PromptVariableType
  readonly required: boolean
  readonly description?: string
}

/** Source skill snapshot retained with a prompt revision. */
export interface PromptSkillSnapshot {
  readonly repository: string
  readonly commit: string
  readonly path: string
  readonly content: string
  readonly contentHash: string
}

/** Input skill source whose digest is computed by the service. */
export interface PromptSkillSource {
  readonly repository: string
  readonly commit: string
  readonly path: string
  readonly content: string
}

/** One documented input/output example for a prompt revision. */
export interface ProjectPromptExample {
  readonly id: ProjectPromptExampleId
  readonly variables: Readonly<Record<string, JsonValue>>
  readonly expectedOutput: string
}

/** Deterministic checks applied to a real child result. */
export interface ProjectPromptEvaluationChecks {
  readonly expectedSubstrings?: readonly string[]
  readonly validJson?: boolean
}

/** One stable evaluation case comparable across prompt revisions. */
export interface ProjectPromptEvaluationCase {
  readonly id: ProjectPromptEvaluationCaseId
  readonly name: string
  readonly variables: Readonly<Record<string, JsonValue>>
  readonly checks: ProjectPromptEvaluationChecks
}
/** One immutable reusable prompt revision. */
export interface ProjectPromptRevision {
  readonly revision: number
  readonly purpose: string
  readonly tags: readonly string[]
  readonly examples: readonly ProjectPromptExample[]
  readonly evaluationCases: readonly ProjectPromptEvaluationCase[]
  readonly template: string
  readonly variablesSchema: Readonly<Record<string, PromptVariableDefinition>>
  readonly sourceSkills: readonly PromptSkillSnapshot[]
  readonly createdAt: string
}

/** Reusable prompt identity plus its immutable revision history. */
export interface ProjectPrompt {
  readonly id: ProjectPromptId
  readonly name: string
  readonly revisions: readonly ProjectPromptRevision[]
}

/** Input accepted when saving a prompt revision. */
export interface SavePromptRequest {
  readonly promptId?: ProjectPromptId
  readonly name: string
  readonly purpose?: string
  readonly tags?: readonly string[]
  readonly examples?: readonly ProjectPromptExample[]
  readonly evaluationCases?: readonly ProjectPromptEvaluationCase[]
  readonly template: string
  readonly variablesSchema: Readonly<Record<string, PromptVariableDefinition>>
  readonly sourceSkills: readonly PromptSkillSource[]
}

/** A fully rendered prompt and exact skill snapshots returned through a tool result. */
export interface EffectivePromptSnapshot {
  readonly promptId: ProjectPromptId
  readonly promptRevision: number
  readonly renderedPrompt: string
  readonly variables: Readonly<Record<string, JsonValue>>
  readonly sourceSkills: readonly PromptSkillSnapshot[]
}

/** One immutable plan item. Dependencies name items in the same revision. */
export interface ProjectPlanItem {
  readonly id: PlanItemId
  readonly title: string
  readonly description?: string
  readonly acceptanceCriteria: readonly string[]
  readonly dependsOn: readonly PlanItemId[]
}

/** One immutable plan revision. */
export interface ProjectPlanRevision {
  readonly revision: number
  readonly summary: string
  readonly items: readonly ProjectPlanItem[]
  readonly createdAt: string
}

/** Complete input for the next immutable plan revision. */
export interface SavePlanRequest {
  readonly summary: string
  readonly items: readonly ProjectPlanItem[]
}

/** Approval of one exact immutable plan revision. */
export interface ProjectPlanApproval {
  readonly revision: number
  readonly approvedAt: string
}

/** Exact reusable prompt revision used by one task execution. */
export interface ProjectPromptRef {
  readonly promptId: ProjectPromptId
  readonly revision: number
}

/** Execution attribution retained for a task after it leaves pending state. */
export interface ProjectTaskExecution {
  readonly sessionId: SessionId
  readonly prompt: ProjectPromptRef
}

/** Persisted task state; restart converts running to uncertain. */
export type ProjectTaskState = 'pending' | 'running' | 'verified' | 'failed' | 'uncertain'

/** Progress for one plan item in one exact approved plan revision. */
export interface ProjectTask {
  readonly planRevision: number
  readonly itemId: PlanItemId
  readonly state: ProjectTaskState
  readonly execution?: ProjectTaskExecution
  readonly evidence: readonly string[]
  readonly result?: JsonValue
  readonly updatedAt: string
}

/** Complete requested replacement of one task progress record. */
export interface UpdateProjectTaskRequest {
  readonly planRevision: number
  readonly itemId: PlanItemId
  readonly state: ProjectTaskState
  readonly execution?: ProjectTaskExecution
  readonly evidence?: readonly string[]
  readonly result?: JsonValue
}

/** One explicitly named step in a reusable workflow revision. */
export interface ProjectWorkflowStep {
  readonly id: ProjectWorkflowStepId
  readonly name: string
  readonly description?: string
  readonly dependsOn: readonly ProjectWorkflowStepId[]
  readonly prompt?: ProjectPromptRef
  readonly variables?: Readonly<Record<string, JsonValue>>
}

/** One immutable reusable workflow revision. */
export interface ProjectWorkflowRevision {
  readonly revision: number
  readonly steps: readonly ProjectWorkflowStep[]
  readonly createdAt: string
}

/** Reusable workflow identity plus immutable revision history. */
export interface ProjectWorkflow {
  readonly id: ProjectWorkflowId
  readonly name: string
  readonly revisions: readonly ProjectWorkflowRevision[]
}

/** Input accepted when saving a workflow revision. */
export interface SaveWorkflowRequest {
  readonly workflowId?: ProjectWorkflowId
  readonly name: string
  readonly steps: readonly ProjectWorkflowStep[]
}

/** Workflow run lifecycle. Uncertain retains its shared active-run reservation. */
export type ProjectWorkflowRunState = 'pending' | 'running' | 'completed' | 'failed' | 'uncertain'
/** Workflow step lifecycle. */
export type ProjectWorkflowStepState = 'pending' | 'running' | 'completed' | 'failed' | 'uncertain'

/** Attempt ledger for one named workflow step. */
export interface ProjectWorkflowStepRun {
  readonly stepId: ProjectWorkflowStepId
  readonly state: ProjectWorkflowStepState
  readonly sessionId?: SessionId
  readonly attempt: number
  readonly input?: JsonValue
  readonly result?: JsonValue
  readonly error?: string
  readonly startedAt?: string
  readonly finishedAt?: string
}

/** Durable run ledger with explicit limits fixed at start. */
export interface ProjectWorkflowRun {
  readonly planRevision?: number
  readonly parentSessionId?: SessionId
  readonly id: ProjectWorkflowRunId
  readonly workflowId: ProjectWorkflowId
  readonly workflowRevision: number
  readonly state: ProjectWorkflowRunState
  readonly input: JsonValue
  readonly steps: readonly ProjectWorkflowStepRun[]
  readonly launchedSteps: number
  readonly maxSteps: number
  readonly startedAt: string
  readonly deadlineAt: string
  readonly finishedAt?: string
  readonly error?: string
}

/** Input accepted when reserving and starting one workflow run. */
export interface StartWorkflowRunRequest {
  readonly workflowId: ProjectWorkflowId
  readonly workflowRevision: number
  readonly input: JsonValue
  readonly maxSteps?: number
  readonly maxDurationMs?: number
  readonly planRevision?: number
  readonly parentSessionId?: SessionId
}

/** Per-project workflow ceilings, each bounded by host configuration. */
export interface ProjectBudget {
  readonly maxActiveRuns: number
  readonly maxStepsPerRun: number
  readonly maxRunDurationMs: number
}

/** Complete per-project limits accepted by the trusted budget control. */
export type ConfigureProjectBudgetRequest = ProjectBudget

/** Child-session provenance attached after a claimed step launch is accepted. */
export interface AttachWorkflowStepSessionRequest {
  readonly runId: ProjectWorkflowRunId
  readonly stepId: ProjectWorkflowStepId
  readonly sessionId: SessionId
}

/** Conservative interruption of active workflow work. */
export interface InterruptWorkflowRunRequest {
  readonly runId: ProjectWorkflowRunId
  readonly reason: string
}

/** Trusted operator increase for a run stopped by its step or deadline budget. */
export interface ResumeWorkflowRunRequest {
  readonly runId: ProjectWorkflowRunId
  readonly maxSteps?: number
  readonly maxDurationMs?: number
}
/** Result of deterministic dependency-aware step claiming. */
export interface ClaimWorkflowStepResult {
  readonly project: ProjectRecord
  readonly step?: ProjectWorkflowStepRun
}

/** Terminal settlement for one running step. */
export interface SettleWorkflowStepRequest {
  readonly runId: ProjectWorkflowRunId
  readonly stepId: ProjectWorkflowStepId
  readonly state: 'completed' | 'failed'
  readonly result?: JsonValue
  readonly error?: string
}

/** Explicit resolution of a run made uncertain by restart. */
export interface ReconcileWorkflowRunRequest {
  readonly runId: ProjectWorkflowRunId
  readonly state: 'pending' | 'failed'
  readonly error?: string
}

/** Deterministic outcome for one evaluation case over a real child result. */
export interface ProjectPromptEvaluationCaseResult {
  readonly caseId: ProjectPromptEvaluationCaseId
  readonly stepId: ProjectWorkflowStepId
  readonly accepted: boolean | null
  readonly expectedSubstringMatches: readonly (boolean | null)[]
  readonly validJson: boolean | null
  readonly latencyMs: number | null
  readonly tokens: number | null
  readonly outputTruncated: boolean
  readonly error?: string
}

/** Immutable comparison result derived once from a terminal workflow run. */
export interface ProjectPromptEvaluationResult {
  readonly accepted: boolean | null
  readonly runState: 'completed' | 'failed'
  readonly cases: readonly ProjectPromptEvaluationCaseResult[]
  readonly finalizedAt: string
}

/** Link between one exact prompt revision and its ordinary workflow driver run. */
export interface ProjectPromptEvaluation {
  readonly id: ProjectPromptEvaluationId
  readonly promptId: ProjectPromptId
  readonly promptRevision: number
  readonly workflowId: ProjectWorkflowId
  readonly workflowRevision: number
  readonly runId: ProjectWorkflowRunId
  readonly caseSteps: readonly { readonly caseId: ProjectPromptEvaluationCaseId; readonly stepId: ProjectWorkflowStepId }[]
  readonly createdAt: string
  readonly result?: ProjectPromptEvaluationResult
}

/** Start a real-child evaluation for one exact immutable prompt revision. */
export interface StartPromptEvaluationRequest {
  readonly promptId: ProjectPromptId
  readonly promptRevision: number
  readonly planRevision: number
  readonly parentSessionId: SessionId
  readonly maxDurationMs?: number
}

/** Derive and persist deterministic checks from a terminal evaluation run. */
export interface FinalizePromptEvaluationRequest {
  readonly evaluationId: ProjectPromptEvaluationId
}
/** Durable project aggregate. Every mutation replaces this record atomically. */
export interface ProjectRecord {
  readonly id: ProjectId
  readonly version: number
  readonly workspaceId: WorkspaceId
  readonly name: string
  readonly description?: string
  readonly plans: readonly ProjectPlanRevision[]
  readonly approvedPlan?: ProjectPlanApproval
  readonly tasks: readonly ProjectTask[]
  readonly prompts: readonly ProjectPrompt[]
  readonly evaluations: readonly ProjectPromptEvaluation[]
  readonly workflows: readonly ProjectWorkflow[]
  readonly budget: ProjectBudget
  readonly runs: readonly ProjectWorkflowRun[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** Compact list projection. */
export interface ProjectSummary {
  readonly id: ProjectId
  readonly version: number
  readonly workspaceId: WorkspaceId
  readonly name: string
  readonly approvedPlanRevision?: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** Input accepted when creating one project aggregate. */
export interface CreateProjectRequest {
  readonly workspaceId: WorkspaceId
  readonly name: string
  readonly description?: string
}
