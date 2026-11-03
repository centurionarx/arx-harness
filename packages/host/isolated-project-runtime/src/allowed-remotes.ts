/**
 * The native USER graph's closed Remote admission policy.
 * Business argument codecs and Agent lookup remain owned by Typert Gateway.
 * @module @arx-ai/arx-isolated-project-runtime/allowed-remotes
 */
import { SessionId } from '@arx-ai/arx-session'
import { WebIdentityError } from '@arx-ai/arx-web-identity'
import type { OwnerResource } from '@arx-ai/arx-web-identity'

interface RemoteAdmission {
  readonly argumentNames: readonly string[]
  readonly owner: 'agentId' | 'request'
  readonly grant: 'runtime' | 'storage'
  readonly renewIdleOnSuccess: boolean
}
const ADMITTED: ReadonlyMap<string, RemoteAdmission> = new Map<string, RemoteAdmission>([
  ['commands/list', { argumentNames: ['agentId'], owner: 'agentId', grant: 'runtime', renewIdleOnSuccess: false }],
  ['commands/execute', { argumentNames: ['agentId', 'line', 'images'], owner: 'agentId', grant: 'runtime', renewIdleOnSuccess: true }],
  ['fileReferences/list', { argumentNames: ['agentId', 'query'], owner: 'agentId', grant: 'runtime', renewIdleOnSuccess: false }],
  ['sessionReferenceResolver/candidates', { argumentNames: ['agentId', 'query'], owner: 'agentId', grant: 'runtime', renewIdleOnSuccess: false }],
  ['filePreviews/read', { argumentNames: ['agentId', 'path'], owner: 'agentId', grant: 'runtime', renewIdleOnSuccess: false }],
  ['turnOutlines/page', { argumentNames: ['agentId', 'before', 'query'], owner: 'agentId', grant: 'runtime', renewIdleOnSuccess: false }],
  ['goals/create', { argumentNames: ['agentId', 'request'], owner: 'agentId', grant: 'runtime', renewIdleOnSuccess: true }],
  ['goals/edit', { argumentNames: ['agentId', 'ref', 'request'], owner: 'agentId', grant: 'runtime', renewIdleOnSuccess: true }],
  ['goals/pause', { argumentNames: ['agentId', 'ref'], owner: 'agentId', grant: 'runtime', renewIdleOnSuccess: true }],
  ['goals/resume', { argumentNames: ['agentId', 'ref'], owner: 'agentId', grant: 'runtime', renewIdleOnSuccess: true }],
  ['goals/complete', { argumentNames: ['agentId', 'ref'], owner: 'agentId', grant: 'runtime', renewIdleOnSuccess: true }],
  ['goals/clear', { argumentNames: ['agentId', 'ref'], owner: 'agentId', grant: 'runtime', renewIdleOnSuccess: true }],
  ['messageFeedback/list', { argumentNames: ['request'], owner: 'request', grant: 'storage', renewIdleOnSuccess: false }],
  ['messageFeedback/put', { argumentNames: ['request'], owner: 'request', grant: 'storage', renewIdleOnSuccess: true }],
  ['messageFeedback/delete', { argumentNames: ['request'], owner: 'request', grant: 'storage', renewIdleOnSuccess: true }],
])
/**
 * Classify activity by the exact server-owned Remote admission row.
 * Business success and current ownership remain required before renewal.
 * @param method - Existing canonical namespace/method.
 * @param value - Canonical Typert result from an already validated successful RPC receipt.
 * @returns Whether the actual business mutation succeeded and may renew its own idle deadline.
 */
export function isOwnerRemoteActivity(method: string, value: unknown): boolean {
  if (ADMITTED.get(method)?.renewIdleOnSuccess !== true) return false
  // The canonical services carry these business refusals inside an RPC success.
  if (method === 'commands/execute') return object(object(value)?.result)?.kind === 'success'
  if (method === 'messageFeedback/put' || method === 'messageFeedback/delete') return object(value)?.ok === true
  return true
}
function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}
function invalid(): never { throw new WebIdentityError('RUNTIME_PROTOCOL', 400, 'Invalid project Remote request') }

/**
 * Resolve an admitted Remote's owner before any worker business dispatch.
 * This parses only the authority surface; Typert validates business codecs.
 * @param method - Canonical namespace/method from the existing request envelope.
 * @param payload - Existing Typert payload, containing only named args.
 * @returns The required owner and grant, or undefined for a non-admitted method.
 */
export function ownerRemoteAdmission(method: string, payload: unknown): {
  readonly resource: OwnerResource
  readonly grant: 'runtime' | 'storage'
} | undefined {
  const rule = ADMITTED.get(method)
  if (rule === undefined) return undefined
  const record = object(payload)
  if (record === undefined || Object.keys(record).length !== 1 || !Object.hasOwn(record, 'args')) invalid()
  const args = object(record.args)
  if (args === undefined || Object.keys(args).some(key => !rule.argumentNames.includes(key))) invalid()
  const owner = rule.owner === 'agentId' ? args.agentId : object(args.request)?.sessionId
  if (typeof owner !== 'string' || owner.length === 0) invalid()
  return { resource: { kind: 'session', sessionId: SessionId(owner) }, grant: rule.grant }
}

/**
 * Admit only owner-scoped or argument-free invalidations from this worker.
 * The caller must authorize a returned resource immediately before publishing.
 * @param event - Existing host/remote-event event name.
 * @param args - Existing JSON argument array.
 * @returns A required owner, a neutral invalidation, or undefined when denied.
 */
export function ownerRemoteEventAdmission(event: string, args: readonly unknown[]): {
  readonly resource?: OwnerResource
} | undefined {
  if (event === 'agent-preset/selected') {
    if (args.length !== 2 || typeof args[0] !== 'string' || args[0].length === 0 || typeof args[1] !== 'string') return undefined
    return { resource: { kind: 'session', sessionId: SessionId(args[0]) } }
  }
  if (['commands/change', 'llm/adapters-updated', 'web/providers-updated'].includes(event) && args.length === 0) return {}
  return undefined
}
