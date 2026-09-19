/** Project Workspace-backed Session creation for one settled webhook rule. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@arx-ai/cordis'
import { installModelSelection, type ModelSelection } from '@arx-ai/arx-agent'
import type {} from '@arx-ai/arx-agent-default-model'
import type {} from '@arx-ai/arx-agent-presets'
import { createUserMessage } from '@arx-ai/arx-llm'
import type {} from '@arx-ai/arx-permission-presets'
import type {} from '@arx-ai/arx-project'
import { SessionId } from '@arx-ai/arx-session'
import type {} from '@arx-ai/arx-session-title'
import type {} from '@arx-ai/arx-workspace'
import type { VerifiedWebhookDelivery, WebhookSessionRequest } from './types.ts'
import type { WebhookRuleId } from './brand.ts'

/**
 * Create, attach, configure, durably prompt, and return one ordinary root Session.
 * @param ctx - runtime context that owns the resulting Agent.
 * @param delivery - authenticated provider provenance.
 * @param ruleId - rule that produced the request.
 * @param request - validated project, Workspace, composition, and prompt selection.
 * @param signal - registration lifetime through durable prompt admission.
 * @returns the new Session id after its initial prompt reaches persistence.
 */
export async function createWebhookSession(
  ctx: Context,
  delivery: VerifiedWebhookDelivery,
  ruleId: WebhookRuleId,
  request: WebhookSessionRequest,
  signal: AbortSignal,
): Promise<SessionId> {
  const project = await ctx.projects.get(request.projectId)
  if (project === undefined) throw new Error(`webhook project '${request.projectId}' does not exist`)
  if (project.workspaceId !== request.workspaceId) {
    throw new Error(`webhook project '${request.projectId}' does not own Workspace '${request.workspaceId}'`)
  }
  const workspace = ctx.workspaceRegistry.get(request.workspaceId)
  if (workspace === undefined) throw new Error(`webhook Workspace '${request.workspaceId}' does not exist`)
  if (await workspace.status() !== 'ok') throw new Error(`webhook Workspace '${request.workspaceId}' is unavailable`)
  ctx.permissionPresets.resolve(request.permissionPreset)
  const preset = await ctx.agentPresets.resolve(request.agentPreset)
  await ctx.agentPresets.standingKeyFor(preset.id)
  const selected = request.model ?? ctx.agentDefaultModel.currentSelection()
  if (selected === undefined) throw new Error('webhook requires an explicit or configured default model')
  const selection: ModelSelection = { provider: selected.provider, model: selected.model }
  signal.throwIfAborted()

  const sessionId = SessionId(`webhook-${randomUUID()}`)
  const handle = await ctx.agents.create({
    sessionId,
    signal,
    meta: { cwd: workspace.path, agentPreset: preset.id },
    agentOptions: {
      provider: selected.provider,
      model: selected.model,
      ...request.model?.maxTokens === undefined ? {} : { maxTokens: request.model.maxTokens },
    },
    setup: async (agentCtx) => {
      await ctx.agentPresets.mount(agentCtx, preset.id)
      installModelSelection(agentCtx, { current: selection, assembled: undefined })
    },
  })

  let attached = false
  try {
    signal.throwIfAborted()
    await workspace.attachSession(sessionId)
    attached = true
    ctx.permissionPresets.set(handle.agent.session, request.permissionPreset)
    ctx.sessionTitle.rename(handle.agent.session, request.title)
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: request.prompt }],
      source: {
        kind: 'webhook',
        provider: delivery.kind,
        source: delivery.source,
        deliveryId: delivery.deliveryId,
        ruleId,
        projectId: request.projectId,
      },
    }))
    await ctx.sessions.flush(handle.agent.session)
    return sessionId
  } catch (error: unknown) {
    if (attached) {
      try { await workspace.detachSession(sessionId) } catch (rollbackError: unknown) {
        ctx.logger.warn(`webhook Workspace detach rollback failed: ${String(rollbackError)}`)
      }
    }
    try { await handle.dispose() } catch (rollbackError: unknown) {
      ctx.logger.warn(`webhook Agent rollback failed: ${String(rollbackError)}`)
    }
    throw error
  }
}
