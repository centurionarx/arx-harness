// @vitest-environment jsdom
import { Context } from '@arx-ai/cordis'
import { SlotRegistry } from '@arx-ai/arx-client-runtime/client'
import { LocaleRuntime } from '@arx-ai/arx-client-locale/client'
import { expect, it, vi } from 'vitest'
import * as Projects from '../src/client/index.ts'
import type { ProjectsInjected } from '../src/client/ProjectsEntry.tsx'

it('mounts after sidebar ownership, forwards versioned requests and unloads its contribution', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const remote = Object.fromEntries(
    [
      'list',
      'get',
      'create',
      'savePlan',
      'approvePlan',
      'savePrompt',
      'finalizePromptEvaluation',
      'configureBudget',
      'resumeWorkflowRun',
      'reconcileWorkflowRun',
    ].map(name => [name, vi.fn(async (...args: unknown[]) => ({ ok: true, value: args }))]),
  )
  ctx.provide('remote', { projects: remote })
  ctx.provide('remote.projects', remote)
  const open = vi.fn()
  ctx.provide('sessions', { open })
  const fiber = ctx.plugin(Projects)
  await fiber
  const owner = ctx.slots.register(
    {
      name: 'root',
      children: {
        'sidebar.footer.action': { kind: 'list', scope: 'global' },
      },
    } as never,
    (() => null) as never,
  )
  const entry = ctx.slots.entries('sidebar.footer.action')[0]!
  expect(entry.options.id).toBe('projects')
  const injected = entry.inject!() as unknown as ProjectsInjected
  const id = 'project' as Parameters<ProjectsInjected['get']>[0]
  const runId = 'run' as Parameters<ProjectsInjected['resumeRun']>[2]['runId']
  const evaluationId = 'evaluation' as Parameters<ProjectsInjected['finalizeEvaluation']>[2]['evaluationId']
  const workspaceId = 'workspace' as Parameters<ProjectsInjected['create']>[0]['workspaceId']
  await injected.list()
  expect(remote.list).toHaveBeenCalledWith()
  expect(await injected.get(id)).toEqual([id])
  const create = { name: 'Release', workspaceId }
  expect(await injected.create(create)).toEqual([create])
  const plan = {
    summary: 'Ship',
    items: [
      {
        id: 'item' as Parameters<ProjectsInjected['savePlan']>[2]['items'][number]['id'],
        title: 'Review',
        acceptanceCriteria: [],
        dependsOn: [],
      },
    ],
  }
  expect(await injected.savePlan(id, 7, plan)).toEqual([id, 7, plan])
  expect(await injected.approvePlan(id, 8, 1)).toEqual([id, 8, 1])
  const prompt = { name: 'Reviewer', template: 'Review', variablesSchema: {}, sourceSkills: [] }
  expect(await injected.savePrompt(id, 9, prompt)).toEqual([id, 9, prompt])
  const budget = { maxActiveRuns: 1, maxStepsPerRun: 2, maxRunDurationMs: 1000 }
  expect(await injected.configureBudget(id, 10, budget)).toEqual([id, 10, budget])
  const resume = { runId, maxSteps: 2, maxDurationMs: 1000 }
  expect(await injected.resumeRun(id, 11, resume)).toEqual([id, 11, resume])
  const reconcile = { runId, state: 'pending' as const }
  expect(await injected.reconcileRun(id, 12, reconcile)).toEqual([id, 12, reconcile])
  expect(await injected.finalizeEvaluation(id, 13, { evaluationId })).toEqual([id, 13, { evaluationId }])
  const sessionId = 'session' as Parameters<ProjectsInjected['openSession']>[0]
  injected.openSession(sessionId)
  expect(open).toHaveBeenCalledWith(sessionId)
  remote.get!.mockImplementationOnce(async () => ({ ok: false, error: { message: 'Stale project' } }) as never)
  await expect(injected.get(id)).rejects.toThrow('Stale project')
  await fiber.dispose()
  expect(ctx.slots.entries('sidebar.footer.action')).toEqual([])
  owner()
  await ctx.fiber.dispose()
})
