/**
 * Per-route configuration for the vendor-CLI model adapter.
 *
 * @module @arx-ai/arx-llm-agent-cli/config
 */

import z from '@arx-ai/schemastery'

/** One model this adapter serves on a route. */
export interface AgentCliModel {
  /** Model id callers pass as `GenerateOptions.model`. */
  id: string
  /**
   * Maximum combined request and response context. Required: automatic
   * compaction refuses to run against a route whose adapter advertises no
   * capacity, and the vendor CLI discloses none.
   */
  contextWindow: number
  /** Per-request output cap materialized when a caller omits one. */
  maxTokens?: number
  /** Human-readable name for selectors. */
  name?: string
  /**
   * Whether this model accepts image input. The CLI discloses no catalog, so a
   * route states it: declaring it on a model that refuses images turns every
   * attached image into a failed request instead of a refused attachment.
   */
  acceptsImages?: boolean
}

/** One provider route backed by a subscription-authenticated vendor CLI. */
export interface AgentCliProfile {
  /** Human-readable provider name for selectors and diagnostics. */
  displayName?: string
  /** Grace between subprocess termination tiers for this route's CLI. */
  disposeGraceMs?: number
  /** Models this route serves. */
  models?: AgentCliModel[]
}

/** Plugin configuration: provider routes keyed by route id. */
export interface Config {
  /**
   * Routes this adapter serves, keyed by the route id requests name. An empty
   * section leaves the plugin mounted and holding no route, so a deployment
   * that has not logged the host CLI in offers nothing to select.
   */
  providers?: Record<string, AgentCliProfile>
  /**
   * Workspace the vendor CLI runs in. The adapter serves requests from every
   * session in one process, so this is a deployment fact rather than a session
   * one; absent, the CLI runs where the harness process runs.
   */
  cwd?: string
}

const model: z<AgentCliModel> = z.object({
  id: z.string().required(),
  contextWindow: z.number().step(1).min(1).required(),
  maxTokens: z.number().step(1).min(1),
  name: z.string(),
  acceptsImages: z.boolean(),
})

const profile: z<AgentCliProfile> = z.object({
  displayName: z.string(),
  disposeGraceMs: z.number().step(1).min(1),
  models: z.array(model),
})

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  providers: z.dict(profile).default({}),
  cwd: z.string(),
})

/** One route resolved from configuration, with every default materialized. */
export interface ResolvedRoute {
  readonly provider: string
  readonly displayName: string
  readonly disposeGraceMs: number
  readonly models: ReadonlyMap<string, AgentCliModel>
}

/**
 * Grace the provider allows between subprocess termination tiers when a route
 * configures none. It matches the shipped subagent provider's own default, so
 * one CLI does not linger longer than another for want of configuration.
 */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/**
 * Resolve configured routes, materializing defaults once instead of at each
 * request.
 * @param providers - the `providers` section as configuration stored it.
 * @returns one resolved route per configured provider, keyed by route id.
 */
export function resolveRoutes(
  providers: Readonly<Record<string, AgentCliProfile>>,
): ReadonlyMap<string, ResolvedRoute> {
  const routes = new Map<string, ResolvedRoute>()
  for (const [provider, configured] of Object.entries(providers)) {
    const models = new Map<string, AgentCliModel>()
    for (const entry of configured.models ?? []) models.set(entry.id, entry)
    routes.set(provider, {
      provider,
      displayName: configured.displayName ?? provider,
      disposeGraceMs: configured.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS,
      models,
    })
  }
  return routes
}
