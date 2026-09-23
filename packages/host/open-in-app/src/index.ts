/**
 * Host half of open-in-app: one connection RPC channel (`/open-in-app`)
 * serving the resolved application catalog (`apps`), per-application icons
 * (`icon`), and launches (`open`) to the browser split button
 * (`@arx-ai/arx-client-ui-open-in-app`).
 *
 * Security has one home, the composition's `connection` service: the channel
 * is registered with `authority: 'loopback'`, so every endpoint answers only a
 * request whose Host is this machine's loopback, whose Origin (when present)
 * is that same authority, and which no browser marked cross-site — the fence
 * `host.openPath` and the other desktop-acting gateway methods use, because a
 * launch acts on the host desktop and the application list is reconnaissance.
 * The connection decodes the RPC envelope; this plugin validates each payload:
 * a string `app` naming a catalog entry resolved on this host, and for `open`
 * an absolute `path` naming an existing directory.
 *
 * The catalog resolves lazily, once per plugin life, on the first request
 * that needs it, into one map of verified launchers: `apps` serves its keys
 * and `open` launches its values, so a click, menu open, or page reload never
 * re-runs detection. A launch that finds its executable gone (`ENOENT`)
 * invalidates that one entry and re-resolves it once.
 */

import { isAbsolute } from 'node:path'
import { stat } from 'node:fs/promises'
import type { Context } from '@arx-ai/cordis'
import type { ConnectionRpcHandler } from '@arx-ai/arx-client-connection'
import type {} from '@arx-ai/arx-host-webserver'
import type {} from '@arx-ai/arx-subprocess'
import { launchedThroughSsh, launchEnvironmentOf } from '@arx-ai/arx-launch-environment'
import z from '@arx-ai/schemastery'
import { OPEN_IN_APP_CATALOG, type OpenInAppApp } from './catalog.ts'
import {
  launchResolved, resolveLaunch, resolveOpenInAppApps,
  type OpenInAppInternals, type OpenInAppResolvedLaunch,
} from './resolver.ts'
import { extractAppIcon, type OpenInAppIcon } from './icons.ts'
import { internals } from './internals.ts'
import {
  OPEN_IN_APP_APPS, OPEN_IN_APP_CHANNEL, OPEN_IN_APP_ICON, OPEN_IN_APP_OPEN,
  type OpenInAppAppsResult, type OpenInAppIconResult, type OpenInAppOpenResult,
} from './shared.ts'

export type * from './shared.ts'

/** Cordis function-plugin name. */
export const name = 'open-in-app'
/**
 * The channel registry and its fence, the webServer the connection mounts the
 * channel's route on for this plugin, and the PATH resolver.
 */
export const inject = ['connection', 'webServer', 'subprocess']

/** Open-in-app host configuration. */
export interface Config {
  /**
   * Per-command deadline in milliseconds for catalog-resolution host
   * commands (`xcode-select`, the Windows registry reads).
   */
  readonly probeTimeoutMs: number
  /**
   * Per-command deadline in milliseconds for icon-extraction host commands
   * (`plutil`/`sips` on macOS, the PowerShell extraction on Windows).
   */
  readonly iconTimeoutMs: number
  /**
   * Early-failure watch window per launch, in milliseconds: a launcher still
   * running when the window closes counts as launched and keeps running, so
   * this bounds how long `open` holds a successful launch, not how long an
   * application may live.
   */
  readonly launchWatchMs: number
}

const boundedMs = (): z<number> => z.number().step(1).min(1).max(600_000).required()

export const Config: z<Config> = z.object({
  probeTimeoutMs: boundedMs(),
  iconTimeoutMs: boundedMs(),
  launchWatchMs: boundedMs(),
})

/** One endpoint's answer in the connection's RPC result vocabulary. */
type Answer = Awaited<ReturnType<ConnectionRpcHandler>>

/** Success answer. */
function answer(value: OpenInAppAppsResult | OpenInAppIconResult | OpenInAppOpenResult): Answer {
  return { ok: true, value }
}

/** Malformed request answer: an unknown endpoint, a non-string field, or an id outside the catalog. */
function badRequest(message: string): Answer {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }
}

/** A catalog entry this host did not resolve (not installed, or an SSH launch). */
function unavailable(id: string): Answer {
  return { ok: false, error: { code: 'open-unavailable', message: `application not available on this host: ${id}`, details: {} } }
}

/** The one catalog entry a payload's `app` field names, or a message saying why none. */
function catalogEntry(payload: unknown): OpenInAppApp | string {
  const app = typeof payload === 'object' && payload !== null ? (payload as { app?: unknown }).app : undefined
  if (typeof app !== 'string') return 'payload must carry a string "app"'
  return OPEN_IN_APP_CATALOG.find(entry => entry.id === app) ?? `unknown app: ${app}`
}

/** Whether the path names an existing directory; ENOENT and EACCES both mean no. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    // Swallows ENOENT/EACCES: both mean there is no directory to open.
    return false
  }
}

/** Data URL of one extracted icon. */
function dataUrl(icon: OpenInAppIcon): string {
  return `data:${icon.contentType};base64,${icon.bytes.toString('base64')}`
}

/** Register the loopback-only `/open-in-app` RPC channel. */
export function apply(ctx: Context, config: Config): void {
  const ssh = launchedThroughSsh(launchEnvironmentOf(ctx))
  /** Test-seam facts completed with the composition's PATH resolver. */
  const catalogInternals = (): OpenInAppInternals => ({
    ssh,
    resolveExecutable: async (executable) => {
      try {
        return await ctx.subprocess.resolveExecutable(executable)
      } catch {
        // Swallows the provider's not-found rejection: for detection, a name
        // that does not resolve has exactly one meaning — unavailable.
        return null
      }
    },
    ...internals.catalog,
  })
  /** Lazy once-per-plugin-life resolution; the map is the mutable authority. */
  let resolutions: Promise<Map<string, OpenInAppResolvedLaunch>> | undefined
  const availability = (): Promise<Map<string, OpenInAppResolvedLaunch>> =>
    resolutions ??= resolveOpenInAppApps(config.probeTimeoutMs, catalogInternals())
  /** Per-app icon promise cache (null = resolved as unavailable). */
  const icons = new Map<string, Promise<OpenInAppIcon | null>>()
  const iconOf = (app: OpenInAppApp, resolved: OpenInAppResolvedLaunch): Promise<OpenInAppIcon | null> => {
    let cached = icons.get(app.id)
    if (cached === undefined) {
      cached = extractAppIcon(app, resolved, config.iconTimeoutMs, catalogInternals())
      icons.set(app.id, cached)
    }
    return cached
  }
  /**
   * Replace one stale resolution after a missing-executable launch: the
   * entry (and its icon) re-resolves once; an entry that no longer resolves
   * leaves the map and the next `apps` answer no longer offers it.
   */
  const refreshResolution = async (app: OpenInAppApp): Promise<OpenInAppResolvedLaunch | undefined> => {
    const map = await availability()
    const fresh = await resolveLaunch(app, config.probeTimeoutMs, catalogInternals())
    icons.delete(app.id)
    if (fresh === null) {
      map.delete(app.id)
      return undefined
    }
    map.set(app.id, fresh)
    return fresh
  }

  /** `icon`: the resolved entry's artwork as a data URL, or null without artwork. */
  const iconEndpoint = async (payload: unknown): Promise<Answer> => {
    const app = catalogEntry(payload)
    if (typeof app === 'string') return badRequest(app)
    const resolved = (await availability()).get(app.id)
    if (resolved === undefined) return unavailable(app.id)
    const icon = await iconOf(app, resolved)
    return answer({ icon: icon === null ? null : dataUrl(icon) })
  }

  /** `open`: launch the resolved entry on an existing absolute directory. */
  const openEndpoint = async (payload: unknown): Promise<Answer> => {
    const app = catalogEntry(payload)
    if (typeof app === 'string') return badRequest(app)
    const path: unknown = (payload as { path?: unknown }).path
    if (typeof path !== 'string') return badRequest('payload must carry a string "path"')
    const resolved = (await availability()).get(app.id)
    if (resolved === undefined) return unavailable(app.id)
    if (!isAbsolute(path)) {
      return {
        ok: false,
        error: { code: 'workspace-invalid-path', message: 'path must be an absolute directory path', details: { path } },
      }
    }
    if (!await isDirectory(path)) {
      return {
        ok: false,
        error: { code: 'directory-unreadable', message: `directory does not exist: ${path}`, details: { path } },
      }
    }
    let outcome = await launchResolved(resolved, path, config.launchWatchMs, catalogInternals())
    if (outcome === 'missing') {
      // The verified launcher is gone (uninstalled since resolution):
      // refresh this one entry and retry once with the fresh launcher.
      const fresh = await refreshResolution(app)
      outcome = fresh === undefined
        ? 'failed'
        : await launchResolved(fresh, path, config.launchWatchMs, catalogInternals())
    }
    return outcome === 'launched'
      ? answer({ launched: true })
      : { ok: false, error: { code: 'internal', message: `failed to launch ${app.id}`, details: {} } }
  }

  // The resolution pass is shared by every request, so one request's
  // cancellation never aborts it; the handler ignores the signal.
  ctx.connection.rpc.handle(OPEN_IN_APP_CHANNEL, async (endpoint, payload) => {
    switch (endpoint) {
      case OPEN_IN_APP_APPS:
        return answer({ apps: [...(await availability()).keys()] })
      case OPEN_IN_APP_ICON:
        return iconEndpoint(payload)
      case OPEN_IN_APP_OPEN:
        return openEndpoint(payload)
      default:
        return badRequest(`unknown open-in-app endpoint: ${endpoint}`)
    }
  }, { authority: 'loopback' })
}
