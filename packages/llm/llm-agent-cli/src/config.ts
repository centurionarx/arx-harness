/**
 * Per-route configuration for the vendor-CLI model adapter.
 *
 * @module @arx-ai/arx-llm-agent-cli/config
 */

import z from '@arx-ai/schemastery'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'

import { AGENT_CLI_PRESETS } from './presets.ts'

/** One model this adapter serves on a route. */
export interface AgentCliModel {
  /** Model id callers pass as `GenerateOptions.model`. */
  id: string
  /**
   * Maximum combined request and response context. An exact canonical model id
   * inherits it from the installed Anthropic catalog; an unknown id or alias
   * must state it, because automatic compaction refuses to run against a route
   * whose adapter advertises no capacity and the vendor CLI discloses none.
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

/** Model metadata after explicit values and the installed catalog are resolved. */
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
 *
 * This is where the whole section's absence defaults too, beside every other
 * default it materializes: a composition entry that configures no route at all
 * resolves to no routes, which is the plugin's dormant posture.
 *
 * A profile that names no display name takes the one this package offers the
 * route under, and only a route the package does not offer falls back to its
 * id. Otherwise a surface that configures an offered route without renaming it
 * would see the route change name the moment it was saved.
 *
 * A model that states no context window inherits the installed Anthropic
 * catalog's context window for its exact id, and with it the catalog's output
 * cap and image input where the model states none. A model the catalog does
 * not list must state its context window, or resolution throws.
 * @param providers - the `providers` section as configuration stored it, or
 *   `undefined` when the configuration carries no section.
 * @returns one resolved route per configured provider, keyed by route id.
 */
export function resolveRoutes(
  providers: Readonly<Record<string, AgentCliProfile>> | undefined,
): ReadonlyMap<string, ResolvedRoute> {
  const routes = new Map<string, ResolvedRoute>()
  const catalog = getBuiltinModels('anthropic')
  for (const [provider, configured] of Object.entries(providers ?? {})) {
    const models = new Map<string, ResolvedAgentCliModel>()
    for (const entry of configured.models ?? []) {
      if (entry.defaultEffort !== undefined && !(entry.efforts ?? []).includes(entry.defaultEffort)) {
        throw new Error(
          `llm-agent-cli: provider "${provider}" model "${entry.id}" defaults to effort `
          + `"${entry.defaultEffort}", which is not among its declared efforts`,
        )
      }
      const known = catalog.find(row => row.id === entry.id)
      const contextWindow = entry.contextWindow ?? known?.contextWindow
      if (contextWindow === undefined) {
        throw new Error(
          `llm-agent-cli: provider "${provider}" model "${entry.id}" is absent from the installed catalog; `
          + 'state its contextWindow',
        )
      }
      models.set(entry.id, {
        ...entry,
        contextWindow,
        ...entry.maxTokens === undefined && known !== undefined ? { maxTokens: known.maxTokens } : {},
        ...entry.acceptsImages === undefined && known !== undefined ? { acceptsImages: known.input.includes('image') } : {},
      })
    }
    routes.set(provider, {
      provider,
      displayName: configured.displayName
        ?? AGENT_CLI_PRESETS.find(preset => preset.provider === provider)?.displayName
        ?? provider,
      disposeGraceMs: configured.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS,
      models,
    })
  }
  return routes
}
