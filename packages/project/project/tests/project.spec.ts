import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import { SessionId } from '@arx-ai/arx-session'
import type { SessionHeader } from '@arx-ai/arx-session'
import type { SessionPersistence } from '@arx-ai/arx-session-persistence'
import Storage from '@arx-ai/arx-storage'
import * as StorageDomain from '@arx-ai/arx-storage-domain'
import * as StorageJson from '@arx-ai/arx-storage-json'
import { realpathNormalize, WorkspaceId } from '@arx-ai/arx-workspace'
import type { Workspace, WorkspaceRegistry } from '@arx-ai/arx-workspace'
import ProjectService, {
  ProjectConflictError,
  ProjectPromptId,
  ProjectWorkflowId,
} from '../src/index.ts'
import type {
  PlanItemId,
  ProjectRecord,
  ProjectPromptExampleId,
  ProjectPromptEvaluationCaseId,
  ProjectWorkflowStepId,
  SaveWorkflowRequest,
} from '../src/types.ts'

let temporaryRoots: string[] = []
let contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
  contexts = []
  for (const root of temporaryRoots.reverse()) await rm(root, { recursive: true, force: true })
  temporaryRoots = []
  vi.useRealTimers()
})

interface HarnessOptions {
  readonly storageRoot: string
  readonly workspacePath: string
  readonly headers?: readonly SessionHeader[]
  readonly maxActiveRuns?: number
  readonly maxStepsPerRun?: number
  readonly maxRunDurationMs?: number
}

async function harness(options: HarnessOptions) {
  const workspaceId = WorkspaceId('workspace-project-test')
  const headers = [...(options.headers ?? [])]
  const workspace: Workspace = {
    id: workspaceId,
    path: await realpathNormalize(options.workspacePath),
    title: 'Project test',
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
    sessionIds: headers.map(header => header.id),
    setTitle: async () => {},
    attachSession: async () => {},
    insertSessionBefore: async () => {},
    detachSession: async () => {},
    status: async () => 'ok',
  }
  const registry = ({ get: (id: typeof workspaceId) => id === workspaceId ? workspace : undefined } as unknown as WorkspaceRegistry)
  const persistence = { list: async () => [...headers] } as unknown as SessionPersistence

  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: options.storageRoot })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  ctx.provide('workspaceRegistry', registry)
  ctx.provide('sessionPersistence', persistence)
  await ctx.plugin(ProjectService, {
    maxActiveRuns: options.maxActiveRuns ?? 8,
    maxStepsPerRun: options.maxStepsPerRun ?? 100,
    maxRunDurationMs: options.maxRunDurationMs ?? 3_600_000,
  })
  expect(ctx.get('projects')).toBeDefined()
  return { ctx, workspaceId }
}

async function roots() {
  const storageRoot = await mkdtemp(join(tmpdir(), 'arx-project-storage-'))
  const workspacePath = await mkdtemp(join(tmpdir(), 'arx-project-workspace-'))
  temporaryRoots.push(storageRoot, workspacePath)
  return { storageRoot, workspacePath }
}

function item(id: string) {
  return {
    id: id as PlanItemId,
    title: `Implement ${id}`,
    acceptanceCriteria: [`${id} is verified`],
    dependsOn: [],
  }
}

const workflow: SaveWorkflowRequest = {
  name: 'ship',
  steps: [
    { id: 'build' as ProjectWorkflowStepId, name: 'Build', dependsOn: [] },
    { id: 'verify' as ProjectWorkflowStepId, name: 'Verify', dependsOn: ['build' as ProjectWorkflowStepId] },
  ],
}

it.each([999, 1000, 1001])('settles a claimed step at %i ms against the durable deadline', async (elapsed) => {
  const paths = await roots()
  const f = await harness({ ...paths, maxActiveRuns: 1 })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(10_000)
  let project = await f.ctx.projects.create({ workspaceId: f.workspaceId, name: 'Settlement deadline' })
  project = await f.ctx.projects.saveWorkflow(project.id, project.version, {
    name: 'One step', steps: [workflow.steps[0]!],
  })
  const start = { workflowId: project.workflows[0]!.id, workflowRevision: 1, input: null, maxDurationMs: 1000, maxSteps: 1 }
  project = await f.ctx.projects.startWorkflowRun(project.id, project.version, start)
  const runId = project.runs[0]!.id
  const claim = await f.ctx.projects.claimWorkflowStep(project.id, project.version, runId)
  const settlement = { runId, stepId: claim.step!.stepId, state: 'completed' as const, result: { delivered: true } }
  vi.setSystemTime(10_000 + elapsed)
  await expect(f.ctx.projects.settleWorkflowStep(project.id, project.version, settlement)).rejects.toBeInstanceOf(ProjectConflictError)
  expect(await f.ctx.projects.get(project.id)).toEqual(claim.project)
  project = await f.ctx.projects.settleWorkflowStep(project.id, claim.project.version, settlement)
  const expired = elapsed >= 1000
  const settled = project.runs[0]!
  expect(settled).toMatchObject({
    state: expired ? 'failed' : 'completed', finishedAt: new Date(10_000 + elapsed).toISOString(), launchedSteps: 1,
    steps: [{ state: 'completed', attempt: 1, result: { delivered: true } }],
  })
  expect(settled.error).toBe(expired ? 'workflow run deadline elapsed' : undefined)
  await f.ctx.fiber.dispose()
  const reloaded = await harness({ ...paths, maxActiveRuns: 1 })
  expect(await reloaded.ctx.projects.get(project.id)).toEqual(project)
  if (expired) {
    project = await reloaded.ctx.projects.resumeWorkflowRun(project.id, project.version, { runId, maxDurationMs: 1000 })
    const resumed = await reloaded.ctx.projects.claimWorkflowStep(project.id, project.version, runId)
    expect(resumed.step).toBeUndefined()
    project = resumed.project
    expect(project.runs[0]).toMatchObject({ state: 'completed', launchedSteps: 1, maxSteps: 1 })
  }
  project = await reloaded.ctx.projects.startWorkflowRun(project.id, project.version, start)
  expect(project.runs[1]?.state).toBe('pending')
  await expect(reloaded.ctx.projects.settleWorkflowStep(project.id, project.version, settlement)).rejects.toThrow('already completed')
})
it('retains a late completed step across an explicit budget increase without launching its dependency early', async () => {
  const paths = await roots()
  const f = await harness(paths)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(20_000)
  let project = await f.ctx.projects.create({ workspaceId: f.workspaceId, name: 'Resume late settlement' })
  project = await f.ctx.projects.saveWorkflow(project.id, project.version, workflow)
  project = await f.ctx.projects.startWorkflowRun(project.id, project.version, {
    workflowId: project.workflows[0]!.id, workflowRevision: 1, input: null, maxDurationMs: 1000,
  })
  const runId = project.runs[0]!.id
  const claim = await f.ctx.projects.claimWorkflowStep(project.id, project.version, runId)
  vi.setSystemTime(21_000)
  project = await f.ctx.projects.settleWorkflowStep(project.id, claim.project.version, {
    runId, stepId: claim.step!.stepId, state: 'completed', result: 'built',
  })
  expect(project.runs[0]).toMatchObject({ state: 'failed', steps: [{ state: 'completed' }, { state: 'pending' }] })
  await expect(f.ctx.projects.claimWorkflowStep(project.id, project.version, runId)).rejects.toThrow('already failed')
  project = await f.ctx.projects.resumeWorkflowRun(project.id, project.version, { runId, maxDurationMs: 1000 })
  const next = await f.ctx.projects.claimWorkflowStep(project.id, project.version, runId)
  expect(next.step).toMatchObject({ stepId: 'verify', attempt: 1, input: { dependencies: { build: 'built' } } })
  expect(next.project.runs[0]).toMatchObject({ launchedSteps: 2, steps: [{ stepId: 'build', state: 'completed', attempt: 1 }, { stepId: 'verify', state: 'running', attempt: 1 }] })
})
describe('project aggregate over the JSON storage backend', () => {
  it('commits one concurrent CAS mutation and rejects invalid task writes without publication', async () => {
    const paths = await roots()
    const knownSession = SessionId('project-known-session')
    const header: SessionHeader = {
      version: 0,
      id: knownSession,
      createdAt: Date.parse('2026-09-12T00:00:00.000Z'),
      cwd: paths.workspacePath,
    }
    const { ctx, workspaceId } = await harness({ ...paths, headers: [header] })
    const changed: ProjectRecord[] = []
    ctx.on('projects/changed', (project) => { changed.push(project) })

    const created = await ctx.projects.create({ workspaceId, name: 'Harness project' })
    ;(created as { name: string }).name = 'borrowed mutation'
    expect((await ctx.projects.get(created.id))?.name).toBe('Harness project')

    const withPrompt = await ctx.projects.savePrompt(created.id, 1, {
      name: 'implement',
      template: 'Implement {{task}}',
      variablesSchema: { task: { type: 'string', required: true } },
      sourceSkills: [{
        repository: 'https://example.test/skills.git',
        commit: '0123456789abcdef',
        path: 'skills/architecture/SKILL.md',
        content: '# Architecture\nUse atomic writes.\n',
      }],
    })
    const promptId = withPrompt.prompts[0]?.id
    if (promptId === undefined) throw new Error('expected prompt id')

    const beforeBounds = await readFile(join(paths.storageRoot, 'project.json'), 'utf8')
    await expect(ctx.projects.savePlan(created.id, 2, {
      summary: 'too many items',
      items: Array.from({ length: 1_001 }, (_, index) => item(`item-${index}`)),
    })).rejects.toThrow('plan exceeds 1000 items')
    await expect(ctx.projects.savePrompt(created.id, 2, {
      name: 'oversized',
      template: 'x'.repeat(100_001),
      variablesSchema: {},
      sourceSkills: [],
    })).rejects.toThrow('prompt template exceeds 100000 characters')
    await expect(ctx.projects.savePrompt(created.id, 2, {
      name: 'unsafe-variable',
      template: 'Unsafe',
      variablesSchema: { constructor: { type: 'string' as const, required: false } },
      sourceSkills: [],
    })).rejects.toThrow("invalid prompt variable name 'constructor'")
    await expect(ctx.projects.savePlan(created.id, 2, {
      summary: 'unsafe graph id',
      items: [item('constructor')],
    })).rejects.toThrow('contains unsafe id')
    await expect(ctx.projects.saveWorkflow(created.id, 2, {
      name: 'invalid prompt input',
      steps: [{
        id: 'invalid-input' as ProjectWorkflowStepId,
        name: 'Invalid input',
        dependsOn: [],
        prompt: { promptId, revision: 1 },
        variables: { task: 7 },
      }],
    })).rejects.toThrow("prompt variable 'task' must be string")
    await expect(ctx.projects.renderPrompt(created.id, ProjectPromptId(promptId), 1, {
      task: 'valid',
      extra: 'undeclared',
    })).rejects.toThrow("prompt variable 'extra' is not declared")
    await expect(ctx.projects.renderPrompt(
      created.id,
      ProjectPromptId(promptId),
      1,
      JSON.parse('{"task":"valid","__proto__":"unsafe"}') as Record<string, string>,
    )).rejects.toThrow("prompt variable '__proto__' is not declared")
    expect(await readFile(join(paths.storageRoot, 'project.json'), 'utf8')).toBe(beforeBounds)
    expect(changed).toHaveLength(2)
    const attempts = await Promise.allSettled([
      ctx.projects.savePlan(created.id, 2, { summary: 'first writer', items: [item('task-a')] }),
      ctx.projects.savePlan(created.id, 2, { summary: 'second writer', items: [item('task-a')] }),
    ])
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = attempts.find(result => result.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(ProjectConflictError)
    let project = await ctx.projects.get(created.id)
    if (project === undefined) throw new Error('expected project')
    expect(project.version).toBe(3)
    expect(project.plans).toHaveLength(1)
    expect(changed).toHaveLength(3)

    project = await ctx.projects.approvePlan(project.id, project.version, 1)
    const storagePath = join(paths.storageRoot, 'project.json')
    const beforeUnknown = await readFile(storagePath, 'utf8')
    await expect(ctx.projects.updateTask(project.id, project.version, {
      planRevision: 1,
      itemId: 'task-a' as PlanItemId,
      state: 'running',
      execution: {
        sessionId: SessionId('missing-session'),
        prompt: { promptId, revision: 1 },
      },
    })).rejects.toThrow("unknown task session 'missing-session'")
    expect(await readFile(storagePath, 'utf8')).toBe(beforeUnknown)
    expect(changed).toHaveLength(4)

    project = await ctx.projects.updateTask(project.id, project.version, {
      planRevision: 1,
      itemId: 'task-a' as PlanItemId,
      state: 'running',
      execution: { sessionId: knownSession, prompt: { promptId, revision: 1 } },
    })
    const beforeForgedExecution = await readFile(storagePath, 'utf8')
    await expect(ctx.projects.updateTask(project.id, project.version, {
      planRevision: 1,
      itemId: 'task-a' as PlanItemId,
      state: 'failed',
      execution: { sessionId: SessionId('forged-session'), prompt: { promptId, revision: 1 } },
    })).rejects.toThrow('provenance can only be set when entering running')
    expect(await readFile(storagePath, 'utf8')).toBe(beforeForgedExecution)

    const beforeEvidence = await readFile(storagePath, 'utf8')
    await expect(ctx.projects.updateTask(project.id, project.version, {
      planRevision: 1,
      itemId: 'task-a' as PlanItemId,
      state: 'verified',
    })).rejects.toThrow('requires non-empty evidence')
    expect(await readFile(storagePath, 'utf8')).toBe(beforeEvidence)
    expect((await ctx.projects.get(project.id))?.version).toBe(project.version)

    project = await ctx.projects.updateTask(project.id, project.version, {
      planRevision: 1,
      itemId: 'task-a' as PlanItemId,
      state: 'verified',
      evidence: ['Focused integration test passed'],
      result: { tests: 1 },
    })
    expect(project.tasks.find(task => task.itemId === 'task-a')).toMatchObject({
      state: 'verified',
      evidence: ['Focused integration test passed'],
      execution: { sessionId: knownSession, prompt: { promptId, revision: 1 } },
    })

    const rendered = await ctx.projects.renderPrompt(project.id, ProjectPromptId(promptId), 1, { task: 'the project service' })
    expect(rendered.renderedPrompt).toBe('Implement the project service')
    expect(rendered.sourceSkills[0]?.content).toContain('Use atomic writes.')
    expect(rendered.sourceSkills[0]?.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('keeps uncertain restart reservations and enforces shared, launch, and deadline ceilings', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'))
    const paths = await roots()
    let first = await harness({
      ...paths,
      maxActiveRuns: 1,
      maxStepsPerRun: 3,
      maxRunDurationMs: 1_000,
    })
    let alpha = await first.ctx.projects.create({ workspaceId: first.workspaceId, name: 'Alpha' })
    alpha = await first.ctx.projects.saveWorkflow(alpha.id, alpha.version, workflow)
    let beta = await first.ctx.projects.create({ workspaceId: first.workspaceId, name: 'Beta' })
    beta = await first.ctx.projects.saveWorkflow(beta.id, beta.version, workflow)
    const workflowId = alpha.workflows[0]?.id
    if (workflowId === undefined) throw new Error('expected workflow id')
    alpha = await first.ctx.projects.startWorkflowRun(alpha.id, alpha.version, {
      workflowId,
      workflowRevision: 1,
      input: { target: 'alpha' },
      maxSteps: 3,
      maxDurationMs: 1_000,
    })
    const runId = alpha.runs[0]?.id
    if (runId === undefined) throw new Error('expected run id')
    const claimed = await first.ctx.projects.claimWorkflowStep(alpha.id, alpha.version, runId)
    expect(claimed.step).toMatchObject({ stepId: 'build', state: 'running', attempt: 1 })
    const beforeConcurrentClaim = await readFile(join(paths.storageRoot, 'project.json'), 'utf8')
    await expect(first.ctx.projects.claimWorkflowStep(alpha.id, claimed.project.version, runId))
      .rejects.toThrow('already has a running step')
    expect(await readFile(join(paths.storageRoot, 'project.json'), 'utf8')).toBe(beforeConcurrentClaim)

    await first.ctx.fiber.dispose()
    contexts = contexts.filter(ctx => ctx !== first.ctx)
    first = await harness({
      ...paths,
      maxActiveRuns: 1,
      maxStepsPerRun: 3,
      maxRunDurationMs: 1_000,
    })
    alpha = await first.ctx.projects.get(alpha.id) as ProjectRecord
    beta = await first.ctx.projects.get(beta.id) as ProjectRecord
    expect(alpha.runs[0]?.state).toBe('uncertain')
    expect(alpha.runs[0]?.steps[0]).toMatchObject({ state: 'uncertain', attempt: 1 })
    expect(alpha.version).toBe(claimed.project.version + 1)

    const beforeReservationFailure = await readFile(join(paths.storageRoot, 'project.json'), 'utf8')
    await expect(first.ctx.projects.startWorkflowRun(beta.id, beta.version, {
      workflowId: ProjectWorkflowId(beta.workflows[0]!.id),
      workflowRevision: 1,
      input: null,
    })).rejects.toThrow('active workflow run limit reached')
    expect(await readFile(join(paths.storageRoot, 'project.json'), 'utf8')).toBe(beforeReservationFailure)

    alpha = await first.ctx.projects.reconcileWorkflowRun(alpha.id, alpha.version, {
      runId,
      state: 'pending',
    })
    const reclaimed = await first.ctx.projects.claimWorkflowStep(alpha.id, alpha.version, runId)
    expect(reclaimed.step).toMatchObject({ stepId: 'build', attempt: 2, state: 'running' })
    alpha = await first.ctx.projects.settleWorkflowStep(alpha.id, reclaimed.project.version, {
      runId,
      stepId: 'build' as ProjectWorkflowStepId,
      state: 'failed',
      error: 'explicitly reconciled failure',
    })
    expect(alpha.runs[0]?.state).toBe('failed')

    beta = await first.ctx.projects.startWorkflowRun(beta.id, beta.version, {
      workflowId: ProjectWorkflowId(beta.workflows[0]!.id),
      workflowRevision: 1,
      input: null,
      maxSteps: 1,
      maxDurationMs: 1_000,
    })
    const betaRun = beta.runs[0]!
    let betaClaim = await first.ctx.projects.claimWorkflowStep(beta.id, beta.version, betaRun.id)
    beta = await first.ctx.projects.settleWorkflowStep(beta.id, betaClaim.project.version, {
      runId: betaRun.id,
      stepId: 'build' as ProjectWorkflowStepId,
      state: 'completed',
      result: { artifact: 'ok' },
    })
    betaClaim = await first.ctx.projects.claimWorkflowStep(beta.id, beta.version, betaRun.id)
    expect(betaClaim.step).toBeUndefined()
    expect(betaClaim.project.runs[0]).toMatchObject({ state: 'failed', error: 'workflow run step budget exhausted' })

    beta = await first.ctx.projects.startWorkflowRun(beta.id, betaClaim.project.version, {
      workflowId: ProjectWorkflowId(beta.workflows[0]!.id),
      workflowRevision: 1,
      input: null,
      maxDurationMs: 10,
    })
    const deadlineRun = beta.runs[1]!
    vi.advanceTimersByTime(11)
    const afterDeadline = await first.ctx.projects.claimWorkflowStep(beta.id, beta.version, deadlineRun.id)
    expect(afterDeadline.step).toBeUndefined()
    expect(afterDeadline.project.runs[1]).toMatchObject({ state: 'failed', error: 'workflow run deadline elapsed' })
  })
  it('pins driver provenance, enforces child lineage, and resumes only service budget failures', async () => {
    const paths = await roots()
    const parent = SessionId('workflow-parent')
    const child = SessionId('workflow-child')
    const stranger = SessionId('workflow-stranger')
    const headers: SessionHeader[] = [
      { version: 0, id: parent, createdAt: 1, cwd: paths.workspacePath },
      { version: 0, id: child, createdAt: 2, cwd: paths.workspacePath, parentSession: parent, origin: 'subagent' },
      { version: 0, id: stranger, createdAt: 3, cwd: paths.workspacePath },
    ]
    const { ctx, workspaceId } = await harness({ ...paths, headers, maxActiveRuns: 3, maxStepsPerRun: 3, maxRunDurationMs: 10_000 })
    let project = await ctx.projects.create({ workspaceId, name: 'Driven project' })
    project = await ctx.projects.savePrompt(project.id, project.version, {
      name: 'step', template: 'Run {{target}}', variablesSchema: { target: { type: 'string', required: true } }, sourceSkills: [],
    })
    const promptId = project.prompts[0]!.id
    project = await ctx.projects.savePlan(project.id, project.version, { summary: 'approved', items: [item('work')] })
    project = await ctx.projects.approvePlan(project.id, project.version, 1)
    project = await ctx.projects.saveWorkflow(project.id, project.version, {
      name: 'driven',
      steps: [
        { id: 'first' as ProjectWorkflowStepId, name: 'First', dependsOn: [], prompt: { promptId, revision: 1 }, variables: { target: 'first' } },
        { id: 'second' as ProjectWorkflowStepId, name: 'Second', dependsOn: ['first' as ProjectWorkflowStepId], prompt: { promptId, revision: 1 }, variables: { target: 'second' } },
      ],
    })
    const beforeInvalidBudget = await readFile(join(paths.storageRoot, 'project.json'), 'utf8')
    await expect(ctx.projects.configureBudget(project.id, project.version, {
      maxActiveRuns: 4, maxStepsPerRun: 2, maxRunDurationMs: 1_000,
    }))
      .rejects.toThrow('host safety ceiling')
    expect(await readFile(join(paths.storageRoot, 'project.json'), 'utf8')).toBe(beforeInvalidBudget)
    project = await ctx.projects.configureBudget(project.id, project.version, {
      maxActiveRuns: 1, maxStepsPerRun: 2, maxRunDurationMs: 1_000,
    })
    const workflowId = project.workflows[0]!.id
    project = await ctx.projects.startWorkflowRun(project.id, project.version, {
      workflowId, workflowRevision: 1, input: null, planRevision: 1, parentSessionId: parent, maxSteps: 1,
    })
    const runId = project.runs[0]!.id
    expect(project.runs[0]).toMatchObject({ planRevision: 1, parentSessionId: parent, maxSteps: 1 })
    project = await ctx.projects.savePlan(project.id, project.version, { summary: 'new plan', items: [item('later')] })
    project = await ctx.projects.approvePlan(project.id, project.version, 2)
    expect(project.runs[0]?.planRevision).toBe(1)
    let other = await ctx.projects.create({ workspaceId, name: 'Independent budget' })
    other = await ctx.projects.saveWorkflow(other.id, other.version, workflow)
    other = await ctx.projects.startWorkflowRun(other.id, other.version, {
      workflowId: other.workflows[0]!.id, workflowRevision: 1, input: null,
    })
    expect(other.runs[0]?.state).toBe('pending')
    const claim = await ctx.projects.claimWorkflowStep(project.id, project.version, runId)
    await expect(ctx.projects.attachWorkflowStepSession(project.id, claim.project.version, {
      runId, stepId: 'first' as ProjectWorkflowStepId, sessionId: stranger,
    })).rejects.toThrow('not a child')
    project = await ctx.projects.attachWorkflowStepSession(project.id, claim.project.version, {
      runId, stepId: 'first' as ProjectWorkflowStepId, sessionId: child,
    })
    expect(project.runs[0]?.steps[0]?.sessionId).toBe(child)
    project = await ctx.projects.settleWorkflowStep(project.id, project.version, {
      runId, stepId: 'first' as ProjectWorkflowStepId, state: 'completed', result: { ok: true },
    })
    const exhausted = await ctx.projects.claimWorkflowStep(project.id, project.version, runId)
    expect(exhausted.project.runs[0]).toMatchObject({ state: 'failed', error: 'workflow run step budget exhausted' })
    project = await ctx.projects.resumeWorkflowRun(project.id, exhausted.project.version, { runId, maxSteps: 2 })
    expect(project.runs[0]).toMatchObject({ state: 'pending', maxSteps: 2 })
    expect(project.runs[0]?.steps[0]).toMatchObject({ state: 'completed', sessionId: child })
    const second = await ctx.projects.claimWorkflowStep(project.id, project.version, runId)
    expect(second.step).toMatchObject({ stepId: 'second', state: 'running' })
    project = await ctx.projects.interruptWorkflowRun(project.id, second.project.version, { runId, reason: 'runner shutdown' })
    expect(project.runs[0]).toMatchObject({ state: 'uncertain', error: 'runner shutdown' })
    expect(project.runs[0]?.steps[1]).toMatchObject({ state: 'uncertain' })
  })
  it('evaluates exact prompt revisions through the ordinary run ledger with comparable bounded results', async () => {
    const paths = await roots()
    const parent = SessionId('evaluation-parent')
    const firstChild = SessionId('evaluation-child-first')
    const secondChild = SessionId('evaluation-child-second')
    const headers: SessionHeader[] = [
      { version: 0, id: parent, createdAt: 1, cwd: paths.workspacePath },
      { version: 0, id: firstChild, createdAt: 2, cwd: paths.workspacePath, parentSession: parent, origin: 'subagent' },
      { version: 0, id: secondChild, createdAt: 3, cwd: paths.workspacePath, parentSession: parent, origin: 'subagent' },
    ]
    const { ctx, workspaceId } = await harness({ ...paths, headers, maxStepsPerRun: 4 })
    let project = await ctx.projects.create({ workspaceId, name: 'Prompt evaluation' })
    const exampleId = 'json-example' as ProjectPromptExampleId
    const acceptedCase = 'valid-json' as ProjectPromptEvaluationCaseId
    const truncatedCase = 'truncated-json' as ProjectPromptEvaluationCaseId
    const evaluationCases = [
      { id: acceptedCase, name: 'Valid JSON', variables: { target: 'valid' }, checks: { expectedSubstrings: ['"status":"ok"'], validJson: true } },
      { id: truncatedCase, name: 'Truncated JSON', variables: { target: 'truncated' }, checks: { validJson: true } },
    ]
    project = await ctx.projects.savePrompt(project.id, project.version, {
      name: 'json-result', purpose: 'Return a status object', tags: ['json', 'release'],
      template: 'Return JSON for {{target}}', variablesSchema: { target: { type: 'string', required: true } }, sourceSkills: [],
      examples: [{ id: exampleId, variables: { target: 'sample' }, expectedOutput: '{"status":"ok"}' }],
      evaluationCases,
    })
    const promptId = project.prompts[0]!.id
    expect(project.prompts[0]?.revisions[0]).toMatchObject({ purpose: 'Return a status object', tags: ['json', 'release'] })
    project = await ctx.projects.savePlan(project.id, project.version, { summary: 'Approved evaluation', items: [item('evaluate')] })
    project = await ctx.projects.approvePlan(project.id, project.version, 1)
    project = await ctx.projects.startPromptEvaluation(project.id, project.version, {
      promptId, promptRevision: 1, planRevision: 1, parentSessionId: parent,
    })
    const evaluation = project.evaluations[0]!
    expect(project.runs[0]).toMatchObject({ id: evaluation.runId, planRevision: 1, parentSessionId: parent, maxSteps: 2 })

    let claim = await ctx.projects.claimWorkflowStep(project.id, project.version, evaluation.runId)
    project = await ctx.projects.attachWorkflowStepSession(project.id, claim.project.version, {
      runId: evaluation.runId, stepId: claim.step!.stepId, sessionId: firstChild,
    })
    project = await ctx.projects.settleWorkflowStep(project.id, project.version, {
      runId: evaluation.runId, stepId: claim.step!.stepId, state: 'completed',
      result: { output: '{"status":"ok"}', truncated: false, usage: { complete: true, tokens: 42 } },
    })
    claim = await ctx.projects.claimWorkflowStep(project.id, project.version, evaluation.runId)
    project = await ctx.projects.attachWorkflowStepSession(project.id, claim.project.version, {
      runId: evaluation.runId, stepId: claim.step!.stepId, sessionId: secondChild,
    })
    project = await ctx.projects.settleWorkflowStep(project.id, project.version, {
      runId: evaluation.runId, stepId: claim.step!.stepId, state: 'completed',
      result: { output: '{"status":"ok"}', truncated: true, usage: { complete: true, tokens: 7 } },
    })
    project = await ctx.projects.finalizePromptEvaluation(project.id, project.version, { evaluationId: evaluation.id })
    expect(project.evaluations[0]?.result).toMatchObject({
      accepted: null,
      runState: 'completed',
      cases: [
        { caseId: acceptedCase, accepted: true, expectedSubstringMatches: [true], validJson: true, tokens: 42, outputTruncated: false },
        { caseId: truncatedCase, accepted: null, expectedSubstringMatches: [], validJson: null, tokens: 7, outputTruncated: true },
      ],
    })
    expect(project.evaluations[0]?.result?.cases[0]?.latencyMs).toEqual(expect.any(Number))
    const beforeSecondFinalize = await readFile(join(paths.storageRoot, 'project.json'), 'utf8')
    await expect(ctx.projects.finalizePromptEvaluation(project.id, project.version, { evaluationId: evaluation.id })).rejects.toThrow('already finalized')
    expect(await readFile(join(paths.storageRoot, 'project.json'), 'utf8')).toBe(beforeSecondFinalize)
    const beforeSemanticChange = await readFile(join(paths.storageRoot, 'project.json'), 'utf8')
    await expect(ctx.projects.savePrompt(project.id, project.version, {
      promptId, name: 'json-result', template: 'Return JSON for {{target}}',
      variablesSchema: { target: { type: 'string', required: true } }, sourceSkills: [],
      evaluationCases: [
        { ...evaluationCases[0]!, checks: { expectedSubstrings: ['different'] } },
        evaluationCases[1]!,
      ],
    })).rejects.toThrow('semantics are immutable')
    expect(await readFile(join(paths.storageRoot, 'project.json'), 'utf8')).toBe(beforeSemanticChange)
  })
  it('rejects workspace-listed sessions whose canonical cwd belongs to another workspace', async () => {
    const paths = await roots()
    const foreignPath = await mkdtemp(join(tmpdir(), 'arx-project-foreign-workspace-'))
    temporaryRoots.push(foreignPath)
    const staleMember = SessionId('stale-workspace-member')
    const header: SessionHeader = { version: 0, id: staleMember, createdAt: 1, cwd: foreignPath }
    const { ctx, workspaceId } = await harness({ ...paths, headers: [header] })
    let project = await ctx.projects.create({ workspaceId, name: 'Canonical session ownership' })
    project = await ctx.projects.savePrompt(project.id, project.version, {
      name: 'owned', template: 'Run {{target}}', variablesSchema: { target: { type: 'string', required: true } }, sourceSkills: [],
      evaluationCases: [{ id: 'ownership' as ProjectPromptEvaluationCaseId, name: 'Ownership', variables: { target: 'check' }, checks: { expectedSubstrings: ['ok'] } }],
    })
    const promptId = project.prompts[0]!.id
    project = await ctx.projects.savePlan(project.id, project.version, { summary: 'Check ownership', items: [item('ownership')] })
    project = await ctx.projects.approvePlan(project.id, project.version, 1)
    const before = await readFile(join(paths.storageRoot, 'project.json'), 'utf8')
    await expect(ctx.projects.updateTask(project.id, project.version, {
      planRevision: 1, itemId: 'ownership' as PlanItemId, state: 'running',
      execution: { sessionId: staleMember, prompt: { promptId, revision: 1 } },
    })).rejects.toThrow('cwd does not match workspace')
    await expect(ctx.projects.startPromptEvaluation(project.id, project.version, {
      promptId, promptRevision: 1, planRevision: 1, parentSessionId: staleMember,
    })).rejects.toThrow('cwd does not match workspace')
    expect(await readFile(join(paths.storageRoot, 'project.json'), 'utf8')).toBe(before)
  })
})
