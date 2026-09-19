/** Execute saved project steps through the existing owned subagent seam. */
import { Context, Service } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import type { Agent } from '@arx-ai/arx-agent'
import type { JsonValue, SessionEvent } from '@arx-ai/arx-session'
import type { SubagentRun } from '@arx-ai/arx-subagent'
import type {} from '@arx-ai/arx-subagent'
import { ProjectConflictError } from '@arx-ai/arx-project'
import type { ProjectId, ProjectRecord, ProjectWorkflowRunId, ProjectWorkflowRun } from '@arx-ai/arx-project/types'

/** Explicit execution outcome; the durable run is the source of step state. */
export interface ProjectRunExecution {
  readonly projectId: ProjectId
  readonly version: number
  readonly run: ProjectWorkflowRun
}

/** Deployment controls for the saved-step driver. */
export interface Config {
  /** Registered subagent provider used for durable local child sessions. */
  readonly provider?: string
  /** Maximum delegated depth allowed to each saved workflow child. */
  readonly maxDepth?: number
}

declare module '@arx-ai/cordis' {
  interface Context {
    projectRunner: ProjectRunner
  }
}

interface ActiveExecution {
  readonly controller: AbortController
  readonly promise: Promise<ProjectRunExecution>
}

/** Count only measured direct-child calls; missing usage remains explicit. */
function measuredUsage(events: readonly SessionEvent[], inherited: number): JsonValue {
  let tokens = 0
  let measuredCalls = 0
  let unknownCalls = 0
  for (const event of events.slice(inherited)) {
    if (event.type !== 'assistant/message') continue
    const usage = event.data.usage
    if (usage === undefined) { unknownCalls += 1; continue }
    const counts = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0]
    if (counts.some(count => !Number.isSafeInteger(count) || count < 0)) { unknownCalls += 1; continue }
    const total = counts.reduce((sum, count) => sum + count, 0)
    if (!Number.isSafeInteger(tokens + total)) { unknownCalls += 1; continue }
    tokens += total; measuredCalls += 1
  }
  return { scope: 'direct-child', tokens, measuredCalls, unknownCalls, complete: unknownCalls === 0 && measuredCalls > 0 }
}

/** Holder-owned sequential driver; restart rehydrates committed step state. */
export class ProjectRunner extends Service {
  static inject = ['projects', 'subagents']
  static Config: z<Config> = z.object({
    provider: z.string().default('spawn'),
    maxDepth: z.number().step(1).min(0).max(32).default(1),
  })

  private readonly active = new Map<string, ActiveExecution>()
  private closing = false
  private readonly provider: string
  private readonly maxDepth: number

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'projectRunner')
    this.provider = config.provider ?? 'spawn'
    this.maxDepth = config.maxDepth ?? 1
    ctx.effect(() => async () => {
      this.closing = true
      for (const execution of this.active.values()) execution.controller.abort(new Error('Saved workflow driver unloaded'))
      await Promise.allSettled([...this.active.values()].map(execution => execution.promise))
    }, 'project-runner: settle owned executions')
  }

  /**
   * Continue pending steps of a run from its original parent session. Confirmed
   * steps are skipped; uncertain effects require explicit operator reconciliation.
   * @param parent - original session owner bound when the run was created.
   * @param projectId - durable project aggregate identity.
   * @param runId - saved workflow run to continue.
   * @param signal - caller cancellation propagated to every owned child.
   * @returns the latest committed run and aggregate version.
   */
  async execute(parent: Agent, projectId: ProjectId, runId: ProjectWorkflowRunId, signal: AbortSignal): Promise<ProjectRunExecution> {
    signal.throwIfAborted()
    if (this.closing) throw new Error('Saved workflow driver is unloading')
    const key = JSON.stringify([projectId, runId])
    if (this.active.has(key)) throw new Error('This saved workflow already has an active driver')
    const controller = new AbortController()
    const combined = AbortSignal.any([signal, controller.signal])
    const promise = this.drive(parent, projectId, runId, combined)
    this.active.set(key, { controller, promise })
    try { return await promise } finally { this.active.delete(key) }
  }

  private async read(projectId: ProjectId, runId: ProjectWorkflowRunId): Promise<{ project: ProjectRecord; run: ProjectWorkflowRun }> {
    const project = await this.ctx.projects.get(projectId)
    const run = project?.runs.find(candidate => candidate.id === runId)
    if (project === undefined || run === undefined) throw new Error('Saved workflow run does not exist')
    return { project, run }
  }

  /** Retry only a stale local CAS, never the external child execution. */
  private async commit(
    projectId: ProjectId,
    write: (version: number) => Promise<ProjectRecord>,
  ): Promise<ProjectRecord> {
    let lastConflict!: ProjectConflictError
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await this.ctx.projects.get(projectId)
      if (current === undefined) throw new Error('Project no longer exists')
      try { return await write(current.version) } catch (error) {
        if (!(error instanceof ProjectConflictError)) throw error
        lastConflict = error
      }
    }
    throw lastConflict
  }

  private async drive(parent: Agent, projectId: ProjectId, runId: ProjectWorkflowRunId, signal: AbortSignal): Promise<ProjectRunExecution> {
    const initial = await this.read(projectId, runId)
    if (initial.run.parentSessionId !== parent.session.id || initial.run.planRevision === undefined) {
      throw new Error('Saved execution requires an approved plan and its original parent session')
    }
    if (initial.run.state === 'uncertain') throw new Error('Reconcile uncertain effects before resuming this workflow')
    const deadline = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const checkDeadline = (): void => {
      const remaining = Date.parse(initial.run.deadlineAt) - Date.now()
      if (remaining <= 0) { deadline.abort(new Error('Saved workflow deadline elapsed')); return }
      timer = setTimeout(checkDeadline, Math.min(remaining, 2_147_483_647))
      timer.unref()
    }
    checkDeadline()
    const combined = AbortSignal.any([signal, deadline.signal])
    let claimed = false
    let owned = false
    let published = false
    try {
      while (true) {
        signal.throwIfAborted()
        const { project, run } = await this.read(projectId, runId)
        if (run.state === 'completed' || run.state === 'failed') return { projectId, version: project.version, run }
        if (run.state === 'uncertain') throw new Error('Workflow effects require explicit reconciliation')
        const definition = project.workflows.find(workflow => workflow.id === run.workflowId)
          ?.revisions.find(revision => revision.revision === run.workflowRevision)
        if (!definition || definition.steps.some(step => !step.prompt)) {
          throw new Error('Every saved executable step must name an exact prompt revision')
        }
        // The domain serializes the claim, including its attempt and budget.
        // CAS retries cannot launch a child because no launch occurs here.
        let claim: Awaited<ReturnType<Context['projects']['claimWorkflowStep']>> | undefined
        await this.commit(projectId, async (version) => {
          claim = await this.ctx.projects.claimWorkflowStep(projectId, version, runId)
          return claim.project
        })
        if (!claim?.step) {
          const current = await this.read(projectId, runId)
          if (current.run.steps.some(step => step.state === 'running')) throw new Error('A saved step already has an owner')
          return { projectId, version: current.project.version, run: current.run }
        }
        claimed = true
        owned = true
        published = false
        const step = claim.step
        const specification = definition.steps.find(candidate => candidate.id === step.stepId)
        if (!specification?.prompt) throw new Error('The claimed step has no saved prompt')
        const effective = await this.ctx.projects.renderPrompt(
          projectId, specification.prompt.promptId, specification.prompt.revision, specification.variables ?? {},
        )
        combined.throwIfAborted()
        const instruction = [
          'Execute this saved workflow step under the current tool and approval policies.',
          'Project: ' + String(projectId) + '; approved plan revision: ' + String(run.planRevision),
          'Reconciliation key: ' + JSON.stringify([projectId, runId, step.stepId, step.attempt]),
          'Step: ' + specification.name,
          effective.renderedPrompt,
          ...effective.sourceSkills.map(skill => [
            'Selected skill: ' + skill.repository + '/' + skill.path + '@' + skill.commit,
            'Content hash: ' + skill.contentHash,
            skill.content,
          ].join('\n')),
          'Persisted step input and dependency results:',
          JSON.stringify(step.input ?? null),
        ].join('\n\n')
        let child: SubagentRun | undefined
        try {
          child = await this.ctx.subagents.start(this.provider, {
            parent, signal: combined, prompt: [{ type: 'text', text: instruction }],
            label: specification.name, maxDepth: this.maxDepth,
          })
          // Observe early infrastructure rejection even if provenance persistence fails.
          void child.result.catch(() => {})
          published = true
          if (!child.localAgent) throw new Error('Saved workflows require a provider with a durable local child session')
          const childId = child.id
          await this.commit(projectId, version => this.ctx.projects.attachWorkflowStepSession(projectId, version, {
            runId, stepId: step.stepId, sessionId: childId,
          }))
          const result = await child.result
          combined.throwIfAborted()
          if (result.stopReason !== 'completed') throw new Error('Saved child stopped with ' + result.stopReason)
          const text = result.output.filter(part => part.type === 'text').map(part => part.text).join('\n')
          const output = {
            sessionId: childId, stopReason: result.stopReason, output: text.slice(0, 32_000),
            truncated: text.length > 32_000, nonTextBlocks: result.output.filter(part => part.type !== 'text').length,
            usage: measuredUsage(child.localAgent.session.events, child.localAgent.session.header.seedLength ?? 0),
          }
          await this.commit(projectId, version => this.ctx.projects.settleWorkflowStep(projectId, version, {
            runId, stepId: step.stepId, state: 'completed', result: output,
          }))
          claimed = false
        } finally {
          if (child) await child.dispose()
        }
      }
    } catch (error) {
      if (claimed || (owned && (await this.read(projectId, runId)).run.state === 'running')) {
        const reason = published
          ? 'Saved step may have produced external effects; inspect its child session and reconcile explicitly'
          : 'Saved step interrupted before a child was published'
        // Even pre-publication provider failure is kept conservative: provider
        // setup may have crossed its own external boundary before rejecting.
        try {
          await this.commit(projectId, version => this.ctx.projects.interruptWorkflowRun(projectId, version, { runId, reason }))
        } catch (commitError) {
          throw new AggregateError([error, commitError], 'Workflow interrupted and its uncertainty could not be committed')
        }
      }
      throw error
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

export default ProjectRunner
