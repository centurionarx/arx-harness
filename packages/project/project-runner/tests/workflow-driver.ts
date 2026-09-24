#!/usr/bin/env node
/** Keyless application driver: real project, workspace, persistence, tools and spawn. */

import assert from 'node:assert/strict'
import { mock } from 'node:test'
import type { Context } from '@arx-ai/cordis'
import { boot, installFailLoud, resolveConfigPath } from '@arx-ai/arx-app-boot'
import { runFixtureTurn } from '@arx-ai/arx-loader-smoke'
import type { ProjectRecord, PlanItemId, ProjectWorkflowStepId } from '@arx-ai/arx-project'
import { CallId, LlmAdapter } from '@arx-ai/arx-llm'
import type { LlmResolvedModelInfo, StreamChunk } from '@arx-ai/arx-llm'

class FixtureAdapter extends LlmAdapter {
  readonly script: StreamChunk[][] = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(): AsyncIterable<StreamChunk> {
    const chunks = this.script.shift()
    assert(chunks, 'fixture model script exhausted')
    yield* chunks
  }
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallResponse(action: string, name: string, args: object): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: {
      type: 'tool-call', id: CallId(action), name, arguments: JSON.stringify(args),
    } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

const [configPath, mode] = process.argv.slice(2)
assert(configPath && (mode === 'automatic' || mode === 'manual'))
const uninstall = installFailLoud('project-workflow-fixture')
// Date is the sole mocked clock; native timers, IO and lifecycle waits remain real.
mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-21T12:00:00.000Z') })
let ctx: Context | undefined
try {
  ctx = await boot('project-workflow-fixture', resolveConfigPath(configPath, undefined))
  const app = ctx
  const [parent] = app.agents.roots()
  assert(parent)
  const workspace = await app.workspaceRegistry.create(process.cwd())
  await workspace.attachSession(parent.session.id)
  const adapter = new FixtureAdapter()
  const script = adapter.script
  app.effect(() => app.llm.registerAdapter(['project-fixture'], adapter))
  let project = await app.projects.create({ workspaceId: workspace.id, name: 'Saved workflow' })
  project = await app.projects.savePlan(project.id, project.version, {
    summary: 'Run the saved task',
    items: [{ id: 'task' as PlanItemId, title: 'Task', acceptanceCriteria: ['Child completes'], dependsOn: [] }],
  })
  project = await app.projects.approvePlan(project.id, project.version, 1)
  project = await app.projects.savePrompt(project.id, project.version, {
    name: 'saved-task', template: 'Execute the saved task.', variablesSchema: {}, sourceSkills: [],
  })
  project = await app.projects.saveWorkflow(project.id, project.version, {
    name: 'One step',
    steps: [{ id: 'step' as ProjectWorkflowStepId, name: 'Saved task', dependsOn: [],
      prompt: { promptId: project.prompts[0]!.id, revision: 1 } }],
  })

  async function current(): Promise<ProjectRecord> {
    const value = await app.projects.get(project.id)
    assert(value)
    return value
  }

  async function toolTurn(action: string, input: object, answer: string, child = false): Promise<void> {
    project = await current()
    script.push(toolCallResponse(action, 'project', {
      action, project_id: project.id, expected_version: project.version, input,
    }))
    if (child) script.push(textResponse('Child completed saved task.'))
    script.push(textResponse(answer))
    const result = await runFixtureTurn(app, { task: action })
    assert.equal(result.output, answer)
    assert(parent)
    const results = parent.session.events.filter(event => event.type === 'tool/result')
    assert(results.length > 0)
    assert.equal(JSON.stringify(results.at(-1)).includes('\"isError\":true'), false)
  }

  await toolTurn('start_workflow', { workflow_id: project.workflows[0]!.id, workflow_revision: 1 }, 'Workflow reserved.')
  project = await current()
  const runId = project.runs[0]!.id
  if (mode === 'automatic') {
    await toolTurn('execute_workflow', { run_id: runId }, 'Workflow completed.', true)
  } else {
    await toolTurn('claim_workflow_step', { run_id: runId }, 'Step claimed.')
    script.push(textResponse('Child completed saved task.'))
    const child = await app.subagents.start('spawn', {
      parent, signal: new AbortController().signal,
      prompt: [{ type: 'text', text: 'Execute the saved task.' }], label: 'Saved task', maxDepth: 1,
    })
    try {
      const outcome = await child.result
      assert.equal(outcome.stopReason, 'completed')
      assert.equal(workspace.sessionIds.includes(child.id), false)
      await toolTurn('attach_workflow_step_session', { run_id: runId, step_id: 'step', session_id: child.id }, 'Child session attached.')
      await toolTurn('settle_workflow_step', {
        run_id: runId, step_id: 'step', state: 'completed',
        result: outcome.output.filter(block => block.type === 'text').map(block => block.text).join(''),
      }, 'Workflow completed.')
    } finally {
      await child.dispose()
    }
  }
  project = await current()
  const run = project.runs[0]!
  assert.equal(run.state, 'completed')
  assert.equal(run.steps[0]?.state, 'completed')
  const childId = run.steps[0]?.sessionId
  assert(childId)
  assert.deepEqual(workspace.sessionIds, [parent.session.id])
  assert.equal(app.agents.get(childId), undefined)
  assert.equal(script.length, 0)
  process.stdout.write(JSON.stringify({ mode, state: run.state, topLevelSessions: workspace.sessionIds.length }) + '\n')
} finally {
  await ctx?.fiber.dispose()
  mock.timers.reset()
  uninstall()
}
