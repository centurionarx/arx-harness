/**
 * Web search settings store: one snapshot joining the seam's search-provider
 * topology (`web.providers`), the settings namespaces (shared settings mirror),
 * and the referenced credentials (`credentials.describe`). The host stays the
 * single fact source — every mutation writes through the wire and the page
 * re-renders from the next describe, pushed or refetched.
 */

import type {
  CredentialView, IApiClient, SettingsNamespaceView, WebProviderView, WebSelectionView,
} from '@arx-ai/arx-api-remotes/client'
import type { SnapshotStore } from '@arx-ai/arx-client-runtime/client'
import { createSnapshotStore } from '@arx-ai/arx-client-runtime/client'
import type { SettingsDescribeFace } from '@arx-ai/arx-client-ui-settings/client'

/** The seam's own settings namespace; its `searchProvider` field is the selection. */
export const WEB_SETTINGS_NS = 'web'

/**
 * Text of a thrown value.
 * @param error - whatever the wire rejected with.
 * @returns the message, or the value stringified.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One provider row the page renders. */
export interface ProviderRow {
  /** The wire view: id, name, settings address, usability. */
  entry: WebProviderView
  /** The credential reference the provider's section names, when its address resolves to one. */
  apiKeyEnv: string | undefined
  /** Credential state for {@link apiKeyEnv}, once described. */
  credential: CredentialView | undefined
}

/** Page snapshot. */
export interface WebSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text; write failures stay with the control that wrote. */
  error: string | null
  /** Credential-describe failure text; the rows still render without their key state. */
  credentialError: string | null
  /** Whether the settings document accepts writes in this deployment. */
  writable: boolean
  rows: ProviderRow[]
  /** The selection the next search would resolve, as the host reported it. */
  selection: WebSelectionView
  /** Revision of the `web` section the last load read, fencing the selection write. */
  revision: number | undefined
}

/**
 * The `apiKeyEnv` a provider's resolved profile names.
 * @param namespace - the provider's section as the mirror describes it.
 * @param path - segments from the section root to the profile object.
 * @returns the reference, or undefined when the section, the path, or the field is absent.
 */
export function apiKeyEnvOf(namespace: SettingsNamespaceView | undefined, path: readonly string[]): string | undefined {
  if (namespace === undefined) return undefined
  let node: unknown = namespace.value
  for (const segment of path) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[segment]
  }
  if (node === null || typeof node !== 'object') return undefined
  const ref = (node as Record<string, unknown>)['apiKeyEnv']
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

/** Page store: the join, plus the two writes the page makes. */
export class WebSettingsStore {
  /** Page snapshot; the UI renderer binds it as `useSnapshot`. */
  readonly store: SnapshotStore<WebSettingsState> = createSnapshotStore<WebSettingsState>({
    status: 'idle',
    error: null,
    credentialError: null,
    writable: false,
    rows: [],
    selection: {},
    revision: undefined,
  })

  private generation = 0

  /**
   * @param api - the wire face (settings writes, credentials, and the web domain).
   * @param describeFace - the shared mirror's describe face (namespace views and writability).
   */
  constructor(
    private readonly api: Pick<IApiClient, 'settings' | 'credentials' | 'web'>,
    private readonly describeFace: SettingsDescribeFace,
  ) {}

  /**
   * Refresh the whole page snapshot: the provider topology and the mirror's
   * settings answer in parallel, then one batched credential describe over
   * every referenced ref. A topology failure or an absent settings answer
   * keeps the last good rows and surfaces an error; a credential failure
   * keeps the rows and drops only their key state.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    let providers: WebProviderView[]
    let selection: WebSelectionView
    let writable: boolean
    let views: readonly SettingsNamespaceView[]
    try {
      const [response] = await Promise.all([this.api.web.providers({}), this.describeFace.ensure()])
      if (!response.result.ok) throw new Error(response.result.error.message)
      const mirrored = this.describeFace.getSnapshot()
      if (mirrored.view === undefined) throw new Error(mirrored.error ?? 'settings are unavailable in this browser')
      providers = response.result.value.providers
      selection = response.result.value.selection
      writable = mirrored.view.writable
      views = mirrored.view.namespaces
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => { s.status = 'error'; s.error = messageOf(error) })
      return
    }
    const namespaces = new Map(views.map(view => [view.ns, view]))
    const rows: ProviderRow[] = providers.map(entry => ({
      entry,
      apiKeyEnv: apiKeyEnvOf(namespaces.get(entry.settingsNs), entry.settingsPath),
      credential: undefined,
    }))
    /* jscpd:ignore-start -- the credential half of the join mirrors the Models
       store by design, and client bundle purity forbids the two plugins from
       sharing the value, so the shape is repeated rather than imported. */
    const refs = [...new Set(rows.flatMap(row => row.apiKeyEnv === undefined ? [] : [row.apiKeyEnv]))]
    let credentials: Record<string, CredentialView> = {}
    let credentialError: string | null = null
    if (refs.length > 0) {
      try {
        const described = await this.api.credentials.describe({ refs })
        if (described.result.ok) credentials = described.result.value.credentials
        else credentialError = described.result.error.message
      } catch (error) {
        credentialError = messageOf(error)
      }
    }
    if (generation !== this.generation) return
    this.store.update((s) => {
      s.status = 'ready'
      s.error = null
      s.credentialError = credentialError
      s.writable = writable
      s.selection = selection
      s.revision = namespaces.get(WEB_SETTINGS_NS)?.revision
      s.rows = rows.map(row => ({
        ...row,
        ...row.apiKeyEnv !== undefined && credentials[row.apiKeyEnv] !== undefined
          ? { credential: credentials[row.apiKeyEnv] }
          : {},
      }))
    })
    /* jscpd:ignore-end */
  }

  /**
   * Pin the search provider, or hand the selection back to the seam's rules.
   * The write is fenced with the revision the last load read, so a document
   * that moved underneath the page is refused rather than overwritten.
   * @param provider - the id to pin; undefined removes the pin.
   * @returns null on success, else the host's refusal text.
   */
  async select(provider: string | undefined): Promise<string | null> {
    const { revision } = this.store.getSnapshot()
    const fence = revision === undefined ? {} : { expectedRevision: revision }
    try {
      const response = provider === undefined
        ? await this.api.settings.mutate({ ns: WEB_SETTINGS_NS, ops: [{ op: 'unset', path: ['searchProvider'] }], ...fence })
        : await this.api.settings.update({ ns: WEB_SETTINGS_NS, patch: { searchProvider: provider }, ...fence })
      return response.result.ok ? null : response.result.error.message
    } catch (error) {
      return messageOf(error)
    }
  }

  /**
   * Store or remove the key a provider resolves through. The value crosses
   * the wire once, inside this write, and never returns in any response.
   * @param ref - the credential reference the provider's section names.
   * @param value - the key to store; empty removes the stored key.
   * @returns null on success, else the host's refusal text.
   */
  async writeKey(ref: string, value: string): Promise<string | null> {
    try {
      const response = value.length === 0
        ? await this.api.credentials.unset({ ref })
        : await this.api.credentials.set({ ref, value })
      return response.result.ok ? null : response.result.error.message
    } catch (error) {
      return messageOf(error)
    }
  }
}
