/**
 * Connection RPC channel, endpoint names, and payloads shared verbatim by the
 * host plugin and the browser package (`@arx-ai/arx-client-ui-open-in-app`),
 * published as the `./shared` subpath. Browser-safe: constants and types only.
 * @module @arx-ai/arx-host-open-in-app/shared
 */

/** Logical connection RPC channel carrying every open-in-app endpoint, loopback-only. */
export const OPEN_IN_APP_CHANNEL = '/open-in-app'

/** Endpoint answering the catalog ids resolved on this host, in menu order. */
export const OPEN_IN_APP_APPS = 'apps'

/** Endpoint answering one resolved application's icon as a data URL. */
export const OPEN_IN_APP_ICON = 'icon'

/** Endpoint launching one resolved application on one workspace directory. */
export const OPEN_IN_APP_OPEN = 'open'

/** `apps` result: catalog ids resolved as installed, in menu order. */
export interface OpenInAppAppsResult {
  /** Resolved catalog ids. */
  readonly apps: readonly string[]
}

/** `icon` request. */
export interface OpenInAppIconRequest {
  /** Catalog id from the `apps` result. */
  readonly app: string
}

/** `icon` result. */
export interface OpenInAppIconResult {
  /** `data:image/png;base64,…` or `data:image/svg+xml;base64,…`; null when the host holds no artwork. */
  readonly icon: string | null
}

/** `open` request. */
export interface OpenInAppOpenRequest {
  /** Catalog id from the `apps` result. */
  readonly app: string
  /** Absolute path of an existing directory. */
  readonly path: string
}

/** `open` result: the launcher was counted launched. */
export interface OpenInAppOpenResult {
  /** Always true; every failure answers an RPC error instead. */
  readonly launched: true
}
