/**
 * Browser-safe native web identity contracts. No host services or credentials.
 * @module @arx-ai/arx-web-identity/contract
 */
import type { Branded } from '@arx-ai/arx-brand'
/**
 * Opaque native account identifier.
 */
export type WebUserId = Branded<'WebUserId'>
/**
 * Opaque audience-bound authentication session identifier.
 */
export type WebAuthSessionId = Branded<'WebAuthSessionId'>
/**
 * Opaque project identifier, independent of user cardinality.
 */
export type ProjectId = Branded<'ProjectId'>
/**
 * Installed module catalog identifier; branding does not grant permission.
 */
export type ModuleId = Branded<'WebModuleId'>
/**
 * Native role separating account administration from USER project access.
 */
export type WebUserRole = 'MASTER_ADMIN' | 'USER'
/**
 * Administrative account lifecycle independent of password establishment.
 */
export type WebUserStatus = 'PENDING' | 'ACTIVE' | 'BLOCKED' | 'DELETED'
/**
 * Fixed deployment audience selecting distinct cookie and account-role admission.
 */
export type AuthAudience = 'user' | 'admin'
/**
 * Category of committed authentication invalidation or lifecycle expiry.
 */
export type AuthInvalidationReason = 'logout' | 'credentials-changed' | 'status-changed' | 'grants-changed' | 'restore' | 'expired' | 'disposed'
/** Detached data only. Its presence is never evidence of authorization. */
export interface WebPrincipal {
  readonly userId: WebUserId
  readonly username: string
  readonly email: string
  readonly role: WebUserRole
  readonly status: WebUserStatus
  readonly mustChangePassword: boolean
  readonly grants: readonly ModuleId[]
}
/**
 * Detached anonymous or authenticated state with the fixed deployment audience.
 */
export type AuthState = {
  readonly authenticated: false
  readonly audience: AuthAudience
} | {
  readonly audience: AuthAudience
  readonly authenticated: true
  readonly principal: WebPrincipal
  readonly csrfToken: string
  readonly expiresAt: number
  readonly generation: number
}
/**
 * Safe identity failure DTO without submitted identifiers, passwords or tokens.
 */
export interface AuthProblem {
  readonly error: {
    readonly code: string
    readonly message: string
  }
}
/**
 * Bounded auth-only invalidation result, independent of project event channels.
 */
export interface AuthInvalidation {
  readonly invalidated: boolean
  readonly generation: number
  readonly reason?: AuthInvalidationReason
}
/**
 * Administrative account metadata with password-establishment state and no project content.
 */
export interface AdminUserSummary extends WebPrincipal {
  readonly passwordEstablished: boolean
}
/**
 * Page of detached administrative account summaries.
 */
export interface AdminUserList {
  readonly users: readonly AdminUserSummary[]
  readonly nextCursor?: string
}
/**
 * Operator-installed module and the operations governed by its grant.
 */
export interface WebModule {
  readonly id: ModuleId
  readonly label: string
  readonly operations: readonly string[]
}
/**
 * Detached installed module catalog.
 */
export interface ModuleCatalog {
  readonly modules: readonly WebModule[]
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('invalid auth contract')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error('invalid auth string')
  return value
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean')
    throw new Error('invalid auth boolean')
  return value
}
function natural(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('invalid auth number')
  return value
}
function texts(value: unknown): readonly string[] {
  if (!Array.isArray(value))
    throw new Error('invalid auth list')
  return Object.freeze(value.map(text))
}
function principal(value: unknown): WebPrincipal {
  const row = object(value)
  if (row.role !== 'MASTER_ADMIN' && row.role !== 'USER')
    throw new Error('invalid auth role')
  if (!['PENDING', 'ACTIVE', 'BLOCKED', 'DELETED'].includes(String(row.status)))
    throw new Error('invalid auth status')
  return Object.freeze({
    userId: text(row.userId) as WebUserId, username: text(row.username), email: text(row.email),
    role: row.role, status: row.status as WebUserStatus,
    mustChangePassword: bool(row.mustChangePassword), grants: texts(row.grants) as readonly ModuleId[],
  })
}
/**
 * Read and freeze a detached session-state DTO.
 * @param value - Detached input to parse.
 * @returns Anonymous or authenticated public session state.
 */
export function parseAuthState(value: unknown): AuthState {
  const row = object(value)
  if (row.audience !== 'user' && row.audience !== 'admin')
    throw new Error('invalid auth audience')
  if (!bool(row.authenticated))
    return Object.freeze({ authenticated: false, audience: row.audience })
  return Object.freeze({ authenticated: true, audience: row.audience, principal: principal(row.principal),
    csrfToken: text(row.csrfToken), expiresAt: natural(row.expiresAt), generation: natural(row.generation) })
}
/**
 * Read and freeze a safe identity failure DTO.
 * @param value - Detached input to parse.
 * @returns Error code and safe message.
 */
export function parseAuthProblem(value: unknown): AuthProblem {
  const row = object(object(value).error)
  return Object.freeze({ error: Object.freeze({ code: text(row.code), message: text(row.message) }) })
}
/**
 * Validate auth-only invalidation fields without coercing an object into a reason.
 * @param value - Detached input to parse.
 * @returns Frozen invalidation result.
 */
export function parseAuthInvalidation(value: unknown): AuthInvalidation {
  const row = object(value)
  const reason = row.reason
  if (reason !== undefined && (typeof reason !== 'string' || !['logout', 'credentials-changed', 'status-changed', 'grants-changed', 'restore', 'expired', 'disposed'].includes(reason))) {
    throw new Error('invalid auth invalidation reason')
  }
  return Object.freeze({ invalidated: bool(row.invalidated), generation: natural(row.generation),
    ...(reason === undefined ? {} : { reason: reason as AuthInvalidationReason }) })
}
/**
 * Read and freeze an administrative account page.
 * @param value - Detached input to parse.
 * @returns Account summaries and optional continuation.
 */
export function parseAdminUserList(value: unknown): AdminUserList {
  const row = object(value)
  if (!Array.isArray(row.users))
    throw new Error('invalid admin user list')
  const users = Object.freeze(row.users.map((value) => {
    const raw = object(value)
    return Object.freeze({ ...principal(raw), passwordEstablished: bool(raw.passwordEstablished) })
  }))
  return Object.freeze({ users, ...(row.nextCursor === undefined ? {} : { nextCursor: text(row.nextCursor) }) })
}
/**
 * Read and freeze installed module definitions.
 * @param value - Detached input to parse.
 * @returns Detached catalog and operation IDs.
 */
export function parseModuleCatalog(value: unknown): ModuleCatalog {
  const row = object(value)
  if (!Array.isArray(row.modules))
    throw new Error('invalid module catalog')
  return Object.freeze({ modules: Object.freeze(row.modules.map((value) => {
    const raw = object(value)
    return Object.freeze({ id: text(raw.id) as ModuleId, label: text(raw.label), operations: texts(raw.operations) })
  })) })
}
/**
 * Validate module ID syntax; permission remains a WebIdentity decision.
 * @param value - Identifier text to validate.
 * @returns Branded installed-module ID.
 */
export function ModuleId(value: string): ModuleId {
  if (!/^[a-z][a-z0-9.-]{0,63}$/.test(value))
    throw new Error('invalid module id')
  return value as ModuleId
}
/**
 * Validate UUID account syntax without issuing authority.
 * @param value - Identifier text to validate.
 * @returns Branded native account ID.
 */
export function WebUserId(value: string): WebUserId {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new Error('invalid user id')
  return value as WebUserId
}
/**
 * Validate UUID project syntax without establishing ownership.
 * @param value - Identifier text to validate.
 * @returns Branded project ID.
 */
export function ProjectId(value: string): ProjectId {
  return WebUserId(value) as unknown as ProjectId
}
/**
 * Browser mutation marker header; its value is the literal 1, never a bearer token.
 */
export const AUTH_HEADER = 'X-Arx-Auth'
/**
 * Session-bound CSRF verifier header for authenticated cookie mutations.
 */
export const CSRF_HEADER = 'X-Arx-CSRF'
/**
 * Separate host-only cookie names selected by deployment audience.
 */
export const AUTH_COOKIE_NAMES = Object.freeze({ user: '__Host-arx-user', admin: '__Host-arx-admin' })
/**
 * Pure project admission over detached facts. Carriers still authenticate, revalidate and authorize the exact owner.
 * @param principal - Detached account facts; never proof of authority.
 * @param audience - Fixed deployment audience.
 * @returns Whether USER role, ACTIVE status and established password permit project admission.
 */
export function allowsProjectAccess(principal: WebPrincipal, audience: AuthAudience): boolean {
  return audience === 'user' && principal.role === 'USER' && principal.status === 'ACTIVE' && !principal.mustChangePassword
}

/**
 * Detached graph-selection metadata. This projection carries no authority,
 * credentials, ownership or user content.
 */
export interface AuthPresentation {
  /** Public entry, account administration, or the admitted USER graph. */
  readonly kind: 'public' | 'admin' | 'user'
  /** Fixed deployment audience inherited from the validated session DTO. */
  readonly audience: AuthAudience
  /** Current auth generation for authenticated presentations only. */
  readonly generation?: number
  /** Project scope requires USER presentation and the installed runtime grant. */
  readonly scope: 'application' | 'project'
}
/**
 * Project graph metadata from detached session facts before any protected prefetch.
 * Recovery entries remain public; role/audience mismatch returns undefined so
 * each carrier retains its own narrow error type. The result proves no authority.
 * @param state - Validated detached state from the deployment's own audience.
 * @param pathname - Canonical entry pathname; reset and invite always select public.
 * @returns Frozen presentation, or undefined for a role/audience mismatch.
 */
export function deriveAuthPresentation(state: AuthState, pathname?: string): AuthPresentation | undefined {
  if (!state.authenticated) return Object.freeze({ kind: 'public', audience: state.audience, scope: 'application' })
  const expected = state.audience === 'admin' ? 'MASTER_ADMIN' : 'USER'
  if (state.principal.role !== expected) return undefined
  const recovery = pathname === '/reset' || pathname === '/invite'
  const kind = recovery ? 'public' : state.audience === 'user'
    ? allowsProjectAccess(state.principal, state.audience) ? 'user' : 'public'
    : state.principal.status === 'ACTIVE' && !state.principal.mustChangePassword ? 'admin' : 'public'
  return Object.freeze({ kind, audience: state.audience, generation: state.generation,
    scope: kind === 'user' && state.principal.grants.some(id => id === 'runtime') ? 'project' : 'application' })
}
