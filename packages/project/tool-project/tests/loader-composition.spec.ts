import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import Loader from '@arx-ai/cordis-plugin-loader'
import Include from '@arx-ai/cordis-plugin-include'
import { CallId } from '@arx-ai/arx-llm'
import type { Agent } from '@arx-ai/arx-agent'
import { SessionId } from '@arx-ai/arx-session'
import type { SessionPersistence } from '@arx-ai/arx-session-persistence'
import Storage from '@arx-ai/arx-storage'
import * as StorageDomain from '@arx-ai/arx-storage-domain'
import * as StorageJson from '@arx-ai/arx-storage-json'
import SystemPrompt from '@arx-ai/arx-system-prompt'
import ToolRuntime from '@arx-ai/arx-tools'
import { WorkspaceId } from '@arx-ai/arx-workspace'
import type { Workspace, WorkspaceRegistry } from '@arx-ai/arx-workspace'
import * as Project from '@arx-ai/arx-project'
import type { PlanItemId, ProjectWorkflowStepId } from '@arx-ai/arx-project/types'
import * as ToolProject from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function resultJson(result: { readonly isError: boolean; readonly content: readonly { type: string; text?: string }[] }) {
  expect(result.isError).toBe(false)
  const block = result.content[0]
  if (block?.type !== 'text' || block.text === undefined) throw new Error('expected text tool result')
  return JSON.parse(block.text) as Record<string, unknown>
}

describe('project tool real Loader composition through cordis.yml', () => {
  it('boots the service and consumer, then returns an effective prompt snapshot through the tool result', async () => {
    root = await mkdtemp(join(tmpdir(), 'arx-project-loader-'))
    const workspacePath = join(root, 'workspace')
    const storageRoot = join(root, 'storage')
    await import('node:fs/promises').then(fs => fs.mkdir(workspacePath))
    const workspaceId = WorkspaceId('loader-workspace')
    const parentSessionId = SessionId('loader-parent')
    const workspace: Workspace = {
      id: workspaceId,
      path: workspacePath,
      title: 'Loader workspace',
      createdAt: '2026-09-12T00:00:00.000Z',
      updatedAt: '2026-09-12T00:00:00.000Z',
      sessionIds: [parentSessionId],
      setTitle: async () => {},
      attachSession: async () => {},
      insertSessionBefore: async () => {},
      detachSession: async () => {},
      status: async () => 'ok',
    }
    const workspacePlugin = {
      name: 'project-loader-workspace-fixture',
      apply(ctx: Context) {
        ctx.provide('workspaceRegistry', {
          get: (id: typeof workspaceId) => id === workspaceId ? workspace : undefined,
        } as unknown as WorkspaceRegistry)
      },
    }
    const persistencePlugin = {
      name: 'project-loader-persistence-fixture',
      apply(ctx: Context) {
        ctx.provide('sessionPersistence', { list: async () => [{ id: parentSessionId, version: 0, createdAt: 1, cwd: workspacePath }] } as unknown as SessionPersistence)
      },
    }
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@arx-ai/arx-storage'",
      "- name: '@arx-ai/arx-storage-json'",
      '  config:',
      `    root: ${JSON.stringify(storageRoot)}`,
      "- name: '@arx-ai/arx-storage-domain'",
      '  config:',
      '    backend: json',
      "- name: '@fixture/workspace'",
      "- name: '@fixture/persistence'",
      "- name: '@arx-ai/arx-project'",
      "- name: '@arx-ai/arx-system-prompt'",
      "- name: '@arx-ai/arx-tools'",
      "- name: '@arx-ai/arx-tool-project'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@arx-ai/arx-storage', Storage],
      ['@arx-ai/arx-storage-json', StorageJson],
      ['@arx-ai/arx-storage-domain', StorageDomain],
      ['@fixture/workspace', workspacePlugin],
      ['@fixture/persistence', persistencePlugin],
      ['@arx-ai/arx-project', Project],
      ['@arx-ai/arx-system-prompt', SystemPrompt],
      ['@arx-ai/arx-tools', ToolRuntime],
      ['@arx-ai/arx-tool-project', ToolProject],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const signal = new AbortController().signal
    const forbiddenApproval = await context.tools.execute({
      signal,
      callId: CallId('project-approve-forbidden'),
      name: 'project',
      arguments: { action: 'approve_plan' as never, project_id: 'forbidden', expected_version: 1, input: { plan_revision: 1 } },
    })
    expect(forbiddenApproval).toMatchObject({ isError: true, error: { info: { code: 'INVALID_ARGS' } } })
    const created = resultJson(await context.tools.execute({
      signal,
      callId: CallId('project-create'),
      name: 'project',
      arguments: { action: 'create', input: { workspace_id: workspaceId, name: 'Loader project' } },
    }))
    const projectId = created['id']
    expect(typeof projectId).toBe('string')
    const unavailableSnapshot = await context.tools.execute({
      signal,
      callId: CallId('project-snapshot-unavailable'),
      name: 'project',
      arguments: {
        action: 'snapshot_skills',
        project_id: projectId as string,
        input: { repository: 'C:/missing', commit: '0000000000000000000000000000000000000000', paths: ['SKILL.md'] },
      },
    })
    expect(unavailableSnapshot).toMatchObject({ isError: true })
    const snapshotContent = unavailableSnapshot.content as readonly { readonly text?: string }[]
    expect(String(snapshotContent[0]?.text)).toContain('skill-git is not composed')
    const unavailableRunner = await context.tools.execute({
      signal,
      callId: CallId('project-runner-unavailable'),
      name: 'project',
      arguments: { action: 'execute_workflow', project_id: projectId as string, input: { run_id: 'missing' } },
    })
    expect(unavailableRunner).toMatchObject({ isError: true })
    const runnerContent = unavailableRunner.content as readonly { readonly text?: string }[]
    expect(String(runnerContent[0]?.text)).toContain('project-runner is not composed')
    const saved = resultJson(await context.tools.execute({
      signal,
      callId: CallId('project-save-prompt'),
      name: 'project',
      arguments: {
        action: 'save_prompt',
        project_id: projectId,
        expected_version: 1,
        input: {
          name: 'ship',
          purpose: 'Ship one approved target',
          tags: ['release'],
          examples: [{ id: 'ship-example', variables: { target: 'sample' }, expected_output: 'shipped' }],
          evaluation_cases: [{ id: 'ship-check', name: 'Ship check', variables: { target: 'evaluation' }, checks: { expected_substrings: ['shipped'] } }],
          template: 'Ship {{target}}',
          variables_schema: { target: { type: 'string', required: true } },
          source_skills: [{
            repository: 'https://example.test/skills.git',
            commit: 'abc123',
            path: 'skills/ship/SKILL.md',
            content: '# Ship\nVerify before delivery.\n',
          }],
        },
      },
    }))
    const prompts = saved['prompts'] as { id: string }[]
    const effective = resultJson(await context.tools.execute({
      signal,
      callId: CallId('project-render-prompt'),
      name: 'project',
      arguments: {
        action: 'render_prompt',
        project_id: projectId,
        expected_version: 2,
        input: { prompt_id: prompts[0]?.id, prompt_revision: 1, variables: { target: 'the release' } },
      },
    }))
    expect(effective).toMatchObject({
      renderedPrompt: 'Ship the release',
      sourceSkills: [{ content: '# Ship\nVerify before delivery.\n' }],
    })

    let driver = await context.projects.savePlan(Project.ProjectId(projectId as string), 2, {
      summary: 'Run approved work',
      items: [{ id: 'ship' as PlanItemId, title: 'Ship', acceptanceCriteria: ['Delivered'], dependsOn: [] }],
    })
    driver = await context.projects.approvePlan(driver.id, driver.version, 1)
    driver = await context.projects.saveWorkflow(driver.id, driver.version, {
      name: 'Approved flow',
      steps: [{
        id: 'ship' as ProjectWorkflowStepId,
        name: 'Ship',
        dependsOn: [],
        prompt: { promptId: driver.prompts[0]!.id, revision: 1 },
        variables: { target: 'the release' },
      }],
    })
    const started = resultJson(await context.tools.execute({
      signal,
      callId: CallId('project-start-driver'),
      name: 'project',
      agent: { session: { id: parentSessionId } } as unknown as Agent,
      arguments: {
        action: 'start_workflow',
        project_id: projectId as string,
        expected_version: driver.version,
        input: {
          workflow_id: driver.workflows[0]!.id,
          workflow_revision: 1,
          run_input: { goal: 'ship' },
          parent_session_id: 'forged-model-parent',
          plan_revision: 999,
        },
      },
    }))
    expect(started['runs']).toEqual([expect.objectContaining({
      planRevision: 1,
      parentSessionId,
      state: 'pending',
    })])
    const evaluation = resultJson(await context.tools.execute({
      signal,
      callId: CallId('project-start-evaluation'),
      name: 'project',
      agent: { session: { id: parentSessionId } } as unknown as Agent,
      arguments: {
        action: 'start_prompt_evaluation',
        project_id: projectId as string,
        expected_version: started['version'] as number,
        input: { prompt_id: prompts[0]?.id, prompt_revision: 1, plan_revision: 999, parent_session_id: 'forged' },
      },
    }))
    expect(evaluation['evaluations']).toEqual([expect.objectContaining({ promptRevision: 1 })])
    const evaluationRuns = evaluation['runs'] as { planRevision?: number; parentSessionId?: string }[]
    expect(evaluationRuns[1]).toMatchObject({ planRevision: 1, parentSessionId })
    expect(context.tools.get('project')).toBeDefined()
    expect((await context.systemPrompt.assemble()).sections.some(section => section.name === 'tool:project')).toBe(true)
  })
})
