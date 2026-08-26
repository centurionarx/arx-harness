/**
 * Cordis plugin registering vendor-CLI model routes on the shared `llm`
 * service.
 *
 * @module @centurionarx/cxh-llm-agent-cli
 */

import type { Context } from '@centurionarx/cordis'

import { AgentCliAdapter } from './adapter.ts'
import { Config, resolveRoutes } from './config.ts'

export { AgentCliAdapter } from './adapter.ts'
export { Config, DEFAULT_DISPOSE_GRACE_MS, resolveRoutes } from './config.ts'
export type { AgentCliModel, AgentCliProfile, ResolvedRoute } from './config.ts'
export { MCP_SERVER_NAME } from './tools.ts'

export const name = 'llm-agent-cli'
export const inject = ['llm', 'subprocess']

/**
 * Register one route per configured provider.
 *
 * A composition mounts this plugin unconditionally; a deployment decides
 * whether it serves anything. With no configured provider the plugin holds no
 * route, so the model picker gains nothing and no request can reach a CLI that
 * the host may not even have logged in.
 * @param ctx - plugin context carrying the llm and subprocess services.
 * @param config - configured provider routes.
 * @returns the disposer releasing this plugin's routes and live vendor runs.
 */
export function apply(ctx: Context, config: Config): Promise<() => void> {
  const routes = resolveRoutes(config.providers ?? {})
  if (routes.size === 0) return Promise.resolve(() => {})
  const cwd = config.cwd ?? process.cwd()
  const adapter = new AgentCliAdapter({
    routes: () => routes,
    spawn: spec => ctx.subprocess.spawn(spec),
    cwd: () => cwd,
  })
  return ctx.effect(function* () {
    const release = ctx.llm.registerAdapter([...routes.keys()], adapter)
    yield () => {
      release()
      // Each live vendor conversation owns a CLI process tree; unloading the
      // plugin without releasing them would leave those trees running.
      adapter.dispose()
    }
  }, 'llm-agent-cli.registerAdapter()') as unknown as Promise<() => void>
}
