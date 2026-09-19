/** Durable schema and single-record project aggregate domain. */

import { z } from 'zod'
import { SessionId } from '@arx-ai/arx-session'
import { defineDomain, domainTable } from '@arx-ai/arx-storage-domain'
import { WorkspaceId } from '@arx-ai/arx-workspace'
import type {
  PlanItemId,
  ProjectId,
  ProjectPromptId,
  ProjectRecord,
  ProjectWorkflowId,
  ProjectWorkflowRunId,
  ProjectWorkflowStepId,
} from './types.ts'

const projectId = z.string().transform(value => value as ProjectId)
const planItemId = z.string().transform(value => value as PlanItemId)
const promptId = z.string().transform(value => value as ProjectPromptId)
const workflowId = z.string().transform(value => value as ProjectWorkflowId)
const workflowRunId = z.string().transform(value => value as ProjectWorkflowRunId)
const workflowStepId = z.string().transform(value => value as ProjectWorkflowStepId)
const promptExampleId = z.string().transform(value => value as import('./types.ts').ProjectPromptExampleId)
const promptEvaluationCaseId = z.string().transform(value => value as import('./types.ts').ProjectPromptEvaluationCaseId)
const promptEvaluationId = z.string().transform(value => value as import('./types.ts').ProjectPromptEvaluationId)

const variableDefinition = z.object({
  type: z.enum(['string', 'number', 'boolean', 'json']),
  required: z.boolean(),
  description: z.string().optional(),
})

const skillSnapshot = z.object({
  repository: z.string(),
  commit: z.string(),
  path: z.string(),
  content: z.string(),
  contentHash: z.string(),
})

const promptExample = z.object({
  id: promptExampleId,
  variables: z.record(z.string(), z.json()),
  expectedOutput: z.string(),
})

const promptEvaluationCase = z.object({
  id: promptEvaluationCaseId,
  name: z.string(),
  variables: z.record(z.string(), z.json()),
  checks: z.object({
    expectedSubstrings: z.array(z.string()).optional(),
    validJson: z.boolean().optional(),
  }),
})
const promptRevision = z.object({
  revision: z.number().int().positive(),
  purpose: z.string(),
  tags: z.array(z.string()),
  examples: z.array(promptExample),
  evaluationCases: z.array(promptEvaluationCase),
  template: z.string(),
  variablesSchema: z.record(z.string(), variableDefinition),
  sourceSkills: z.array(skillSnapshot),
  createdAt: z.string(),
})

const prompt = z.object({
  id: promptId,
  name: z.string(),
  revisions: z.array(promptRevision),
})

const planItem = z.object({
  id: planItemId,
  title: z.string(),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()),
  dependsOn: z.array(planItemId),
})

const planRevision = z.object({
  revision: z.number().int().positive(),
  summary: z.string(),
  items: z.array(planItem),
  createdAt: z.string(),
})

const task = z.object({
  planRevision: z.number().int().positive(),
  itemId: planItemId,
  state: z.enum(['pending', 'running', 'verified', 'failed', 'uncertain']),
  execution: z.object({
    sessionId: z.string().transform(SessionId),
    prompt: z.object({ promptId, revision: z.number().int().positive() }),
  }).optional(),
  evidence: z.array(z.string()),
  result: z.json().optional(),
  updatedAt: z.string(),
})

const workflowStep = z.object({
  id: workflowStepId,
  name: z.string(),
  description: z.string().optional(),
  dependsOn: z.array(workflowStepId),
  prompt: z.object({ promptId, revision: z.number().int().positive() }).optional(),
  variables: z.record(z.string(), z.json()).optional(),
})

const workflowRevision = z.object({
  revision: z.number().int().positive(),
  steps: z.array(workflowStep),
  createdAt: z.string(),
})

const workflow = z.object({
  id: workflowId,
  name: z.string(),
  revisions: z.array(workflowRevision),
})

const workflowStepRun = z.object({
  stepId: workflowStepId,
  state: z.enum(['pending', 'running', 'completed', 'failed', 'uncertain']),
  attempt: z.number().int().nonnegative(),
  input: z.json().optional(),
  result: z.json().optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  sessionId: z.string().transform(SessionId).optional(),
})

const workflowRun = z.object({
  id: workflowRunId,
  workflowId,
  workflowRevision: z.number().int().positive(),
  state: z.enum(['pending', 'running', 'completed', 'failed', 'uncertain']),
  input: z.json(),
  steps: z.array(workflowStepRun),
  planRevision: z.number().int().positive().optional(),
  parentSessionId: z.string().transform(SessionId).optional(),
  launchedSteps: z.number().int().nonnegative(),
  maxSteps: z.number().int().positive(),
  startedAt: z.string(),
  deadlineAt: z.string(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
})

const promptEvaluationCaseResult = z.object({
  caseId: promptEvaluationCaseId,
  stepId: workflowStepId,
  accepted: z.boolean().nullable(),
  expectedSubstringMatches: z.array(z.boolean().nullable()),
  validJson: z.boolean().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  tokens: z.number().int().nonnegative().nullable(),
  outputTruncated: z.boolean(),
  error: z.string().optional(),
})

const promptEvaluation = z.object({
  id: promptEvaluationId,
  promptId,
  promptRevision: z.number().int().positive(),
  workflowId,
  workflowRevision: z.number().int().positive(),
  runId: workflowRunId,
  caseSteps: z.array(z.object({ caseId: promptEvaluationCaseId, stepId: workflowStepId })),
  createdAt: z.string(),
  result: z.object({
    accepted: z.boolean().nullable(),
    runState: z.enum(['completed', 'failed']),
    cases: z.array(promptEvaluationCaseResult),
    finalizedAt: z.string(),
  }).optional(),
})
/** Durable validator for one complete project aggregate. */
export const projectRecord = z.object({
  id: projectId,
  version: z.number().int().positive(),
  workspaceId: z.string().transform(WorkspaceId),
  name: z.string(),
  description: z.string().optional(),
  plans: z.array(planRevision),
  approvedPlan: z.object({ revision: z.number().int().positive(), approvedAt: z.string() }).optional(),
  tasks: z.array(task),
  prompts: z.array(prompt),
  evaluations: z.array(promptEvaluation),
  workflows: z.array(workflow),
  runs: z.array(workflowRun),
  createdAt: z.string(),
  updatedAt: z.string(),
  budget: z.object({
    maxActiveRuns: z.number().int().positive(),
    maxStepsPerRun: z.number().int().positive(),
    maxRunDurationMs: z.number().int().positive(),
  }),
}) as unknown as z.ZodType<ProjectRecord>

/** One atomic project record per table key; no cross-table transaction is required. */
export const projectDomainSpec = defineDomain({
  name: 'project',
  version: 1,
  tables: { projects: domainTable<ProjectId, ProjectRecord>(projectRecord) },
})
