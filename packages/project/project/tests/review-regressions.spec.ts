import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import Storage from '@arx-ai/arx-storage'
import * as StorageDomain from '@arx-ai/arx-storage-domain'
import * as StorageJson from '@arx-ai/arx-storage-json'
import ProjectService from '@arx-ai/arx-project'
import { SessionId } from '@arx-ai/arx-session'
import { realpathNormalize, WorkspaceId } from '@arx-ai/arx-workspace'
import type { WorkspaceRegistry } from '@arx-ai/arx-workspace'
import type { SessionPersistence } from '@arx-ai/arx-session-persistence'
import type { PlanItemId } from '@arx-ai/arx-project'
const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.allSettled(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function root() { const value = await mkdtemp(join(tmpdir(), 'arx-independent-review-')); roots.push(value); return value }
it('review: terminal task updates cannot replace provenance with an unknown session', async () => {
  const directory = await root(); const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage); await ctx.plugin(StorageJson, { root: directory }); await ctx.plugin(StorageDomain, { backend: 'json' })
  const workspacePath = await realpathNormalize(directory)
  const workspaceId = WorkspaceId('review-workspace'); const sessionId = SessionId('known-session')
  ctx.provide('workspaceRegistry', { get: () => ({ id: workspaceId, path: workspacePath, sessionIds: [sessionId], status: async () => 'ok' }) } as unknown as WorkspaceRegistry)
  ctx.provide('sessionPersistence', { list: async () => [{ id: sessionId, version: 0, createdAt: 0, cwd: directory }] } as unknown as SessionPersistence)
  await ctx.plugin(ProjectService, {})
  let project = await ctx.projects.create({ workspaceId, name: 'review' })
  project = await ctx.projects.savePrompt(project.id, project.version, { name: 'task', template: 'Implement task', variablesSchema: {}, sourceSkills: [] })
  const prompt = { promptId: project.prompts[0]!.id, revision: 1 }
  const itemId = 'build' as PlanItemId
  project = await ctx.projects.savePlan(project.id, project.version, { summary: 'build', items: [{ id: itemId, title: 'Build', dependsOn: [], acceptanceCriteria: ['passes'] }] })
  project = await ctx.projects.approvePlan(project.id, project.version, 1)
  project = await ctx.projects.updateTask(project.id, project.version, { planRevision: 1, itemId, state: 'running', execution: { sessionId, prompt } })
  await expect(ctx.projects.updateTask(project.id, project.version, { planRevision: 1, itemId, state: 'verified', evidence: ['tested'], execution: { sessionId: SessionId('forged-session'), prompt } })).rejects.toThrow()
})

it('review: resuming a budget-failed run cannot exceed the host active reservation ceiling', async () => {
  const directory = await root(); const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage); await ctx.plugin(StorageJson, { root: directory }); await ctx.plugin(StorageDomain, { backend: 'json' })
  const workspacePath = await realpathNormalize(directory)
  const workspaceId = WorkspaceId('review-budget-workspace')
  ctx.provide('workspaceRegistry', { get: () => ({ id: workspaceId, path: workspacePath, sessionIds: [], status: async () => 'ok' }) } as unknown as WorkspaceRegistry)
  ctx.provide('sessionPersistence', { list: async () => [] } as unknown as SessionPersistence)
  await ctx.plugin(ProjectService, { maxActiveRuns: 1 })
  let project = await ctx.projects.create({ workspaceId, name: 'budget review' })
  project = await ctx.projects.saveWorkflow(project.id, project.version, { name: 'flow', steps: [
    { id: 'a' as import('@arx-ai/arx-project').ProjectWorkflowStepId, name: 'A', dependsOn: [] },
    { id: 'b' as import('@arx-ai/arx-project').ProjectWorkflowStepId, name: 'B', dependsOn: ['a' as import('@arx-ai/arx-project').ProjectWorkflowStepId] },
  ] })
  const definition = project.workflows[0]!
  project = await ctx.projects.startWorkflowRun(project.id, project.version, {
    workflowId: definition.id, workflowRevision: 1, input: null, maxSteps: 1,
  })
  const first = project.runs[0]!
  const claim = await ctx.projects.claimWorkflowStep(project.id, project.version, first.id)
  project = await ctx.projects.settleWorkflowStep(project.id, claim.project.version, { runId: first.id, stepId: claim.step!.stepId, state: 'completed', result: 'done' })
  project = (await ctx.projects.claimWorkflowStep(project.id, project.version, first.id)).project
  expect(project.runs[0]?.state).toBe('failed')
  project = await ctx.projects.startWorkflowRun(project.id, project.version, {
    workflowId: definition.id, workflowRevision: 1, input: null,
  })
  await expect(ctx.projects.resumeWorkflowRun(project.id, project.version, { runId: first.id, maxSteps: 2 })).rejects.toThrow()
})
