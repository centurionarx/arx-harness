/** Settings-backed vendor-CLI routes on the shared LLM service. */
import type { Context } from '@arx-ai/cordis'
import type { AdapterRegistrationHandle } from '@arx-ai/arx-llm'
import { installSettingsSection, settingsNamespace } from '@arx-ai/arx-settings'
import { AgentCliAdapter } from './adapter.ts'
import { Config, resolveRoutes } from './config.ts'

export { AgentCliAdapter } from './adapter.ts'
export { Config, DEFAULT_DISPOSE_GRACE_MS, resolveRoutes } from './config.ts'
export type { AgentCliModel, AgentCliProfile, ResolvedRoute } from './config.ts'
export { MCP_SERVER_NAME } from './tools.ts'

export const name = 'llm-agent-cli'
export const inject = ['llm', 'subprocess']

/**
 * Register configured subscription routes and apply Settings changes live.
 * @param ctx - context carrying LLM, subprocess, and optional settings services.
 * @param config - composed provider routes, used beneath the settings section.
 */
export function apply(ctx: Context, config: Config): void {
  let current = () => config
  let routes = resolveRoutes(config.providers ?? {})
  let acceptedConfig = config
  const adapter = new AgentCliAdapter({
    routes: () => routes,
    spawn: spec => ctx.subprocess.spawn(spec),
    cwd: () => acceptedConfig.cwd ?? process.cwd(),
    attachments: () => ctx.get('attachments'),
  })
  let registration: AdapterRegistrationHandle | undefined
  const update = () => {
    const next = current()
    const candidate = resolveRoutes(next.providers ?? {})
    const previousRoutes = routes
    const previousConfig = acceptedConfig
    routes = candidate
    acceptedConfig = next
    try {
      if (registration === undefined) {
        if (candidate.size > 0) registration = ctx.llm.registerAdapter([...candidate.keys()], adapter)
      } else {
        registration.replace([...candidate.keys()])
      }
    } catch (error) {
      routes = previousRoutes
      acceptedConfig = previousConfig
      throw error
    }
  }
  update()
  installSettingsSection(ctx, settingsNamespace('llm-agent-cli'), Config, config, {
    validate: (candidate) => { resolveRoutes(candidate.providers ?? {}) },
    setSource: (source) => { current = source },
    onChange: update,
  })
}
