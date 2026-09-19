import { describe, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import type { CreateAgentOptions } from '@arx-ai/arx-agent'
import { ProjectId } from '@arx-ai/arx-project'
import { WorkspaceId } from '@arx-ai/arx-workspace'
import {
  WebhookDeliveryId, WebhookRuleId, WebhookSourceId,
} from '../src/index.ts'
import { createWebhookSession } from '../src/session.ts'
import type { VerifiedWebhookDelivery, WebhookSessionRequest } from '../src/types.ts'

const delivery: VerifiedWebhookDelivery = {
  kind: 'github',
  source: WebhookSourceId('source'),
  deliveryId: WebhookDeliveryId('delivery'),
  event: {},
  receivedAt: 1,
}

const baseRequest: WebhookSessionRequest = {
  projectId: ProjectId('project'),
  workspaceId: WorkspaceId('workspace'),
  title: 'Webhook title',
  prompt: 'Bounded prompt',
  agentPreset: 'standard',
  permissionPreset: 'workspace-write',
}

interface Scenario {
  readonly project?: unknown
  readonly workspace?: unknown
  readonly defaultModel?: unknown
  readonly createError?: Error
  readonly attachError?: Error
  readonly flushError?: Error
  readonly detachError?: Error
  readonly disposeError?: Error
}

function setup(overrides: Scenario = {}) {
  const ctx = new Context()
  const session = { id: 'session', events: [] }
  const followup = vi.fn()
  const dispose = vi.fn(async () => {
    if (overrides.disposeError !== undefined) throw overrides.disposeError
  })
  const create = vi.fn(async (_options: CreateAgentOptions) => {
    if (overrides.createError !== undefined) throw overrides.createError
    return { agent: { session, followup }, dispose }
  })
  const detachSession = vi.fn(async () => {
    if (overrides.detachError !== undefined) throw overrides.detachError
  })
  const attachSession = vi.fn(async () => {
    if (overrides.attachError !== undefined) throw overrides.attachError
  })
  const workspace = overrides.workspace === undefined
    ? { path: 'C:\\workspace', status: async () => 'ok', attachSession, detachSession }
    : overrides.workspace
  ctx.provide('projects', {
    get: vi.fn(async () => overrides.project === undefined
      ? { id: ProjectId('project'), workspaceId: WorkspaceId('workspace') }
      : overrides.project),
  } as never)
  ctx.provide('workspaceRegistry', {
    get: vi.fn(() => workspace),
  } as never)
  ctx.provide('permissionPresets', { resolve: vi.fn(), set: vi.fn() } as never)
  ctx.provide('agentPresets', {
    resolve: vi.fn(async (id: string) => ({ id })),
    standingKeyFor: vi.fn(async () => 'standard'),
    mount: vi.fn(async () => {}),
  } as never)
  ctx.provide('agentDefaultModel', {
    currentSelection: vi.fn(() => overrides.defaultModel === undefined
      ? { provider: 'provider', model: 'default-model' }
      : overrides.defaultModel),
  } as never)
  ctx.provide('agents', { create } as never)
  ctx.provide('sessions', {
    flush: vi.fn(async () => {
      if (overrides.flushError !== undefined) throw overrides.flushError
    }),
  } as never)
  ctx.provide('sessionTitle', { rename: vi.fn() } as never)
  return { ctx, create, dispose, followup, attachSession, detachSession }
}

async function create(scenario: ReturnType<typeof setup>, request = baseRequest): Promise<unknown> {
  return await createWebhookSession(
    scenario.ctx, delivery, WebhookRuleId('rule'), request, new AbortController().signal,
  )
}

describe('webhook Session creation boundaries', () => {
  it('rejects missing or mismatched project and Workspace state before creating an Agent', async () => {
    const missingProject = setup({ project: null })
    missingProject.ctx.projects.get = vi.fn(async () => undefined)
    await expect(create(missingProject)).rejects.toThrow(/project 'project' does not exist/)

    const mismatched = setup({ project: { workspaceId: WorkspaceId('other') } })
    await expect(create(mismatched)).rejects.toThrow(/does not own Workspace/)

    const missingWorkspace = setup({ workspace: null })
    missingWorkspace.ctx.workspaceRegistry.get = vi.fn(() => undefined)
    await expect(create(missingWorkspace)).rejects.toThrow(/Workspace 'workspace' does not exist/)

    const unavailable = setup({ workspace: {
      path: 'C:\\workspace', status: async () => 'error',
      attachSession: vi.fn(), detachSession: vi.fn(),
    } })
    await expect(create(unavailable)).rejects.toThrow(/Workspace 'workspace' is unavailable/)
    expect(missingProject.create).not.toHaveBeenCalled()
    expect(mismatched.create).not.toHaveBeenCalled()
    expect(missingWorkspace.create).not.toHaveBeenCalled()
    expect(unavailable.create).not.toHaveBeenCalled()
  })

  it('requires either an explicit or configured default model', async () => {
    const scenario = setup()
    scenario.ctx.agentDefaultModel.currentSelection = vi.fn(() => undefined)
    await expect(create(scenario)).rejects.toThrow(/requires an explicit or configured default model/)
    expect(scenario.create).not.toHaveBeenCalled()
  })

  it('passes an explicit model and token ceiling into Agent creation', async () => {
    const scenario = setup()
    await expect(create(scenario, {
      ...baseRequest,
      model: { provider: 'explicit', model: 'selected', maxTokens: 321 },
    })).resolves.toMatch(/^webhook-/)
    expect(scenario.create).toHaveBeenCalledWith(expect.objectContaining({
      agentOptions: { provider: 'explicit', model: 'selected', maxTokens: 321 },
    }))
    expect(scenario.attachSession).toHaveBeenCalledTimes(1)
    expect(scenario.followup).toHaveBeenCalledTimes(1)
  })

  it('disposes an unpublished Agent when Workspace attachment fails', async () => {
    const scenario = setup({ attachError: new Error('attach failed') })
    await expect(create(scenario)).rejects.toThrow('attach failed')
    expect(scenario.detachSession).not.toHaveBeenCalled()
    expect(scenario.dispose).toHaveBeenCalledTimes(1)
  })

  it('detaches and disposes after a post-attachment persistence failure', async () => {
    const scenario = setup({ flushError: new Error('flush failed') })
    await expect(create(scenario)).rejects.toThrow('flush failed')
    expect(scenario.detachSession).toHaveBeenCalledTimes(1)
    expect(scenario.dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps the original failure and reports both rollback failures', async () => {
    const scenario = setup({
      flushError: new Error('flush failed'),
      detachError: new Error('detach failed'),
      disposeError: new Error('dispose failed'),
    })
    const warn = vi.spyOn(scenario.ctx.logger, 'warn')
    await expect(create(scenario)).rejects.toThrow('flush failed')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('detach rollback failed'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Agent rollback failed'))
  })
})
