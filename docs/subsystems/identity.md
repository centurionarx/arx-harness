# Identity and owned project storage

This reference defines the native login, ownership and isolated execution types. [Web identity](../../packages/identity/web-identity/README.md) owns authentication and authorization; [project storage](../../packages/identity/project-storage/README.md) owns private content indices and durable history. Neither the administrative API nor the browser can adopt an operator filesystem path as a project.

## Identity and request authority

`WebUserId` is the stable account identity; names and email addresses are lookup fields, not ownership keys. `WebAuthSessionId` identifies a login session and is distinct from the conversation `SessionId`. `AuthAudience` separates user and administrative deployments. `WebPrincipal` carries the account role, status, first-password restriction and module grants, while `AuthState` distinguishes anonymous and authenticated browser state. The public [contract](../../packages/identity/web-identity/src/contract.ts) parses that state and defines `allowsProjectAccess`, a pure admission predicate that never validates credentials or issues authority.

`RequestAuthority` is an immutable identity-provider-issued value capturing the principal, audience, login session and authorization revision. Server consumers revalidate it; copying its fields or submitting an owner id does not create authority. Revalidation rejects stale revisions, absolute expiry and idle expiry, and never upgrades a captured request. The identity provider requires an explicit idle budget. Only a carrier mutation admitted after its credential, Host/Origin and applicable CSRF fences may request durable activity renewal; passive polling, WebSocket admission and worker progress do not extend inactivity. Renewal cannot move the absolute deadline. The MASTER_ADMIN role administers account release and module availability; only an active unrestricted USER in the user audience can access project content. These requirements apply even when a request arrives on loopback.

The current HTTP admission still treats authenticated automatic SDK unary reads sent by POST as mutating activity before semantic success. This unresolved idle-policy defect keeps AUTH BLOCKED despite the quiet-expiry tests. GET polling, WebSocket admission and direct worker progress remain passive; an automatic worker-driven SDK refetch through POST does not. The reviewed server-owned eligibility proposal is not implemented, and no acceptance bar or further review round is waived.

The [SQLite provider](../../packages/identity/web-identity-sqlite/README.md) owns hashes, opaque token verifiers, state transitions and authorization durability. The [HTTP identity API](../../packages/host/web-identity-api/README.md) owns origin/cookie/CSRF validation, rate budgets and generic recovery responses. `IdentityDelivery` belongs to an operator delivery adapter; [Resend](../../packages/identity/web-identity-resend/README.md) sends the bounded encrypted outbox through its separately configured credential reference. Raw tokens, delivery links and content are absent from administrative projections.

`LoginResult` is a Host-only result containing the cookie token and authenticated `AuthState`; browser projections never serialize the token. `AdminUserSummary` and `AdminUserList` expose bounded account metadata, password-establishment state and outbox status without private delivery links or project content. `ModuleId` identifies an installed module, and `ModuleCatalog` describes the catalog available for account grants; an identifier or catalog row does not grant access. `PageOptions` supplies a bounded page size and continuation cursor.

## Resource ownership

`ProjectId`, `WorkspaceId` and conversation `SessionId` identify the three owned resource kinds. `OwnerResource` names one kind for authorization; `OwnedResource` records its owner and parent project/workspace. `OwnerScope` requires the workspace as well as the owner and project; the captured authorization revision belongs to `RequestAuthority`. Ownership records and deletion tombstones are authoritative even when a derived index is rebuilt or an older content backup is restored. Missing mapping never authorizes legacy content through its name or historical cwd.

`ProjectsPage` and `WorkspacesPage` are owner-authorized navigation pages. `UserWorkspaceSummary` describes an opaque workspace id, display name and parent project; it never grants access to a filesystem path. The browser can use these summaries to select an owned resource, while the provider revalidates ownership before any content operation.

`ProjectStorage` resolves sealed USER authority, the required grant and current resource ownership for every list/read/append/recovery operation. It keeps history indices, committed logs and workspace provisioning manifests outside worker content mounts. Navigation projections carry opaque ids and display names. An explicit owner raw-log download preserves its existing header and bytes; those fields remain data and never select an execution path. Removing a workspace grouping, deleting a conversation and deleting project files have distinct contracts.

`HistoryCommit` acknowledges the durable provider append and private index projection. A failed append cannot advance the acknowledged sequence or produce a saved receipt. `HistoryPage` contains an owner-authorized metadata page. `HistoryArtifactPage` contains a bounded raw artifact page with a revision-bound cursor; providers without paged artifact support fail that operation rather than reading the entire log as a fallback. Compressed pages validate the containing frame before acknowledgement. Physical provider semantics are documented in [persistence](persistence.md).

## Authorization journal and restoration

`IdentityAuthorityJournal` records current revisions, ownership and tombstones outside the auth/content backup set. `AuthorityHead` binds the committed journal sequence to its hash and is compared with the independently protected current watermark. Its head is append-and-fsync durable before the SQLite FULL projection and acknowledgement. Journal/projection disagreement closes access until reconciliation; ordinary startup cannot create a new genesis or recreate bootstrap accounts. Restore invalidates all old login, invitation and reset tokens, then reconciles with the current external authority before admitting users. The [journal provider](../../packages/identity/identity-authority-journal/README.md) owns locking, watermark validation and failure recovery.

`AuthInvalidationReason` classifies logout, credential/status/grant changes, restore, expiry and disposal; it conveys a committed invalidation category and never authorizes a request. `AuthorityEvent` carries one provider-owned decision and operation id; `AuthorityRecord` adds its immutable sequence, time and preceding/current hashes. `IdentityDeliveryProvider` is the single registered transport for the private encrypted invitation/reset outbox; provider acceptance records an external id and does not prove recipient delivery. `web-identity/invalidated` signals login/grant invalidation. `web-identity/ownership-deleted` awaits content operation quiescence after a durable resource tombstone without revoking the user's login. `web-identity/session-expired` awaits quiescence of one FULL-projected authentication session even without new traffic; other login sessions keep their revision. The [isolated runtime](../../packages/host/isolated-project-runtime/README.md) consumes these events and verifies its captured revision/owner before final dispatch and publication.

`OwnedWorkerPersistence` (`ctx.ownedWorkerHistory`) mediates the existing persistence seam through a control-issued worker capability. It binds the assigned owner/project/workspace before admitting session creation, durable append, unpublished inspection, preparation or bounded artifact reads. Its coordinator stores the real event log outside worker content, closes an interrupted cold turn before publication and preserves explicit fork lineage; aborting a browser request does not prove that the corresponding worker operation has quiesced.

## Isolated execution

`IsolatedProjectRuntime` uses a fixed operator endpoint and credential reference, existing ApiProxy envelopes, a closed USER method policy and operation-scoped supervisor receipts. A missing endpoint, missing ownership or an unconfirmed cancellation leaves execution closed; the adapter has no shared-host fallback. The worker receives only its assigned resource and mediated persistence operations. The [native authority decision](../../.agents/notes/proposed/architecture/2026-10-08-native-web-authority-and-owned-control-plane.md) owns the control/worker separation and preview-origin rationale.

These software contracts do not establish VM, mount or network isolation. A public deployment requires separately verified HTTPS origins, operator-protected keys/journal/control files and an independently confined worker volume. Backup/restore and migration fixtures are documented by the [owned storage example](../../examples/owned-project-storage/README.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxidentityauthorityjournal--identityauthorityjournal-abstract-seam"></a>

### `ctx.identityAuthorityJournal` — `IdentityAuthorityJournal` (abstract seam)

The protected authority log is outside every restored auth/content snapshot.

```ts cordis-catalog
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
```

Source: [`packages/identity/web-identity/src/index.ts`](../../packages/identity/web-identity/src/index.ts)

<a id="ctxisolatedprojectruntime--isolatedprojectruntime"></a>

### `ctx.isolatedProjectRuntime` — `IsolatedProjectRuntime`

One trusted supervisor serves owner-assigned workers, never the shared host.

```ts cordis-catalog
/**
 * Close the affected downlinks, abort all affected transports, cancel every supervisor lease, and await
 * process-tree receipts. Concurrent requests share the barrier, and new owner
 * execution refuses until it settles. A missing receipt permanently closes this adapter and logs one error
 * with the operation id, the trigger, the error class and, for a WebIdentityError, its code; never its message.
 * @param userId - Affected account, or all accounts during disposal.
 */
quiesce(userId?: WebUserId): Promise<void>

/**
 * Execute the closed worker-history protocol using a control-issued lease.
 * Capabilities authorize only the current USER workspace and never carry SQL
 * or path operations. Broker errors omit private locations and source bytes.
 * @param request - Private supervisor-to-control Request.
 * @returns Durable receipt or a fixed refusal.
 */
async broker(request: Request): Promise<Response>

/**
 * Forward one existing RPC request after the final ownership/revision check.
 * No cookie, bearer, browser Origin or arbitrary endpoint crosses to workers.
 * @param authority - Current provider-issued USER authority.
 * @param resource - Authoritative selected resource, if the method addresses one.
 * @param request - Existing ApiProxy request envelope.
 * @param signal - Local caller cancellation.
 * @returns Existing RPC business result.
 */
async invoke(authority: RequestAuthority, resource: OwnerResource | undefined, request: ClientRequest, signal?: AbortSignal): Promise<ServerResponse['result']>

/**
 * Existing HTTP carrier entry for unary RPC and owned log downloads.
 * @param authority - Current issued USER authority.
 * @param request - Incoming browser carrier request.
 * @param resource - Resource selected by the trusted gateway parser.
 * @param signal - Caller cancellation.
 * @returns Existing ServerResponse JSON envelope.
 */
async fetch(authority: RequestAuthority, request: Request, resource?: OwnerResource, signal?: AbortSignal): Promise<Response>

/**
 * Open the existing owner-filtered mux downlink.
 * @param authority - Current issued USER authority.
 * @param signal - Downlink cancellation.
 * @returns Existing mux frames.
 */
async *streamMux(authority: RequestAuthority, signal: AbortSignal): AsyncIterable<RpcRequest<MuxFrame>>

/**
 * Open the existing owner-filtered host downlink.
 * @param authority - Current issued USER authority.
 * @param signal - Downlink cancellation.
 * @returns Existing host frames.
 */
async *streamHost(authority: RequestAuthority, signal: AbortSignal): AsyncIterable<RpcRequest<HostFrame>>

/**
 * Merge one workspace-scoped sub-stream per attached workspace into one
 * downlink. The initial set is the user's workspaces with a live lease;
 * dispatch() attaches others before forwarding their first request. Each
 * frame is authorized against its sub-lease's workspace before exposure.
 * Any sub-stream end or failure ends the whole downlink and cancels every
 * sub-lease. Remote host events are denied.
 * @param authority - Current issued USER authority.
 * @param channel - Existing host or mux channel.
 * @param signal - Local downlink cancellation.
 * @returns Existing narrow RpcRequest frames filtered by identity ownership.
 */
async *streams(authority: RequestAuthority, channel: 'mux' | 'host', signal: AbortSignal): AsyncIterable<RpcRequest<MuxFrame | HostFrame>>
```

Types: [ClientRequest](../../packages/host/apiproxy/README.md) · [HostFrame](../../packages/host/apiproxy/README.md) · [MuxFrame](../../packages/host/apiproxy/README.md) · [RpcRequest](../../packages/host/apiproxy/README.md)

Source: [`packages/host/isolated-project-runtime/src/index.ts`](../../packages/host/isolated-project-runtime/src/index.ts)

<a id="ctxownedworkerhistory--ownedworkerpersistence"></a>

### `ctx.ownedWorkerHistory` — `OwnedWorkerPersistence`

Existing SessionPersistence provider, with no local history database/files.

```ts cordis-catalog
/**
 * Bind a trusted supervisor request to this fixed workspace.
 * @param capability - Opaque control-issued lease capability.
 * @param scope - Fixed assigned scope carried by trusted supervisor metadata.
 */
bind(capability: string, scope: OwnerScope): void

/**
 * Read original private bytes over the bounded broker contract.
 * @param id - Owned session within this operator-mounted workspace.
 * @param request - Existing persistence page request.
 * @param signal - Carrier cancellation.
 * @returns Original page or refusal when no materialized artifact exists.
 */
override async readRawPage(id: SessionId, request: SessionRawArtifactPageRequest, signal?: AbortSignal): Promise<SessionRawArtifactPage>

/**
 * Assemble an explicit raw export without reserializing any recorded event.
 * Navigation continues to use bounded control pages, never this full reader.
 * @param id - Owned session.
 * @param signal - Export cancellation.
 * @returns The unchanged logical artifact, absent for a lazy log.
 */
override async readRaw(id: SessionId, signal?: AbortSignal): Promise<SessionRawArtifact | undefined>

/**
 * Obtain an existing control allocation before native Agent publication.
 * @param sessionId - Registered unseeded session in this fixed workspace.
 * @returns Canonical immutable metadata without materializing its lazy log.
 */
async readCreationHeader(sessionId: SessionId): Promise<SessionHeader>

/**
 * Allocate fork lineage in control before the worker creates its child.
 * @param sessionId - Existing owned parent session.
 * @param seedLength - Canonical event prefix length accepted by persistence.
 * @param agentPreset - Optional existing preset recorded in the new header.
 * @returns The control-generated owned child session identity.
 */
async allocateForkSessionId(sessionId: SessionId, seedLength: number, agentPreset?: string): Promise<SessionId>

/**
 * Preserve the exact control-committed creation timestamp and immutable lineage.
 * @param sessionId - Existing parent in this fixed workspace.
 * @param seedLength - Canonical inherited event prefix.
 * @param agentPreset - Expected original composition preset.
 * @returns The closed control-issued header before Agent publication.
 */
async allocateForkSessionHeader(sessionId: SessionId, seedLength: number, agentPreset?: string): Promise<SessionHeader>

/**
 * Worker volumes contain no authoritative session artifact locations.
 * @param _meta - Owned header; control keeps its physical log location private.
 * @returns Undefined because this worker has no local history path.
 */
locate(_meta: SessionHeader): SessionLocation | undefined

/**
 * Cold control recovery completes before returning the first writer snapshot.
 * @param id - Owned session identity.
 * @param signal - Optional snapshot cancellation.
 * @returns A committed original prefix at the fixed worker mount, or undefined for a lazy log.
 */
async loadStored(id: SessionId, signal?: AbortSignal): Promise<StoredPrefix | undefined>

/**
 * Read the current control-owned artifact generation.
 * @param id - Owned session identity.
 * @param signal - Optional revision-read cancellation.
 * @returns The opaque generation, or undefined before log materialization.
 */
override readRevision(id: SessionId, signal?: AbortSignal): Promise<SessionPersistenceRevision | undefined>

/**
 * Read the current control-owned artifact generation over the closed broker.
 * @param id - Owned session identity.
 * @param signal - Optional revision-read cancellation.
 * @returns The opaque generation, or undefined before log materialization.
 */
async readStoredRevision(id: SessionId, signal?: AbortSignal): Promise<SessionPersistenceRevision | undefined>

/**
 * Commit one coordinator batch through the current fixed workspace lease.
 * @param meta - Owned session header used to identify the control log.
 * @param events - Canonical events already validated by the coordinator.
 * @param _isMaterialized - Coordinator state; control determines actual materialization.
 * @returns Completion only after the durable append receipt.
 */
async appendBatch(meta: SessionHeader, events: readonly SessionEvent[], _isMaterialized: boolean): Promise<void>

/**
 * Control has already durably repaired a cold prefix; a live open-tail reload refuses.
 * @param _meta - Existing session header already authorized by control.
 * @param _marker - Existing coordinator marker; control owns durable repair.
 * @param closers - Proposed repair events; a live worker refuses nonempty repair.
 * @returns A completed promise only when no live repair is needed.
 */
commitRepair(_meta: SessionHeader, _marker: unknown, closers: readonly SessionEvent[]): Promise<void>

/**
 * List materialized owned headers for this fixed workspace.
 * @param signal - Optional list cancellation.
 * @returns Original owned headers with the operator-assigned execution mount.
 */
async list(signal?: AbortSignal): Promise<SessionHeader[]>

/**
 * Pair materialized owned headers with their current control generations.
 * @param signal - Optional snapshot-list cancellation.
 * @returns Only headers whose artifacts remain present at the revision lookup.
 */
async listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]>
```

Types: [SessionEvent](session.md) · [SessionHeader](persistence.md) · [SessionId](core.md) · [SessionLocation](persistence.md) · [SessionPersistenceRevision](persistence.md) · [SessionPersistenceSnapshot](persistence.md) · [SessionRawArtifact](persistence.md) · [SessionRawArtifactPage](persistence.md) · [SessionRawArtifactPageRequest](persistence.md) · [StoredPrefix](persistence.md)

Source: [`packages/host/isolated-project-runtime/src/worker-persistence.ts`](../../packages/host/isolated-project-runtime/src/worker-persistence.ts)

<a id="ctxprojectstorage--projectstorage"></a>

### `ctx.projectStorage` — `ProjectStorage`

The index is derived from acknowledged persistence operations and identity ownership, never from cwd, usernames, legacy headers or a global directory scan.

```ts cordis-catalog
/**
 * Create project identity before projecting its user-visible metadata.
 * @param authority - Issued USER authority.
 * @param name - Display name, never a filesystem path.
 * @returns New opaque project metadata.
 */
async createProject(authority: RequestAuthority, name: string): Promise<ProjectSummary>

/**
 * List projects whose identity records still authorize the principal.
 * @param authority - Issued USER authority.
 * @param cursor - Prior identity page cursor.
 * @returns Metadata for the current owned project page.
 */
async projects(authority: RequestAuthority, cursor?: string): Promise<ProjectsPage>

/**
 * Create an owned workspace volume with an opaque server id.
 * @param authority - Issued USER authority.
 * @param projectId - Owned project.
 * @param name - Display name, never a host path.
 * @returns User-safe workspace metadata.
 */
async createWorkspace(authority: RequestAuthority, projectId: ProjectId, name: string): Promise<UserWorkspaceSummary>

/**
 * List grouping metadata without inspecting any user directory.
 * @param authority - Issued USER authority.
 * @param projectId - Owned project.
 * @param cursor - Last returned workspace id.
 * @returns Owner-authorized workspace metadata page.
 */
async workspaces(authority: RequestAuthority, projectId: ProjectId, cursor?: string): Promise<WorkspacesPage>

/**
 * List the user's grouped workspaces in display order. Workspaces absent from
 * the stored order follow it in creation order; unowned rows are omitted.
 * @param authority - Issued USER authority.
 * @returns Owned workspace ids in display order.
 */
async workspaceOrder(authority: RequestAuthority): Promise<WorkspaceId[]>

/**
 * Move one owned workspace before another, or to the end, and store the
 * user's complete display order. Moves of one user apply one at a time.
 * @param authority - Issued USER authority.
 * @param workspaceId - Owned grouped workspace to move.
 * @param beforeWorkspaceId - Owned grouped anchor; absent appends.
 * @returns The complete stored display order.
 */
async moveWorkspace(authority: RequestAuthority, workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<WorkspaceId[]>

/**
 * Remove a grouping registration while preserving every identity, history
 * artifact and workspace file.
 * @param authority - Issued USER authority.
 * @param workspaceId - Owned workspace.
 */
async removeGrouping(authority: RequestAuthority, workspaceId: WorkspaceId): Promise<void>

/**
 * Rename only the index title; the canonical session stream is unchanged.
 * @param authority - Issued USER authority.
 * @param id - Owned session.
 * @param title - Display title.
 * @returns Updated metadata.
 */
async rename(authority: RequestAuthority, id: SessionId, title: string): Promise<StoredSessionSummary>

/**
 * Commit an identity tombstone before removing derived history metadata.
 * Physical logs and backups remain subject to the operator retention policy.
 * @param authority - Issued USER authority.
 * @param id - Owned session.
 */
async deleteSession(authority: RequestAuthority, id: SessionId): Promise<void>

/**
 * Reserve a workspace's opaque volume without exposing its parent or touching
 * worker-created files. Only the deployment operator mounts the returned path.
 * @param authority - Current issued USER authority.
 * @param workspaceId - Identity-owned workspace.
 * @param signal - Optional cancellation before provisioning or dispatch.
 * @returns Private provisioning data for the trusted runtime adapter.
 */
async provision(authority: RequestAuthority, workspaceId: WorkspaceId, signal?: AbortSignal): Promise<{ scope: OwnerScope volumePath: string }>

/**
 * Register authoritative ownership before creating new persistence state.
 * Caller-supplied cwd is replaced by the opaque owned workspace volume.
 * @param authority - Current issued USER authority.
 * @param workspaceId - Owning workspace.
 * @param header - Session header in the existing on-disk format.
 * @param signal - Optional broker admission cancellation before commit starts.
 * @returns Header committed to the index and persistence provider.
 */
async register(authority: RequestAuthority, workspaceId: WorkspaceId, header: SessionHeader, signal?: AbortSignal): Promise<SessionHeader>

/**
 * Read committed creation metadata without materializing or inspecting a log.
 * @param authority - Current issued USER authority.
 * @param id - Already registered owned session.
 * @param signal - Lease cancellation checked before and after metadata access.
 * @returns The registered canonical header after current owner revalidation.
 */
async executionCreationHeader(authority: RequestAuthority, id: SessionId, signal?: AbortSignal): Promise<SessionHeader>

/**
 * Commit an already registered empty header for native session creation.
 * Default registration stays lazy; failed writes publish no durable receipt.
 * @param authority - Current issued USER authority for this owned session.
 * @param id - Registered owner session, never a caller-supplied filesystem path.
 * @param signal - Cancellation before admission and after an initiated commit.
 * @returns Completion after the canonical provider commit and owner revalidation.
 */
async materialize(authority: RequestAuthority, id: SessionId, signal?: AbortSignal): Promise<void>

/**
 * Append a contiguous batch and acknowledge only the fsync plus FULL index
 * projection. Failed appends publish neither a cursor nor a saved receipt.
 * @param authority - Current issued USER authority.
 * @param id - Owned session.
 * @param events - Existing SessionEvents, including their sequence envelopes.
 * @param signal - Optional cancellation before append starts; an initiated commit still projects its index.
 * @returns The next durable event sequence.
 */
async append(authority: RequestAuthority, id: SessionId, events: readonly SessionEvent[], signal?: AbortSignal): Promise<HistoryCommit>

/**
 * Reconcile an index after durable crash recovery without dispatching tools.
 * Legacy sessions without authoritative ownership and an index mapping fail.
 * @param authority - Current issued USER authority.
 * @param id - Owned and indexed session.
 * @returns Durable commit cursor after the provider repairs interrupted turns.
 */
async recover(authority: RequestAuthority, id: SessionId): Promise<HistoryCommit>

/**
 * Read the private authoritative execution source for a validated worker lease.
 * Cold recovery is requested only after the runtime has excluded another writer.
 * @param authority - Issued owner authority, checked again after persistence work.
 * @param id - Owned session identity.
 * @param cold - A quiescent new worker needs durable interrupted-tail recovery.
 * @param signal - Optional cancellation before repair starts or source reads continue.
 * @returns Immutable source interpreted by the existing persistence provider.
 */
async executionSnapshot(authority: RequestAuthority, id: SessionId, cold: boolean = false, signal?: AbortSignal): Promise<{ meta: SessionHeader events: SessionEvent[] revision: string } | undefined>

/**
 * Read a bounded private artifact page through an already scoped worker broker.
 * Raw bytes preserve the existing serialization, including its original cwd;
 * only the operator's assigned mount is used when executing the hydrated session.
 * @param authority - Current sealed owner authority.
 * @param id - Owned session.
 * @param request - Existing persistence page contract, bounded by storage policy.
 * @param signal - Lease cancellation.
 * @returns Original artifact page, absent for an unmaterialized log.
 */
async executionRawPage(authority: RequestAuthority, id: SessionId, request: import('@arx-ai/arx-session-persistence').SessionRawArtifactPageRequest, signal?: AbortSignal): Promise<import('@arx-ai/arx-session-persistence').SessionRawArtifactPage | undefined>

/**
 * Observe one owned log revision without repairing or buffering its full body.
 * @param authority - Current issued owner authority.
 * @param id - Owned session.
 * @param signal - Cancellation before and after the provider observation.
 * @returns Provider-qualified revision, absent for a lazy unmaterialized log.
 */
async executionRevision(authority: RequestAuthority, id: SessionId, signal?: AbortSignal): Promise<string | undefined>

/**
 * List private headers inside one fixed worker mount, including only current owners.
 * @param authority - Current issued USER authority.
 * @param workspaceId - The operator-assigned workspace.
 * @param signal - Optional cancellation for metadata observation and ownership checks.
 * @returns Metadata only; no conversation bodies or other owner rows.
 */
async executionHeaders(authority: RequestAuthority, workspaceId: WorkspaceId, signal?: AbortSignal): Promise<SessionHeader[]>

/**
 * Pair owned execution headers with revisions from one authoritative provider scan.
 * The index supplies membership candidates; each owner and materialized source
 * is checked independently before any metadata is returned to the worker.
 * @param authority - Current sealed USER authority.
 * @param workspaceId - Operator-assigned workspace bound to the requesting lease.
 * @param signal - Optional cancellation throughout metadata and ownership observation.
 * @returns Original owned headers and actual source-qualified revisions.
 */
async executionSnapshots(authority: RequestAuthority, workspaceId: WorkspaceId, signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]>

/**
 * List owned session headers without loading any conversation body.
 * @param authority - Current issued USER authority.
 * @param resource - Owned project or workspace.
 * @param cursor - Last returned opaque session id.
 * @returns A bounded page with an optional continuation.
 */
async list(authority: RequestAuthority, resource: Exclude<OwnerResource, { kind: 'session' }>, cursor?: string): Promise<HistoryPage>

/**
 * Read the provider's bounded original JSONL page under a source revision.
 * Pages retain complete UTF-8 characters and never use full-log readRaw.
 * Current session and ancestor ownership is checked again after physical I/O.
 * @param authority - Current issued USER authority.
 * @param id - Owned session.
 * @param cursor - Opaque revision-bound continuation from the prior page.
 * @param signal - Optional carrier cancellation for physical read/decode work.
 * @returns Unmodified decoded bytes plus the durable cursor.
 */
async read(authority: RequestAuthority, id: SessionId, cursor?: string, signal?: AbortSignal): Promise<HistoryArtifactPage>
```

Types: [ProjectId](../../packages/project/project/README.md) · [ProjectSummary](../../packages/project/project/README.md) · [SessionEvent](session.md) · [SessionHeader](persistence.md) · [SessionId](core.md) · [SessionPersistenceSnapshot](persistence.md) · [SessionRawArtifactPage](persistence.md) · [SessionRawArtifactPageRequest](persistence.md) · [StoredSessionSummary](persistence.md) · [WorkspaceId](workspace.md)

Source: [`packages/identity/project-storage/src/index.ts`](../../packages/identity/project-storage/src/index.ts)

<a id="ctxwebidentity--webidentity-abstract-seam"></a>

### `ctx.webIdentity` — `WebIdentity` (abstract seam)

Site identity, grants and opaque ownership; this service exposes no project content.

```ts cordis-catalog
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
abstract state(authority: RequestAuthority): Promise<Extract<AuthState, { authenticated: true }>>

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
abstract changePassword( authority: RequestAuthority, currentPassword: string, newPassword: string, signal?: AbortSignal, ): Promise<LoginResult>

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
abstract createUser(authority: RequestAuthority, input: { username: string email: string }): Promise<AdminUserSummary>

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
abstract authorizeOwner(authority: RequestAuthority, resource: Exclude<OwnerResource, { kind: 'project' }>, moduleId?: ModuleId): Promise<OwnerScope>

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
abstract listOwnedProjects(authority: RequestAuthority, options?: PageOptions): Promise<{ projectIds: readonly ProjectId[] nextCursor?: string }>

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
```

Types: [ProjectId](../../packages/project/project/README.md) · [SessionId](core.md) · [WorkspaceId](workspace.md)

Source: [`packages/identity/web-identity/src/index.ts`](../../packages/identity/web-identity/src/index.ts)

<a id="ctxwebidentityapi--webidentityrequestauthenticator"></a>

### `ctx.webIdentityApi` — `WebIdentityRequestAuthenticator`

Shared audience, Host/Origin and CSRF request admission used by every authenticated carrier.

```ts cordis-catalog
/**
 * Authenticate an incoming carrier through the fixed deployment audience, Host/Origin and cookie/bearer policy.
 * @param request - Web Request or original Node request whose authority and headers are checked.
 * @param options - Require session-bound browser CSRF when the carrier performs a mutation.
 * @returns Current immutable authority issued and revalidated by the native identity provider.
 */
authenticateRequest(request: Request | IncomingMessage, options?: { readonly mutating?: boolean }): Promise<RequestAuthority>
```

Source: [`packages/identity/web-identity/src/index.ts`](../../packages/identity/web-identity/src/index.ts)

<a id="web-identity-events"></a>

### `web-identity/*` events

<a id="web-identityinvalidated--parallel"></a>

#### `web-identity/invalidated` — parallel

Authentication invalidation after durable projection. Listeners run outside the writer queue and finish quiescence before mutation ACK.

```ts cordis-catalog
/**
     * Authentication invalidation after durable projection. Listeners run
     * outside the writer queue and finish quiescence before mutation ACK.
     * @mode parallel
     * @param userId Affected account.
     * @param reason Invalidation category.
     * @param revision Committed authority revision.
     */
'web-identity/invalidated'(userId: WebUserId, reason: AuthInvalidationReason, revision: number): void | Promise<void>
```

Source: [`packages/identity/web-identity/src/index.ts`](../../packages/identity/web-identity/src/index.ts)

<a id="web-identityownership-deleted--parallel"></a>

#### `web-identity/ownership-deleted` — parallel

Ownership tombstone after durable projection. Awaited listeners quiesce deleted resources without revoking the valid cookie or auth revision.

```ts cordis-catalog
/**
     * Ownership tombstone after durable projection. Awaited listeners quiesce
     * deleted resources without revoking the valid cookie or auth revision.
     * @mode parallel
     * @param userId Affected USER owner.
     * @param resource Tombstoned resource and its denied descendants.
     */
'web-identity/ownership-deleted'(userId: WebUserId, resource: OwnerResource): void | Promise<void>
```

Source: [`packages/identity/web-identity/src/index.ts`](../../packages/identity/web-identity/src/index.ts)

<a id="web-identityprojected--emit"></a>

#### `web-identity/projected` — emit

Committed journal and FULL projection watermark for derived observers.

```ts cordis-catalog
/**
     * Committed journal and FULL projection watermark for derived observers.
     * @mode emit
     * @param head Current durable authority head.
     */
'web-identity/projected'(head: AuthorityHead): void
```

Source: [`packages/identity/web-identity/src/index.ts`](../../packages/identity/web-identity/src/index.ts)

<a id="web-identitysession-expired--parallel"></a>

#### `web-identity/session-expired` — parallel

One expired authentication session after journal and FULL projection. Awaited listeners finish session-scoped quiescence outside the writer queue.

```ts cordis-catalog
/**
     * One expired authentication session after journal and FULL projection.
     * Awaited listeners finish session-scoped quiescence outside the writer queue.
     * @mode parallel
     * @param userId Affected account.
     * @param authSessionId Expired authentication session; other sessions retain authority.
     */
'web-identity/session-expired'(userId: WebUserId, authSessionId: WebAuthSessionId): void | Promise<void>
```

Source: [`packages/identity/web-identity/src/index.ts`](../../packages/identity/web-identity/src/index.ts)
<!-- END GENERATED cordis-surface -->
