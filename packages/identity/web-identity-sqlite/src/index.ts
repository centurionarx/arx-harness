/**
 * Native site identity provider. Authority journal is canonical; SQLite is
 * a FULL-synchronous projection and owns no history or workspace contents.
 * @module @arx-ai/arx-web-identity-sqlite
 */
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import { Context, Service } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import { WebIdentity, WebIdentityError, identityFailure, ModuleId } from '@arx-ai/arx-web-identity'
import type { AdminUserList, AdminUserSummary, AuthAudience, AuthInvalidationReason, AuthState, AuthorityEvent, AuthorityRecord, IdentityDeliveryProvider, JsonValue, LoginResult, ModuleCatalog, ModuleId as ModuleIdType, OwnerResource, OwnedResource, OwnerScope, PageOptions, ProjectId, RequestAuthority, WebAuthSessionId, WebModule, WebPrincipal, WebUserId } from '@arx-ai/arx-web-identity'
import type { WorkspaceId } from '@arx-ai/arx-workspace'
import type { SessionId } from '@arx-ai/arx-session'
import { configureDatabase } from './schema.ts'
import { csrf, decryptDelivery, digest, encryptDelivery, hashPassword, newToken, readPrivateKey, safeEqual, configureHashQueueLimit, validatePassword, verifyPassword } from './crypto.ts'
/**
 * Private control storage, canonical recovery origins, installed grants and bounded native identity policies.
 */
export interface Config {
  /**
   * Absolute local identity SQLite file, independent of the history schema and outside private worker content.
   */
  path: string
  /**
   * Absolute protected 32-byte control key file used for session CSRF and encrypted outbox envelopes, outside DB
   * backup sets.
   */
  privateKeyPath: string
  /**
   * Canonical audience origins used only to build private fragment-based invitation and reset links.
   */
  recoveryOrigins: {
    /**
     * Canonical USER deployment origin for recipient-owned invitation/reset completion.
     */
    user: string
    /**
     * Canonical administration origin for MASTER account password recovery.
     */
    admin: string
  }
  /**
   * Operator-installed grant catalog; account administration may grant only these module and operation identifiers.
   */
  modules: {
    /**
     * Stable validated module identifier used by authorization and administrative grant replacement.
     */
    id: string
    /**
     * Display label for the installed module in the detached administration catalog.
     */
    label: string
    /**
     * Installed operation identifiers governed by this module; duplicate operation IDs are refused.
     */
    operations: string[]
  }[]
  /**
   * Identifiers of the single MASTER_ADMIN account that bootstrapMaster creates; both must be valid account identifiers.
   */
  bootstrapAccount: {
    /**
     * Username of the bootstrap MASTER_ADMIN account.
     */
    username: string
    /**
     * Email address of the bootstrap MASTER_ADMIN account, used for its password recovery.
     */
    email: string
  }
  /**
   * Explicit operator or fixture permission to create a new independent identity schema; it does not recreate a
   * missing journal.
   */
  allowInitialize?: boolean
  /**
   * Lifetime of newly issued audience-bound authentication sessions before mandatory reauthentication.
   */
  sessionTtlMs?: number
  /**
   * Explicit maximum idle interval; only authenticated carrier activity renews it within the absolute session lifetime.
   */
  sessionIdleTtlMs: number
  /**
   * Lifetime of a single-use invitation independently of administrative account release.
   */
  invitationTtlMs?: number
  /**
   * Lifetime of a single-use credential recovery token; consumption cannot release or grant an account.
   */
  resetTtlMs?: number
  /**
   * Deadline of one pending outbox transport attempt, communicated through its cancellation signal.
   */
  deliveryTimeoutMs?: number
  /**
   * Interval of the scoped delivery pump for pending, nonexpired encrypted outbox entries.
   */
  deliveryRetryMs?: number
  /**
   * Bounded number of pending password jobs; native scrypt execution remains limited to two active jobs.
   */
  hashQueueLimit?: number
}
interface UserRow {
  id: string
  username: string
  username_key: string
  email: string
  email_key: string
  role: 'MASTER_ADMIN' | 'USER'
  status: 'PENDING' | 'ACTIVE' | 'BLOCKED' | 'DELETED'
  password_hash: string | null
  must_change: number
  revision: number
  created_at: number
}
interface SessionRow {
  id: string
  user_id: string
  token_digest: string
  audience: AuthAudience
  revision: number
  expires_at: number
  idle_expires_at: number
  revoked: number
}
interface TokenRow {
  id: string
  user_id: string
  purpose: 'invitation' | 'reset'
  token_digest: string
  expires_at: number
  used: number
}
interface OutboxRow {
  id: string
  user_id: string
  token_id: string
  purpose: 'invitation' | 'reset'
  expires_at: number
  ciphertext: string | null
  state: 'pending' | 'accepted' | 'cancelled'
  provider_id: string | null
}
interface Change {
  user?: UserRow
  session?: SessionRow
  token?: TokenRow
  outbox?: OutboxRow
  grants?: {
    userId: string
    values: readonly string[]
  }
  revokeUser?: string
  cancelTokens?: string
  project?: {
    id: string
    user_id: string
    deleted: number
  }
  workspace?: {
    id: string
    project_id: string
    deleted: number
  }
  sessionOwner?: {
    id: string
    workspace_id: string
    deleted: number
  }
  deleteOwner?: {
    kind: 'project' | 'workspace' | 'session'
    id: string
  }
  restore?: boolean
}
const columns = {
  users: ['id', 'username', 'username_key', 'email', 'email_key', 'role', 'status', 'password_hash', 'must_change', 'revision', 'created_at'],
  web_sessions: ['id', 'user_id', 'token_digest', 'audience', 'revision', 'expires_at', 'idle_expires_at', 'revoked'],
  auth_tokens: ['id', 'user_id', 'purpose', 'token_digest', 'expires_at', 'used'],
  outbox: ['id', 'user_id', 'token_id', 'purpose', 'expires_at', 'ciphertext', 'state', 'provider_id'],
  project_owners: ['id', 'user_id', 'deleted'], workspace_owners: ['id', 'project_id', 'deleted'],
  session_owners: ['id', 'workspace_id', 'deleted'],
} as const
function username(value: string): {
  value: string
  key: string
} {
  const text = value.trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/.test(text))
    identityFailure('INVALID_USERNAME', 400, 'Use 3 to 64 letters, numbers, periods, underscores or hyphens')
  return { value: text, key: text.toLowerCase() }
}
function email(value: string): {
  value: string
  key: string
} {
  const text = value.trim()
  if (text.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(text))
    identityFailure('INVALID_EMAIL', 400, 'Enter a valid email address')
  return { value: text, key: text.toLowerCase() }
}
function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
/**
 * Native identity provider with journal-first FULL projection and quiescence before revocation acknowledgment.
 */
export class SqliteWebIdentity extends WebIdentity {
  static inject = ['identityAuthorityJournal']
  static Config: z<Config> = z.object({
    path: z.string().required(), privateKeyPath: z.string().required(),
    recoveryOrigins: z.object({ user: z.string().required(), admin: z.string().required() }).required(),
    modules: z.array(z.object({
      id: z.string().required(), label: z.string().required(), operations: z.array(String).required(),
    })).required(),
    bootstrapAccount: z.object({ username: z.string().required(), email: z.string().required() }).required(),
    allowInitialize: z.boolean().default(false),
    sessionTtlMs: z.natural().min(1000).max(86400000).default(28800000),
    sessionIdleTtlMs: z.natural().min(1000).max(86400000).required(),
    invitationTtlMs: z.natural().min(1000).max(86400000).default(86400000),
    resetTtlMs: z.natural().min(1000).max(3600000).default(1800000),
    deliveryTimeoutMs: z.natural().min(1).max(60000).default(10000),
    deliveryRetryMs: z.natural().min(1000).max(60000).default(5000),
    hashQueueLimit: z.natural().max(64).default(16),
  })
  private projectionReady = false
  private database: DatabaseSync | undefined
  private key: Buffer | undefined
  private dummy = ''
  private queue: Promise<unknown> = Promise.resolve()
  private delivery: IdentityDeliveryProvider | undefined
  private pumping: Promise<void> | undefined
  private deliveryAbort: AbortController | undefined
  private deliveryTimer: ReturnType<typeof setInterval> | undefined
  private expiryTimer: ReturnType<typeof setTimeout> | undefined
  private expiryWork: Promise<void> | undefined
  private expiryFailed = false
  private stopped = false
  private closing = false
  private readonly ownerCtx: Context
  private readonly catalog: readonly WebModule[]
  private readonly bootstrap: { username: { value: string; key: string }; email: { value: string; key: string } }
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    this.ownerCtx = ctx
    if (!Number.isSafeInteger(config.sessionIdleTtlMs) || config.sessionIdleTtlMs < 1000 || config.sessionIdleTtlMs > 86400000)
      identityFailure('AUTH_CONFIGURATION', 503, 'Explicit bounded session idle policy required')
    configureHashQueueLimit(config.hashQueueLimit ?? 16)
    try {
      this.bootstrap = { username: username(config.bootstrapAccount.username), email: email(config.bootstrapAccount.email) }
    } catch {
      // username/email reject with request-level errors; a configuration value maps to AUTH_CONFIGURATION.
      identityFailure('AUTH_CONFIGURATION', 503, 'Valid bootstrap account identifiers required')
    }
    const ids = new Set<string>(), operations = new Set<string>()
    this.catalog = Object.freeze(config.modules.map((row) => {
      const id = ModuleId(row.id)
      if (ids.has(id) || new Set(row.operations).size !== row.operations.length || row.label.trim() === '' || row.operations.some(operation => operation.trim() === '' || operations.has(operation))) {
        identityFailure('AUTH_CONFIGURATION', 503, 'Distinct identity module catalog required')
      }
      ids.add(id)
      row.operations.forEach(operation => operations.add(operation))
      return Object.freeze({ ...row, id, operations: Object.freeze([...row.operations]) })
    }))
    for (const origin of Object.values(config.recoveryOrigins)) {
      const parsed = new URL(origin)
      if (parsed.origin !== origin || parsed.protocol !== 'https:')
        identityFailure('AUTH_CONFIGURATION', 503, 'Canonical HTTPS recovery origins required')
    }
    ctx.effect(() => () => this.close(), 'web-identity-sqlite: database, private key and delivery lifecycle')
  }
  protected async [Service.init](): Promise<void> {
    if (!isAbsolute(this.config.path) || inside(dirname(this.config.path), this.config.privateKeyPath)
            || inside(dirname(this.config.path), this.ownerCtx.identityAuthorityJournal.root)) {
      identityFailure('AUTH_CONFIGURATION', 503, 'Separate private identity storage and authority required')
    }
    this.key = await readPrivateKey(this.config.privateKeyPath)
    if (this.config.allowInitialize === true)
      await mkdir(dirname(this.config.path), { recursive: true, mode: 0o700 })
    const parent = await lstat(dirname(this.config.path))
    if (!parent.isDirectory() || parent.isSymbolicLink() || (process.platform !== 'win32' && (parent.mode & 0o077) !== 0)) {
      identityFailure('AUTH_CONFIGURATION', 503, 'Private identity directory required')
    }
    if (await realpath(dirname(this.config.path)) !== dirname(this.config.path))
      identityFailure('AUTH_CONFIGURATION', 503, 'Canonical identity directory required')
    let exists = true
    try {
      await lstat(this.config.path)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
      exists = false
    }
    if (!exists) {
      if (this.config.allowInitialize !== true)
        identityFailure('AUTH_SCHEMA', 503, 'Initialized identity database required')
      const file = await open(this.config.path, 'wx', 0o600)
      await file.close()
    }
    const info = await lstat(this.config.path)
    if (!info.isFile() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) {
      identityFailure('AUTH_CONFIGURATION', 503, 'Private identity database required')
    }
    this.database = new DatabaseSync(this.config.path)
    configureDatabase(this.database, this.config.allowInitialize === true)
    this.projectionReady = true
    const meta = this.meta()
    const head = this.ownerCtx.identityAuthorityJournal.head
    if (meta.sequence > head.sequence)
      identityFailure('AUTHORITY_UNAVAILABLE', 503, 'Current identity authority required')
    if (meta.sequence === head.sequence && meta.hash !== head.hash)
      identityFailure('AUTHORITY_UNAVAILABLE', 503, 'Identity authority mismatch')
    const records = await this.ownerCtx.identityAuthorityJournal.recordsAfter(meta.sequence)
    if (meta.sequence > 0) {
      const all = await this.ownerCtx.identityAuthorityJournal.recordsAfter(0)
      if (all[meta.sequence - 1]?.hash !== meta.hash)
        identityFailure('AUTHORITY_UNAVAILABLE', 503, 'Identity authority mismatch')
    }
    for (const record of records)
      this.project(record)
    if (records.length > 0)
      await this.commit({ restore: true }, 'restore')
    this.dummy = await hashPassword(newToken())
    this.scheduleExpiry()
  }
  private db(): DatabaseSync {
    if (this.stopped || this.database === undefined)
      identityFailure('AUTHORITY_UNAVAILABLE', 503, 'Identity unavailable')
    return this.database
  }
  get authorityHead(): {
    sequence: number
    hash: string
  } { return Object.freeze(this.meta()) }
  private meta(): {
    sequence: number
    hash: string
  } {
    const row = (this.db().prepare('SELECT sequence,hash FROM auth_meta WHERE id=1').get() as Record<string, import('node:sqlite').SQLOutputValue>)
    return { sequence: Number(row.sequence), hash: String(row.hash) }
  }
  private fresh(): void {
    if (this.closing || this.expiryFailed)
      identityFailure('AUTHORITY_UNAVAILABLE', 503, 'Identity unavailable')
    const actual = this.meta(), head = this.ownerCtx.identityAuthorityJournal.head
    if (actual.sequence !== head.sequence || actual.hash !== head.hash)
      identityFailure('AUTHORITY_UNAVAILABLE', 503, 'Identity authority projection unavailable')
  }
  // The writer queue ends at FULL projection. Revocation barriers can await
  // broker jobs whose owner registrations require this same writer queue.
  private run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => { this.fresh(); return action() })
    this.queue = result.catch(() => { })
    return result
  }
  private row(id: string): UserRow {
    const value = this.db().prepare('SELECT * FROM users WHERE id=?').get(id) as unknown as UserRow | undefined
    if (value === undefined)
      identityFailure('USER_NOT_FOUND', 404, 'Account not found')
    return value
  }
  private lookup(identifier: string): UserRow | undefined {
    if (identifier.length > 254)
      return undefined
    const key = identifier.trim().toLowerCase()
    return this.db().prepare(key.includes('@') ? 'SELECT * FROM users WHERE email_key=?' : 'SELECT * FROM users WHERE username_key=?').get(key) as unknown as UserRow | undefined
  }
  private principal(user: UserRow): WebPrincipal {
    const rows = this.db().prepare('SELECT module_id FROM module_grants WHERE user_id=? ORDER BY module_id').all(user.id)
    return Object.freeze({ userId: user.id as WebUserId, username: user.username, email: user.email, role: user.role, status: user.status,
      mustChangePassword: user.must_change === 1, grants: Object.freeze(rows.map(row => String(row.module_id) as ModuleIdType)) })
  }
  private summary(user: UserRow): AdminUserSummary {
    return Object.freeze({ ...this.principal(user), passwordEstablished: user.password_hash !== null })
  }
  private upsert(table: keyof typeof columns, row: object): void {
    const keys = columns[table]
    const values = keys.map(key => (row as Record<string, SQLInputValue>)[key] ?? null)
    this.db().prepare('INSERT INTO ' + table + '(' + keys.join(',') + ') VALUES(' + keys.map(() => '?').join(',') + ') ON CONFLICT(id) DO UPDATE SET '
            + keys.filter(key => key !== 'id').map(key => key + '=excluded.' + key).join(',')).run(...values)
  }
  private project(record: AuthorityRecord, localCiphertext?: string): void {
    const change = record.payload as unknown as Change
    this.db().exec('BEGIN IMMEDIATE')
    try {
      if (change.user !== undefined)
        this.upsert('users', change.user)
      if (change.revokeUser !== undefined)
        this.db().prepare('UPDATE web_sessions SET revoked=1 WHERE user_id=?').run(change.revokeUser)
      if (change.cancelTokens !== undefined) {
        this.db().prepare('UPDATE auth_tokens SET used=1 WHERE user_id=?').run(change.cancelTokens)
        this.db().prepare("UPDATE outbox SET state='cancelled',ciphertext=NULL WHERE user_id=? AND state='pending'").run(change.cancelTokens)
      }
      if (change.session !== undefined)
        this.upsert('web_sessions', change.session)
      if (change.token !== undefined)
        this.upsert('auth_tokens', change.token)
      if (change.outbox !== undefined)
        this.upsert('outbox', { ...change.outbox, ciphertext: localCiphertext ?? change.outbox.ciphertext })
      if (change.grants !== undefined) {
        this.db().prepare('DELETE FROM module_grants WHERE user_id=?').run(change.grants.userId)
        const insert = this.db().prepare('INSERT INTO module_grants(user_id,module_id) VALUES(?,?)')
        change.grants.values.forEach(id => insert.run((change.grants as NonNullable<Change['grants']>).userId, id))
      }
      if (change.project !== undefined)
        this.upsert('project_owners', change.project)
      if (change.workspace !== undefined)
        this.upsert('workspace_owners', change.workspace)
      if (change.sessionOwner !== undefined)
        this.upsert('session_owners', change.sessionOwner)
      if (change.deleteOwner !== undefined) {
        const table = { project: 'project_owners', workspace: 'workspace_owners', session: 'session_owners' }[change.deleteOwner.kind]
        this.db().prepare('UPDATE ' + table + ' SET deleted=1 WHERE id=?').run(change.deleteOwner.id)
      }
      if (change.restore === true) {
        this.db().exec("UPDATE web_sessions SET revoked=1; UPDATE auth_tokens SET used=1; UPDATE outbox SET state='cancelled',ciphertext=NULL WHERE state='pending';")
        this.db().prepare('UPDATE users SET revision=?').run(record.sequence)
      }
      this.db().prepare('INSERT INTO audit(sequence,operation_id,kind) VALUES(?,?,?)').run(record.sequence, record.operationId, record.kind)
      this.db().prepare('UPDATE auth_meta SET sequence=?,hash=? WHERE id=1').run(record.sequence, record.hash)
      this.db().exec('COMMIT')
    }
    catch (error) {
      this.db().exec('ROLLBACK')
      throw error
    }
  }
  private async commit(change: Change, kind: AuthorityEvent['kind']): Promise<void> {
    this.fresh()
    const record = await this.ownerCtx.identityAuthorityJournal.append(this.meta().sequence, {
      operationId: randomUUID(), kind,
      payload: { ...change, ...(change.outbox === undefined ? {} : { outbox: { ...change.outbox, ciphertext: null } }) } as unknown as {
        [key: string]: JsonValue
      } })
    try {
      this.project(record, change.outbox?.ciphertext ?? undefined)
    }
    catch {
      identityFailure('AUTHORITY_UNAVAILABLE', 503, 'Identity projection unavailable')
    }
    this.ownerCtx.emit('web-identity/projected', { sequence: record.sequence, hash: record.hash })
    this.scheduleExpiry()
  }
  // One timer follows the nearest durable deadline. Passive scheduling never
  // changes session activity, the user revision, or the authority head.
  private scheduleExpiry(): void {
    clearTimeout(this.expiryTimer)
    this.expiryTimer = undefined
    if (this.closing || this.stopped || this.expiryFailed || this.expiryWork !== undefined
      || this.database === undefined || !this.projectionReady) return
    try {
      const row = this.database.prepare('SELECT MIN(MIN(expires_at,idle_expires_at)) AS deadline FROM web_sessions WHERE revoked=0').get() as Record<string, import('node:sqlite').SQLOutputValue>
      if (row.deadline === null) return
      const delay = Math.max(0, Math.min(2147483647, Number(row.deadline) - Date.now()))
      this.expiryTimer = setTimeout(() => {
        this.expiryTimer = undefined
        this.trackExpiry(this.expireSessions())
      }, delay)
      this.expiryTimer.unref()
    }
    catch {
      this.expiryFailed = true
      this.trackExpiry(Promise.reject(new Error('Identity deadline scheduling failed')))
    }
  }
  private trackExpiry(action: Promise<void>): void {
    const work = action.catch(async () => {
      this.expiryFailed = true
      // Admission is terminally closed. Release the writer before disposing
      // every account consumer, including the uncommitted expiry suffix.
      await this.queue
      const users = this.db().prepare('SELECT id,revision FROM users').all()
      const settled = await Promise.allSettled(users.map(user => this.notify(String(user.id), 'disposed', Number(user.revision))))
      if (settled.some(result => result.status === 'rejected'))
        identityFailure('AUTH_QUIESCENCE_FAILED', 503, 'Identity unavailable; execution quiescence unconfirmed')
    })
    this.expiryWork = work
    const finished = () => {
      this.expiryWork = undefined
      this.scheduleExpiry()
    }
    void work.then(finished, finished)
  }
  private async expireSessions(): Promise<void> {
    const expired: SessionRow[] = []
    let failed = false, failure: unknown
    try {
      await this.run(async () => {
        const now = Date.now()
        const rows = this.db().prepare('SELECT * FROM web_sessions WHERE revoked=0 AND (expires_at<=? OR idle_expires_at<=?)').all(now, now) as unknown as SessionRow[]
        for (const row of rows) {
          await this.commit({ session: { ...row, revoked: 1 } }, 'session')
          expired.push(row)
        }
      })
    }
    catch (error) { failed = true; failure = error; this.expiryFailed = true }
    // A later durable-write failure cannot abandon already projected sessions.
    const settled = await Promise.allSettled(expired.map(row => this.ownerCtx.parallel(
      'web-identity/session-expired', row.user_id as WebUserId, row.id as WebAuthSessionId)))
    if (settled.some(result => result.status === 'rejected'))
      identityFailure('AUTH_QUIESCENCE_FAILED', 503, 'Authentication expired; execution quiescence unconfirmed')
    if (failed) throw failure
  }
  private nextRevision(): number { return this.meta().sequence + 1 }
  private async notify(userId: string, reason: AuthInvalidationReason, revision: number): Promise<void> {
    try {
      await this.ownerCtx.parallel('web-identity/invalidated', userId as WebUserId, reason, revision)
    }
    catch {
      identityFailure('AUTH_QUIESCENCE_FAILED', 503, 'Authorization revoked; execution quiescence unconfirmed')
    }
  }
  private async admin(authority: RequestAuthority): Promise<UserRow> {
    const value = await this.revalidate(authority)
    if (value.principal.mustChangePassword)
      identityFailure('PASSWORD_CHANGE_REQUIRED', 403, 'Change password before continuing')
    if (value.principal.role !== 'MASTER_ADMIN' || value.audience !== 'admin')
      identityFailure('AUTH_FORBIDDEN', 403, 'Administrative access required')
    return this.row(value.principal.userId)
  }
  private async user(authority: RequestAuthority): Promise<UserRow> {
    const value = await this.revalidate(authority)
    if (value.principal.mustChangePassword)
      identityFailure('PASSWORD_CHANGE_REQUIRED', 403, 'Change password before continuing')
    if (value.principal.role !== 'USER' || value.audience !== 'user')
      identityFailure('AUTH_FORBIDDEN', 403, 'Project access required')
    return this.row(value.principal.userId)
  }
  private targetUser(id: WebUserId): UserRow {
    const user = this.row(id)
    if (user.role !== 'USER' || user.status === 'DELETED')
      identityFailure('AUTH_FORBIDDEN', 403, 'This account cannot be managed')
    return user
  }
  private makeSession(user: UserRow, audience: AuthAudience): {
    row: SessionRow
    token: string
  } {
    const token = newToken(), now = Date.now(), expires_at = now + (this.config.sessionTtlMs ?? 28800000)
    return { token, row: { id: randomUUID(), user_id: user.id, token_digest: digest(audience + ':' + token), audience,
      revision: user.revision, expires_at, idle_expires_at: Math.min(expires_at, now + this.config.sessionIdleTtlMs), revoked: 0 } }
  }
  async login(identifier: string, password: string, audience: AuthAudience, signal?: AbortSignal): Promise<LoginResult> {
    this.fresh()
    const initial = this.lookup(identifier)
    const accepted = await verifyPassword(password, initial?.password_hash ?? this.dummy, signal)
    return this.run(async () => {
      if (signal?.aborted === true)
        throw new WebIdentityError('AUTH_ABORTED', 499, 'Identity request cancelled')
      const user = this.lookup(identifier)
      if (!accepted || user === undefined || user.password_hash !== initial?.password_hash || user.status !== 'ACTIVE'
                || (user.role === 'MASTER_ADMIN' ? 'admin' : 'user') !== audience)
        identityFailure('AUTH_INVALID', 401, 'Invalid login')
      const session = this.makeSession(user, audience)
      await this.commit({ session: session.row }, 'session')
      const authority = await this.authenticate(session.token, audience)
      return { token: session.token, state: await this.state(authority) }
    })
  }
  authenticate(token: string, audience: AuthAudience): Promise<RequestAuthority> {
    return new Promise((resolve) => {
      this.fresh()
      if (!/^[A-Za-z0-9_-]{43}$/.test(token))
        identityFailure('AUTH_INVALID', 401, 'Authentication required')
      const session = this.db().prepare('SELECT * FROM web_sessions WHERE token_digest=? AND audience=?').get(digest(audience + ':' + token), audience) as unknown as SessionRow | undefined
      if (session === undefined || session.revoked !== 0 || session.expires_at <= Date.now() || session.idle_expires_at <= Date.now())
        identityFailure('AUTH_INVALID', 401, 'Authentication required')
      const user = this.row(session.user_id)
      if (user.status !== 'ACTIVE' || user.revision !== session.revision || (user.role === 'MASTER_ADMIN' ? 'admin' : 'user') !== audience)
        identityFailure('AUTH_INVALID', 401, 'Authentication required')
      this.scheduleExpiry()
      this.fresh()
      resolve(this.issueAuthority({
        principal: this.principal(user), authSessionId: session.id as WebAuthSessionId, audience, revision: user.revision,
      }))
    })
  }
  revalidate(authority: RequestAuthority, options: { readonly activity?: boolean } = {}): Promise<RequestAuthority> {
    if (options.activity === true) {
      return this.run(async () => {
        await this.revalidate(authority)
        const session = this.db().prepare('SELECT * FROM web_sessions WHERE id=?').get(authority.authSessionId) as unknown as SessionRow
        await this.commit({ session: { ...session, idle_expires_at: Math.min(session.expires_at, Date.now() + this.config.sessionIdleTtlMs) } }, 'session')
        return this.revalidate(authority)
      })
    }
    return new Promise((resolve) => {
      this.assertIssued(authority)
      this.fresh()
      const session = this.db().prepare('SELECT * FROM web_sessions WHERE id=?').get(authority.authSessionId) as unknown as SessionRow | undefined
      const user = this.row(authority.principal.userId)
      if (session === undefined || session.user_id !== user.id || session.audience !== authority.audience || session.revoked !== 0
                || session.expires_at <= Date.now() || session.idle_expires_at <= Date.now() || user.status !== 'ACTIVE' || user.revision !== authority.revision
                || session.revision !== authority.revision)
        identityFailure('AUTH_INVALID', 401, 'Authentication required')
      resolve(authority)
    })
  }
  async state(authority: RequestAuthority): Promise<Extract<AuthState, {
    authenticated: true
  }>> {
    await this.revalidate(authority)
    const row = (this.db().prepare('SELECT expires_at FROM web_sessions WHERE id=?').get(authority.authSessionId) as Record<string, import('node:sqlite').SQLOutputValue>)
    return Object.freeze({ authenticated: true, audience: authority.audience, principal: authority.principal,
      csrfToken: csrf((this.key as Buffer), authority.authSessionId), expiresAt: Number(row.expires_at), generation: authority.revision })
  }
  async assertCsrf(authority: RequestAuthority, token: string): Promise<void> {
    await this.revalidate(authority)
    if (!safeEqual(csrf((this.key as Buffer), authority.authSessionId), token))
      identityFailure('AUTH_CSRF', 403, 'Request verification failed')
  }
  async logout(authority: RequestAuthority): Promise<void> {
    const user = await this.run(async () => {
      await this.revalidate(authority)
      const value = { ...this.row(authority.principal.userId), revision: this.nextRevision() }
      await this.commit({ user: value, revokeUser: value.id }, 'user')
      return value
    })
    await this.notify(user.id, 'logout', user.revision)
  }
  async changePassword(
    authority: RequestAuthority, currentPassword: string, newPassword: string, signal?: AbortSignal,
  ): Promise<LoginResult> {
    await this.revalidate(authority)
    const initial = this.row(authority.principal.userId)
    const accepted = await verifyPassword(currentPassword, initial.password_hash ?? this.dummy, signal)
    validatePassword(newPassword)
    if (!accepted || newPassword === currentPassword)
      identityFailure('PASSWORD_CHANGE_INVALID', 400, 'Password change rejected')
    const password_hash = await hashPassword(newPassword, signal)
    const result = await this.run(async () => {
      if (signal?.aborted === true)
        throw new WebIdentityError('AUTH_ABORTED', 499, 'Identity request cancelled')
      await this.revalidate(authority)
      if (this.row(initial.id).password_hash !== initial.password_hash)
        identityFailure('AUTH_INVALID', 401, 'Authentication required')
      const user = { ...initial, password_hash, must_change: 0, revision: this.nextRevision() }
      const session = this.makeSession(user, authority.audience)
      await this.commit({ user, revokeUser: user.id, cancelTokens: user.id, session: session.row }, 'user')
      return { user, token: session.token }
    })
    await this.notify(result.user.id, 'credentials-changed', result.user.revision)
    return { token: result.token, state: await this.state(await this.authenticate(result.token, authority.audience)) }
  }
  private invitation(user: UserRow, purpose: 'invitation' | 'reset'): Change {
    const token = newToken(), id = randomUUID(), operationId = randomUUID()
    const expires_at = Date.now() + (purpose === 'invitation' ? (this.config.invitationTtlMs ?? 86400000) : (this.config.resetTtlMs ?? 1800000))
    const audience = user.role === 'MASTER_ADMIN' ? 'admin' : 'user'
    const link = this.config.recoveryOrigins[audience] + (purpose === 'invitation' ? '/invite#invite=' : '/reset#reset=') + token
    return { cancelTokens: user.id, token: { id, user_id: user.id, purpose, token_digest: digest(purpose + ':' + token), expires_at, used: 0 },
      outbox: { id: operationId, user_id: user.id, token_id: id, purpose, expires_at,
        ciphertext: encryptDelivery((this.key as Buffer), { operationId, to: user.email, purpose, link, expiresAt: expires_at }), state: 'pending', provider_id: null } }
  }
  async forgotPassword(identifier: string): Promise<void> {
    await this.run(async () => {
      const user = this.lookup(identifier)
      if (user !== undefined && user.status === 'ACTIVE' && user.password_hash !== null)
        await this.commit(this.invitation(user, 'reset'), 'token')
    })
    this.scheduleDelivery()
  }
  private async consume(token: string, password: string, purpose: 'invitation' | 'reset', signal?: AbortSignal): Promise<void> {
    validatePassword(password)
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      identityFailure('AUTH_TOKEN_INVALID', 400, 'Link invalid or expired')
    this.fresh()
    const initial = this.db().prepare('SELECT * FROM auth_tokens WHERE token_digest=? AND purpose=?').get(digest(purpose + ':' + token), purpose) as unknown as TokenRow | undefined
    if (initial === undefined || initial.used !== 0 || initial.expires_at <= Date.now())
      identityFailure('AUTH_TOKEN_INVALID', 400, 'Link invalid or expired')
    const password_hash = await hashPassword(password, signal)
    const user = await this.run(async () => {
      if (signal?.aborted === true)
        throw new WebIdentityError('AUTH_ABORTED', 499, 'Identity request cancelled')
      const row = this.db().prepare('SELECT * FROM auth_tokens WHERE id=?').get(initial.id) as unknown as TokenRow | undefined
      if (row === undefined || row.used !== 0 || row.expires_at <= Date.now())
        identityFailure('AUTH_TOKEN_INVALID', 400, 'Link invalid or expired')
      const current = this.row(row.user_id)
      if ((purpose === 'reset' && current.status !== 'ACTIVE') || (purpose === 'invitation' && (current.password_hash !== null || !['PENDING', 'ACTIVE'].includes(current.status)))) {
        identityFailure('AUTH_TOKEN_INVALID', 400, 'Link invalid or expired')
      }
      const value = { ...current, password_hash, must_change: 0, revision: this.nextRevision() }
      await this.commit({ user: value, revokeUser: value.id, cancelTokens: value.id }, 'user')
      return value
    })
    await this.notify(user.id, 'credentials-changed', user.revision)
  }
  /**
       * Consume a purpose-bound reset and await credential-revocation quiescence.
       * @param token - Single-use reset token.
       * @param password - Recipient-selected replacement password.
       * @param signal - Cancels hashing or queued admission.
       */
  resetPassword(token: string, password: string, signal?: AbortSignal): Promise<void> { return this.consume(token, password, 'reset', signal) }
  /**
       * Establish the recipient password independently of administrative release.
       * @param token - Single-use invitation token.
       * @param password - Recipient-selected password.
       * @param signal - Cancels hashing or queued admission.
       */
  acceptInvitation(token: string, password: string, signal?: AbortSignal): Promise<void> { return this.consume(token, password, 'invitation', signal) }
  async bootstrapMaster(password: string): Promise<void> {
    const password_hash = await hashPassword(password)
    await this.run(async () => {
      const { username: name, email: address } = this.bootstrap
      const existing = this.lookup(name.key), sameEmail = this.lookup(address.key)
      if (existing !== undefined || sameEmail !== undefined) {
        if (existing?.id !== sameEmail?.id || existing?.role !== 'MASTER_ADMIN')
          identityFailure('AUTH_BOOTSTRAP_COLLISION', 503, 'Bootstrap account collision')
        return
      }
      if (this.db().prepare("SELECT 1 FROM users WHERE role='MASTER_ADMIN' LIMIT 1").get() !== undefined)
        identityFailure('AUTH_BOOTSTRAP_COLLISION', 503, 'Bootstrap account collision')
      await this.commit({ user: { id: randomUUID(), username: name.value, username_key: name.key,
        email: address.value, email_key: address.key, role: 'MASTER_ADMIN', status: 'ACTIVE',
        password_hash, must_change: 1, revision: this.nextRevision(), created_at: Date.now() } }, 'user')
    })
  }
  async createUser(authority: RequestAuthority, input: {
    username: string
    email: string
  }): Promise<AdminUserSummary> {
    const name = username(input.username), address = email(input.email)
    const result = await this.run(async () => {
      await this.admin(authority)
      if (this.lookup(name.key) !== undefined || this.lookup(address.key) !== undefined)
        identityFailure('ACCOUNT_CONFLICT', 409, 'Account identifier already exists')
      const user: UserRow = { id: randomUUID(), username: name.value, username_key: name.key, email: address.value, email_key: address.key,
        role: 'USER', status: 'PENDING', password_hash: null, must_change: 0, revision: this.nextRevision(), created_at: Date.now() }
      await this.commit({ user, ...this.invitation(user, 'invitation') }, 'user')
      return this.summary(user)
    })
    this.scheduleDelivery()
    return result
  }
  async listUsers(authority: RequestAuthority, options: PageOptions = {}): Promise<AdminUserList> {
    await this.admin(authority)
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100))
    const rows = this.db().prepare('SELECT * FROM users WHERE id>? ORDER BY id LIMIT ?').all(options.cursor ?? '', limit + 1) as unknown as UserRow[]
    return {
      users: rows.slice(0, limit).map(row => this.summary(row)),
      ...(rows.length > limit ? { nextCursor: (rows[limit - 1] as UserRow).id } : {}),
    }
  }
  async setStatus(authority: RequestAuthority, userId: WebUserId, status: 'ACTIVE' | 'BLOCKED' | 'DELETED'): Promise<AdminUserSummary> {
    if (!['ACTIVE', 'BLOCKED', 'DELETED'].includes(status))
      identityFailure('INVALID_STATUS', 400, 'Invalid account status')
    const result = await this.run(async () => {
      await this.admin(authority)
      const user = { ...this.targetUser(userId), status, revision: this.nextRevision() }
      await this.commit({ user, revokeUser: user.id, ...(status === 'ACTIVE' ? {} : { cancelTokens: user.id }) }, 'user')
      return { user, summary: this.summary(user) }
    })
    await this.notify(result.user.id, 'status-changed', result.user.revision)
    return result.summary
  }
  async setModules(authority: RequestAuthority, userId: WebUserId, grants: readonly string[]): Promise<AdminUserSummary> {
    if (new Set(grants).size !== grants.length || grants.some(id => !this.catalog.some(module => module.id === id)))
      identityFailure('INVALID_MODULE', 400, 'Invalid module grant')
    const result = await this.run(async () => {
      await this.admin(authority)
      const user = { ...this.targetUser(userId), revision: this.nextRevision() }
      await this.commit({ user, revokeUser: user.id, grants: { userId: user.id, values: grants } }, 'user')
      return { user, summary: this.summary(user) }
    })
    await this.notify(result.user.id, 'grants-changed', result.user.revision)
    return result.summary
  }
  async resendInvitation(authority: RequestAuthority, userId: WebUserId): Promise<void> {
    await this.run(async () => {
      await this.admin(authority)
      const user = this.targetUser(userId)
      if (user.password_hash !== null || !['PENDING', 'ACTIVE'].includes(user.status))
        identityFailure('INVITATION_UNAVAILABLE', 403, 'Invitation unavailable')
      await this.commit(this.invitation(user, 'invitation'), 'token')
    })
    this.scheduleDelivery()
  }
  /**
       * Correct an invitation address only before the recipient establishes a password.
       * @param authority - Current MASTER authority.
       * @param userId - Invitation recipient USER.
       * @param value - Corrected registered email.
       * @returns Committed invitation recipient summary.
       */
  async correctInvitationEmail(authority: RequestAuthority, userId: WebUserId, value: string): Promise<AdminUserSummary> {
    const address = email(value)
    const result = await this.run(async () => {
      await this.admin(authority)
      const current = this.targetUser(userId)
      if (current.status !== 'PENDING' || current.password_hash !== null)
        identityFailure('AUTH_FORBIDDEN', 403, 'Account email cannot be changed')
      const collision = this.lookup(address.key)
      if (collision !== undefined && collision.id !== userId)
        identityFailure('ACCOUNT_CONFLICT', 409, 'Account identifier already exists')
      const user = { ...current, email: address.value, email_key: address.key, revision: this.nextRevision() }
      await this.commit({ user, ...this.invitation(user, 'invitation') }, 'user')
      return this.summary(user)
    })
    this.scheduleDelivery()
    return result
  }
  async moduleCatalog(authority: RequestAuthority): Promise<ModuleCatalog> { await this.admin(authority); return { modules: this.catalog } }
  authorizeOwner(authority: RequestAuthority, resource: Exclude<OwnerResource, { kind: 'project' }>,
    moduleId?: ModuleIdType): Promise<OwnerScope>
  authorizeOwner(authority: RequestAuthority, resource: OwnerResource, moduleId?: ModuleIdType): Promise<OwnedResource>
  async authorizeOwner(authority: RequestAuthority, resource: OwnerResource, moduleId?: ModuleIdType): Promise<OwnedResource> {
    await this.user(authority)
    if (moduleId !== undefined
      && (!this.catalog.some(module => module.id === moduleId) || !authority.principal.grants.includes(moduleId))) {
      identityFailure('MODULE_FORBIDDEN', 403, 'Module access denied')
    }
    let row: {
      user_id: string
      project_id: string
      workspace_id?: string
    } | undefined
    if (resource.kind === 'project')
      row = this.db().prepare('SELECT user_id,id AS project_id FROM project_owners WHERE id=? AND deleted=0').get(resource.projectId) as unknown as typeof row
    else if (resource.kind === 'workspace')
      row = this.db().prepare('SELECT p.user_id,p.id AS project_id,w.id AS workspace_id FROM workspace_owners w JOIN project_owners p ON p.id=w.project_id WHERE w.id=? AND w.deleted=0 AND p.deleted=0').get(resource.workspaceId) as unknown as typeof row
    else
      row = this.db().prepare('SELECT p.user_id,p.id AS project_id,w.id AS workspace_id FROM session_owners s JOIN workspace_owners w ON w.id=s.workspace_id JOIN project_owners p ON p.id=w.project_id WHERE s.id=? AND s.deleted=0 AND w.deleted=0 AND p.deleted=0').get(resource.sessionId) as unknown as typeof row
    if (row === undefined || row.user_id !== authority.principal.userId)
      identityFailure('OWNER_FORBIDDEN', 403, 'Resource access denied')
    return Object.freeze({
      userId: row.user_id as WebUserId, projectId: row.project_id as ProjectId,
      ...(row.workspace_id === undefined ? {} : { workspaceId: row.workspace_id as WorkspaceId }),
    })
  }
  async createProject(authority: RequestAuthority): Promise<ProjectId> {
    return this.run(async () => {
      await this.user(authority)
      const id = randomUUID() as ProjectId
      await this.commit({ project: { id, user_id: authority.principal.userId, deleted: 0 } }, 'owner')
      return id
    })
  }
  async createWorkspace(authority: RequestAuthority, projectId: ProjectId): Promise<OwnerScope> {
    return this.run(async () => {
      await this.authorizeOwner(authority, { kind: 'project', projectId })
      const workspaceId = randomUUID() as WorkspaceId
      await this.commit({ workspace: { id: workspaceId, project_id: projectId, deleted: 0 } }, 'owner')
      return Object.freeze({ userId: authority.principal.userId, projectId, workspaceId })
    })
  }
  async registerSession(authority: RequestAuthority, scope: OwnerScope, sessionId: SessionId, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    await this.run(async () => {
      signal?.throwIfAborted()
      const actual = await this.authorizeOwner(authority, { kind: 'workspace', workspaceId: scope.workspaceId })
      signal?.throwIfAborted()
      if (actual.projectId !== scope.projectId || actual.userId !== scope.userId
                || this.db().prepare('SELECT id FROM session_owners WHERE id=?').get(sessionId) !== undefined)
        identityFailure('OWNER_FORBIDDEN', 403, 'Resource ownership cannot be replaced')
      await this.commit({ sessionOwner: { id: sessionId, workspace_id: scope.workspaceId, deleted: 0 } }, 'owner')
    })
  }
  private async deleteResource(authority: RequestAuthority, resource: OwnerResource): Promise<void> {
    const deleted = Object.freeze({ ...resource })
    await this.run(async () => {
      await this.authorizeOwner(authority, deleted)
      const id = deleted.kind === 'project' ? deleted.projectId : deleted.kind === 'workspace' ? deleted.workspaceId : deleted.sessionId
      await this.commit({ deleteOwner: { kind: deleted.kind, id } }, 'owner')
    })
    try {
      await this.ownerCtx.parallel('web-identity/ownership-deleted', authority.principal.userId, deleted)
    }
    catch {
      identityFailure('AUTH_QUIESCENCE_FAILED', 503, 'Resource revoked; execution quiescence unconfirmed')
    }
  }
  deleteProject(authority: RequestAuthority, projectId: ProjectId): Promise<void> { return this.deleteResource(authority, { kind: 'project', projectId }) }
  deleteWorkspace(authority: RequestAuthority, workspaceId: WorkspaceId): Promise<void> { return this.deleteResource(authority, { kind: 'workspace', workspaceId }) }
  deleteSession(authority: RequestAuthority, sessionId: SessionId): Promise<void> { return this.deleteResource(authority, { kind: 'session', sessionId }) }
  async listOwnedProjects(authority: RequestAuthority, options: PageOptions = {}): Promise<{
    projectIds: readonly ProjectId[]
    nextCursor?: string
  }> {
    await this.user(authority)
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100))
    const rows = this.db().prepare('SELECT id FROM project_owners WHERE user_id=? AND deleted=0 AND id>? ORDER BY id LIMIT ?').all(authority.principal.userId, options.cursor ?? '', limit + 1)
    return { projectIds: rows.slice(0, limit).map(row => String(row.id) as ProjectId), ...(rows.length > limit ? { nextCursor: String((rows[limit - 1] as Record<string, import('node:sqlite').SQLOutputValue>).id) } : {}) }
  }
  registerDelivery(provider: IdentityDeliveryProvider): () => void {
    if (this.delivery !== undefined)
      identityFailure('AUTH_CONFIGURATION', 503, 'One identity delivery provider required')
    this.delivery = provider
    this.deliveryTimer = setInterval(() => { this.scheduleDelivery() }, this.config.deliveryRetryMs ?? 5000)
    this.scheduleDelivery()
    return () => { if (this.delivery === provider) {
      this.deliveryAbort?.abort()
      clearInterval(this.deliveryTimer)
      this.deliveryTimer = undefined
      this.delivery = undefined
    } }
  }
  private scheduleDelivery(): void { if (this.delivery !== undefined && !this.stopped)
    void this.flushOutbox().catch(() => { }) }
  flushOutbox(signal?: AbortSignal): Promise<void> {
    if (this.pumping !== undefined)
      return this.pumping
    const provider = this.delivery
    if (provider === undefined || this.stopped)
      return Promise.resolve()
    const task = (async () => {
      const pending = this.db().prepare("SELECT * FROM outbox WHERE state='pending' ORDER BY id").all() as unknown as OutboxRow[]
      for (const row of pending) {
        if (signal?.aborted === true || this.stopped || this.delivery !== provider)
          break
        const current = this.db().prepare('SELECT * FROM outbox WHERE id=?').get(row.id) as unknown as OutboxRow
        const token = (this.db().prepare('SELECT used,expires_at FROM auth_tokens WHERE id=?').get(row.token_id) as Record<string, import('node:sqlite').SQLOutputValue>)
        if (current.state !== 'pending' || current.ciphertext === null)
          continue
        if (row.expires_at <= Date.now() || Number(token.used) !== 0 || Number(token.expires_at) <= Date.now()) {
          await this.run(() => this.commit({ outbox: { ...row, ciphertext: null, state: 'cancelled' } }, 'outbox'))
          continue
        }
        const mail = decryptDelivery((this.key as Buffer), row.id, (row.ciphertext as string))
        if (mail.to !== this.row(row.user_id).email || mail.expiresAt !== row.expires_at || mail.operationId !== row.id)
          identityFailure('AUTH_DELIVERY', 503, 'Identity delivery verification failed')
        const controller = new AbortController()
        this.deliveryAbort = controller
        const onAbort = () => { controller.abort(signal?.reason) }
        signal?.addEventListener('abort', onAbort, { once: true })
        const timeout = setTimeout(() => { controller.abort() }, this.config.deliveryTimeoutMs ?? 10000)
        try {
          const result = await provider.send(mail, controller.signal)
          if (controller.signal.aborted)
            throw new Error('delivery interrupted')
          await this.run(async () => {
            const value = this.db().prepare('SELECT * FROM outbox WHERE id=?').get(row.id) as unknown as OutboxRow
            if (value.state === 'pending')
              await this.commit({ outbox: { ...value, state: 'accepted', ciphertext: null, provider_id: result.providerId } }, 'outbox')
          })
        }
        finally {
          clearTimeout(timeout)
          signal?.removeEventListener('abort', onAbort)
          this.deliveryAbort = undefined
        }
      }
    })()
    this.pumping = task
    void task.finally(() => { this.pumping = undefined }).catch(() => { })
    return task
  }
  async restoreFence(): Promise<void> {
    const users = await this.run(async () => {
      await this.commit({ restore: true }, 'restore')
      return this.db().prepare('SELECT id,revision FROM users').all()
    })
    for (const user of users)
      await this.notify(String(user.id), 'restore', Number(user.revision))
  }
  private async close(): Promise<void> {
    this.closing = true
    clearTimeout(this.expiryTimer)
    this.expiryTimer = undefined
    this.deliveryAbort?.abort()
    clearInterval(this.deliveryTimer)
    this.deliveryTimer = undefined
    try {
      await this.pumping?.catch(() => { })
      await this.expiryWork
      await this.queue
      if (this.database !== undefined && this.projectionReady) {
        const users = this.database.prepare('SELECT id,revision FROM users').all()
        for (const user of users)
          await this.notify(String(user.id), 'disposed', Number(user.revision))
      }
    }
    finally {
      this.stopped = true
      try {
        this.database?.close()
      }
      finally {
        this.database = undefined
        this.key?.fill(0)
        this.key = undefined
      }
    }
  }
}
export default SqliteWebIdentity
