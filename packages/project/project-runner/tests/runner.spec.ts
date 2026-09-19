import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import type { Agent } from '@arx-ai/arx-agent'
import { SessionId } from '@arx-ai/arx-session'
import type { SessionEvent, SessionHeader } from '@arx-ai/arx-session'
import Storage from '@arx-ai/arx-storage'
import * as StorageJson from '@arx-ai/arx-storage-json'
import * as StorageDomain from '@arx-ai/arx-storage-domain'
import { WorkspaceId } from '@arx-ai/arx-workspace'
import type { Workspace, WorkspaceRegistry } from '@arx-ai/arx-workspace'
import type { SessionPersistence } from '@arx-ai/arx-session-persistence'
import type SubagentService from '@arx-ai/arx-subagent'
import type { SubagentStartRequest, SubagentResult } from '@arx-ai/arx-subagent'
import Projects, { ProjectConflictError, ProjectId, ProjectWorkflowRunId } from '@arx-ai/arx-project'
import type { PlanItemId, ProjectWorkflowStepId } from '@arx-ai/arx-project/types'
import Runner from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.useRealTimers()
})

async function harness(existing?: string) {
  const root = existing ?? (await mkdtemp(join(tmpdir(), 'arx-project-runner-')))
  if (!existing) roots.push(root)
  const parentId = SessionId('saved-parent')
  const headers: SessionHeader[] = [{ version: 0, id: parentId, createdAt: 1, cwd: root }]
  const workspaceId = WorkspaceId('saved-workspace')
  const sessionIds = [parentId]
  const workspace: Workspace = {
    id: workspaceId,
    path: root,
    title: 'Saved',
    createdAt: '2026-09-12T00:00:00Z',
    updatedAt: '2026-09-12T00:00:00Z',
    sessionIds,
    setTitle: async () => {},
    attachSession: async () => {},
    insertSessionBefore: async () => {},
    detachSession: async () => {},
    status: async () => 'ok',
  }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  ctx.provide('workspaceRegistry', {
    get: (id: typeof workspaceId) => (id === workspaceId ? workspace : undefined),
  } as unknown as WorkspaceRegistry)
  ctx.provide('sessionPersistence', { list: async () => [...headers] } as unknown as SessionPersistence)
  await ctx.plugin(Projects, { maxActiveRuns: 4, maxStepsPerRun: 10, maxRunDurationMs: 60_000 })
  const parent = { session: { id: parentId } } as Agent
  const prompts: string[] = []
  const disposed = vi.fn(async () => {})
  let resultHook: ((request: SubagentStartRequest) => Promise<SubagentResult>) | undefined
  const start = vi.fn(async (_provider: string, request: SubagentStartRequest) => {
    prompts.push(request.prompt.map(part => (part.type === 'text' ? part.text : '')).join(''))
    const id = SessionId(`child-${prompts.length}`)
    const header: SessionHeader = {
      version: 0,
      id,
      createdAt: Date.now(),
      cwd: root,
      parentSession: parentId,
      origin: 'subagent',
    }
    headers.push(header)
    sessionIds.push(id)
    const localAgent = { session: { id, header, events: [] } } as unknown as Agent
    return {
      id,
      localAgent,
      result: resultHook
        ? resultHook(request)
        : Promise.resolve({
          stopReason: 'completed' as const,
          output: [{ type: 'text' as const, text: `done ${prompts.length}` }],
        }),
      dispose: disposed,
    }
  })
  ctx.provide('subagents', { start } as unknown as SubagentService)
  const holder = await ctx.plugin(Runner)
  async function prepare(maxSteps = 10) {
    let project = await ctx.projects.create({ workspaceId, name: 'Release' })
    project = await ctx.projects.savePlan(project.id, project.version, {
      summary: 'Ship',
      items: [{ id: 'work' as PlanItemId, title: 'Work', acceptanceCriteria: ['Checked'], dependsOn: [] }],
    })
    project = await ctx.projects.approvePlan(project.id, project.version, 1)
    project = await ctx.projects.savePrompt(project.id, project.version, {
      name: 'step',
      template: 'Work on {{target}}',
      variablesSchema: { target: { type: 'string', required: true } },
      sourceSkills: [
        {
          repository: 'https://example.test/skills.git',
          commit: '0123456789abcdef',
          path: 's/SKILL.md',
          content: '# Read before execution',
        },
      ],
    })
    const promptId = project.prompts[0]!.id
    project = await ctx.projects.saveWorkflow(project.id, project.version, {
      name: 'Ship',
      steps: [
        {
          id: 'first' as ProjectWorkflowStepId,
          name: 'First',
          dependsOn: [],
          prompt: { promptId, revision: 1 },
          variables: { target: 'first' },
        },
        {
          id: 'second' as ProjectWorkflowStepId,
          name: 'Second',
          dependsOn: ['first' as ProjectWorkflowStepId],
          prompt: { promptId, revision: 1 },
          variables: { target: 'second' },
        },
      ],
    })
    project = await ctx.projects.startWorkflowRun(project.id, project.version, {
      workflowId: project.workflows[0]!.id,
      workflowRevision: 1,
      planRevision: 1,
      parentSessionId: parentId,
      input: { goal: 'release' },
      maxSteps,
    })
    return { projectId: project.id, runId: project.runs[0]!.id }
  }
  return {
    root,
    ctx,
    parent,
    start,
    prompts,
    disposed,
    holder,
    prepare,
    hook: (fn: typeof resultHook) => {
      resultHook = fn
    },
  }
}

it('resumes only pending steps after budget stop, persisted restart and explicit budget increase', async () => {
  const first = await harness()
  const { projectId, runId } = await first.prepare(1)
  const stopped = await first.ctx.projectRunner.execute(first.parent, projectId, runId, new AbortController().signal)
  expect(stopped.run).toMatchObject({ state: 'failed', launchedSteps: 1 })
  expect(first.start).toHaveBeenCalledTimes(1)
  expect(first.prompts[0]).toContain('Work on first')
  expect(first.prompts[0]).toContain('# Read before execution')
  expect(first.prompts[0]).toContain('Reconciliation key:')
  expect(first.disposed).toHaveBeenCalledTimes(1)
  expect(stopped.run.steps[0]?.result).toMatchObject({ usage: { tokens: 0, complete: false } })
  await first.ctx.fiber.dispose()
  contexts.splice(contexts.indexOf(first.ctx), 1)
  const next = await harness(first.root)
  const restored = (await next.ctx.projects.get(projectId))!
  await next.ctx.projects.resumeWorkflowRun(projectId, restored.version, { runId, maxSteps: 2 })
  const completed = await next.ctx.projectRunner.execute(next.parent, projectId, runId, new AbortController().signal)
  expect(completed.run.state).toBe('completed')
  expect(next.start).toHaveBeenCalledTimes(1)
  expect(next.prompts[0]).toContain('Work on second')
  expect(next.prompts[0]).toContain('done 1')
  expect(completed.run.steps.map(step => step.attempt)).toEqual([1, 1])
})

it('prevents duplicate drivers, persists uncertainty on cancellation and never retries effects', async () => {
  const h = await harness()
  const ids = await h.prepare()
  h.hook(
    request =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener(
          'abort',
          () => {
            reject(request.signal.reason instanceof Error ? request.signal.reason : new Error(String(request.signal.reason)))
          },
          { once: true },
        )
      }),
  )
  const controller = new AbortController()
  const running = h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, controller.signal)
  const rejected = expect(running).rejects.toThrow('cancel requested')
  await vi.waitFor(() => {
    expect(h.start).toHaveBeenCalledTimes(1)
  })
  await expect(
    h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, new AbortController().signal),
  ).rejects.toThrow('active driver')
  controller.abort(new Error('cancel requested'))
  await rejected
  const record = (await h.ctx.projects.get(ids.projectId))!
  expect(record.runs[0]).toMatchObject({
    state: 'uncertain',
    steps: [{ state: 'uncertain', sessionId: 'child-1' }, { state: 'pending' }],
  })
  await expect(
    h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, new AbortController().signal),
  ).rejects.toThrow('Reconcile')
  expect(h.start).toHaveBeenCalledTimes(1)
  expect(h.disposed).toHaveBeenCalledTimes(1)
})

it('does not launch a child after the persisted deadline and releases the budget reservation', async () => {
  const h = await harness()
  const ids = await h.prepare()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.now() + 61_000)
  const result = await h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, new AbortController().signal)
  expect(result.run).toMatchObject({ state: 'failed', error: 'workflow run deadline elapsed' })
  expect(h.start).not.toHaveBeenCalled()
})

it('rejects execution from another parent session before claiming work', async () => {
  const h = await harness()
  const ids = await h.prepare()
  await expect(
    h.ctx.projectRunner.execute(
      { session: { id: SessionId('stranger') } } as Agent,
      ids.projectId,
      ids.runId,
      new AbortController().signal,
    ),
  ).rejects.toThrow('original parent')
  expect(h.start).not.toHaveBeenCalled()
  expect((await h.ctx.projects.get(ids.projectId))?.runs[0]?.launchedSteps).toBe(0)
})

it('unloading aborts and awaits owned child cleanup', async () => {
  const h = await harness()
  const ids = await h.prepare()
  h.hook(
    request =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener(
          'abort',
          () => {
            reject(request.signal.reason instanceof Error ? request.signal.reason : new Error(String(request.signal.reason)))
          },
          { once: true },
        )
      }),
  )
  const running = h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, new AbortController().signal)
  const rejected = expect(running).rejects.toThrow('unloaded')
  await vi.waitFor(() => {
    expect(h.start).toHaveBeenCalledTimes(1)
  })
  await h.holder.dispose()
  await rejected
  expect(h.disposed).toHaveBeenCalledTimes(1)
  expect((await h.ctx.projects.get(ids.projectId))?.runs[0]?.state).toBe('uncertain')
})

const signal = () => new AbortController().signal
it('rejects an aborted caller and a disposed driver without admitting work', async () => {
  const h = await harness()
  const ids = await h.prepare()
  const runner = h.ctx.projectRunner
  const cancelled = new AbortController()
  cancelled.abort(new Error('cancelled before start'))
  await expect(runner.execute(h.parent, ids.projectId, ids.runId, cancelled.signal)).rejects.toThrow('cancelled before start')
  await h.holder.dispose()
  await expect(runner.execute(h.parent, ids.projectId, ids.runId, signal())).rejects.toThrow('unloading')
  expect(h.start).not.toHaveBeenCalled()
})
it('supports constructor defaults and refuses missing runs without a child', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('projects', { get: vi.fn(async () => undefined) } as never)
  ctx.provide('subagents', { start: vi.fn() } as never)
  const runner = new Runner(ctx)
  await expect(runner.execute({ session: { id: SessionId('parent') } } as Agent,
    ProjectId('missing'), ProjectWorkflowRunId('missing'), signal())).rejects.toThrow('does not exist')
})
it('refuses an absent run in an existing project', async () => {
  const h = await harness()
  const ids = await h.prepare()
  await expect(h.ctx.projectRunner.execute(h.parent, ids.projectId, ProjectWorkflowRunId('missing'), signal()))
    .rejects.toThrow('does not exist')
  expect(h.start).not.toHaveBeenCalled()
})
it('retries only stale claim commits and launches each child once', async () => {
  const h = await harness()
  const ids = await h.prepare()
  vi.spyOn(h.ctx.projects, 'claimWorkflowStep').mockRejectedValueOnce(new ProjectConflictError(ids.projectId, 1, 2))
  const result = await h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, signal())
  expect(result.run.state).toBe('completed')
  expect(h.start).toHaveBeenCalledTimes(2)
  expect(result.run.steps.map(step => step.attempt)).toEqual([1, 1])
})
it('stops after eight stale commits without replaying child effects', async () => {
  const h = await harness()
  const ids = await h.prepare()
  const claim = vi.spyOn(h.ctx.projects, 'claimWorkflowStep').mockRejectedValue(new ProjectConflictError(ids.projectId, 1, 2))
  await expect(h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, signal())).rejects.toThrow('version conflict')
  expect(claim).toHaveBeenCalledTimes(8)
  expect(h.start).not.toHaveBeenCalled()
})
it('preserves a persistence failure without retrying it as a version conflict', async () => {
  const h = await harness()
  const ids = await h.prepare()
  const claim = vi.spyOn(h.ctx.projects, 'claimWorkflowStep').mockRejectedValue(new Error('disk unavailable'))
  await expect(h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, signal())).rejects.toThrow('disk unavailable')
  expect(claim).toHaveBeenCalledOnce()
  expect(h.start).not.toHaveBeenCalled()
})
it('refuses an existing claimed owner without changing its state', async () => {
  const h = await harness()
  const ids = await h.prepare()
  const project = (await h.ctx.projects.get(ids.projectId))!
  await h.ctx.projects.claimWorkflowStep(ids.projectId, project.version, ids.runId)
  await expect(h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, signal())).rejects.toThrow('already has a running step')
  expect(h.start).not.toHaveBeenCalled()
  expect((await h.ctx.projects.get(ids.projectId))?.runs[0]?.state).toBe('running')
})
it.each(['provider', 'nonlocal', 'aborted'] as const)('records uncertainty after %s failure and disposes published children', async (failure) => {
  const h = await harness()
  const ids = await h.prepare()
  if (failure === 'provider') h.start.mockRejectedValueOnce(new Error('provider failed'))
  if (failure === 'nonlocal') h.start.mockResolvedValueOnce({ id: SessionId('remote'), result: Promise.resolve({
    stopReason: 'completed', output: [],
  }), dispose: h.disposed } as never)
  if (failure === 'aborted') h.hook(async () => ({ stopReason: 'aborted', output: [] }))
  await expect(h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, signal()))
    .rejects.toThrow(failure === 'provider' ? 'provider failed' : failure === 'nonlocal' ? 'durable local' : 'stopped with aborted')
  const run = (await h.ctx.projects.get(ids.projectId))!.runs[0]!
  expect(run.state).toBe('uncertain')
  expect(run.error).toContain(failure === 'provider' ? 'before a child was published' : 'may have produced external effects')
  expect(h.start).toHaveBeenCalledOnce()
  expect(h.disposed).toHaveBeenCalledTimes(failure === 'provider' ? 0 : 1)
})
it('reports both execution and uncertainty persistence failures', async () => {
  const h = await harness()
  const ids = await h.prepare()
  h.start.mockRejectedValueOnce(new Error('provider failed'))
  vi.spyOn(h.ctx.projects, 'interruptWorkflowRun').mockRejectedValue(new Error('disk failed'))
  const error = await h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, signal()).catch((reason: unknown) => reason)
  expect(error).toBeInstanceOf(AggregateError)
  expect((error as AggregateError).errors.map((reason: Error) => reason.message)).toEqual(['provider failed', 'disk failed'])
  expect(h.start).toHaveBeenCalledOnce()
})
it('bounds output, counts non-text blocks and measures only direct-child valid usage', async () => {
  const h = await harness()
  const ids = await h.prepare(1)
  const start = h.start.getMockImplementation()!
  const events = [
    { type: 'assistant/message', data: { usage: { inputTokens: 999, outputTokens: 999 } } },
    { type: 'turn/start', data: {} },
    { type: 'assistant/message', data: {} },
    { type: 'assistant/message', data: { usage: { inputTokens: 2, outputTokens: 3 } } },
    { type: 'assistant/message', data: { usage: { inputTokens: 2, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 7 } } },
    { type: 'assistant/message', data: { usage: { inputTokens: -1, outputTokens: 3 } } },
    { type: 'assistant/message', data: { usage: { inputTokens: 0.5, outputTokens: 3 } } },
    { type: 'assistant/message', data: { usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 3 } } },
  ] as unknown as SessionEvent[]
  h.start.mockImplementation(async (...args) => {
    const child = await start(...args)
    Object.assign(child.localAgent.session, { events, header: { ...child.localAgent.session.header, seedLength: 1 } })
    return child
  })
  h.hook(async () => ({ stopReason: 'completed', output: [
    { type: 'text', text: 'x'.repeat(32_001) }, { type: 'image', data: '', mediaType: 'image/png' } as never,
  ] }))
  const result = await h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, signal())
  expect(result.run.steps[0]?.result).toMatchObject({ output: 'x'.repeat(32_000), truncated: true, nonTextBlocks: 1,
    usage: { tokens: 22, measuredCalls: 2, unknownCalls: 4, complete: false } })
})
it('reports complete measured usage when every direct-child call has counters', async () => {
  const h = await harness()
  const ids = await h.prepare(1)
  const start = h.start.getMockImplementation()!
  h.start.mockImplementation(async (...args) => {
    const child = await start(...args)
    Object.assign(child.localAgent.session, { events: [{ type: 'assistant/message', data: {
      usage: { inputTokens: 2, outputTokens: 3 },
    } }] })
    return child
  })
  const result = await h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, signal())
  expect(result.run.steps[0]?.result).toMatchObject({ usage: { tokens: 5, measuredCalls: 1, unknownCalls: 0, complete: true } })
})
it('reports a project removed between reading the run and its claim', async () => {
  const h = await harness()
  const ids = await h.prepare()
  const project = (await h.ctx.projects.get(ids.projectId))!
  vi.spyOn(h.ctx.projects, 'get').mockResolvedValueOnce(project).mockResolvedValueOnce(project).mockResolvedValueOnce(undefined)
  await expect(h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, signal())).rejects.toThrow('Project no longer exists')
  expect(h.start).not.toHaveBeenCalled()
})
it('refuses effects that become uncertain between admission and the next read', async () => {
  const h = await harness()
  const ids = await h.prepare()
  const project = (await h.ctx.projects.get(ids.projectId))!
  vi.spyOn(h.ctx.projects, 'get').mockResolvedValueOnce(project).mockResolvedValueOnce({ ...project,
    runs: project.runs.map(run => ({ ...run, state: 'uncertain' })),
  })
  await expect(h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, signal())).rejects.toThrow('explicit reconciliation')
  expect(h.start).not.toHaveBeenCalled()
})
it.each(['workflow', 'revision', 'prompt'] as const)('refuses incomplete saved %s definitions before admission', async (missing) => {
  const h = await harness()
  const ids = await h.prepare()
  const project = (await h.ctx.projects.get(ids.projectId))!
  const broken = { ...project, workflows: missing === 'workflow' ? [] : project.workflows.map(workflow => ({ ...workflow,
    revisions: missing === 'revision' ? [] : workflow.revisions.map(revision => ({ ...revision,
      steps: revision.steps.map(({ prompt: _prompt, ...step }) => step),
    })),
  })) }
  vi.spyOn(h.ctx.projects, 'get').mockResolvedValueOnce(project).mockResolvedValueOnce(broken)
  await expect(h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, signal())).rejects.toThrow('exact prompt revision')
  expect(h.start).not.toHaveBeenCalled()
})
it('rejects a claim that does not identify a step in the pinned definition', async () => {
  const h = await harness()
  const ids = await h.prepare()
  const claim = h.ctx.projects.claimWorkflowStep.bind(h.ctx.projects)
  vi.spyOn(h.ctx.projects, 'claimWorkflowStep').mockImplementationOnce(async (...args) => {
    const result = await claim(...args)
    return { ...result, step: { ...result.step!, stepId: 'unknown' as ProjectWorkflowStepId } }
  })
  await expect(h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, signal())).rejects.toThrow('no saved prompt')
  expect(h.start).not.toHaveBeenCalled()
  expect((await h.ctx.projects.get(ids.projectId))?.runs[0]?.state).toBe('uncertain')
})
it('detects another owner that appears after a claim returns no ready step', async () => {
  const h = await harness()
  const ids = await h.prepare()
  const claim = h.ctx.projects.claimWorkflowStep.bind(h.ctx.projects)
  vi.spyOn(h.ctx.projects, 'claimWorkflowStep').mockImplementationOnce(async (...args) => ({ project: (await claim(...args)).project }))
  await expect(h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, signal())).rejects.toThrow('already has an owner')
  expect(h.start).not.toHaveBeenCalled()
  expect((await h.ctx.projects.get(ids.projectId))?.runs[0]?.state).toBe('running')
})
it('uses empty variables and explicit null when optional saved inputs are absent', async () => {
  const h = await harness()
  const ids = await h.prepare(1)
  const project = (await h.ctx.projects.get(ids.projectId))!
  const withoutVariables = { ...project, workflows: project.workflows.map(workflow => ({ ...workflow,
    revisions: workflow.revisions.map(revision => ({ ...revision,
      steps: revision.steps.map(({ variables: _variables, ...step }) => step),
    })),
  })) }
  vi.spyOn(h.ctx.projects, 'get').mockResolvedValueOnce(project).mockResolvedValueOnce(withoutVariables)
  const render = vi.spyOn(h.ctx.projects, 'renderPrompt').mockResolvedValue({
    projectId: ids.projectId, promptId: project.prompts[0]!.id, revision: 1,
    renderedPrompt: 'No inputs required', sourceSkills: [],
  } as never)
  const claim = h.ctx.projects.claimWorkflowStep.bind(h.ctx.projects)
  vi.spyOn(h.ctx.projects, 'claimWorkflowStep').mockImplementationOnce(async (...args) => {
    const result = await claim(...args)
    const { input: _input, ...step } = result.step!
    return { ...result, step }
  })
  const result = await h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, signal())
  expect(result.run.launchedSteps).toBe(1)
  expect(render).toHaveBeenCalledWith(ids.projectId, project.prompts[0]!.id, 1, {})
  expect(h.prompts[0]).toContain('Persisted step input and dependency results:\n\nnull')
})

it('leaves another live driver running when its durable claim wins', async () => {
  const h = await harness()
  const ids = await h.prepare()
  const firstResult = Promise.withResolvers<SubagentResult>()
  let childCount = 0
  h.hook(async () => ++childCount === 1 ? await firstResult.promise : { stopReason: 'completed', output: [] })
  const running = h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, signal())
  const completion = expect(running).resolves.toMatchObject({ run: { state: 'completed' } })
  await vi.waitFor(async () => {
    expect((await h.ctx.projects.get(ids.projectId))?.runs[0]?.steps[0]?.sessionId).toBe('child-1')
  })
  const contender = new Context()
  contexts.push(contender)
  contender.provide('projects', h.ctx.projects)
  contender.provide('subagents', h.ctx.subagents)
  await contender.plugin(Runner)
  try {
    await expect(contender.projectRunner.execute(h.parent, ids.projectId, ids.runId, signal()))
      .rejects.toThrow('already has a running step')
    expect((await h.ctx.projects.get(ids.projectId))?.runs[0]?.state).toBe('running')
    expect(h.start).toHaveBeenCalledOnce()
  } finally {
    firstResult.resolve({ stopReason: 'completed', output: [] })
    await completion
  }
  expect(h.start).toHaveBeenCalledTimes(2)
  expect((await h.ctx.projects.get(ids.projectId))?.runs[0]?.steps.map(step => step.attempt)).toEqual([1, 1])
})

it.each(['between-steps', 'after-completion'] as const)('retains committed results after child cleanup fails %s', async (when) => {
  const h = await harness()
  const ids = await h.prepare()
  if (when === 'after-completion') h.disposed.mockResolvedValueOnce(undefined)
  h.disposed.mockRejectedValueOnce(new Error('child cleanup failed'))
  await expect(h.ctx.projectRunner.execute(h.parent, ids.projectId, ids.runId, signal()))
    .rejects.toThrow('child cleanup failed')
  const run = (await h.ctx.projects.get(ids.projectId))!.runs[0]!
  expect(run.state).toBe(when === 'between-steps' ? 'uncertain' : 'completed')
  expect(run.steps[0]!.state).toBe('completed')
  expect(run.steps[0]!.result).toMatchObject({ output: 'done 1' })
  expect(h.start).toHaveBeenCalledTimes(when === 'between-steps' ? 1 : 2)
})
