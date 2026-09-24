/**
 * Per-route configuration for the vendor-CLI model adapter.
 *
 * @module @arx-ai/arx-llm-agent-cli/config
 */

import z from '@arx-ai/schemastery'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'

/** One model this adapter serves on a route. */
export interface AgentCliModel {
  /** Model id callers pass as `GenerateOptions.model`. */
  id: string
  /**
   * Maximum combined request and response context. Exact canonical model ids
   * inherit this value from the installed provider catalog; unknown ids and
   * aliases require an explicit value.
   */
  contextWindow?: number
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
  /**
   * Effort levels this model accepts, in the order a selector should offer
   * them. Declared rather than discovered: the SDK does publish these levels,
   * but only for its alias rows, while a route pins explicit ids. Omitting the
   * field leaves the model with no effort control, so requests carry the
   * vendor's own default; declaring a level the model does not serve makes the
   * vendor silently downgrade it, which the selector then misreports.
   */
  efforts?: AgentCliEffort[]
  /**
   * Effort materialized into requests that name none. Must be one of
   * {@link efforts}; absent, an unspecified request keeps the vendor default.
   */
  defaultEffort?: AgentCliEffort
}

/**
 * Effort levels the vendor CLI accepts, as its SDK declares them.
 *
 * A closed set rather than free text: it is the vendor's own parameter domain,
 * so a route cannot widen it, and a value outside it is a request the CLI
 * refuses rather than a deployment choice.
 */
export const AGENT_CLI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** One effort level the vendor CLI accepts. */
export type AgentCliEffort = (typeof AGENT_CLI_EFFORTS)[number]

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

const effort: z<AgentCliEffort> = z.union(AGENT_CLI_EFFORTS.map(level => z.const(level)))

const model: z<AgentCliModel> = z.object({
  id: z.string().required(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  name: z.string(),
  acceptsImages: z.boolean(),
  efforts: z.array(effort),
  defaultEffort: effort,
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

/** Model metadata after explicit overrides and the installed catalog are resolved. */
export type ResolvedAgentCliModel = Omit<AgentCliModel, 'contextWindow'> & { contextWindow: number }

/** One route resolved from configuration, with every default materialized. */
export interface ResolvedRoute {
  readonly provider: string
  readonly displayName: string
  readonly disposeGraceMs: number
  readonly models: ReadonlyMap<string, ResolvedAgentCliModel>
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
    const catalog = getBuiltinModels('anthropic')
    const models = new Map<string, ResolvedAgentCliModel>()
    for (const entry of configured.models ?? []) {
      if (entry.defaultEffort !== undefined && !(entry.efforts ?? []).includes(entry.defaultEffort)) {
        throw new Error(
          `llm-agent-cli: provider "${provider}" model "${entry.id}" defaults to effort `
          + `"${entry.defaultEffort}", which is not among its declared efforts`,
        )
      }
      const known = catalog.find(model => model.id === entry.id)
      const contextWindow = entry.contextWindow ?? known?.contextWindow
      if (contextWindow === undefined) {
        throw new Error(`llm-agent-cli: model "${entry.id}" is absent from the installed catalog; specify contextWindow`)
      }
      models.set(entry.id, {
        ...entry,
        contextWindow,
        ...(entry.maxTokens === undefined && known !== undefined ? { maxTokens: known.maxTokens } : {}),
        ...(entry.acceptsImages === undefined && known !== undefined ? { acceptsImages: known.input.includes('image') } : {}),
      })
    }
    routes.set(provider, {
      provider,
      displayName: configured.displayName ?? provider,
      disposeGraceMs: configured.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS,
      models,
    })
  }
  return routes
}
