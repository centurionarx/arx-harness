/**
 * Owner-scoped history access over the existing durable SessionPersistence.
 * Control logs and their derived index never belong to a worker mount.
 * @module @arx-ai/arx-project-storage
 */
import { Context, Service } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, lstat, chmod, open } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { SessionId } from '@arx-ai/arx-session'
import type { SessionHeader, SessionEvent } from '@arx-ai/arx-session'
import { SessionPersistenceRevision } from '@arx-ai/arx-session-persistence'
import type { SessionPersistenceSnapshot } from '@arx-ai/arx-session-persistence'
import { ModuleId, WebIdentityError } from '@arx-ai/arx-web-identity'
import type { OwnerScope, OwnerResource, RequestAuthority, ProjectId } from '@arx-ai/arx-web-identity'
import type { WorkspaceId } from '@arx-ai/arx-workspace'

/** All roots are operator-owned paths. Runtime workers receive only one volume. */
export interface Config {
  /** Derived metadata database, separate from the identity and history databases. */
  indexPath: string
  /** Root of the existing JSONL provider, inaccessible to every worker. */
  logRoot: string
  /** Parent of opaque workspace volumes, inaccessible to every worker. */
  volumeRoot: string
  /** Largest list response, including metadata and continuation fields. */
  maxPageBytes: number
  /** Maximum session headers per page. */
  pageSize: number
  /** Largest decoded history page, including its JSON envelope. */
  historyPageBytes: number
  /** Largest admitted event batch after JSON serialization. */
  appendBytes: number
  /** SQLite write reservation wait in milliseconds. */
  busyTimeoutMs: number
}

export type { StoredSessionSummary, HistoryCommit, HistoryPage, HistoryArtifactPage,
  ProjectSummary, UserWorkspaceSummary, ProjectsPage, WorkspacesPage } from './contract.ts'
import type { StoredSessionSummary, HistoryCommit, HistoryPage, HistoryArtifactPage,
  ProjectSummary, UserWorkspaceSummary, ProjectsPage, WorkspacesPage } from './contract.ts'

interface IndexRow {
  session: string
  user: string
  project: string
  workspace: string
  created: number
  next_seq: number
  header: string
  title: string
  grouped: number
}

declare module '@arx-ai/cordis' {
  interface Context { projectStorage: ProjectStorage }
}

function deny(message: string): never { throw new WebIdentityError('STORAGE_DENIED', 403, message) }
/**
 * Decode one `workspace_order.workspaces` value read from the control index.
 * @param text - Stored column value.
 * @returns Workspace ids in stored order.
 * @throws Error when the value is not a JSON array of strings; no part of it is applied.
 */
function parseWorkspaceOrder(text: string): string[] {
  let value: unknown
  try { value = JSON.parse(text) }
  catch (cause) { throw new Error('corrupt project storage workspace order', { cause }) }
  if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) throw new Error('corrupt project storage workspace order')
  return value
}
function contained(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}
function scopeKey(scope: OwnerScope): string {
  return createHash('sha256').update(JSON.stringify([scope.userId, scope.projectId, scope.workspaceId])).digest('hex')
}
async function privateDirectory(path: string): Promise<void> {
  try {
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('storage root must be a private real directory')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(path, { recursive: true, mode: 0o700 })
  }
  await chmod(path, 0o700)
}
function row(value: unknown): IndexRow {
  if (typeof value !== 'object' || value === null) throw new Error('invalid project storage index row')
  const result = value as IndexRow
  if (typeof result.session !== 'string' || typeof result.user !== 'string'
    || typeof result.project !== 'string' || typeof result.workspace !== 'string'
    || typeof result.header !== 'string' || !Number.isSafeInteger(result.created)
    || !Number.isSafeInteger(result.next_seq) || result.next_seq < 0) throw new Error('corrupt project storage index')
  return result
}
function summary(value: IndexRow): StoredSessionSummary {
  return { sessionId: SessionId(value.session), projectId: value.project as ProjectId,
    workspaceId: value.workspace as WorkspaceId, createdAt: value.created, nextSeq: value.next_seq,
    title: value.title, grouped: value.grouped === 1 }
}
function bytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value)) }

/**
 * The index is derived from acknowledged persistence operations and identity
 * ownership, never from cwd, usernames, legacy headers or a global directory scan.
 */
export class ProjectStorage extends Service {
  static inject = ['webIdentity', 'sessionPersistence']
  static Config: z<Config> = z.object({
    indexPath: z.string().required(), logRoot: z.string().required(), volumeRoot: z.string().required(),
    maxPageBytes: z.number().step(1).min(1).required(), pageSize: z.number().step(1).min(1).max(50).required(),
    historyPageBytes: z.number().step(1).min(1).max(128 * 1024).required(),
    appendBytes: z.number().step(1).min(1).required(),
    busyTimeoutMs: z.number().step(1).min(0).max(2_147_483_647).required(),
  })
  private db: DatabaseSync | undefined
  private readonly tails = new Map<SessionId, Promise<unknown>>()
  private readonly orderTails = new Map<string, Promise<unknown>>()
  private closed = false
  private readonly indexPath: string
  private readonly logRoot: string
  private readonly volumeRoot: string

  constructor(ctx: Context, readonly config: Config) {
    super(ctx, 'projectStorage')
    this.indexPath = resolve(config.indexPath)
    this.logRoot = resolve(config.logRoot)
    this.volumeRoot = resolve(config.volumeRoot)
    if (contained(this.volumeRoot, this.indexPath) || contained(this.volumeRoot, this.logRoot)
      || contained(this.logRoot, this.volumeRoot) || contained(this.logRoot, this.indexPath)) {
      throw new Error('control index, logs and worker volume roots must be disjoint')
    }
    ctx.effect(() => async () => {
      this.closed = true
      await Promise.allSettled([...this.tails.values()])
      this.db?.close()
      this.db = undefined
    })
  }

  protected async [Service.init](): Promise<void> {
    await privateDirectory(dirname(this.indexPath))
    await privateDirectory(this.logRoot)
    await privateDirectory(this.volumeRoot)
    try {
      const info = await lstat(this.indexPath)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('indexPath must be a private regular file')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const handle = await open(this.indexPath, 'wx', 0o600)
      await handle.sync()
      await handle.close()
    }
    await chmod(this.indexPath, 0o600)
    this.db = new DatabaseSync(this.indexPath)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=${this.config.busyTimeoutMs};`)
    const version = this.db.prepare('PRAGMA user_version').get()?.user_version
    if (version !== 0 && version !== 1) throw new Error('unsupported project storage index version')
    this.db.exec("CREATE TABLE IF NOT EXISTS history(session TEXT PRIMARY KEY,user TEXT NOT NULL,project TEXT NOT NULL,workspace TEXT NOT NULL,created INTEGER NOT NULL,next_seq INTEGER NOT NULL CHECK(next_seq>=0),header TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',grouped INTEGER NOT NULL DEFAULT 1 CHECK(grouped IN (0,1))); CREATE INDEX IF NOT EXISTS history_owner_page ON history(user,project,workspace,session); CREATE TABLE IF NOT EXISTS projects(project TEXT PRIMARY KEY,user TEXT NOT NULL,name TEXT NOT NULL,created INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS workspaces(workspace TEXT PRIMARY KEY,project TEXT NOT NULL,user TEXT NOT NULL,name TEXT NOT NULL,created INTEGER NOT NULL,grouped INTEGER NOT NULL CHECK(grouped IN (0,1))); CREATE INDEX IF NOT EXISTS workspaces_owner_page ON workspaces(user,project,workspace); PRAGMA user_version=1;")
    // Additive table: existing tables, rows and user_version are unchanged.
    this.db.exec('CREATE TABLE IF NOT EXISTS workspace_order(user TEXT PRIMARY KEY,workspaces TEXT NOT NULL)')
  }

  private database(): DatabaseSync {
    if (this.closed || this.db === undefined) throw new Error('project storage is unavailable')
    return this.db
  }

  private async requireStorageGrant(authority: RequestAuthority): Promise<void> {
    const current = await this.ctx.webIdentity.revalidate(authority)
    if (!current.principal.grants.includes(ModuleId('storage'))) deny('Storage module unavailable')
  }

  private async scope(authority: RequestAuthority, resource: Exclude<OwnerResource, { kind: 'project' }>,
    module = 'storage'): Promise<OwnerScope> {
    return await this.ctx.webIdentity.authorizeOwner(authority, resource, ModuleId(module))
  }

  private async indexed(authority: RequestAuthority, id: SessionId): Promise<{ scope: OwnerScope
    row: IndexRow }> {
    const scope = await this.scope(authority, { kind: 'session', sessionId: id })
    const value = this.database().prepare('SELECT * FROM history WHERE session=? AND user=? AND project=? AND workspace=?')
      .get(id, scope.userId, scope.projectId, scope.workspaceId)
    if (value === undefined) throw new WebIdentityError('HISTORY_UNAVAILABLE', 404, 'History unavailable')
    return { scope, row: row(value) }
  }

  private async exclusive<T>(id: SessionId, action: () => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('project storage is unavailable')
    const prior = this.tails.get(id) ?? Promise.resolve()
    const operation = prior.then(action, action)
    const tail = operation.then(() => undefined, () => undefined)
    this.tails.set(id, tail)
    try { return await operation }
    finally { if (this.tails.get(id) === tail) this.tails.delete(id) }
  }

  /**
   * Create project identity before projecting its user-visible metadata.
   * @param authority - Issued USER authority.
   * @param name - Display name, never a filesystem path.
   * @returns New opaque project metadata.
   */
  async createProject(authority: RequestAuthority, name: string): Promise<ProjectSummary> {
    await this.requireStorageGrant(authority)
    const projectId = await this.ctx.webIdentity.createProject(authority)
    const createdAt = Date.now()
    this.database().prepare('INSERT INTO projects VALUES(?,?,?,?)').run(projectId, authority.principal.userId, name, createdAt)
    await this.ctx.webIdentity.revalidate(authority)
    return { projectId, name, createdAt }
  }

  /**
   * List projects whose identity records still authorize the principal.
   * @param authority - Issued USER authority.
   * @param cursor - Prior identity page cursor.
   * @returns Metadata for the current owned project page.
   */
  async projects(authority: RequestAuthority, cursor?: string): Promise<ProjectsPage> {
    await this.requireStorageGrant(authority)
    const page = await this.ctx.webIdentity.listOwnedProjects(authority, { limit: this.config.pageSize,
      ...(cursor === undefined ? {} : { cursor }) })
    const projects: ProjectSummary[] = []
    for (const projectId of page.projectIds) {
      await this.ctx.webIdentity.authorizeOwner(authority, { kind: 'project', projectId }, ModuleId('storage'))
      const found = this.database().prepare('SELECT name,created FROM projects WHERE project=? AND user=?').get(projectId,
        authority.principal.userId)
      if (found !== undefined) projects.push({ projectId, name: String(found.name), createdAt: Number(found.created) })
    }
    const result = { projects, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) }
    if (bytes(result) > this.config.maxPageBytes) throw new WebIdentityError('HISTORY_LIMIT', 413, 'Project metadata limit exceeded')
    await this.ctx.webIdentity.revalidate(authority)
    return result
  }

  /**
   * Create an owned workspace volume with an opaque server id.
   * @param authority - Issued USER authority.
   * @param projectId - Owned project.
   * @param name - Display name, never a host path.
   * @returns User-safe workspace metadata.
   */
  async createWorkspace(authority: RequestAuthority, projectId: ProjectId, name: string): Promise<UserWorkspaceSummary> {
    await this.ctx.webIdentity.authorizeOwner(authority, { kind: 'project', projectId }, ModuleId('storage'))
    const scope = await this.ctx.webIdentity.createWorkspace(authority, projectId)
    await this.provision(authority, scope.workspaceId)
    const createdAt = Date.now()
    this.database().prepare('INSERT INTO workspaces VALUES(?,?,?,?,?,1)').run(scope.workspaceId, projectId, scope.userId, name, createdAt)
    await this.ctx.webIdentity.revalidate(authority)
    return { workspaceId: scope.workspaceId, projectId, name, createdAt, grouped: true }
  }

  /**
   * List grouping metadata without inspecting any user directory.
   * @param authority - Issued USER authority.
   * @param projectId - Owned project.
   * @param cursor - Last returned workspace id.
   * @returns Owner-authorized workspace metadata page.
   */
  async workspaces(authority: RequestAuthority, projectId: ProjectId, cursor?: string): Promise<WorkspacesPage> {
    const scope = await this.ctx.webIdentity.authorizeOwner(authority, { kind: 'project', projectId }, ModuleId('storage'))
    const found = this.database().prepare('SELECT * FROM workspaces WHERE user=? AND project=? AND workspace>? AND grouped=1 ORDER BY workspace LIMIT ?')
      .all(scope.userId, projectId, cursor ?? '', this.config.pageSize + 1)
    const workspaces: UserWorkspaceSummary[] = []
    for (const value of found.slice(0, this.config.pageSize)) {
      const workspaceId = String(value.workspace) as WorkspaceId
      await this.ctx.webIdentity.authorizeOwner(authority, { kind: 'workspace', workspaceId }, ModuleId('storage'))
      workspaces.push({ workspaceId, projectId, name: String(value.name), createdAt: Number(value.created), grouped: true })
    }
    const last = workspaces[workspaces.length - 1]
    const result = { workspaces, ...(found.length > workspaces.length && last !== undefined ? { nextCursor: last.workspaceId } : {}) }
    if (bytes(result) > this.config.maxPageBytes) throw new WebIdentityError('HISTORY_LIMIT', 413, 'Workspace metadata limit exceeded')
    await this.ctx.webIdentity.revalidate(authority)
    return result
  }

  /**
   * List the user's grouped workspaces in display order. Workspaces absent from
   * the stored order follow it in creation order; unowned rows are omitted.
   * @param authority - Issued USER authority.
   * @returns Owned workspace ids in display order.
   */
  async workspaceOrder(authority: RequestAuthority): Promise<WorkspaceId[]> {
    await this.requireStorageGrant(authority)
    const user = authority.principal.userId
    const stored = this.database().prepare('SELECT workspaces FROM workspace_order WHERE user=?').get(user)
    const saved = stored === undefined ? [] : parseWorkspaceOrder(String(stored.workspaces))
    const rank = (id: string): number => { const index = saved.indexOf(id); return index === -1 ? saved.length : index }
    const ids = this.database().prepare('SELECT workspace FROM workspaces WHERE user=? AND grouped=1 ORDER BY rowid').all(user)
      .map(value => String(value.workspace) as WorkspaceId)
    const order: WorkspaceId[] = []
    for (const workspaceId of ids.map((id, index) => ({ id, index })).sort((a, b) => rank(a.id) - rank(b.id) || a.index - b.index)
      .map(entry => entry.id)) {
      try {
        await this.scope(authority, { kind: 'workspace', workspaceId })
        order.push(workspaceId)
      } catch (error) {
        if (!(error instanceof WebIdentityError) || error.status !== 403) throw error
      }
    }
    return order
  }

  /**
   * Move one owned workspace before another, or to the end, and store the
   * user's complete display order. Moves of one user apply one at a time.
   * @param authority - Issued USER authority.
   * @param workspaceId - Owned grouped workspace to move.
   * @param beforeWorkspaceId - Owned grouped anchor; absent appends.
   * @returns The complete stored display order.
   */
  async moveWorkspace(authority: RequestAuthority, workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<WorkspaceId[]> {
    const user = authority.principal.userId
    const task = (this.orderTails.get(user) ?? Promise.resolve()).catch(() => {})
      .then(() => this.moveWorkspaceNow(authority, workspaceId, beforeWorkspaceId))
    this.orderTails.set(user, task)
    try { return await task }
    finally { if (this.orderTails.get(user) === task) this.orderTails.delete(user) }
  }

  private async moveWorkspaceNow(authority: RequestAuthority, workspaceId: WorkspaceId,
    beforeWorkspaceId?: WorkspaceId): Promise<WorkspaceId[]> {
    await this.scope(authority, { kind: 'workspace', workspaceId })
    if (beforeWorkspaceId !== undefined) await this.scope(authority, { kind: 'workspace', workspaceId: beforeWorkspaceId })
    const current = await this.workspaceOrder(authority)
    const order = current.filter(id => id !== workspaceId)
    const at = beforeWorkspaceId === undefined ? order.length : order.indexOf(beforeWorkspaceId)
    if (!current.includes(workspaceId) || at === -1) deny('Workspace order anchor unavailable')
    order.splice(at, 0, workspaceId)
    this.database().prepare('INSERT INTO workspace_order VALUES(?,?) ON CONFLICT(user) DO UPDATE SET workspaces=excluded.workspaces')
      .run(authority.principal.userId, JSON.stringify(order))
    await this.ctx.webIdentity.revalidate(authority)
    return order
  }

  /**
   * Remove a grouping registration while preserving every identity, history
   * artifact and workspace file.
   * @param authority - Issued USER authority.
   * @param workspaceId - Owned workspace.
   */
  async removeGrouping(authority: RequestAuthority, workspaceId: WorkspaceId): Promise<void> {
    const scope = await this.scope(authority, { kind: 'workspace', workspaceId }, 'storage')
    this.database().exec('BEGIN IMMEDIATE')
    try {
      this.database().prepare('UPDATE workspaces SET grouped=0 WHERE workspace=? AND user=?').run(workspaceId, scope.userId)
      this.database().prepare('UPDATE history SET grouped=0 WHERE workspace=? AND user=?').run(workspaceId, scope.userId)
      this.database().exec('COMMIT')
    } catch (error) {
      this.database().exec('ROLLBACK')
      throw error
    }
  }

  /**
   * Rename only the index title; the canonical session stream is unchanged.
   * @param authority - Issued USER authority.
   * @param id - Owned session.
   * @param title - Display title.
   * @returns Updated metadata.
   */
  async rename(authority: RequestAuthority, id: SessionId, title: string): Promise<StoredSessionSummary> {
    const indexed = await this.indexed(authority, id)
    await this.ctx.webIdentity.revalidate(authority)
    this.database().prepare('UPDATE history SET title=? WHERE session=?').run(title, id)
    return summary({ ...indexed.row, title })
  }

  /**
   * Commit an identity tombstone before removing derived history metadata.
   * Physical logs and backups remain subject to the operator retention policy.
   * @param authority - Issued USER authority.
   * @param id - Owned session.
   */
  async deleteSession(authority: RequestAuthority, id: SessionId): Promise<void> {
    return this.exclusive(id, async () => {
      await this.indexed(authority, id)
      await this.ctx.webIdentity.deleteSession(authority, id)
      this.database().prepare('DELETE FROM history WHERE session=?').run(id)
    })
  }

  /**
   * Reserve a workspace's opaque volume without exposing its parent or touching
   * worker-created files. Only the deployment operator mounts the returned path.
   * @param authority - Current issued USER authority.
   * @param workspaceId - Identity-owned workspace.
   * @param signal - Optional cancellation before provisioning or dispatch.
   * @returns Private provisioning data for the trusted runtime adapter.
   */
  async provision(authority: RequestAuthority, workspaceId: WorkspaceId, signal?: AbortSignal): Promise<{ scope: OwnerScope
    volumePath: string }> {
    const scope = await this.scope(authority, { kind: 'workspace', workspaceId }, 'storage')
    signal?.throwIfAborted()
    const volumePath = resolve(this.volumeRoot, scopeKey(scope))
    await privateDirectory(volumePath)
    await this.ctx.webIdentity.revalidate(authority)
    signal?.throwIfAborted()
    return { scope, volumePath }
  }

  /**
   * Register authoritative ownership before creating new persistence state.
   * Caller-supplied cwd is replaced by the opaque owned workspace volume.
   * @param authority - Current issued USER authority.
   * @param workspaceId - Owning workspace.
   * @param header - Session header in the existing on-disk format.
   * @param signal - Optional broker admission cancellation before commit starts.
   * @returns Header committed to the index and persistence provider.
   */
  async register(authority: RequestAuthority, workspaceId: WorkspaceId, header: SessionHeader,
    signal?: AbortSignal): Promise<SessionHeader> {
    return this.exclusive(header.id, async () => {
      signal?.throwIfAborted()
      const provision = await this.provision(authority, workspaceId, signal)
      signal?.throwIfAborted()
      if (header.parentSession !== undefined) {
        const parent = await this.scope(authority, { kind: 'session', sessionId: header.parentSession })
        signal?.throwIfAborted()
        if (parent.projectId !== provision.scope.projectId) deny('Fork ownership differs')
      }
      let registered = false
      try {
        const existing = await this.ctx.webIdentity.authorizeOwner(authority, { kind: 'session', sessionId: header.id })
        if (existing.userId !== provision.scope.userId || existing.projectId !== provision.scope.projectId
          || existing.workspaceId !== provision.scope.workspaceId) deny('Session ownership differs')
        registered = true
      } catch (error) {
        if (!(error instanceof WebIdentityError) || error.status !== 403) throw error
      }
      signal?.throwIfAborted()
      if (!registered) await this.ctx.webIdentity.registerSession(authority, provision.scope, header.id, signal)
      const meta = { ...header, cwd: provision.volumePath }
      const location = this.ctx.sessionPersistence.locate(meta)
      if (location?.kind !== 'jsonl' || !contained(this.logRoot,
        location.path)) throw new Error('owned history requires the configured private JSONL provider')
      await this.ctx.webIdentity.revalidate(authority)
      // Once ownership committed, finish its derived header projection even if
      // the request was cancelled. Existing allocations still refuse new work.
      if (registered) signal?.throwIfAborted()
      await this.ctx.sessionPersistence.create(meta)
      this.database().prepare('INSERT INTO history(session,user,project,workspace,created,next_seq,header) VALUES(?,?,?,?,?,0,?) ON CONFLICT(session) DO NOTHING')
        .run(meta.id, provision.scope.userId, provision.scope.projectId, provision.scope.workspaceId, meta.createdAt, JSON.stringify(meta))
      await this.ctx.webIdentity.revalidate(authority)
      signal?.throwIfAborted()
      return meta
    })
  }

  /**
   * Read committed creation metadata without materializing or inspecting a log.
   * @param authority - Current issued USER authority.
   * @param id - Already registered owned session.
   * @param signal - Lease cancellation checked before and after metadata access.
   * @returns The registered canonical header after current owner revalidation.
   */
  async executionCreationHeader(authority: RequestAuthority, id: SessionId, signal?: AbortSignal): Promise<SessionHeader> {
    return this.exclusive(id, async () => {
      signal?.throwIfAborted()
      const indexed = await this.indexed(authority, id)
      signal?.throwIfAborted()
      const header = JSON.parse(indexed.row.header) as SessionHeader
      await this.scope(authority, { kind: 'session', sessionId: id })
      signal?.throwIfAborted()
      return header
    })
  }

  /**
   * Commit an already registered empty header for native session creation.
   * Default registration stays lazy; failed writes publish no durable receipt.
   * @param authority - Current issued USER authority for this owned session.
   * @param id - Registered owner session, never a caller-supplied filesystem path.
   * @param signal - Cancellation before admission and after an initiated commit.
   * @returns Completion after the canonical provider commit and owner revalidation.
   */
  async materialize(authority: RequestAuthority, id: SessionId, signal?: AbortSignal): Promise<void> {
    return this.exclusive(id, async () => {
      signal?.throwIfAborted()
      await this.indexed(authority, id)
      signal?.throwIfAborted()
      await this.ctx.sessionPersistence.materialize(id)
      signal?.throwIfAborted()
      await this.scope(authority, { kind: 'session', sessionId: id })
      signal?.throwIfAborted()
    })
  }

  /**
   * Append a contiguous batch and acknowledge only the fsync plus FULL index
   * projection. Failed appends publish neither a cursor nor a saved receipt.
   * @param authority - Current issued USER authority.
   * @param id - Owned session.
   * @param events - Existing SessionEvents, including their sequence envelopes.
   * @param signal - Optional cancellation before append starts; an initiated commit still projects its index.
   * @returns The next durable event sequence.
   */
  async append(authority: RequestAuthority, id: SessionId, events: readonly SessionEvent[], signal?: AbortSignal): Promise<HistoryCommit> {
    return this.appendBatch(authority, id, events, false, signal)
  }

  /**
   * Append a worker's batch like `append`, except that leading events the log
   * already holds with the same content are not appended again. A worker
   * resends a batch whose append was committed but refused after the commit,
   * as when its lease was cancelled in between; a held event that differs
   * leaves the whole batch to the provider, which refuses its sequence.
   * @param authority - Current issued USER authority.
   * @param id - Owned session.
   * @param events - Existing SessionEvents, including their sequence envelopes.
   * @param signal - Optional cancellation before append starts; an initiated commit still projects its index.
   * @returns The next durable event sequence.
   */
  async executionAppend(authority: RequestAuthority, id: SessionId, events: readonly SessionEvent[],
    signal?: AbortSignal): Promise<HistoryCommit> {
    return this.appendBatch(authority, id, events, true, signal)
  }

  private async appendBatch(authority: RequestAuthority, id: SessionId, events: readonly SessionEvent[], skipHeld: boolean,
    signal?: AbortSignal): Promise<HistoryCommit> {
    if (bytes(events) > this.config.appendBytes) throw new WebIdentityError('HISTORY_LIMIT', 413, 'History batch too large')
    return this.exclusive(id, async () => {
      signal?.throwIfAborted()
      await this.indexed(authority, id)
      signal?.throwIfAborted()
      await this.ctx.webIdentity.revalidate(authority)
      signal?.throwIfAborted()
      const unstored = skipHeld ? await this.unstored(id, events, signal) : events
      if (unstored.length > 0 || events.length === 0) await this.ctx.sessionPersistence.append(id, unstored)
      const nextSeq = events.length === 0
        ? row(this.database().prepare('SELECT * FROM history WHERE session=?').get(id)).next_seq
        : (events[events.length - 1] as SessionEvent).seq + 1
      this.database().prepare('UPDATE history SET next_seq=? WHERE session=?').run(nextSeq, id)
      await this.ctx.webIdentity.revalidate(authority)
      signal?.throwIfAborted()
      return { sessionId: id, nextSeq }
    })
  }

  /**
   * The part of a batch that the log does not hold yet: the events after a
   * leading run that the indexed log already holds with the same content, or
   * the whole batch when a held event differs.
   * @param id - Owned session, inside its exclusive section.
   * @param events - Contiguous batch to append.
   * @param signal - Cancellation of the read.
   * @returns Events still to append.
   */
  private async unstored(id: SessionId, events: readonly SessionEvent[], signal?: AbortSignal): Promise<readonly SessionEvent[]> {
    const first = events[0]
    if (first === undefined
      || first.seq >= row(this.database().prepare('SELECT * FROM history WHERE session=?').get(id)).next_seq) return events
    const held = (await this.ctx.sessionPersistence.readFrom(id, first.seq, signal)).events
    const overlap = Math.min(held.length, events.length)
    for (let index = 0; index < overlap; index++) if (!isDeepStrictEqual(held[index], events[index])) return events
    return events.slice(overlap)
  }

  /**
   * Reconcile an index after durable crash recovery without dispatching tools.
   * Legacy sessions without authoritative ownership and an index mapping fail.
   * @param authority - Current issued USER authority.
   * @param id - Owned and indexed session.
   * @returns Durable commit cursor after the provider repairs interrupted turns.
   */
  async recover(authority: RequestAuthority, id: SessionId): Promise<HistoryCommit> {
    return this.exclusive(id, async () => {
      const scope = await this.scope(authority, { kind: 'session', sessionId: id })
      const stored = await this.ctx.sessionPersistence.load(id)
      const volumePath = resolve(this.volumeRoot, scopeKey(scope))
      const location = this.ctx.sessionPersistence.locate(stored.meta)
      if (stored.meta.cwd !== volumePath || location?.kind !== 'jsonl' || !contained(this.logRoot, location.path)) {
        deny('History mapping differs')
      }
      const nextSeq = stored.events.length === 0 ? 0 : (stored.events[stored.events.length - 1] as SessionEvent).seq + 1
      await this.ctx.webIdentity.revalidate(authority)
      this.database().prepare('INSERT INTO history(session,user,project,workspace,created,next_seq,header) VALUES(?,?,?,?,?,?,?) ON CONFLICT(session) DO UPDATE SET user=excluded.user,project=excluded.project,workspace=excluded.workspace,created=excluded.created,next_seq=excluded.next_seq,header=excluded.header')
        .run(id, scope.userId, scope.projectId, scope.workspaceId, stored.meta.createdAt, nextSeq, JSON.stringify(stored.meta))
      return { sessionId: id, nextSeq }
    })
  }

  /**
   * Read the private authoritative execution source for a validated worker lease.
   * Cold recovery is requested only after the runtime has excluded another writer.
   * @param authority - Issued owner authority, checked again after persistence work.
   * @param id - Owned session identity.
   * @param cold - A quiescent new worker needs durable interrupted-tail recovery.
   * @param signal - Optional cancellation before repair starts or source reads continue.
   * @returns Immutable source interpreted by the existing persistence provider.
   */
  async executionSnapshot(authority: RequestAuthority, id: SessionId, cold: boolean = false,
    signal?: AbortSignal): Promise<{ meta: SessionHeader
      events: SessionEvent[]
      revision: string } | undefined> {
    return this.exclusive(id, async () => {
      signal?.throwIfAborted()
      const indexed = await this.indexed(authority, id)
      signal?.throwIfAborted()
      const observed = await this.ctx.sessionPersistence.readRevision(id, signal)
      signal?.throwIfAborted()
      if (observed === undefined) return undefined
      if (cold) {
        const recovered = await this.ctx.sessionPersistence.load(id)
        this.database().prepare('UPDATE history SET next_seq=? WHERE session=?').run(recovered.events.length, id)
      }
      // Cold repair already initiated must finish its FULL index projection.
      signal?.throwIfAborted()
      const beforeRead = await this.ctx.sessionPersistence.readRevision(id, signal)
      signal?.throwIfAborted()
      const stored = await this.ctx.sessionPersistence.readFrom(id, 0, signal)
      const revision = await this.ctx.sessionPersistence.readRevision(id, signal)
      if (revision === undefined || beforeRead !== revision) throw new WebIdentityError('HISTORY_REVISION', 409,
        'Execution history changed')
      if (stored.meta.cwd !== (JSON.parse(indexed.row.header) as SessionHeader).cwd) deny('Execution history mapping differs')
      await this.scope(authority, { kind: 'session', sessionId: id })
      signal?.throwIfAborted()
      return { meta: stored.meta, events: stored.events, revision }
    })
  }


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
  async executionRawPage(authority: RequestAuthority, id: SessionId,
    request: import('@arx-ai/arx-session-persistence').SessionRawArtifactPageRequest,
    signal?: AbortSignal): Promise<import('@arx-ai/arx-session-persistence').SessionRawArtifactPage | undefined> {
    return this.exclusive(id, async () => {
      const indexed = await this.indexed(authority, id)
      if (!this.ctx.sessionPersistence.supportsRawArtifactPages) throw new WebIdentityError('HISTORY_UNAVAILABLE',
        503, 'Bounded history unavailable')
      if (request.maxBytes > this.config.historyPageBytes) throw new WebIdentityError('HISTORY_LIMIT', 413, 'History page limit exceeded')
      if (await this.ctx.sessionPersistence.readRevision(id, signal) === undefined) return undefined
      const page = await this.ctx.sessionPersistence.readRawPage(id, request, signal)
      if (page !== undefined && page.meta.cwd !== (JSON.parse(indexed.row.header) as SessionHeader).cwd) deny('Execution history mapping differs')
      await this.scope(authority, { kind: 'session', sessionId: id })
      signal?.throwIfAborted()
      return page
    })
  }

  /**
   * Observe one owned log revision without repairing or buffering its full body.
   * @param authority - Current issued owner authority.
   * @param id - Owned session.
   * @param signal - Cancellation before and after the provider observation.
   * @returns Provider-qualified revision, absent for a lazy unmaterialized log.
   */
  async executionRevision(authority: RequestAuthority, id: SessionId, signal?: AbortSignal): Promise<string | undefined> {
    signal?.throwIfAborted()
    await this.indexed(authority, id)
    signal?.throwIfAborted()
    const revision = await this.ctx.sessionPersistence.readRevision(id, signal)
    await this.scope(authority, { kind: 'session', sessionId: id })
    signal?.throwIfAborted()
    return revision
  }

  /**
   * List private headers inside one fixed worker mount, including only current owners.
   * @param authority - Current issued USER authority.
   * @param workspaceId - The operator-assigned workspace.
   * @param signal - Optional cancellation for metadata observation and ownership checks.
   * @returns Metadata only; no conversation bodies or other owner rows.
   */
  async executionHeaders(authority: RequestAuthority, workspaceId: WorkspaceId,
    signal?: AbortSignal): Promise<SessionHeader[]> {
    return (await this.executionSnapshots(authority, workspaceId, signal)).map(snapshot => snapshot.header)
  }

  /**
   * Pair owned execution headers with revisions from one authoritative provider scan.
   * The index supplies membership candidates; each owner and materialized source
   * is checked independently before any metadata is returned to the worker.
   * @param authority - Current sealed USER authority.
   * @param workspaceId - Operator-assigned workspace bound to the requesting lease.
   * @param signal - Optional cancellation throughout metadata and ownership observation.
   * @returns Original owned headers and actual source-qualified revisions.
   */
  async executionSnapshots(authority: RequestAuthority, workspaceId: WorkspaceId,
    signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]> {
    signal?.throwIfAborted()
    const scope = await this.scope(authority, { kind: 'workspace', workspaceId })
    signal?.throwIfAborted()
    const values = this.database().prepare('SELECT * FROM history WHERE user=? AND workspace=? ORDER BY session').all(scope.userId,
      workspaceId).map(row)
    const materialized = new Map((await this.ctx.sessionPersistence.listSnapshots(signal)).map(snapshot =>
      [snapshot.header.id, snapshot.revision] as const))
    signal?.throwIfAborted()
    const snapshots: SessionPersistenceSnapshot[] = []
    for (const value of values) {
      signal?.throwIfAborted()
      const id = SessionId(value.session)
      const revision = materialized.get(id)
      if (revision === undefined) continue
      try {
        await this.ctx.webIdentity.authorizeOwner(authority, { kind: 'session', sessionId: id })
        signal?.throwIfAborted()
        snapshots.push({ header: JSON.parse(value.header) as SessionHeader, revision })
      } catch (error) {
        if (!(error instanceof WebIdentityError) || error.status !== 403) throw error
      }
    }
    await this.scope(authority, { kind: 'workspace', workspaceId })
    signal?.throwIfAborted()
    return snapshots
  }

  /**
   * List owned session headers without loading any conversation body.
   * @param authority - Current issued USER authority.
   * @param resource - Owned project or workspace.
   * @param cursor - Last returned opaque session id.
   * @returns A bounded page with an optional continuation.
   */
  async list(authority: RequestAuthority, resource: Exclude<OwnerResource, { kind: 'session' }>, cursor?: string): Promise<HistoryPage> {
    const scope = await this.ctx.webIdentity.authorizeOwner(authority, resource, ModuleId('storage'))
    const values = this.database().prepare('SELECT * FROM history WHERE user=? AND project=? AND (? IS NULL OR workspace=?) AND session>? ORDER BY session LIMIT ?')
      .all(scope.userId, scope.projectId, scope.workspaceId ?? null, scope.workspaceId ?? null, cursor ?? '', this.config.pageSize + 1)
      .map(row)
    const authorized: IndexRow[] = []
    for (const value of values.slice(0, this.config.pageSize)) {
      try {
        await this.ctx.webIdentity.authorizeOwner(authority, { kind: 'session', sessionId: SessionId(value.session) }, ModuleId('storage'))
        authorized.push(value)
      } catch (error) {
        if (!(error instanceof WebIdentityError) || error.status !== 403) throw error
      }
    }
    let selected = authorized.map(summary)
    let result: HistoryPage
    for (;;) {
      const last = selected[selected.length - 1]
      const scanned = values[Math.min(values.length, this.config.pageSize) - 1]
      const next = last?.sessionId ?? (values.length > this.config.pageSize ? scanned?.session : undefined)
      result = { sessions: selected, ...(selected.length < values.length && next !== undefined ? { nextCursor: next } : {}) }
      if (bytes(result) <= this.config.maxPageBytes) break
      if (selected.length <= 1) throw new WebIdentityError('HISTORY_LIMIT', 413, 'History metadata limit too small')
      selected = selected.slice(0, -1)
    }
    await this.ctx.webIdentity.revalidate(authority)
    return result
  }

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
  async read(authority: RequestAuthority, id: SessionId, cursor?: string, signal?: AbortSignal): Promise<HistoryArtifactPage> {
    return this.exclusive(id, async () => {
      signal?.throwIfAborted()
      const indexed = await this.indexed(authority, id)
      let offset = 0
      let revision: string | undefined
      if (cursor !== undefined) {
        try {
          if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('cursor')
          const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
          if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) throw new Error('cursor')
          const value = decoded as Record<string, unknown>
          if (value.sessionId !== id || typeof value.offset !== 'number' || !Number.isSafeInteger(value.offset) || value.offset < 0
          || typeof value.revision !== 'string' || value.revision.length === 0
          || Object.keys(value).some(key => !['sessionId', 'offset', 'revision'].includes(key))) throw new Error('cursor')
          offset = value.offset
          revision = value.revision
        } catch {
          throw new WebIdentityError('HISTORY_CURSOR', 400, 'Invalid history cursor')
        }
      }
      if (!this.ctx.sessionPersistence.supportsRawArtifactPages) {
        throw new WebIdentityError('HISTORY_UNAVAILABLE', 503, 'Bounded history pages unavailable')
      }
      let artifact
      try {
        artifact = await this.ctx.sessionPersistence.readRawPage(id, { offset, maxBytes: this.config.historyPageBytes,
          ...(revision === undefined ? {} : { revision: SessionPersistenceRevision(revision) }) }, signal)
      } catch (error) {
        if (error instanceof Error && error.message === 'raw artifact revision changed') {
          throw new WebIdentityError('HISTORY_REVISION', 409, 'History changed; reopen its first page')
        }
        if (error instanceof Error && error.message === 'invalid raw artifact offset') {
          throw new WebIdentityError('HISTORY_CURSOR', 400, 'Invalid history cursor')
        }
        throw error
      }
      if (artifact === undefined) throw new WebIdentityError('HISTORY_UNAVAILABLE', 404, 'History unavailable')
      if (artifact.meta.cwd !== resolve(this.volumeRoot, scopeKey(indexed.scope))) deny('History mapping differs')
      const source = Buffer.from(artifact.content)
      let end = source.length
      let result: HistoryArtifactPage
      for (;;) {
        while (end > 0 && end < source.length && ((source[end] as number) & 0xc0) === 0x80) end--
        const nextOffset = end < source.length ? offset + end : artifact.nextOffset
        const nextCursor = nextOffset === undefined ? undefined
          : Buffer.from(JSON.stringify({ sessionId: id, offset: nextOffset, revision: artifact.revision })).toString('base64url')
        result = { sessionId: id, nextSeq: indexed.row.next_seq, content: source.subarray(0, end).toString('utf8'),
          ...(nextCursor === undefined ? {} : { nextCursor }) }
        const excess = bytes(result) - this.config.historyPageBytes
        if (excess <= 0) break
        end -= excess
        if (end <= 0) throw new WebIdentityError('HISTORY_LIMIT', 413, 'History page limit too small')
      }
      await this.scope(authority, { kind: 'session', sessionId: id })
      signal?.throwIfAborted()
      return result
    })
  }

}
export default ProjectStorage
