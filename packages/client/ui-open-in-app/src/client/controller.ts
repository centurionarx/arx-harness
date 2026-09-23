/** Browser application list, icons, last choice, and the launch call behind the split button. */

import type { ConnectionHandle } from '@arx-ai/arx-client-connection/client'
import { createSnapshotStore, type SnapshotStore } from '@arx-ai/arx-client-runtime/client'
import {
  OPEN_IN_APP_APPS, OPEN_IN_APP_CHANNEL, OPEN_IN_APP_ICON, OPEN_IN_APP_OPEN,
  type OpenInAppIconRequest, type OpenInAppOpenRequest,
} from '@arx-ai/arx-host-open-in-app/shared'

/** The connection facts the controller reads: the RPC caller and whether this page is on loopback. */
export type OpenInAppConnection = Pick<ConnectionHandle, 'rpc' | 'isLoopback'>

/** One RPC call's result, in the connection's result vocabulary. */
type CallResult = Awaited<ReturnType<OpenInAppConnection['rpc']['call']>>

/** Catalog ids from an `apps` result value; anything else reads as no applications. */
function appIds(value: unknown): readonly string[] {
  const apps = typeof value === 'object' && value !== null ? (value as { apps?: unknown }).apps : undefined
  return Array.isArray(apps) ? apps.filter((id): id is string => typeof id === 'string') : []
}

/** Image data URL from an `icon` result value; anything else reads as no artwork. */
function iconUrl(value: unknown): string | null {
  const icon = typeof value === 'object' && value !== null ? (value as { icon?: unknown }).icon : undefined
  return typeof icon === 'string' && icon.startsWith('data:image/') ? icon : null
}

/**
 * Owns the once-per-page application list and icon reads, the persisted last
 * choice, and the launch call. Every session header reads the same stores, so
 * all headers show one list and one choice.
 */
export class OpenInAppController {
  /** Resolved application ids in host menu order; null until the host answered. */
  readonly apps: SnapshotStore<readonly string[] | null> = createSnapshotStore<readonly string[] | null>(null)
  /** Icon data URLs by application id, published as each extraction answers. */
  readonly icons: SnapshotStore<Readonly<Record<string, string>>> = createSnapshotStore<Readonly<Record<string, string>>>({})
  /** Last chosen application id, or empty before the first choice; shared across sessions and browser restarts. */
  readonly choice: SnapshotStore<string> = createSnapshotStore<string>('', {
    persist: { name: 'arx.open-in-app.choice' },
  })

  private loading: Promise<void> | undefined

  /**
   * @param connection - the RPC caller and the page's loopback fact.
   */
  constructor(private readonly connection: OpenInAppConnection) {}

  /**
   * Read the application list once per controller life, then each listed
   * application's icon; concurrent calls share the reads. A page that is not
   * on loopback asks nothing, because the host channel answers loopback only,
   * and a failed read publishes an empty list, which renders no button.
   * @returns after the list and every icon read settled.
   */
  load(): Promise<void> {
    this.loading ??= this.run()
    return this.loading
  }

  /**
   * Remember one picked application id.
   * @param appId - catalog id from the application list.
   */
  choose(appId: string): void {
    this.choice.set(appId)
  }

  /**
   * Launch one application on a workspace directory.
   * @param appId - catalog id from the application list.
   * @param path - the session's absolute workspace directory.
   * @returns after the host counted the launch; rejects with the host's message on any failure.
   */
  async launch(appId: string, path: string): Promise<void> {
    const request: OpenInAppOpenRequest = { app: appId, path }
    const result = await this.connection.rpc.call(OPEN_IN_APP_CHANNEL, OPEN_IN_APP_OPEN, request)
    if (!result.ok) throw new Error(result.error.message)
  }

  private async run(): Promise<void> {
    let answer: CallResult | undefined
    if (this.connection.isLoopback) {
      try {
        answer = await this.connection.rpc.call(OPEN_IN_APP_CHANNEL, OPEN_IN_APP_APPS, {})
      } catch {
        // Swallows transport failures (a host without the channel, a network
        // error): an unreachable list reads as no applications, so the header
        // shows no button rather than a broken one.
      }
    }
    const apps = answer?.ok === true ? appIds(answer.value) : []
    this.apps.set(apps)
    await Promise.all(apps.map(id => this.loadIcon(id)))
  }

  private async loadIcon(id: string): Promise<void> {
    const request: OpenInAppIconRequest = { app: id }
    let answer: CallResult | undefined
    try {
      answer = await this.connection.rpc.call(OPEN_IN_APP_CHANNEL, OPEN_IN_APP_ICON, request)
    } catch {
      // Swallows a failed icon read: the menu keeps the generic glyph for this entry.
    }
    const url = answer?.ok === true ? iconUrl(answer.value) : null
    if (url !== null) this.icons.set({ ...this.icons.getSnapshot(), [id]: url })
  }
}
