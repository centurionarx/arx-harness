import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import Storage from '@arx-ai/arx-storage'
import * as StorageDomain from '@arx-ai/arx-storage-domain'
import * as StorageJson from '@arx-ai/arx-storage-json'
import { SessionId } from '@arx-ai/arx-session'
import type { SessionHeader } from '@arx-ai/arx-session'
import type { SessionPersistence } from '@arx-ai/arx-session-persistence'
import { WorkspaceId } from '@arx-ai/arx-workspace'
import type { WorkspaceRegistry } from '@arx-ai/arx-workspace'
import ProjectService, { ProjectId, ProjectPromptId, ProjectWorkflowId, ProjectWorkflowRunId, ProjectPromptEvaluationId, projectRecord, projectDomainSpec } from '../src/index.ts'
import type { Config, PlanItemId, ProjectWorkflowStepId, SavePromptRequest, ProjectPromptExampleId, ProjectPromptEvaluationCaseId } from '../src/index.ts'

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) }
})

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function setup(config: Config = {}) {
  // The workspace registry stores canonical paths and checks a task session's
  // cwd through realpath; a runner's temp dir can be a symlink or, on Windows,
  // an 8.3 short name, so the fixture starts from the canonical spelling.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arx-project-contract-')))
  roots.push(root)
  const workspaceId = WorkspaceId('contract-workspace')
  const parent = SessionId('parent')
  const child = SessionId('child')
  const headers: SessionHeader[] = [
    { id: parent, version: 0, createdAt: 1, cwd: root },
    { id: child, version: 0, createdAt: 2, cwd: root, parentSession: parent },
  ]
  const workspace = { id: workspaceId, path: root, sessionIds: [parent, child], status: vi.fn(async () => 'ok') }
  const registry = { get: vi.fn((id: typeof workspaceId) => id === workspaceId ? workspace : undefined) }
  const persistence = { list: vi.fn(async () => headers) }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'data') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  ctx.provide('workspaceRegistry', registry as unknown as WorkspaceRegistry)
  ctx.provide('sessionPersistence', persistence as unknown as SessionPersistence)
  await ctx.plugin(ProjectService, config)
  const projects = ctx.projects
  return { ctx, root, workspaceId, workspace, registry, persistence, headers, parent, child, projects }
}
const item = (id: string, dependencies: string[] = []) => ({ id: id as PlanItemId, title: id, acceptanceCriteria: ['verified'], dependsOn: dependencies as PlanItemId[] })
const step = (id: string, dependencies: string[] = []) => ({
  id: id as ProjectWorkflowStepId, name: id, dependsOn: dependencies as ProjectWorkflowStepId[],
})
const prompt: SavePromptRequest = { name: 'Prompt', template: 'Use {{value}}', variablesSchema: { value: { type: 'string', required: true } }, sourceSkills: [] }
const example = { id: 'example' as ProjectPromptExampleId, variables: { value: 'sample' }, expectedOutput: 'output' }
const evaluationCase = { id: 'case' as ProjectPromptEvaluationCaseId, name: 'Case', variables: { value: 'sample' }, checks: { expectedSubstrings: ['ok'] } }

it('rejects malformed graphs and preserves committed revision on every rejection', async () => {
  const f = await setup()
  let project = await f.projects.create({ workspaceId: f.workspaceId, name: 'Domain', description: ' description ' })
  const invalid = [
    [], [item('bad id')], [item('prototype')], [item('a'), item('a')],
    [item('a', ['missing'])], [item('a', ['a'])],
    [item('a'), item('b', ['a', 'a'])], [item('a', ['b']), item('b', ['a'])],
    [{ ...item('a'), acceptanceCriteria: [] }], [{ ...item('a'), acceptanceCriteria: [' '] }],
    [{ ...item('a'), title: ' ' }],
  ]
  for (const items of invalid) {
    await expect(f.projects.savePlan(project.id, project.version, { summary: 'Test', items })).rejects.toThrow()
    expect((await f.projects.get(project.id))?.version).toBe(project.version)
  }
  await expect(f.projects.savePlan(project.id, 0, { summary: 'Test', items: [item('a')] })).rejects.toThrow('positive safe integer')
  await expect(f.projects.savePlan(ProjectId('missing'), 1, { summary: 'Test', items: [item('a')] })).rejects.toThrow('not found')
  await expect(f.projects.savePlan(project.id, project.version, { summary: ' ', items: [item('a')] })).rejects.toThrow('non-empty')
  await expect(f.projects.approvePlan(project.id, project.version, 999)).rejects.toThrow('no plan revision')
  await expect(f.projects.approvePlan(project.id, project.version, 1.5)).rejects.toThrow('positive safe integer')
  project = await f.projects.savePlan(project.id, project.version, {
    summary: 'Accepted DAG', items: [item('a'), item('b', ['a']), item('c', ['a'])],
  })
  project = await f.projects.approvePlan(project.id, project.version, 1)
  const listed = await f.projects.list()
  expect(listed).toMatchObject([{ id: project.id, approvedPlanRevision: 1 }])
  expect(await f.projects.get(ProjectId('missing'))).toBeUndefined()
  expect(projectRecord.parse(project)).toEqual(project)
  for (let revision = 2; revision <= 100; revision++) project = await f.projects.savePlan(project.id, project.version, {
    summary: 'Revision ' + String(revision), items: [item('a')],
  })
  await expect(f.projects.savePlan(project.id, project.version, { summary: 'Limit', items: [item('a')] })).rejects.toThrow('revision limit')
}, 30_000)

it('keeps sorting deterministic and rejects unavailable workspaces and oversize aggregates', async () => {
  const f = await setup()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(1000)
  const a = await f.projects.create({ workspaceId: f.workspaceId, name: 'A' })
  const b = await f.projects.create({ workspaceId: f.workspaceId, name: 'B' })
  vi.setSystemTime(2000)
  const c = await f.projects.create({ workspaceId: f.workspaceId, name: 'C' })
  expect((await f.projects.list()).map(value => value.id)).toEqual([a.id, b.id].sort((a, b) => a.localeCompare(b)).concat(c.id))
  await expect(f.projects.create({ workspaceId: WorkspaceId('missing'), name: 'No' })).rejects.toThrow('unknown workspace')
  f.workspace.status.mockResolvedValue('missing')
  await expect(f.projects.create({ workspaceId: f.workspaceId, name: 'No' })).rejects.toThrow('unavailable')
  f.workspace.status.mockResolvedValue('ok')
  await expect(f.projects.create({ workspaceId: f.workspaceId, name: 'a'.repeat(8 * 1024 * 1024) })).rejects.toThrow('serialized bytes')
  const warn = vi.spyOn(f.ctx.logger, 'warn').mockImplementation(() => {})
  f.ctx.on('projects/changed', () => { throw new Error('observer failure') })
  expect(await f.projects.create({ workspaceId: f.workspaceId, name: 'Durable despite observer' })).toMatchObject({ version: 1 })
  expect(warn).toHaveBeenCalled()
})

it('validates prompt metadata, variable boundaries, history identity, and persisted schemas', async () => {
  const f = await setup()
  let project = await f.projects.create({ workspaceId: f.workspaceId, name: 'Prompts' })
  const invalid: SavePromptRequest[] = [
    { ...prompt, template: 'x'.repeat(100_001) },
    { ...prompt, variablesSchema: Object.fromEntries(Array.from({ length: 101 }, (_, i) => ['v' + String(i), { type: 'string', required: false }])) },
    { ...prompt, variablesSchema: { 'bad name': { type: 'string', required: false } } },
    { ...prompt, variablesSchema: { prototype: { type: 'string', required: false } } },
    { ...prompt, variablesSchema: { bad: { type: 'invalid' as never, required: false } } },
    { ...prompt, sourceSkills: Array.from({ length: 33 }, () => ({ repository: 'repo', commit: 'sha', path: 'path', content: 'content' })) },
    { ...prompt, sourceSkills: [{ repository: 'repo', commit: 'sha', path: 'path', content: 'x'.repeat(1_000_001) }] },
    { ...prompt, purpose: 'x'.repeat(4001) },
    { ...prompt, tags: Array.from({ length: 17 }, (_, i) => 'tag' + String(i)) },
    { ...prompt, tags: ['x'.repeat(65)] }, { ...prompt, tags: ['same', 'same'] }, { ...prompt, tags: [' '] },
    { ...prompt, examples: Array.from({ length: 17 }, () => example) },
    { ...prompt, examples: [{ ...example, id: 'bad id' as never }] },
    { ...prompt, examples: [{ ...example, id: 'prototype' as never }] },
    { ...prompt, examples: [example, example] },
    { ...prompt, examples: [{ ...example, expectedOutput: 'x'.repeat(16_001) }] },
    { ...prompt, examples: [{ ...example, variables: { value: 'x'.repeat(65_536) } }] },
    { ...prompt, evaluationCases: Array.from({ length: 17 }, () => evaluationCase) },
    { ...prompt, evaluationCases: [{ ...evaluationCase, id: 'bad id' as never }] },
    { ...prompt, evaluationCases: [{ ...evaluationCase, id: 'constructor' as never }] },
    { ...prompt, evaluationCases: [evaluationCase, evaluationCase] },
    { ...prompt, evaluationCases: [{ ...evaluationCase, checks: {} }] },
    { ...prompt, evaluationCases: [{ ...evaluationCase, checks: { expectedSubstrings: Array.from({ length: 17 }, () => 'check') } }] },
    { ...prompt, evaluationCases: [{ ...evaluationCase, checks: { expectedSubstrings: [' '] } }] },
    { ...prompt, evaluationCases: [{ ...evaluationCase, checks: { expectedSubstrings: ['x'.repeat(1001)] } }] },
    { ...prompt, evaluationCases: [{ ...evaluationCase, variables: { value: 'x'.repeat(65_536) } }] },
  ]
  for (const request of invalid) {
    await expect(f.projects.savePrompt(project.id, project.version, request)).rejects.toThrow()
    expect((await f.projects.get(project.id))?.version).toBe(project.version)
  }
  project = await f.projects.savePrompt(project.id, project.version, { ...prompt, examples: [example], evaluationCases: [evaluationCase] })
  const promptId = project.prompts[0]!.id
  await expect(f.projects.savePrompt(project.id, project.version, { ...prompt, promptId, name: 'Renamed' })).rejects.toThrow('immutable')
  await expect(f.projects.savePrompt(project.id, project.version, prompt)).rejects.toThrow('already has')
  await expect(f.projects.renderPrompt(project.id, ProjectPromptId('unknown'), 1, {})).rejects.toThrow('unknown prompt')
  await expect(f.projects.renderPrompt(project.id, promptId, 2, {})).rejects.toThrow('no revision')
  await expect(f.projects.renderPrompt(project.id, promptId, 1, {})).rejects.toThrow('required')
  await expect(f.projects.renderPrompt(project.id, promptId, 1, { value: 9 })).rejects.toThrow('must be string')
  await expect(f.projects.renderPrompt(project.id, promptId, 1, { value: 'ok', extra: true })).rejects.toThrow('not declared')
  project = await f.projects.savePrompt(project.id, project.version, {
    ...prompt, promptId, evaluationCases: [{ ...evaluationCase, id: 'new-case' as never }],
  })
  expect(projectRecord.parse(project)).toEqual(project)
  project = await f.projects.savePrompt(project.id, project.version, {
    name: 'optional', template: 'Fixed', variablesSchema: { unused: { type: 'boolean', required: false }, number: { type: 'number', required: false } }, sourceSkills: [],
  })
  const optional = project.prompts.at(-1)!.id
  expect((await f.projects.renderPrompt(project.id, optional, 1, {})).renderedPrompt).toBe('Fixed')
  expect((await f.projects.renderPrompt(project.id, optional, 1, { number: 1, unused: false })).renderedPrompt).toBe('Fixed')
  project = await f.projects.savePrompt(project.id, project.version, {
    name: 'json', template: '{{json}}', variablesSchema: { json: { type: 'json', required: false } }, sourceSkills: [],
  })
  const jsonId = project.prompts.at(-1)!.id
  await expect(f.projects.renderPrompt(project.id, jsonId, 1, {})).rejects.toThrow('not supplied')
  expect((await f.projects.renderPrompt(project.id, jsonId, 1, { json: [1, null, true] })).renderedPrompt).toBe('[1,null,true]')
  for (let revision = 2; revision <= 100; revision++) project = await f.projects.savePrompt(project.id, project.version, {
    ...prompt, promptId: optional, name: 'optional',
  })
  await expect(f.projects.savePrompt(project.id, project.version, { ...prompt, promptId: optional, name: 'optional' })).rejects.toThrow('revision limit')
}, 30_000)

it('checks task provenance against current workspace and immutable prompt identity', async () => {
  const f = await setup()
  let project = await f.projects.create({ workspaceId: f.workspaceId, name: 'Tasks' })
  project = await f.projects.savePrompt(project.id, project.version, { ...prompt, template: 'Fixed', variablesSchema: {} })
  const promptRef = { promptId: project.prompts[0]!.id, revision: 1 }
  project = await f.projects.savePlan(project.id, project.version, { summary: 'Plan', items: [item('a'), item('b')] })
  const update = { planRevision: 1, itemId: 'a' as PlanItemId, state: 'running' as const, execution: { sessionId: f.parent, prompt: promptRef } }
  await expect(f.projects.updateTask(project.id, project.version, update)).rejects.toThrow('approved')
  project = await f.projects.approvePlan(project.id, project.version, 1)
  await expect(f.projects.updateTask(project.id, project.version, { ...update, itemId: 'unknown' as PlanItemId })).rejects.toThrow('no task')
  await expect(f.projects.updateTask(project.id, project.version, { planRevision: 1, itemId: 'a' as PlanItemId, state: 'pending' })).rejects.toThrow('cannot transition')
  await expect(f.projects.updateTask(project.id, project.version, { planRevision: 1, itemId: 'a' as PlanItemId, state: 'running' })).rejects.toThrow('execution')
  await expect(f.projects.updateTask(project.id, project.version, { ...update, execution: { ...update.execution, prompt: { promptId: ProjectPromptId('missing'), revision: 1 } } })).rejects.toThrow('unknown prompt')
  await expect(f.projects.updateTask(project.id, project.version, { ...update, execution: { ...update.execution, prompt: { ...promptRef, revision: 2 } } })).rejects.toThrow('no revision')
  f.registry.get.mockReturnValueOnce(undefined)
  await expect(f.projects.updateTask(project.id, project.version, update)).rejects.toThrow('no longer registered')
  f.workspace.sessionIds.splice(0, 1)
  await expect(f.projects.updateTask(project.id, project.version, update)).rejects.toThrow('not attached')
  f.workspace.sessionIds.push(f.parent)
  f.headers[0] = { id: f.parent, version: 0, createdAt: 0 }
  await expect(f.projects.updateTask(project.id, project.version, update)).rejects.toThrow('no cwd')
  f.headers[0] = { id: f.parent, version: 0, createdAt: 0, cwd: join(f.root, 'missing') }
  await expect(f.projects.updateTask(project.id, project.version, update)).rejects.toThrow('unavailable')
  f.headers[0] = { id: f.parent, version: 0, createdAt: 0, cwd: f.root }
  project = await f.projects.updateTask(project.id, project.version, update)
  await expect(f.projects.updateTask(project.id, project.version, { planRevision: 1, itemId: 'a' as PlanItemId, state: 'verified', evidence: [' '] })).rejects.toThrow('non-empty evidence')
  project = await f.projects.updateTask(project.id, project.version, {
    planRevision: 1, itemId: 'a' as PlanItemId, state: 'failed', result: { reason: 'test' },
  })
  project = await f.projects.updateTask(project.id, project.version, update)
  project = await f.projects.updateTask(project.id, project.version, {
    planRevision: 1, itemId: 'a' as PlanItemId, state: 'verified', evidence: ['passed'],
  })
  expect(projectRecord.parse(project)).toEqual(project)
})

it('validates workflow identity, ceilings, driver pairs, and unknown ledger references', async () => {
  const f = await setup({ maxActiveRuns: 4, maxStepsPerRun: 8, maxRunDurationMs: 10_000 })
  let project = await f.projects.create({ workspaceId: f.workspaceId, name: 'Workflow' })
  project = await f.projects.saveWorkflow(project.id, project.version, { name: 'Workflow', steps: [step('a'), step('b', ['a'])] })
  const workflowId = project.workflows[0]!.id
  await expect(f.projects.saveWorkflow(project.id, project.version, { workflowId, name: 'Renamed', steps: [step('a')] })).rejects.toThrow('immutable')
  await expect(f.projects.saveWorkflow(project.id, project.version, { name: 'Workflow', steps: [step('a')] })).rejects.toThrow('already has')
  await expect(f.projects.saveWorkflow(project.id, project.version, { name: 'Bad variables', steps: [{ ...step('a'), variables: {} }] })).rejects.toThrow('require a prompt')
  const start = { workflowId, workflowRevision: 1, input: null }
  await expect(f.projects.startWorkflowRun(project.id, project.version, { ...start, planRevision: 1 })).rejects.toThrow('together')
  await expect(f.projects.startWorkflowRun(project.id, project.version, { ...start, parentSessionId: f.parent })).rejects.toThrow('together')
  await expect(f.projects.startWorkflowRun(project.id, project.version, { ...start, planRevision: 1, parentSessionId: f.parent })).rejects.toThrow('approved')
  await expect(f.projects.startWorkflowRun(project.id, project.version, { ...start, maxSteps: 9 })).rejects.toThrow('ceiling')
  await expect(f.projects.startWorkflowRun(project.id, project.version, { ...start, maxDurationMs: 10_001 })).rejects.toThrow('ceiling')
  await expect(f.projects.startWorkflowRun(project.id, project.version, { ...start, workflowId: ProjectWorkflowId('unknown') })).rejects.toThrow('unknown workflow')
  await expect(f.projects.startWorkflowRun(project.id, project.version, { ...start, workflowRevision: 2 })).rejects.toThrow('no revision')
  const unknown = ProjectWorkflowRunId('unknown')
  await expect(f.projects.claimWorkflowStep(project.id, project.version, unknown)).rejects.toThrow('unknown workflow')
  await expect(f.projects.interruptWorkflowRun(project.id, project.version, { runId: unknown, reason: 'Stop' })).rejects.toThrow('unknown workflow')
  await expect(f.projects.resumeWorkflowRun(project.id, project.version, { runId: unknown, maxSteps: 2 })).rejects.toThrow('unknown workflow')
  await expect(f.projects.reconcileWorkflowRun(project.id, project.version, { runId: unknown, state: 'pending' })).rejects.toThrow('unknown workflow')
  await expect(f.projects.settleWorkflowStep(project.id, project.version, { runId: unknown, stepId: 'a' as ProjectWorkflowStepId, state: 'completed', result: null })).rejects.toThrow('unknown workflow')
  project = await f.projects.startWorkflowRun(project.id, project.version, start)
  const run = project.runs[0]!
  await expect(f.projects.attachWorkflowStepSession(project.id, project.version, { runId: run.id, stepId: 'a' as ProjectWorkflowStepId, sessionId: f.child })).rejects.toThrow('no pinned parent')
  await expect(f.projects.resumeWorkflowRun(project.id, project.version, { runId: run.id })).rejects.toThrow('budget increase')
  await expect(f.projects.resumeWorkflowRun(project.id, project.version, { runId: run.id, maxSteps: 2 })).rejects.toThrow('only a run failed')
  await expect(f.projects.reconcileWorkflowRun(project.id, project.version, { runId: run.id, state: 'pending' })).rejects.toThrow('not uncertain')
  await expect(f.projects.settleWorkflowStep(project.id, project.version, { runId: run.id, stepId: 'a' as ProjectWorkflowStepId, state: 'completed' })).rejects.toThrow('requires a result')
  await expect(f.projects.settleWorkflowStep(project.id, project.version, { runId: run.id, stepId: 'a' as ProjectWorkflowStepId, state: 'failed' })).rejects.toThrow('error')
  await expect(f.projects.settleWorkflowStep(project.id, project.version, { runId: run.id, stepId: 'missing' as ProjectWorkflowStepId, state: 'failed', error: 'Failed' })).rejects.toThrow('no step')
  await expect(f.projects.settleWorkflowStep(project.id, project.version, { runId: run.id, stepId: 'a' as ProjectWorkflowStepId, state: 'failed', error: 'Failed' })).rejects.toThrow('not running')
  project = (await f.projects.claimWorkflowStep(project.id, project.version, run.id)).project
  project = await f.projects.settleWorkflowStep(project.id, project.version, {
    runId: run.id, stepId: 'a' as ProjectWorkflowStepId, state: 'failed', error: 'Failed',
  })
  await expect(f.projects.claimWorkflowStep(project.id, project.version, run.id)).rejects.toThrow('already failed')
  await expect(f.projects.interruptWorkflowRun(project.id, project.version, { runId: run.id, reason: 'Stop' })).rejects.toThrow('not active')
  await expect(f.projects.settleWorkflowStep(project.id, project.version, { runId: run.id, stepId: 'a' as ProjectWorkflowStepId, state: 'failed', error: 'Again' })).rejects.toThrow('already failed')
  for (let revision = 2; revision <= 100; revision++) project = await f.projects.saveWorkflow(project.id, project.version, {
    workflowId, name: 'Workflow', steps: [step('a')],
  })
  await expect(f.projects.saveWorkflow(project.id, project.version, { workflowId, name: 'Workflow', steps: [step('a')] })).rejects.toThrow('revision limit')
}, 30_000)

it('enforces active project reservations on a budget decrease and on new runs', async () => {
  const f = await setup({ maxActiveRuns: 4 })
  let project = await f.projects.create({ workspaceId: f.workspaceId, name: 'Budget' })
  project = await f.projects.saveWorkflow(project.id, project.version, { name: 'Flow', steps: [step('a')] })
  const start = { workflowId: project.workflows[0]!.id, workflowRevision: 1, input: null }
  for (let i = 0; i < 2; i++) project = await f.projects.startWorkflowRun(project.id, project.version, start)
  await expect(f.projects.configureBudget(project.id, project.version, { ...project.budget, maxActiveRuns: 1 })).rejects.toThrow('below its active')
  project = await f.projects.configureBudget(project.id, project.version, { ...project.budget, maxActiveRuns: 2 })
  await expect(f.projects.startWorkflowRun(project.id, project.version, start)).rejects.toThrow('project active')
  project = await f.projects.interruptWorkflowRun(project.id, project.version, { runId: project.runs[0]!.id, reason: 'Stopped admission' })
  await expect(f.projects.claimWorkflowStep(project.id, project.version, project.runs[0]!.id)).rejects.toThrow('uncertain')
  await expect(f.projects.reconcileWorkflowRun(project.id, project.version, { runId: project.runs[0]!.id, state: 'failed' })).rejects.toThrow('error')
  project = await f.projects.reconcileWorkflowRun(project.id, project.version, {
    runId: project.runs[0]!.id, state: 'failed', error: 'Confirmed stop',
  })
  expect(project.runs[0]?.state).toBe('failed')
})

it('checks exact driver child ownership and rejects duplicate session attachment', async () => {
  const f = await setup()
  let project = await f.projects.create({ workspaceId: f.workspaceId, name: 'Driver' })
  project = await f.projects.savePlan(project.id, project.version, { summary: 'Plan', items: [item('a')] })
  project = await f.projects.approvePlan(project.id, project.version, 1)
  project = await f.projects.saveWorkflow(project.id, project.version, { name: 'Flow', steps: [step('a'), step('b', ['a'])] })
  project = await f.projects.startWorkflowRun(project.id, project.version, {
    workflowId: project.workflows[0]!.id, workflowRevision: 1, input: null, planRevision: 1, parentSessionId: f.parent,
  })
  const attach = { runId: project.runs[0]!.id, stepId: 'a' as ProjectWorkflowStepId, sessionId: f.child }
  await expect(f.projects.attachWorkflowStepSession(project.id, project.version, { ...attach, sessionId: f.parent })).rejects.toThrow('not a child')
  await expect(f.projects.attachWorkflowStepSession(project.id, project.version, attach)).rejects.toThrow('not running')
  project = (await f.projects.claimWorkflowStep(project.id, project.version, attach.runId)).project
  await expect(f.projects.attachWorkflowStepSession(project.id, project.version, { ...attach, stepId: 'missing' as ProjectWorkflowStepId })).rejects.toThrow('step is not running')
  await expect(f.projects.attachWorkflowStepSession(project.id, project.version, { ...attach, stepId: 'b' as ProjectWorkflowStepId })).rejects.toThrow('step is not running')
  await expect(f.projects.settleWorkflowStep(project.id, project.version, { ...attach, state: 'completed', result: 'done' })).rejects.toThrow('requires attached child')
  project = await f.projects.attachWorkflowStepSession(project.id, project.version, attach)
  await expect(f.projects.attachWorkflowStepSession(project.id, project.version, attach)).rejects.toThrow('already attached')
  project = await f.projects.settleWorkflowStep(project.id, project.version, { ...attach, state: 'completed', result: null })
  const next = await f.projects.claimWorkflowStep(project.id, project.version, attach.runId)
  expect(next.step?.input).toMatchObject({ dependencies: { a: null } })
  project = await f.projects.interruptWorkflowRun(project.id, next.project.version, { runId: attach.runId, reason: 'process stop' })
  project = await f.projects.reconcileWorkflowRun(project.id, project.version, { runId: attach.runId, state: 'pending' })
  expect(project.runs[0]?.steps.map(value => value.state)).toEqual(['completed', 'pending'])
})



it('rejects uninitialized service access and applies the same default limits in direct construction', async () => {
  const ctx = new Context(); contexts.push(ctx)
  const uninitialized = new ProjectService(ctx, {})
  await expect(uninitialized.list()).rejects.toThrow('not initialized')
})

it('checks prompt evaluation admission and deterministically scores missing or failed child output', async () => {
  const f = await setup({ maxActiveRuns: 4 })
  let project = await f.projects.create({ workspaceId: f.workspaceId, name: 'Evaluation contracts' })
  project = await f.projects.savePrompt(project.id, project.version, {
    ...prompt, evaluationCases: [evaluationCase, { ...evaluationCase, id: 'second' as never, checks: { validJson: false } }],
  })
  const promptId = project.prompts[0]!.id
  const start = { promptId, promptRevision: 1, planRevision: 1, parentSessionId: f.parent }
  await expect(f.projects.startPromptEvaluation(project.id, project.version, start)).rejects.toThrow('approved plan')
  project = await f.projects.savePlan(project.id, project.version, { summary: 'Evaluation', items: [item('a')] })
  project = await f.projects.approvePlan(project.id, project.version, 1)
  await expect(f.projects.startPromptEvaluation(project.id, project.version, { ...start, promptId: ProjectPromptId('unknown') })).rejects.toThrow('unknown prompt')
  await expect(f.projects.startPromptEvaluation(project.id, project.version, { ...start, maxDurationMs: 0 })).rejects.toThrow('positive safe integer')
  await expect(f.projects.startPromptEvaluation(project.id, project.version, { ...start, maxDurationMs: 3_600_001 })).rejects.toThrow('duration exceeds')
  project = await f.projects.configureBudget(project.id, project.version, { ...project.budget, maxStepsPerRun: 1 })
  await expect(f.projects.startPromptEvaluation(project.id, project.version, start)).rejects.toThrow('step ceiling')
  project = await f.projects.configureBudget(project.id, project.version, { ...project.budget, maxStepsPerRun: 100, maxActiveRuns: 1 })
  project = await f.projects.startPromptEvaluation(project.id, project.version, { ...start, maxDurationMs: 30_000 })
  let evaluation = project.evaluations[0]!
  await expect(f.projects.startPromptEvaluation(project.id, project.version, start)).rejects.toThrow('project active')
  await expect(f.projects.finalizePromptEvaluation(project.id, project.version, { evaluationId: ProjectPromptEvaluationId('unknown') })).rejects.toThrow('unknown prompt evaluation')
  await expect(f.projects.finalizePromptEvaluation(project.id, project.version, { evaluationId: evaluation.id })).rejects.toThrow('must be terminal')
  const claim = await f.projects.claimWorkflowStep(project.id, project.version, evaluation.runId)
  project = await f.projects.attachWorkflowStepSession(project.id, claim.project.version, {
    runId: evaluation.runId, stepId: claim.step!.stepId, sessionId: f.child,
  })
  project = await f.projects.settleWorkflowStep(project.id, project.version, {
    runId: evaluation.runId, stepId: claim.step!.stepId, state: 'failed', error: 'Model could not answer',
  })
  project = await f.projects.finalizePromptEvaluation(project.id, project.version, { evaluationId: evaluation.id })
  expect(project.evaluations[0]?.result).toMatchObject({ accepted: false, cases: [
    { accepted: false, tokens: null, expectedSubstringMatches: [null], error: 'Model could not answer' },
    { accepted: null, tokens: null, latencyMs: null, error: 'evaluation child output is unavailable' },
  ] })
  expect(projectRecord.parse(project)).toEqual(project)
  project = await f.projects.savePrompt(project.id, project.version, {
    name: 'No cases', template: 'Fixed', variablesSchema: {}, sourceSkills: [],
  })
  await expect(f.projects.startPromptEvaluation(project.id, project.version, { ...start, promptId: project.prompts.at(-1)!.id })).rejects.toThrow('no evaluation cases')
  for (let index = 1; index < 100; index++) {
    project = await f.projects.startPromptEvaluation(project.id, project.version, start)
    evaluation = project.evaluations.at(-1)!
    project = await f.projects.interruptWorkflowRun(project.id, project.version, {
      runId: evaluation.runId, reason: 'Operator ended evaluation',
    })
    project = await f.projects.reconcileWorkflowRun(project.id, project.version, {
      runId: evaluation.runId, state: 'failed', error: 'Confirmed no model invocation',
    })
  }
  await expect(f.projects.startPromptEvaluation(project.id, project.version, start)).rejects.toThrow('evaluation limit')
}, 30_000)

it('keeps acceptance and tokens explicit for every allowed generic child-result shape', async () => {
  const f = await setup()
  let project = await f.projects.create({ workspaceId: f.workspaceId, name: 'Result shapes' })
  const results = [
    null, 'plain result', [], {}, { output: false }, { output: 'ok', usage: null },
    { output: 'ok', usage: [] }, { output: 'ok', usage: { complete: true, tokens: -1 } },
    { output: 'ok', usage: { complete: true, tokens: 1.5 } }, { output: 'ok', usage: { complete: false, tokens: 8 } },
    { output: 'ok', usage: { complete: true, tokens: 0 } }, { output: '"ok"', usage: { complete: true, tokens: 2 } },
    { output: 'unexpected', usage: {} },
  ]
  project = await f.projects.savePrompt(project.id, project.version, {
    ...prompt, evaluationCases: results.map((_, index) => ({ ...evaluationCase, id: ('result-' + String(index)) as ProjectPromptEvaluationCaseId })),
  })
  project = await f.projects.savePlan(project.id, project.version, { summary: 'Results', items: [item('a')] })
  project = await f.projects.approvePlan(project.id, project.version, 1)
  project = await f.projects.startPromptEvaluation(project.id, project.version, {
    promptId: project.prompts[0]!.id, promptRevision: 1, planRevision: 1, parentSessionId: f.parent,
  })
  const evaluation = project.evaluations[0]!
  for (const result of results) {
    const claim = await f.projects.claimWorkflowStep(project.id, project.version, evaluation.runId)
    project = await f.projects.attachWorkflowStepSession(project.id, claim.project.version, {
      runId: evaluation.runId, stepId: claim.step!.stepId, sessionId: f.child,
    })
    project = await f.projects.settleWorkflowStep(project.id, project.version, {
      runId: evaluation.runId, stepId: claim.step!.stepId, state: 'completed', result,
    })
  }
  project = await f.projects.finalizePromptEvaluation(project.id, project.version, { evaluationId: evaluation.id })
  const cases = project.evaluations[0]!.result!.cases
  expect(cases.slice(0, 5).every(value => value.accepted === null)).toBe(true)
  expect(cases.slice(0, 10).every(value => value.tokens === null)).toBe(true)
  expect(cases[10]).toMatchObject({ accepted: true, tokens: 0, validJson: false })
  expect(cases[11]).toMatchObject({ accepted: true, tokens: 2, validJson: true })
  expect(cases[12]).toMatchObject({ accepted: false })
})

it('requires a meaningful bounded increase when resuming deadline and step-budget stops', async () => {
  const f = await setup({ maxActiveRuns: 2, maxStepsPerRun: 4, maxRunDurationMs: 1000 })
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_000)
  let project = await f.projects.create({ workspaceId: f.workspaceId, name: 'Resume contracts' })
  project = await f.projects.saveWorkflow(project.id, project.version, { name: 'Flow', steps: [step('a'), step('b', ['a'])] })
  const start = { workflowId: project.workflows[0]!.id, workflowRevision: 1, input: null }
  project = await f.projects.startWorkflowRun(project.id, project.version, { ...start, maxDurationMs: 10 })
  const runId = project.runs[0]!.id
  vi.setSystemTime(1_011)
  project = (await f.projects.claimWorkflowStep(project.id, project.version, runId)).project
  await expect(f.projects.resumeWorkflowRun(project.id, project.version, { runId, maxSteps: 4 })).rejects.toThrow('requires maxDurationMs')
  await expect(f.projects.resumeWorkflowRun(project.id, project.version, { runId, maxDurationMs: 0 })).rejects.toThrow('positive safe integer')
  await expect(f.projects.resumeWorkflowRun(project.id, project.version, { runId, maxDurationMs: 1001 })).rejects.toThrow('duration exceeds')
  await expect(f.projects.resumeWorkflowRun(project.id, project.version, { runId, maxSteps: 3, maxDurationMs: 20 })).rejects.toThrow('maxSteps must increase')
  vi.setSystemTime(1_000)
  await expect(f.projects.resumeWorkflowRun(project.id, project.version, { runId, maxDurationMs: 10 })).rejects.toThrow('budget increase')
  vi.setSystemTime(1_011)
  project = await f.projects.resumeWorkflowRun(project.id, project.version, { runId, maxDurationMs: 20 })
  expect(project.runs[0]).toMatchObject({ state: 'pending', deadlineAt: new Date(1031).toISOString() })
  project = await f.projects.startWorkflowRun(project.id, project.version, { ...start, maxSteps: 1 })
  const budgetId = project.runs[1]!.id
  const claim = await f.projects.claimWorkflowStep(project.id, project.version, budgetId)
  project = await f.projects.settleWorkflowStep(project.id, claim.project.version, {
    runId: budgetId, stepId: 'a' as ProjectWorkflowStepId, state: 'completed', result: null,
  })
  project = (await f.projects.claimWorkflowStep(project.id, project.version, budgetId)).project
  for (const request of [{ runId: budgetId, maxDurationMs: 20 }, { runId: budgetId, maxSteps: 1 }]) await expect(f.projects.resumeWorkflowRun(project.id, project.version, request)).rejects.toThrow('larger maxSteps')
  await expect(f.projects.resumeWorkflowRun(project.id, project.version, { runId: budgetId, maxSteps: 5 })).rejects.toThrow('project ceiling')
  let other = await f.projects.create({ workspaceId: f.workspaceId, name: 'Other reservations' })
  other = await f.projects.saveWorkflow(other.id, other.version, { name: 'Other flow', steps: [step('a')] })
  other = await f.projects.startWorkflowRun(other.id, other.version, {
    workflowId: other.workflows[0]!.id, workflowRevision: 1, input: null,
  })
  await expect(f.projects.resumeWorkflowRun(project.id, project.version, { runId: budgetId, maxSteps: 2 })).rejects.toThrow('host active')
})

it('recovers a running task and run together while preserving other committed states', async () => {
  const f = await setup()
  let project = await f.projects.create({ workspaceId: f.workspaceId, name: 'Recovery' })
  project = await f.projects.savePrompt(project.id, project.version, {
    name: 'Fixed', template: 'Fixed', variablesSchema: {}, sourceSkills: [],
  })
  const promptRef = { promptId: project.prompts[0]!.id, revision: 1 }
  project = await f.projects.savePlan(project.id, project.version, { summary: 'Plan', items: [item('a'), item('b')] })
  project = await f.projects.approvePlan(project.id, project.version, 1)
  project = await f.projects.updateTask(project.id, project.version, {
    planRevision: 1, itemId: 'a' as PlanItemId, state: 'running', execution: { sessionId: f.parent, prompt: promptRef },
  })
  await expect(f.projects.updateTask(project.id, project.version, { planRevision: 1, itemId: 'a' as PlanItemId, state: 'running' })).rejects.toThrow('requires a session')
  project = await f.projects.saveWorkflow(project.id, project.version, {
    name: 'Flow', steps: [{ ...step('a'), prompt: promptRef }, step('b', ['a'])],
  })
  const start = { workflowId: project.workflows[0]!.id, workflowRevision: 1, input: null }
  project = await f.projects.startWorkflowRun(project.id, project.version, start)
  project = await f.projects.startWorkflowRun(project.id, project.version, start)
  project = (await f.projects.claimWorkflowStep(project.id, project.version, project.runs[0]!.id)).project
  await f.ctx.fiber.dispose()
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(f.root, 'data') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  ctx.provide('workspaceRegistry', f.registry as unknown as WorkspaceRegistry)
  ctx.provide('sessionPersistence', f.persistence as unknown as SessionPersistence)
  await ctx.plugin(ProjectService)
  const restored = await ctx.projects.get(project.id)
  expect(restored?.tasks.map(task => task.state)).toEqual(['uncertain', 'pending'])
  expect(restored?.runs.map(run => run.state)).toEqual(['uncertain', 'pending'])
  expect(restored?.runs[0]?.steps.map(step => step.state)).toEqual(['uncertain', 'pending'])
})



function durableProjects(f: Awaited<ReturnType<typeof setup>>) {
  const domain = f.ctx.storageDomain.get('project') as unknown as StorageDomain.Domain<typeof projectDomainSpec>
  return domain.table('projects')
}

async function evaluationFixture(checks: typeof evaluationCase.checks | { validJson: boolean } = evaluationCase.checks) {
  const f = await setup()
  let project = await f.projects.create({ workspaceId: f.workspaceId, name: 'Durable evaluation' })
  project = await f.projects.savePlan(project.id, project.version, { summary: 'Evaluate', items: [item('a')] })
  project = await f.projects.approvePlan(project.id, project.version, 1)
  project = await f.projects.savePrompt(project.id, project.version, { ...prompt, evaluationCases: [{ ...evaluationCase, checks }] })
  project = await f.projects.startPromptEvaluation(project.id, project.version, {
    promptId: project.prompts[0]!.id, promptRevision: 1, planRevision: 1, parentSessionId: f.parent,
  })
  return { ...f, project, evaluation: project.evaluations[0]! }
}

it('retries a colliding generated project identity without overwriting its stored owner', async () => {
  const f = await setup()
  const existing = await f.projects.create({ workspaceId: f.workspaceId, name: 'Original owner' })
  const replacement = randomUUID()
  vi.mocked(randomUUID).mockReturnValueOnce(existing.id as ReturnType<typeof randomUUID>).mockReturnValueOnce(replacement)
  const created = await f.projects.create({ workspaceId: f.workspaceId, name: 'New owner' })
  expect(created.id).toBe(replacement)
  expect(await f.projects.get(existing.id)).toEqual(existing)
  expect(await f.projects.list()).toHaveLength(2)
})

it('reserves prompt evaluations against the host ceiling across distinct projects', async () => {
  const f = await setup({ maxActiveRuns: 1 })
  let occupied = await f.projects.create({ workspaceId: f.workspaceId, name: 'Reserved host capacity' })
  occupied = await f.projects.saveWorkflow(occupied.id, occupied.version, { name: 'Work', steps: [step('a')] })
  await f.projects.startWorkflowRun(occupied.id, occupied.version, {
    workflowId: occupied.workflows[0]!.id, workflowRevision: 1, input: null,
  })
  let target = await f.projects.create({ workspaceId: f.workspaceId, name: 'Evaluation project' })
  target = await f.projects.savePlan(target.id, target.version, { summary: 'Evaluate', items: [item('a')] })
  target = await f.projects.approvePlan(target.id, target.version, 1)
  target = await f.projects.savePrompt(target.id, target.version, { ...prompt, evaluationCases: [evaluationCase] })
  await expect(f.projects.startPromptEvaluation(target.id, target.version, {
    promptId: target.prompts[0]!.id, promptRevision: 1, planRevision: 1, parentSessionId: f.parent,
  })).rejects.toThrow('host active workflow run limit')
  expect(await f.projects.get(target.id)).toEqual(target)
})

it.each(['run', 'prompt', 'case', 'step'] as const)('refuses to fabricate scores for a persisted evaluation missing its %s reference', async (missing) => {
  const f = await evaluationFixture()
  const { project, evaluation } = f
  const terminal = { ...project, runs: project.runs.map(run => ({ ...run, state: 'failed' as const })) }
  const stored = missing === 'run' ? { ...terminal, runs: [] }
    : missing === 'prompt' ? { ...terminal, prompts: [] }
      : { ...terminal, evaluations: terminal.evaluations.map(value => ({ ...value, caseSteps: value.caseSteps.map(link => ({
        ...link,
        ...(missing === 'case' ? { caseId: 'missing' as typeof link.caseId } : { stepId: 'missing' as typeof link.stepId }),
      })) })) }
  // Fault injection crosses the actual durable schema boundary: shape-valid records can contain dangling references.
  await durableProjects(f).put(project.id, stored)
  await expect(f.projects.finalizePromptEvaluation(project.id, project.version, { evaluationId: evaluation.id }))
    .rejects.toThrow(missing === 'run' ? 'run is missing' : missing === 'prompt' ? 'revision is missing' : 'case mapping is invalid')
  expect(await f.projects.get(project.id)).toEqual(stored)
})

it('scores JSON-only cases without requiring substring checks', async () => {
  const f = await evaluationFixture({ validJson: true })
  const claim = await f.projects.claimWorkflowStep(f.project.id, f.project.version, f.evaluation.runId)
  let project = await f.projects.attachWorkflowStepSession(f.project.id, claim.project.version, {
    runId: f.evaluation.runId, stepId: claim.step!.stepId, sessionId: f.child,
  })
  project = await f.projects.settleWorkflowStep(project.id, project.version, {
    runId: f.evaluation.runId, stepId: claim.step!.stepId, state: 'completed', result: { output: '{"ok":true}' },
  })
  project = await f.projects.finalizePromptEvaluation(project.id, project.version, { evaluationId: f.evaluation.id })
  expect(project.evaluations[0]!.result).toMatchObject({
    accepted: true, cases: [{ accepted: true, validJson: true, expectedSubstringMatches: [] }],
  })
})

it('reports an explicit failure for a persisted failed child without error text', async () => {
  const f = await evaluationFixture()
  const stored = { ...f.project, runs: f.project.runs.map(run => ({
    ...run, state: 'failed' as const, steps: run.steps.map(value => ({ ...value, state: 'failed' as const })),
  })) }
  await durableProjects(f).put(stored.id, stored)
  const project = await f.projects.finalizePromptEvaluation(stored.id, stored.version, { evaluationId: f.evaluation.id })
  expect(project.evaluations[0]!.result).toMatchObject({ accepted: false, cases: [{ accepted: false, error: 'evaluation child failed' }] })
})

it.each(['completed', 'blocked'] as const)('does not relaunch persisted %s step snapshots with no dependency-ready work', async (state) => {
  const f = await setup()
  let project = await f.projects.create({ workspaceId: f.workspaceId, name: 'Resume snapshot' })
  project = await f.projects.saveWorkflow(project.id, project.version, { name: 'Work', steps: [step('a'), step('b', ['a'])] })
  project = await f.projects.startWorkflowRun(project.id, project.version, {
    workflowId: project.workflows[0]!.id, workflowRevision: 1, input: null,
  })
  const stored = { ...project, runs: project.runs.map(run => ({
    ...run, steps: run.steps.map((value, index) => ({ ...value, state: state === 'completed' ? 'completed' as const : index === 0 ? 'uncertain' as const : 'pending' as const })),
  })) }
  await durableProjects(f).put(stored.id, stored)
  const claim = await f.projects.claimWorkflowStep(stored.id, stored.version, stored.runs[0]!.id)
  expect(claim.step).toBeUndefined()
  expect(claim.project.runs[0]!.state).toBe(state === 'completed' ? 'completed' : 'pending')
  expect(claim.project.runs[0]!.steps).toEqual(stored.runs[0]!.steps)
  expect(claim.project.runs[0]!.launchedSteps).toBe(0)
})
