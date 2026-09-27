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
 * `stale` lacks a roster model or offers a model other effort levels than the
 * roster reports, and `current` serves every roster model at its levels.
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
 * model the installed catalog describes keeps the catalog's name and
 * capacities; any other model carries the roster's name and takes the route's
 * default capacities. Either one carries the efforts the roster reports that
 * pi-ai can offer, which replace the catalog's levels for that model.
 * @param models - the account's roster, in the product's order.
 * @param catalog - the model ids pi-ai's installed `openai-codex` catalog describes.
 * @returns the entries in roster order, one per model id.
 */
export function codexRouteEntries(models: readonly NativeAccountModel[], catalog: ReadonlySet<string>): RouteModelEntry[] {
  const rows = new Map<string, RouteModelEntry>()
  for (const model of models) {
    if (rows.has(model.id)) continue
    const levels = (model.efforts ?? []).flatMap((effort) => {
      const level = PI_AI_LEVEL_OF[effort]
      return level === undefined ? [] : [[level, effort] as const]
    })
    rows.set(model.id, {
      id: model.id,
      ...catalog.has(model.id) ? {} : { name: model.name },
      ...levels.length === 0 ? {} : { reasoningEfforts: Object.fromEntries(levels) },
    })
  }
  return [...rows.values()]
}

/** The entry field that carries a route's effort levels: `efforts` for Claude, `reasoningEfforts` for Codex. */
export type EffortField = 'efforts' | 'reasoningEfforts'

/**
 * Stored model entries brought up to a roster. An entry the roster names
 * takes the roster's effort levels when the roster reports any, and keeps
 * every other field an operator wrote; a Claude entry's `defaultEffort` that
 * its new `efforts` no longer offer is dropped, because the route refuses it.
 * Roster models the list lacks are appended in roster order.
 * @param listed - the entries the route lists, as stored.
 * @param entries - the roster's entries for the route.
 * @param field - the entry field that carries the route's effort levels.
 * @returns the reconciled list; each entry it leaves unchanged is the stored
 *   object itself, so an unchanged list holds exactly the `listed` objects.
 */
export function reconciledModels(
  listed: readonly unknown[], entries: readonly RouteModelEntry[], field: EffortField,
): unknown[] {
  const roster = new Map<string | undefined, RouteModelEntry>(entries.map(entry => [entry.id, entry]))
  const kept = listed.map((stored) => {
    const levels = roster.get(entryId(stored))?.[field]
    const { defaultEffort, ...rest } = recordOf(stored)
    if (levels === undefined || sameLevels(rest[field], levels)) return stored
    const offered = defaultEffort !== undefined && (!Array.isArray(levels) || levels.includes(defaultEffort))
    return { ...rest, [field]: levels, ...offered ? { defaultEffort } : {} }
  })
  const served = new Set(listed.map(entryId))
  return [...kept, ...entries.filter(entry => !served.has(entry.id))]
}

/**
 * The roster entries whose effort levels a Codex route without a `models`
 * list lacks in its `modelOverrides`. Such a route serves the installed
 * catalog, and an override for a model reshapes only the fields it sets.
 * @param overrides - the route's stored `modelOverrides` value.
 * @param entries - the roster's entries, every one of them a catalog model.
 * @returns the entries whose `reasoningEfforts` the stored overrides do not
 *   already carry, in roster order; an entry without levels is never stale.
 */
export function staleOverrides(overrides: unknown, entries: readonly RouteModelEntry[]): RouteModelEntry[] {
  const stored = recordOf(overrides)
  return entries.filter(entry =>
    entry.reasoningEfforts !== undefined && !sameLevels(recordOf(stored[entry.id]).reasoningEfforts, entry.reasoningEfforts))
}

/**
 * A Codex route's installed catalog written out as a `models` list. Each
 * catalog model carries the fields its stored override sets, because the
 * route refuses `modelOverrides` beside a list.
 * @param catalog - the model ids pi-ai's installed `openai-codex` catalog describes.
 * @param overrides - the route's stored `modelOverrides` value.
 * @returns one entry per catalog model, in catalog order.
 */
export function pinnedCatalog(catalog: ReadonlySet<string>, overrides: unknown): RouteModelEntry[] {
  const stored = recordOf(overrides)
  return [...catalog].map(id => ({ ...recordOf(stored[id]), id }))
}

/**
 * One settings value read as an object.
 * @param value - a settings value, untyped as settings values are.
 * @returns the value when it is an object, otherwise an empty object.
 */
function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null ? value as Readonly<Record<string, unknown>> : {}
}

/**
 * Whether stored levels equal the roster's: the same list in the same order,
 * or the same level-to-effort pairs in any key order.
 * @param stored - the stored levels, untyped as settings values are.
 * @param roster - the roster's levels.
 * @returns true when writing the roster's levels would change nothing.
 */
function sameLevels(stored: unknown, roster: unknown): boolean {
  const canonical = (value: unknown): string => JSON.stringify(
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      : value,
  )
  return canonical(stored) === canonical(roster)
}

/**
 * The route object a settings namespace stores for one route.
 * @param value - the namespace value from the settings view.
 * @param route - route id under `providers`.
 * @returns the stored route, or `undefined` when the namespace configures none.
 */
export function storedRoute(value: unknown, route: string): Readonly<Record<string, unknown>> | undefined {
  const stored = recordOf(recordOf(value).providers)[route]
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
