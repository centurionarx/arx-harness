/**
 * Cordis plugin registering vendor-CLI model routes on the shared `llm`
 * service.
 *
 * The plugin mounts dormant and stays mounted: it declares its routes to the
 * configurable-provider directory so a configuration surface can offer them,
 * installs a settings section so a deployment can configure one without
 * editing composition, and registers an adapter only once some route exists.
 *
 * @module @arx-ai/arx-llm-agent-cli
 */

import type { Context } from '@arx-ai/cordis'
import type {
  AdapterRegistrationHandle, DirectoryRegistrationHandle, LlmConfigurableProvider,
} from '@arx-ai/arx-llm'
import { installSettingsSection, settingsNamespace } from '@arx-ai/arx-settings'

import { AgentCliAdapter } from './adapter.ts'
import { Config, resolveRoutes, type ResolvedRoute } from './config.ts'
import { discoverModels } from './discovery.ts'
import { AGENT_CLI_PRESETS, AGENT_CLI_PRESET_IDS } from './presets.ts'

export { AgentCliAdapter } from './adapter.ts'
export { Config, DEFAULT_DISPOSE_GRACE_MS, resolveRoutes } from './config.ts'
export type { AgentCliModel, AgentCliProfile, ResolvedRoute } from './config.ts'
export { discoverModels } from './discovery.ts'
export { AGENT_CLI_PRESET_IDS, AGENT_CLI_PRESETS, type AgentCliPreset } from './presets.ts'
export { MCP_SERVER_NAME } from './tools.ts'

export const name = 'llm-agent-cli'
export const inject = ['llm', 'subprocess']

/** The settings namespace whose section configures this adapter's routes. */
export const NS = settingsNamespace('llm-agent-cli')

/**
 * The configurable-provider directory: every route this package offers by
 * name, plus every route the current configuration declares.
 *
 * A configured route joins under its own display name, so renaming one in
 * settings renames it on the page that wrote it. A route configuration named
 * that this package does not offer is `declared`, which is what lets a surface
 * distinguish a deployment's own route from one the product ships.
 * @param routes - the currently resolved routes.
 * @returns directory entries, offered routes first.
 */
function directoryEntries(routes: ReadonlyMap<string, ResolvedRoute>): LlmConfigurableProvider[] {
  const entries = new Map<string, LlmConfigurableProvider>()
  const declare = (provider: string, displayName: string): void => {
    entries.set(provider, {
      provider,
      displayName,
      settingsNs: NS,
      settingsPath: ['providers', provider],
      declared: !AGENT_CLI_PRESET_IDS.has(provider),
    })
  }
  for (const preset of AGENT_CLI_PRESETS) declare(preset.provider, preset.displayName)
  for (const [provider, route] of routes) declare(provider, route.displayName)
  return [...entries.values()]
}

/**
 * The registration-level facts a route set carries, for deciding whether the
 * llm registry must be told anything.
 * @param routes - the currently resolved routes.
 * @returns a comparable projection of what registration would hold.
 */
function registrationFacts(routes: ReadonlyMap<string, ResolvedRoute>): string[] {
  return [...routes.keys()].sort()
}

/**
 * Whether two string lists hold the same members in the same order.
 * @param a - the first list.
 * @param b - the second list.
 * @returns true when the lists are element-wise equal.
 */
function sameRoutes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * Register the directory, the settings section, and one adapter per configured
 * route.
 *
 * With no configured provider the plugin holds no route, so the model picker
 * gains nothing and no request can reach a CLI that the host may not even have
 * logged in. The directory is declared regardless, because a configuration
 * surface must be able to offer a route before one exists.
 * @param ctx - plugin context carrying the llm and subprocess services.
 * @param config - configured provider routes from the composition entry.
 */
export function apply(ctx: Context, config: Config): void {
  // The authoritative source is the settings section while one is attached and
  // the composition entry otherwise; `installSettingsSection` swaps it.
  let current: () => Config = () => config
  let memoFrom: Config | undefined
  let memoized: ReadonlyMap<string, ResolvedRoute> = new Map()
  const routes = (): ReadonlyMap<string, ResolvedRoute> => {
    const source = current()
    if (source !== memoFrom) {
      memoized = resolveRoutes(source.providers)
      memoFrom = source
    }
    return memoized
  }

  const adapter = new AgentCliAdapter({
    routes,
    spawn: spec => ctx.subprocess.spawn(spec),
    cwd: () => current().cwd ?? process.cwd(),
    // Optional: a composition without durable attachments serves text-only
    // routes, and an image reaching one fails naming the missing store.
    attachments: () => ctx.get('attachments'),
  })

  let directory: DirectoryRegistrationHandle | undefined
  let directoryFacts: string | undefined
  const ensureDirectory = (): void => {
    const entries = directoryEntries(routes())
    const facts = JSON.stringify(entries)
    if (facts === directoryFacts) return
    // Atomic replace, never dispose-then-register: a route another adapter
    // family already declares would otherwise leave this plugin's whole
    // directory withdrawn and its rows gone from the page.
    if (directory === undefined) directory = ctx.llm.registerConfigurableProviders(entries)
    else directory.replace(entries)
    directoryFacts = facts
  }

  let registration: AdapterRegistrationHandle | undefined
  let registered: string[] = []
  const ensureRegistration = (): void => {
    const next = registrationFacts(routes())
    if (sameRoutes(next, registered)) return
    // Reaching here with no routes means some route was withdrawn, so a
    // registration exists to replace: a bare mount's empty set equals the
    // empty `registered` above and never gets this far, which is the dormant
    // posture — nothing registers until a section supplies a route.
    if (registration === undefined) registration = ctx.llm.registerAdapter(next, adapter)
    else registration.replace(next)
    registered = next
  }

  ensureDirectory()
  ensureRegistration()

  // Interrogating the host CLI is a configuration-time action, so it is
  // offered for the whole namespace rather than per route: the route a surface
  // is adding does not exist yet. It reports ids only — the CLI publishes no
  // capacities, which is why a model row still states its own context window.
  ctx.llm.registerModelDiscovery(NS, () => discoverModels({
    spawn: spec => ctx.subprocess.spawn(spec),
    cwd: () => current().cwd ?? process.cwd(),
  }))

  installSettingsSection(ctx, NS, Config, config, {
    // Refuse an unserviceable section where it is written: without this a
    // schema-valid profile the adapter cannot serve would be stored and then
    // silently hold no route.
    validate: (candidate) => { resolveRoutes(candidate.providers) },
    setSource: (source) => { current = source },
    onChange: () => {
      // Named here rather than left to the settings watcher: `validate` cannot
      // see the llm registry, so a profile claiming a route another adapter
      // family owns is stored successfully and only fails at this swap.
      // Without its own diagnostic that refusal reaches the operator as a
      // generic watcher failure, naming neither the route nor why it is not
      // serving. The previous routes keep serving either way.
      try {
        ensureDirectory()
        ensureRegistration()
      } catch (error) {
        ctx.logger.error(`llm-agent-cli: configured routes were refused, previous routes still serving: ${String(error)}`)
      }
    },
  })
}
