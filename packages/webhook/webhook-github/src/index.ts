/** Signed GitHub HTTP adapter with explicit allowlists and project binding. */

import type { Context } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import type {} from '@arx-ai/arx-credentials'
import type {} from '@arx-ai/arx-host-webserver'
import type {} from '@arx-ai/arx-webhook'
import { createGitHubWebhookIntegration, githubSecretRef } from './handler.ts'

export type * from './types.ts'
export { githubWebhookPrompt } from './handler.ts'
export { readBoundedBody, verifyGitHubSignature, WebhookHttpError } from './body.ts'

export const name = 'webhook-github'
export const inject = ['credentials', 'webServer', 'webhookRuntime']

/** Required GitHub route, allowlist, and Agent binding. */
export interface Config {
  /** Stable adapter namespace included in durable delivery identity and webhook message provenance. */
  readonly source: string
  /** Stable rule identity combined with source and GitHub delivery id for durable deduplication. */
  readonly ruleId: string
  /** Exact HTTP pathname on which this optional adapter accepts GitHub POST requests. */
  readonly path: string
  /** Environment credential reference whose value is the GitHub webhook shared secret. */
  readonly secretEnv: string
  /** Inclusive byte ceiling applied to the raw request body before signature verification and JSON parsing. */
  readonly maxBodyBytes: number
  /** Exact GitHub owner/name repository allowlist accepted after authentication. */
  readonly repositories: string[]
  /** Exact X-GitHub-Event name allowlist accepted after authentication. */
  readonly events: string[]
  /** Existing durable project that will own Sessions created for accepted deliveries. */
  readonly projectId: string
  /** Exact Workspace within projectId used as the new Session cwd and ownership boundary. */
  readonly workspaceId: string
  /** Existing Agent preset mounted before publishing each webhook-created Agent. */
  readonly agentPreset: string
  /** Existing permission preset recorded on each webhook-created Session. */
  readonly permissionPreset: string
  /** Trusted deployment instruction presented separately from the untrusted GitHub payload. */
  readonly instruction: string
  /** Optional model route for webhook-created Agents; omission uses the configured default selection. */
  readonly model?: {
    /** Registered model provider name selected for the new Agent. */
    readonly provider: string
    /** Provider-specific model identifier selected for the new Agent. */
    readonly model: string
    /** Optional positive output-token ceiling applied to the new Agent. */
    readonly maxTokens?: number
  }
}

export const Config: z<Config> = z.object({
  source: z.string().required(),
  ruleId: z.string().required(),
  path: z.string().required(),
  secretEnv: z.string().role('credential-ref').required(),
  maxBodyBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  repositories: z.array(z.string()).required(),
  events: z.array(z.string()).required(),
  projectId: z.string().required(),
  workspaceId: z.string().required(),
  agentPreset: z.string().required(),
  permissionPreset: z.string().required(),
  instruction: z.string().required(),
  // Preserve omission; Schemastery otherwise materializes the optional object as `{}`.
  model: z.object({
    provider: z.string().required(),
    model: z.string().required(),
    maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  }).default(undefined as unknown as { provider: string; model: string; maxTokens: number }),
})

function trimmed(value: string, field: string): void {
  if (value.trim() !== value || value === '') throw new Error(`webhook-github ${field} must be non-empty and trimmed`)
}

function validate(config: Config): void {
  for (const field of ['source', 'ruleId', 'projectId', 'workspaceId', 'agentPreset', 'permissionPreset', 'instruction'] as const) {
    trimmed(config[field], field)
  }
  if (!config.path.startsWith('/') || config.path === '/' || config.path.endsWith('/') || config.path.includes('?') || config.path.includes('#')) {
    throw new Error('webhook-github path must be an absolute non-root pathname without a trailing slash, query, or fragment')
  }
  if (config.repositories.length === 0 || new Set(config.repositories).size !== config.repositories.length) {
    throw new Error('webhook-github repositories must be a non-empty unique allowlist')
  }
  if (config.events.length === 0 || new Set(config.events).size !== config.events.length) {
    throw new Error('webhook-github events must be a non-empty unique allowlist')
  }
  for (const value of [...config.repositories, ...config.events]) trimmed(value, 'allowlist entry')
  if (config.model !== undefined) {
    trimmed(config.model.provider, 'model.provider')
    trimmed(config.model.model, 'model.model')
  }
  githubSecretRef(config.secretEnv)
}

/** Register one exact route and its matching rule as one disposal unit. */
export function apply(ctx: Context, config: Config): void {
  validate(config)
  ctx.effect(function* () {
    const integration = createGitHubWebhookIntegration(ctx, {
      source: config.source,
      ruleId: config.ruleId,
      secretEnv: githubSecretRef(config.secretEnv),
      maxBodyBytes: config.maxBodyBytes,
      repositories: new Set(config.repositories),
      events: new Set(config.events),
      projectId: config.projectId,
      workspaceId: config.workspaceId,
      agentPreset: config.agentPreset,
      permissionPreset: config.permissionPreset,
      instruction: config.instruction,
      ...(config.model === undefined ? {} : { model: config.model }),
    })
    yield integration.disposeRule
    yield ctx.webServer.register({ ...integration.route, path: config.path })
  }, `webhook-github: ${config.path}`)
}
