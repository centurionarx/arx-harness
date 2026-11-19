/**
 * Native web identity and ownership Service Definitions.
 * Request authorities are issued by the provider, never reconstructed from DTOs.
 * @module @arx-ai/arx-web-identity
 */
import type { IncomingMessage } from 'node:http'
import { Context, Service } from '@arx-ai/cordis'
import type { WorkspaceId } from '@arx-ai/arx-workspace'
import type { SessionId } from '@arx-ai/arx-session'
import type { AuthAudience, AuthInvalidationReason, AuthState, AdminUserList, AdminUserSummary, ModuleCatalog, ModuleId, ProjectId, WebAuthSessionId, WebPrincipal, WebUserId } from './contract.ts'
export * from './contract.ts'
/**
 * Shared audience, Host/Origin and CSRF request admission used by every authenticated carrier.
 */
export interface WebIdentityRequestAuthenticator {
  readonly audience: AuthAudience
  readonly canonicalOrigin: string
  /**
   * Authenticate an incoming carrier through the fixed deployment audience, Host/Origin and cookie/bearer policy.
   * @param request - Web Request or original Node request whose authority and headers are checked.
   * @param options - Require session-bound browser CSRF when the carrier performs a mutation.
   * @returns Current immutable authority issued and revalidated by the native identity provider.
   */
  authenticateRequest(request: Request | IncomingMessage, options?: {
    readonly mutating?: boolean
  }): Promise<RequestAuthority>
}
/**
 * Immutable provider-issued authority. Detached DTOs and copied objects cannot replace the sealed issuer value.
 */
export interface RequestAuthority {
  readonly principal: WebPrincipal
  readonly authSessionId: WebAuthSessionId
  readonly audience: AuthAudience
  readonly revision: number
}
/**
 * Authoritative USER and project ownership, with an optional workspace for project-level resources.
 */
export interface OwnedResource {
  readonly userId: WebUserId
  readonly projectId: ProjectId
  readonly workspaceId?: WorkspaceId
}
/**
 * Complete workspace owner scope required for worker dispatch and session registration.
 */
export interface OwnerScope extends OwnedResource {
  readonly workspaceId: WorkspaceId
}
/**
 * Opaque resource reference resolved through current ownership and ancestor tombstones.
 */
export type OwnerResource = {
  readonly kind: 'project'
  readonly projectId: ProjectId
} | {
  readonly kind: 'workspace'
  readonly workspaceId: WorkspaceId
} | {
  readonly kind: 'session'
  readonly sessionId: SessionId
}
/**
 * JSON payload values admitted to the private identity authority journal.
 */
export type JsonValue = null | string | number | boolean | readonly JsonValue[] | {
  readonly [key: string]: JsonValue
}
/**
 * One provider-owned identity decision, identified for durable append and replay.
 */
export interface AuthorityEvent {
  readonly operationId: string
  readonly kind: 'user' | 'session' | 'token' | 'owner' | 'restore' | 'outbox'
  readonly payload: {
    readonly [key: string]: JsonValue
  }
}
/**
 * Sequence and hash identifying the current durable identity projection.
 */
export interface AuthorityHead {
  readonly sequence: number
  readonly hash: string
}
/**
 * Immutable journal record linked to the preceding authority hash.
 */
export interface AuthorityRecord extends AuthorityEvent, AuthorityHead {
  readonly recordedAt: number
  readonly previousHash: string
}
/**
 * Private invitation or reset envelope. Its link belongs only in the encrypted outbox and outbound delivery.
 */
export interface IdentityDelivery {
  readonly operationId: string
  readonly to: string
  readonly purpose: 'invitation' | 'reset'
  readonly link: string
  readonly expiresAt: number
}
/**
 * External provider acceptance identifier; acceptance does not prove recipient delivery.
 */
export interface IdentityDeliveryResult {
  readonly providerId: string
}
/**
 * Single registered outbound transport for private identity envelopes.
 */
export interface IdentityDeliveryProvider {
  send(delivery: IdentityDelivery, signal: AbortSignal): Promise<IdentityDeliveryResult>
}
/**
 * Host-only token and public session state. HTTP consumers emit the token through the audience cookie.
 */
export interface LoginResult {
  readonly token: string
  readonly state: Extract<AuthState, {
    authenticated: true
  }>
}
/**
 * Continuation and page bound for administrative or owner metadata.
 */
export interface PageOptions {
  readonly cursor?: string
  readonly limit?: number
}
/** Safe failure text is deliberately independent of submitted values. */
export class WebIdentityError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message)
    this.name = 'WebIdentityError'
  }
}
/**
 * Throw a typed failure whose message is independent of submitted credentials.
 * @param code - Stable identity failure category.
 * @param status - HTTP status for the failure.
 * @param message - Safe fixed diagnostic text.
 * @returns Never returns; throws WebIdentityError.
 */
export function identityFailure(code: string, status: number, message: string): never {
  throw new WebIdentityError(code, status, message)
}
declare module '@arx-ai/cordis' {
  interface Context {
    webIdentityApi: WebIdentityRequestAuthenticator
    webIdentity: WebIdentity
    identityAuthorityJournal: IdentityAuthorityJournal
  }
  interface Events {
    /**
         * Authentication invalidation after durable projection. Listeners run
         * outside the writer queue and finish quiescence before mutation ACK.
         * @mode parallel
         * @param userId Affected account.
         * @param reason Invalidation category.
         * @param revision Committed authority revision.
         */
    'web-identity/invalidated'(userId: WebUserId, reason: AuthInvalidationReason, revision: number): void | Promise<void>
    /**
         * Ownership tombstone after durable projection. Awaited listeners quiesce
         * deleted resources without revoking the valid cookie or auth revision.
         * @mode parallel
         * @param userId Affected USER owner.
         * @param resource Tombstoned resource and its denied descendants.
         */
    'web-identity/ownership-deleted'(userId: WebUserId, resource: OwnerResource): void | Promise<void>
    /**
         * One expired authentication session after journal and FULL projection.
         * Awaited listeners finish session-scoped quiescence outside the writer queue.
         * @mode parallel
         * @param userId Affected account.
         * @param authSessionId Expired authentication session; other sessions retain authority.
         */
    'web-identity/session-expired'(userId: WebUserId, authSessionId: WebAuthSessionId): void | Promise<void>
    /**
         * Committed journal and FULL projection watermark for derived observers.
         * @mode emit
         * @param head Current durable authority head.
         */
    'web-identity/projected'(head: AuthorityHead): void
  }
}
/** The protected authority log is outside every restored auth/content snapshot. */
export abstract class IdentityAuthorityJournal extends Service {
  constructor(ctx: Context) { super(ctx, 'identityAuthorityJournal') }
  /**
       * Current authority head; implementations refuse absent or stale authority.
       */
  abstract readonly head: AuthorityHead
  /**
       * Protected journal location excluded from rollback snapshots and worker mounts.
       */
  abstract readonly root: string
  /**
       * Read immutable records after the supplied projection watermark.
       * @param sequence - Last sequence already projected.
       * @returns Ordered records strictly after the watermark.
       */
  abstract recordsAfter(sequence: number): Promise<readonly AuthorityRecord[]>
  /**
       * Append and fsync one decision against the expected current head.
       * @param expectedSequence - Current authority sequence required by the writer.
       * @param event - Provider-owned decision with a unique operation ID.
       * @returns Immutable record after journal and watermark durability.
       */
  abstract append(expectedSequence: number, event: AuthorityEvent): Promise<AuthorityRecord>
}
/** Site identity, grants and opaque ownership; this service exposes no project content. */
export abstract class WebIdentity extends Service {
  private readonly issued = new WeakSet<RequestAuthority>()
  constructor(ctx: Context) { super(ctx, 'webIdentity') }
  protected issueAuthority(value: RequestAuthority): RequestAuthority {
    const principal = Object.freeze({ ...value.principal, grants: Object.freeze([...value.principal.grants]) })
    const authority = Object.freeze({ ...value, principal })
    this.issued.add(authority)
    return authority
  }
  protected assertIssued(value: RequestAuthority): void {
    if (!this.issued.has(value))
      identityFailure('AUTH_INVALID', 401, 'Authentication required')
  }
  /**
       * Current FULL projection head, checked against the external authority journal.
       */
  abstract readonly authorityHead: AuthorityHead
  /**
       * Verify username or email and establish an audience-bound session.
       * @param identifier - Username or registered email.
       * @param password - Submitted password, never logged.
       * @param audience - Deployment audience of the new session.
       * @param signal - Cancels hashing or queued admission.
       * @returns Host-only token and detached public session state.
       */
  abstract login(identifier: string, password: string, audience: AuthAudience, signal?: AbortSignal): Promise<LoginResult>
  /**
       * Verify the token against current session, account and deployment audience.
       * @param token - Opaque cookie or explicitly enabled bearer token.
       * @param audience - Deployment audience required by the carrier.
       * @returns Sealed immutable authority issued by this provider.
       */
  abstract authenticate(token: string, audience: AuthAudience): Promise<RequestAuthority>
  /**
       * Refuse stale, expired, revoked or copied authority; explicitly admitted activity may renew only the idle deadline.
       * @param authority - Previously issued authority.
       * @param options - Activity admitted by the authenticated carrier after its request fences; passive checks omit it.
       * @returns The same issued authority when still current, after durable activity publication when requested.
       */
  abstract revalidate(authority: RequestAuthority, options?: { readonly activity?: boolean }): Promise<RequestAuthority>
  /**
       * Read public session state for a current issued authority.
       * @param authority - Issued authority to revalidate.
       * @returns Authenticated state including CSRF verifier and generation.
       */
  abstract state(authority: RequestAuthority): Promise<Extract<AuthState, {
    authenticated: true
  }>>
  /**
       * Commit session revocation and await execution quiescence outside the writer queue.
       * @param authority - Issued authority being revoked.
       */
  abstract logout(authority: RequestAuthority): Promise<void>
  /**
       * Replace credentials, revoke earlier sessions and await quiescence before returning a replacement token.
       * @param authority - Issued account authority.
       * @param currentPassword - Current password to verify.
       * @param newPassword - Replacement satisfying the native password policy.
       * @param signal - Cancels hashing or queued admission.
       * @returns Replacement token and current public session state after the barrier.
       */
  abstract changePassword(
    authority: RequestAuthority, currentPassword: string, newPassword: string, signal?: AbortSignal,
  ): Promise<LoginResult>
  /**
       * Queue recovery only to the account registered recipient while preserving generic public responses.
       * @param identifier - Username or registered email.
       */
  abstract forgotPassword(identifier: string): Promise<void>
  /**
       * Consume a valid single-use reset without releasing or granting a blocked account.
       * @param token - Purpose-bound reset token.
       * @param newPassword - Recipient-selected replacement password.
       * @param signal - Cancels hashing or queued consumption.
       */
  abstract resetPassword(token: string, newPassword: string, signal?: AbortSignal): Promise<void>
  /**
       * Establish the recipient password independently of administrative account release.
       * @param token - Single-use invitation token.
       * @param newPassword - Recipient-selected password.
       * @param signal - Cancels hashing or queued consumption.
       */
  abstract acceptInvitation(token: string, newPassword: string, signal?: AbortSignal): Promise<void>
  /**
       * Create a pending USER and private invitation under current MASTER authority.
       * @param authority - Current MASTER authority after its first password change.
       * @param input - Username and registered invitation email.
       * @returns Detached administrative summary.
       */
  abstract createUser(authority: RequestAuthority, input: {
    username: string
    email: string
  }): Promise<AdminUserSummary>
  /**
       * Page administrative metadata without project content.
       * @param authority - Current MASTER authority.
       * @param options - Continuation and page bound.
       * @returns Administrative page and optional continuation.
       */
  abstract listUsers(authority: RequestAuthority, options?: PageOptions): Promise<AdminUserList>
  /**
       * Release, block or delete a USER and await committed revocation quiescence.
       * @param authority - Current MASTER authority.
       * @param userId - Existing USER account.
       * @param status - Requested release, block or terminal deletion.
       * @returns Summary of the committed account state.
       */
  abstract setStatus(authority: RequestAuthority, userId: WebUserId, status: 'ACTIVE' | 'BLOCKED' | 'DELETED'): Promise<AdminUserSummary>
  /**
       * Replace installed module grants and await execution quiescence.
       * @param authority - Current MASTER authority.
       * @param userId - Existing USER account.
       * @param grants - IDs from the operator-installed catalog.
       * @returns Summary of the committed grants.
       */
  abstract setModules(authority: RequestAuthority, userId: WebUserId, grants: readonly string[]): Promise<AdminUserSummary>
  /**
       * Replace an unused invitation for an account without an established password.
       * @param authority - Current MASTER authority.
       * @param userId - Invitation recipient account.
       */
  abstract resendInvitation(authority: RequestAuthority, userId: WebUserId): Promise<void>
  /**
       * Correct only an unestablished invitation recipient and invalidate its older links.
       * @param authority - Current MASTER authority.
       * @param userId - Account without an established password.
       * @param email - Corrected registered recipient.
       * @returns Committed recipient summary.
       */
  abstract correctInvitationEmail(authority: RequestAuthority, userId: WebUserId, email: string): Promise<AdminUserSummary>
  /**
       * Read the operator-installed module catalog for administration.
       * @param authority - Current MASTER authority.
       * @returns Installed module definitions.
       */
  abstract moduleCatalog(authority: RequestAuthority): Promise<ModuleCatalog>
  /**
   * Resolve workspace or session ownership with a complete workspace scope; MASTER cannot use this operation.
   * @param authority - Current issued USER authority.
   * @param resource - Opaque workspace or session reference.
   * @param moduleId - Installed grant additionally required by the caller.
   * @returns Current USER, project and workspace ownership with nondeleted ancestors.
   */
  abstract authorizeOwner(authority: RequestAuthority, resource: Exclude<OwnerResource, { kind: 'project' }>,
    moduleId?: ModuleId): Promise<OwnerScope>
  /**
       * Resolve exact ownership, current revision and nondeleted ancestors; MASTER cannot use this operation.
       * @param authority - Current issued USER authority.
       * @param resource - Opaque project, workspace or session reference.
       * @param moduleId - Installed grant additionally required by the caller.
       * @returns Current USER/project ownership and workspace when applicable.
       */
  abstract authorizeOwner(authority: RequestAuthority, resource: OwnerResource, moduleId?: ModuleId): Promise<OwnedResource>
  /**
       * Allocate a project owned only by the current USER.
       * @param authority - Current issued USER authority.
       * @returns New opaque project ID.
       */
  abstract createProject(authority: RequestAuthority): Promise<ProjectId>
  /**
       * Allocate a workspace under an existing project of the current USER.
       * @param authority - Current issued USER authority.
       * @param projectId - Owned, nondeleted project.
       * @returns Complete owner scope for the new workspace.
       */
  abstract createWorkspace(authority: RequestAuthority, projectId: ProjectId): Promise<OwnerScope>
  /**
       * Journal session ownership before any content is materialized.
       * @param authority - Current issued USER authority.
       * @param scope - Exact current owned workspace scope.
       * @param sessionId - Existing-format session ID being registered.
       * @param signal - Caller deadline; cancellation prevents a new append.
       * An append already started completes its durable projection.
       * @returns Completion of the journal and SQLite ownership projection.
       */
  abstract registerSession(authority: RequestAuthority, scope: OwnerScope, sessionId: SessionId, signal?: AbortSignal): Promise<void>
  /**
       * Commit a session tombstone and await ownership quiescence without changing the auth generation.
       * @param authority - Current issued USER authority.
       * @param sessionId - Owned session to tombstone.
       */
  abstract deleteSession(authority: RequestAuthority, sessionId: SessionId): Promise<void>
  /**
       * Commit a workspace tombstone, deny descendants and await ownership quiescence.
       * @param authority - Current issued USER authority.
       * @param workspaceId - Owned workspace to tombstone.
       */
  abstract deleteWorkspace(authority: RequestAuthority, workspaceId: WorkspaceId): Promise<void>
  /**
       * Commit a project tombstone, deny descendants and await ownership quiescence.
       * @param authority - Current issued USER authority.
       * @param projectId - Owned project to tombstone.
       */
  abstract deleteProject(authority: RequestAuthority, projectId: ProjectId): Promise<void>
  /**
       * Page only current USER project IDs.
       * @param authority - Current issued USER authority.
       * @param options - Continuation and page bound.
       * @returns Owned project IDs and optional continuation.
       */
  abstract listOwnedProjects(authority: RequestAuthority, options?: PageOptions): Promise<{
    projectIds: readonly ProjectId[]
    nextCursor?: string
  }>
  /**
       * Install the single outbound provider as a scoped registration.
       * @param provider - Explicit private delivery transport.
       * @returns Disposer that removes the same registration.
       */
  abstract registerDelivery(provider: IdentityDeliveryProvider): () => void
  /**
       * Attempt pending nonexpired mail without reviving cancelled ciphertext.
       * @param signal - Cancels active delivery or the remaining batch.
       */
  abstract flushOutbox(signal?: AbortSignal): Promise<void>
  /**
       * Verify the session-bound browser CSRF token after current-authority revalidation.
       * @param authority - Current issued cookie authority.
       * @param token - Submitted CSRF verifier.
       */
  abstract assertCsrf(authority: RequestAuthority, token: string): Promise<void>
  /**
       * Operator restore barrier that invalidates historical sessions and links, then awaits quiescence.
       */
  abstract restoreFence(): Promise<void>
  /**
     * Operator-only idempotent bootstrap with mandatory first password change; never an HTTP/RPC tool or literal config secret.
     * @param password - Protected operator-supplied temporary password.
     */
  abstract bootstrapMaster(password: string): Promise<void>
}
export default WebIdentity
