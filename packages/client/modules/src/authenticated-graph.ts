/** Closed server projection of the native browser graph. No config values are emitted. */
import type { ClientComposition } from '@arx-ai/arx-client-ui-slots/composition'
import { APPLICATION_PLUGIN_IDS, APPLICATION_PLUGIN_FACES, stripClientSuffix } from './client/manifest.ts'
import type { WebBootGraph, WebBootEntry } from './client/manifest.ts'
import { deriveAuthPresentation } from '@arx-ai/arx-web-identity/contract'
import type { AuthState } from '@arx-ai/arx-web-identity/contract'

/** Required project framework; anonymous/admin/no-runtime USER never receive these rows. */
export const USER_PROJECT_BASE = Object.freeze([
  ...APPLICATION_PLUGIN_IDS,
  '@arx-ai/arx-client-connection', '@arx-ai/arx-client-runtime',
  '@arx-ai/arx-api-gateway', '@arx-ai/arx-api-remotes', '@arx-ai/arx-typert-registry',
  '@arx-ai/arx-client-ui-layout', '@arx-ai/arx-client-ui-sidebar', '@arx-ai/arx-client-ui-settings',
])
/** Only installed members of this reviewed roster are eligible for the runtime grant. */
export const USER_RUNTIME_FEATURES = Object.freeze([
  '@arx-ai/arx-client-ui-conversation', '@arx-ai/arx-client-ui-tool',
  '@arx-ai/arx-client-ui-commands', '@arx-ai/arx-client-ui-model-selection',
  '@arx-ai/arx-client-ui-jobs', '@arx-ai/arx-client-ui-subagent',
  '@arx-ai/arx-client-ui-goal', '@arx-ai/arx-client-ui-plan', '@arx-ai/arx-client-ui-trajectory',
  '@arx-ai/arx-client-ui-message-feedback', '@arx-ai/arx-client-ui-reference',
  '@arx-ai/arx-client-ui-input-trigger', '@arx-ai/arx-client-ui-user-questions',
  '@arx-ai/arx-client-ui-attachment', '@arx-ai/arx-client-ui-deliverables',
  '@arx-ai/arx-client-ui-turn-outline', '@arx-ai/arx-client-ui-brand-official',
  '@arx-ai/arx-client-ui-skill', '@arx-ai/arx-client-ui-file-preview',
])
// These are carrier words, not package rows. A drift test pins this gate to web/platform.ts.
/**
 * Browser carrier modules that the closed native graph may reference without a plugin row.
 */
export const AUTH_STATIC_WORDS = Object.freeze([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@arx-ai/cordis',
  '@arx-ai/arx-client-ui-slots', '@arx-ai/arx-client-ui-primitives',
])

/**
 * Derive the fixed presentation tree from a fresh parsed session and canonical route.
 * @param state - Validated same-audience auth response; this data is not request authority.
 * @param pathname - Canonical entry or recovery pathname.
 * @returns Readonly kind, audience, generation, and internal application/project scope.
 */
export function nativeComposition(state: AuthState, pathname?: string): ClientComposition {
  const composition = deriveAuthPresentation(state, pathname)
  if (composition === undefined) throw new Error('identity audience mismatch')
  return composition
}

/**
 * Select a closed plugin roster and reject dependencies outside that roster.
 * @param graph - Installed boot graph produced by the real module registry.
 * @param composition - Fixed tree view derived from the current server session.
 * @returns Only the allowlisted rows and their validated dependencies.
 */
export function authenticatedGraph(graph: WebBootGraph, composition: ClientComposition): WebBootEntry[] {
  const application = composition.scope === 'application' || composition.kind !== 'user'
  const required = application ? APPLICATION_PLUGIN_IDS : USER_PROJECT_BASE
  const allowed = new Set<string>(application ? required : [...required, ...USER_RUNTIME_FEATURES])
  const installed = new Set(graph.entries.map(row => row.id))
  for (const id of required) if (!installed.has(id)) throw new Error('native graph missing required plugin ' + id)
  const rows = graph.entries.filter(row => allowed.has(row.id)).map((row) => {
    const neutral = application && Object.hasOwn(APPLICATION_PLUGIN_FACES, row.id)
      ? APPLICATION_PLUGIN_FACES[row.id as keyof typeof APPLICATION_PLUGIN_FACES] : undefined
    return { id: row.id, url: row.url, rev: row.rev,
      ...(row.immediately === undefined ? {} : { immediately: row.immediately }),
      ...(neutral !== undefined ? { inject: [...neutral.inject] } : row.inject === undefined ? {} : { inject: [...row.inject] }),
      ...(row.external === undefined ? {} : { external: [...row.external] }),
    }
  })
  const selected = new Set(rows.map(row => row.id))
  const staticWords = new Set<string>(AUTH_STATIC_WORDS)
  for (const row of rows) for (const request of [...(row.inject ?? []), ...(row.external ?? [])]) {
    if (!selected.has(stripClientSuffix(request)) && !staticWords.has(request)) {
      throw new Error('native graph rejects dependency ' + request + ' of ' + row.id)
    }
  }
  return rows
}
