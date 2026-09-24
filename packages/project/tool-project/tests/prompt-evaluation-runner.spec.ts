import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import type { Agent } from '@arx-ai/arx-agent'
import { SessionId } from '@arx-ai/arx-session'
import type { SessionHeader } from '@arx-ai/arx-session'
import type { SessionPersistence } from '@arx-ai/arx-session-persistence'
import Storage from '@arx-ai/arx-storage'
import * as StorageJson from '@arx-ai/arx-storage-json'
import * as StorageDomain from '@arx-ai/arx-storage-domain'
import { realpathNormalize, WorkspaceId } from '@arx-ai/arx-workspace'
import type { Workspace, WorkspaceRegistry } from '@arx-ai/arx-workspace'
import type SubagentService from '@arx-ai/arx-subagent'
import Projects from '@arx-ai/arx-project'
import type { PlanItemId, ProjectPromptEvaluationCaseId } from '@arx-ai/arx-project/types'
import Runner from '@arx-ai/arx-project-runner'

let root: string | undefined
let ctx: Context | undefined
afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

it('executes a prompt evaluation through a real project runner child and finalizes its measured result', async () => {
  root = await mkdtemp(join(tmpdir(), 'arx-prompt-evaluation-runner-'))
  const workspaceId = WorkspaceId('evaluation-workspace')
  const parentId = SessionId('evaluation-parent')
  const sessionIds = [parentId]
  const headers: SessionHeader[] = [{ version: 0, id: parentId, createdAt: 1, cwd: root }]
  const workspace: Workspace = {
    id: workspaceId, path: await realpathNormalize(root), title: 'Evaluation', createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z',
    sessionIds, setTitle: async () => {}, attachSession: async () => {}, insertSessionBefore: async () => {},
    detachSession: async () => {}, status: async () => 'ok',
  }
  ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  ctx.provide('workspaceRegistry', { get: (id: typeof workspaceId) => id === workspaceId ? workspace : undefined } as unknown as WorkspaceRegistry)
  ctx.provide('sessionPersistence', { list: async () => [...headers] } as unknown as SessionPersistence)
  await ctx.plugin(Projects, { maxActiveRuns: 2, maxStepsPerRun: 4, maxRunDurationMs: 60_000 })
  const dispose = vi.fn(async () => {})
  ctx.provide('subagents', {
    start: vi.fn(async (_provider, _request) => {
      const id = SessionId('evaluation-child')
      const header: SessionHeader = { version: 0, id, createdAt: 2, cwd: root as string, parentSession: parentId, origin: 'subagent', seedLength: 0 }
      headers.push(header)
      return {
        id,
        localAgent: { session: { id, header, events: [{ type: 'assistant/message', data: { usage: { inputTokens: 3, outputTokens: 4 } } }] } } as unknown as Agent,
        result: Promise.resolve({ stopReason: 'completed' as const, output: [{ type: 'text' as const, text: '{"status":"ok"}' }] }),
        dispose,
      }
    }),
  } as unknown as SubagentService)
  await ctx.plugin(Runner)

  let project = await ctx.projects.create({ workspaceId, name: 'Evaluation project' })
  project = await ctx.projects.savePrompt(project.id, project.version, {
    name: 'status-json', purpose: 'Return status JSON', template: 'Return status JSON for {{target}}',
    variablesSchema: { target: { type: 'string', required: true } }, sourceSkills: [],
    evaluationCases: [{
      id: 'status-ok' as ProjectPromptEvaluationCaseId,
      name: 'Status accepted', variables: { target: 'release' },
      checks: { expectedSubstrings: ['"status":"ok"'], validJson: true },
    }],
  })
  project = await ctx.projects.savePlan(project.id, project.version, {
    summary: 'Evaluate approved prompt',
    items: [{ id: 'evaluate' as PlanItemId, title: 'Evaluate', acceptanceCriteria: ['Result recorded'], dependsOn: [] }],
  })
  project = await ctx.projects.approvePlan(project.id, project.version, 1)
  project = await ctx.projects.startPromptEvaluation(project.id, project.version, {
    promptId: project.prompts[0]!.id, promptRevision: 1, planRevision: 1, parentSessionId: parentId,
  })
  const evaluation = project.evaluations[0]!
  const executed = await ctx.projectRunner.execute(
    { session: { id: parentId } } as Agent, project.id, evaluation.runId, new AbortController().signal,
  )
  expect(executed.run.state).toBe('completed')
  project = await ctx.projects.finalizePromptEvaluation(project.id, executed.version, { evaluationId: evaluation.id })
  expect(project.evaluations[0]?.result).toMatchObject({
    accepted: true,
    cases: [{ accepted: true, validJson: true, expectedSubstringMatches: [true], tokens: 7, outputTruncated: false }],
  })
  expect(dispose).toHaveBeenCalledOnce()
})
