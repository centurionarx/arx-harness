/**
 * Chat route model entries built from a native account's model roster.
 *
 * A native product lists the models its signed-in plan offers: Claude Code
 * through the Agent SDK's `supportedModels()`, and Codex through the
 * app-server's `model/list`, which its server filters by plan and client
 * version. Each product feeds one chat route. This module turns a roster into
 * that route's model entries and never states a capacity the route can
 * resolve on its own.
 *
 * @module @arx-ai/arx-client-ui-settings-models/chat-roster
 */
import type { NativeAccountModel, NativeAccountProvider } from '@arx-ai/arx-api-remotes/client'

/** Where one native product's chat route lives in settings. */
export interface ChatRouteTarget {
  /** Settings namespace whose `providers` section holds the route. */
  readonly ns: string
  /** Route id under that section's `providers`. */
  readonly route: string
}

/** The chat route each native product's roster feeds. */
export const CHAT_ROUTES: Readonly<Record<NativeAccountProvider, ChatRouteTarget>> = {
  'claude-code': { ns: 'llm-agent-cli', route: 'claude-subscription' },
  codex: { ns: 'llm-pi-ai', route: 'openai-codex' },
}

/**
 * Whether a chat route serves an account's roster: `absent` has no route,
 * `stale` lacks at least one roster model, and `current` serves them all.
 */
export type ChatRouteState = 'absent' | 'stale' | 'current'

/** One model entry a route stores under `models`; settings values cross the wire untyped. */
export type RouteModelEntry = { readonly id: string } & Readonly<Record<string, unknown>>

/** Effort levels an `llm-agent-cli` route accepts; the product may report others. */
const AGENT_CLI_EFFORTS: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/**
 * The pi-ai thinking level each Codex effort selects. An effort pi-ai has no
 * level for, such as `ultra`, cannot be offered and is left out.
 */
const PI_AI_LEVEL_OF: Readonly<Record<string, string>> = {
  none: 'off', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
}

/**
 * The model entries of a Claude Code roster, one per model the route serves.
 * Each entry is the row's resolved canonical id, which the route sizes from
 * the installed catalog, including an id with the CLI's `[1m]` suffix. The
 * roster's `default` row names the model the product recommends rather than a
 * model of its own, so a row naming the same model directly supplies the name.
 * @param models - the account's roster, in the product's order.
 * @returns the entries in roster order, one per resolved id.
 */
export function claudeRouteEntries(models: readonly NativeAccountModel[]): RouteModelEntry[] {
  const rows = new Map<string, { entry: RouteModelEntry; recommended: boolean }>()
  for (const model of models) {
    const id = model.resolvedModel ?? model.id
    if (rows.get(id)?.recommended === false) continue
    rows.set(id, {
      entry: {
        id,
        name: model.name,
        ...model.efforts === undefined ? {} : { efforts: model.efforts.filter(effort => AGENT_CLI_EFFORTS.has(effort)) },
      },
      recommended: model.id === 'default',
    })
  }
  return [...rows.values()].map(row => row.entry)
}

/**
 * The model entries of a Codex roster for the pi-ai `openai-codex` route. A
 * model the installed catalog describes is named by id alone, so it keeps the
 * catalog's name, capacities, and reasoning levels. Any other model carries
 * the roster's name and the efforts pi-ai can offer, and takes the route's
 * default capacities.
 * @param models - the account's roster, in the product's order.
 * @param catalog - the model ids pi-ai's installed `openai-codex` catalog describes.
 * @returns the entries in roster order, one per model id.
 */
export function codexRouteEntries(models: readonly NativeAccountModel[], catalog: ReadonlySet<string>): RouteModelEntry[] {
  const rows = new Map<string, RouteModelEntry>()
  for (const model of models) {
    if (rows.has(model.id)) continue
    if (catalog.has(model.id)) {
      rows.set(model.id, { id: model.id })
      continue
    }
    const levels = (model.efforts ?? []).flatMap((effort) => {
      const level = PI_AI_LEVEL_OF[effort]
      return level === undefined ? [] : [[level, effort] as const]
    })
    rows.set(model.id, {
      id: model.id,
      name: model.name,
      ...levels.length === 0 ? {} : { reasoningEfforts: Object.fromEntries(levels) },
    })
  }
  return [...rows.values()]
}

/**
 * The route object a settings namespace stores for one route.
 * @param value - the namespace value from the settings view.
 * @param route - route id under `providers`.
 * @returns the stored route, or `undefined` when the namespace configures none.
 */
export function storedRoute(value: unknown, route: string): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const providers = (value as { providers?: unknown }).providers
  if (typeof providers !== 'object' || providers === null) return undefined
  const stored = (providers as Record<string, unknown>)[route]
  return typeof stored === 'object' && stored !== null ? stored as Readonly<Record<string, unknown>> : undefined
}

/**
 * The model entries a stored route lists, as it stores them.
 * @param route - the stored route object.
 * @returns the listed entries; empty when the route lists none.
 */
export function storedModels(route: Readonly<Record<string, unknown>>): readonly unknown[] {
  return Array.isArray(route.models) ? route.models : []
}

/**
 * The id of one stored model entry.
 * @param entry - one stored entry, untyped as settings values are.
 * @returns its id, or `undefined` for an entry without one.
 */
export function entryId(entry: unknown): string | undefined {
  const id = typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined
  return typeof id === 'string' ? id : undefined
}
