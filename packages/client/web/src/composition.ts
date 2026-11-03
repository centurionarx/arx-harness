/** Native web identity composition validation. No project factories belong here. */
import type { ClientComposition } from '@arx-ai/arx-client-ui-slots'
import { authComposition } from '@arx-ai/arx-client-ui-auth/browser'
import type { AuthState } from '@arx-ai/arx-web-identity/contract'

/**
 * Explicit serving profile; authenticated failures never fall back to the legacy local profile.
 */
export type ClientAccessMode = 'local' | 'authenticated'
/**
 * Minimal bootstrap fields delivered by the serving index, without private auth state.
 */
export interface WebCompositionWindow {
  readonly __ARX_CLIENT_ACCESS_MODE__?: unknown
  readonly __ARX_CLIENT_COMPOSITION__?: unknown
}

/**
 * Read the explicit serving profile before creating any client factories.
 * @param win - Window-like bootstrap carrier supplied by the served page.
 * @returns Declared authenticated profile or the existing legacy local default.
 */
export function readClientAccessMode(win: WebCompositionWindow): ClientAccessMode {
  const mode = win.__ARX_CLIENT_ACCESS_MODE__
  if (mode !== undefined && mode !== 'local' && mode !== 'authenticated') throw new Error('invalid client access mode')
  if (mode !== 'authenticated' && win.__ARX_CLIENT_COMPOSITION__ !== undefined) {
    throw new Error('composition marker requires authenticated access mode')
  }
  return mode ?? 'local'
}

/**
 * Check the served marker against the fresh session before admitting a tree.
 * @param raw - Untrusted readonly marker received with the HTML.
 * @param state - Fresh session parsed by the canonical auth contract.
 * @param pathname - Canonical entry or recovery pathname.
 * @returns Derived coherent tree metadata; divergence rejects this boot.
 */
export function verifiedComposition(raw: unknown, state: AuthState, pathname?: string): ClientComposition {
  if (typeof raw !== 'object' || raw === null) throw new Error('authenticated composition marker is missing')
  const marker = raw as Record<string, unknown>
  const expected = authComposition(state, pathname)
  if (marker.kind !== expected.kind || marker.audience !== expected.audience
    || marker.generation !== expected.generation) throw new Error('authenticated composition marker is stale or invalid')
  return expected
}
