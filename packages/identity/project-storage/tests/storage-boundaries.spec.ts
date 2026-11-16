import { afterEach, describe, expect, it, vi, afterAll, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, mkdir, symlink, readFile, writeFile, appendFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import { storageHarness } from './harness.ts'

// Identity bootstrap hashes several passwords, so it runs once; every test opens its own copy of that root.
const seed = { root: '', users: [] as Awaited<ReturnType<typeof storageHarness>>['users'], master: '',
  passwords: {} as Awaited<ReturnType<typeof storageHarness>>['passwords'] }
beforeAll(async () => {
  const harness = await storageHarness({ readyUsers: 1 })
  try {
    seed.root = harness.paths.root
    seed.users = harness.users
    seed.passwords = harness.passwords
    seed.master = (await harness.ctx.webIdentity.login('arxadmin', harness.passwords.master, 'admin')).token
  } finally { await harness.close(false) }
})
afterAll(() => rm(seed.root, { recursive: true, force: true }))
async function seededHarness(options: Omit<Parameters<typeof storageHarness>[0] & object, 'root' | 'readyUsers' | 'initialize'> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arx-project-fixture-'))
  const remove = () => rm(root, { recursive: true, force: true })
  const harness = await cp(seed.root, root, { recursive: true }).then(() => storageHarness({ ...options, root }))
    .catch(async (error: unknown) => { await remove(); throw error })
  try {
    const users = await Promise.all(seed.users.map(async user => ({ ...user,
      authority: await harness.ctx.webIdentity.authenticate(user.token, 'user') })))
    return { ...harness, users, passwords: seed.passwords,
      master: await harness.ctx.webIdentity.authenticate(seed.master, 'admin'),
      async close() { await harness.close(false); await remove() } }
  } catch (error) { await harness.close(false); await remove(); throw error }
}

const resources: Awaited<ReturnType<typeof storageHarness>>[] = []
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const resource of resources.splice(0)) await resource.close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture(options: Parameters<typeof seededHarness>[0] = {}) {
  const result = await seededHarness(options); resources.push(result); return result
}
async function owned(h: Awaited<ReturnType<typeof storageHarness>>, user = 0, seed = true) {
  const authority = h.users[user]!.authority
  const project = await h.ctx.projectStorage.createProject(authority, 'Owned project')
  const workspace = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Owned workspace')
  const meta = await h.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  if (seed) await h.ctx.projectStorage.append(authority, meta.id, oneTurnLog())
  return { authority, project, workspace, meta }
}
function sql(h: Awaited<ReturnType<typeof storageHarness>>, action: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(h.index)
  try { action(db) } finally { db.close() }
}

describe('private control storage boundaries', () => {
  it('keeps unmaterialized headers absent from cold hydration and treats an empty append as no progress', async () => {
    const h = await fixture()
    const own = await owned(h, 0, false)
    const store = h.ctx.projectStorage
    expect(await store.executionHeaders(own.authority, own.workspace.workspaceId)).toEqual([])
    expect(await store.executionSnapshot(own.authority, own.meta.id)).toBeUndefined()
    expect(await store.executionRawPage(own.authority, own.meta.id, { offset: 0, maxBytes: 400 })).toBeUndefined()
    expect(await store.executionRevision(own.authority, own.meta.id)).toBeUndefined()
    expect(await store.append(own.authority, own.meta.id, [])).toEqual({ sessionId: own.meta.id, nextSeq: 0 })
    await expect(store.register(own.authority, own.workspace.workspaceId, own.meta)).rejects.toThrow('already exists')
    expect((await store.list(own.authority, { kind: 'workspace', workspaceId: own.workspace.workspaceId })).sessions[0]!.nextSeq).toBe(0)
    await store.append(own.authority, own.meta.id, oneTurnLog())
    expect(await store.executionHeaders(own.authority, own.workspace.workspaceId)).toEqual([own.meta])
    expect((await store.executionRawPage(own.authority, own.meta.id, { offset: 0,
      maxBytes: 400 }))!.meta).toEqual({ ...own.meta, delegationDepth: 0 })
  })
  it('binds preexisting IDs and fork lineage to their original workspace and project', async () => {
    const h = await fixture()
    const own = await owned(h)
    const another = await owned(h)
    await expect(h.ctx.projectStorage.register(own.authority, another.workspace.workspaceId,
      own.meta)).rejects.toMatchObject({ status: 403 })
    await expect(h.ctx.projectStorage.register(own.authority, another.workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1, parentSession: own.meta.id, seedLength: 1 }))
      .rejects.toMatchObject({ status: 403 })
    await h.ctx.webIdentity.logout(own.authority)
    await expect(h.ctx.projectStorage.register(own.authority, own.workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })).rejects.toMatchObject({ status: 401 })
  })
  it('rolls back grouping metadata if a real SQLite trigger refuses its transaction', async () => {
    const h = await fixture()
    const own = await owned(h)
    const before = await h.ctx.projectStorage.read(own.authority, own.meta.id)
    sql(h, (db) =>{  db.exec("CREATE TRIGGER fixture_reject_group BEFORE UPDATE OF grouped ON history BEGIN SELECT RAISE(ABORT, 'fixture grouping failure'); END") })
    await expect(h.ctx.projectStorage.removeGrouping(own.authority, own.workspace.workspaceId)).rejects.toThrow('fixture grouping failure')
    expect((await h.ctx.projectStorage.workspaces(own.authority, own.project.projectId)).workspaces[0]!.grouped).toBe(true)
    expect((await h.ctx.projectStorage.list(own.authority, { kind: 'workspace',
      workspaceId: own.workspace.workspaceId })).sessions[0]!.grouped).toBe(true)
    expect(await h.ctx.projectStorage.read(own.authority, own.meta.id)).toEqual(before)
  })
  it('refuses a missing or corrupt index row without deducing ownership from log paths', async () => {
    const h = await fixture()
    const own = await owned(h)
    sql(h, db => db.prepare('UPDATE history SET created=? WHERE session=?').run('corrupt', own.meta.id))
    await expect(h.ctx.projectStorage.read(own.authority, own.meta.id)).rejects.toThrow('corrupt project storage index')
    sql(h, db => db.prepare('DELETE FROM history WHERE session=?').run(own.meta.id))
    await expect(h.ctx.projectStorage.read(own.authority, own.meta.id)).rejects.toMatchObject({ status: 404 })
    expect(await h.ctx.projectStorage.recover(own.authority, own.meta.id)).toEqual({ sessionId: own.meta.id, nextSeq: oneTurnLog().length })
  })
  it('rejects changed execution revisions and restored headers whose volume mapping differs', async () => {
    const h = await fixture()
    const own = await owned(h)
    const location = h.ctx.sessionPersistence.locate(own.meta)!
    const delegate = h.ctx.sessionPersistence.readFrom.bind(h.ctx.sessionPersistence)
    vi.spyOn(h.ctx.sessionPersistence, 'readFrom').mockImplementationOnce(async (...args) => {
      const value = await delegate(...args); await appendFile(location.path, '{"torn'); return value
    })
    await expect(h.ctx.projectStorage.executionSnapshot(own.authority, own.meta.id)).rejects.toMatchObject({ status: 409 })
    await h.ctx.projectStorage.recover(own.authority, own.meta.id)
    sql(h, db => db.prepare('UPDATE history SET header=? WHERE session=?').run(JSON.stringify({ ...own.meta,
      cwd: '/invalid-owned-volume' }), own.meta.id))
    await expect(h.ctx.projectStorage.executionSnapshot(own.authority, own.meta.id)).rejects.toMatchObject({ status: 403 })
    await expect(h.ctx.projectStorage.executionRawPage(own.authority, own.meta.id, { offset: 0,
      maxBytes: 400 })).rejects.toMatchObject({ status: 403 })
    const raw = await readFile(location.path, 'utf8')
    const lines = raw.split('\n'); lines[0] = JSON.stringify({ ...JSON.parse(lines[0]!), cwd: '/invalid-owned-volume' })
    await writeFile(location.path, lines.join('\n'))
    await expect(h.ctx.projectStorage.recover(own.authority, own.meta.id)).rejects.toThrow('corrupt session log')
    await expect(h.ctx.projectStorage.read(own.authority, own.meta.id)).rejects.toThrow('corrupt session log')
  })
  it('paginates projects and workspaces and advances past tombstoned history without exposing it', async () => {
    const h = await fixture({ storageConfig: { pageSize: 1 } })
    const own = await owned(h)
    const other = await owned(h)
    const projects = await h.ctx.projectStorage.projects(own.authority)
    expect(projects.projects).toHaveLength(1); expect(projects.nextCursor).toBeDefined()
    const next = await h.ctx.projectStorage.projects(own.authority, projects.nextCursor)
    expect(next.projects).toHaveLength(1); expect(next.projects[0]!.projectId).not.toBe(projects.projects[0]!.projectId)
    const anotherWorkspace = await h.ctx.projectStorage.createWorkspace(own.authority, own.project.projectId, 'Second workspace')
    const workspacePage = await h.ctx.projectStorage.workspaces(own.authority, own.project.projectId)
    expect(workspacePage.workspaces).toHaveLength(1); expect(workspacePage.nextCursor).toBeDefined()
    const nextWorkspace = await h.ctx.projectStorage.workspaces(own.authority, own.project.projectId, workspacePage.nextCursor)
    expect(nextWorkspace.workspaces[0]!.workspaceId).not.toBe(workspacePage.workspaces[0]!.workspaceId)
    const second = await h.ctx.projectStorage.register(own.authority, own.workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 2 })
    await h.ctx.projectStorage.append(own.authority, second.id, oneTurnLog())
    const ordered = [own.meta.id, second.id].sort()
    await h.ctx.webIdentity.deleteSession(own.authority, ordered[0]!)
    const page = await h.ctx.projectStorage.list(own.authority, { kind: 'project', projectId: own.project.projectId })
    expect(page.sessions).toEqual([]); expect(page.nextCursor).toBe(ordered[0])
    const resumed = await h.ctx.projectStorage.list(own.authority, { kind: 'project', projectId: own.project.projectId }, page.nextCursor)
    expect(resumed.sessions.map(value => value.sessionId)).toEqual([ordered[1]])
    expect((await h.ctx.projectStorage.executionHeaders(own.authority,
      own.workspace.workspaceId)).map(value => value.id)).toEqual([ordered[1]])
    expect(anotherWorkspace.workspaceId).not.toBe(other.workspace.workspaceId)
  })
  it('bounds the complete metadata, append and raw-history results even with tiny configured limits', async () => {
    const h = await fixture({ storageConfig: { maxPageBytes: 1, historyPageBytes: 4, appendBytes: 2 } })
    const own = await owned(h, 0, false)
    await expect(h.ctx.projectStorage.projects(own.authority)).rejects.toMatchObject({ status: 413 })
    await expect(h.ctx.projectStorage.workspaces(own.authority, own.project.projectId)).rejects.toMatchObject({ status: 413 })
    await expect(h.ctx.projectStorage.list(own.authority, { kind: 'project',
      projectId: own.project.projectId })).rejects.toMatchObject({ status: 413 })
    await expect(h.ctx.projectStorage.append(own.authority, own.meta.id, oneTurnLog())).rejects.toMatchObject({ status: 413 })
    await h.ctx.sessionPersistence.append(own.meta.id, oneTurnLog())
    await expect(h.ctx.projectStorage.executionRawPage(own.authority, own.meta.id, { offset: 0,
      maxBytes: 5 })).rejects.toMatchObject({ status: 413 })
    await expect(h.ctx.projectStorage.read(own.authority, own.meta.id)).rejects.toMatchObject({ status: 413 })
  })
  it('rejects invalid physical cursor boundaries and arbitrary decoded JSON continuations', async () => {
    const h = await fixture({ historyPageBytes: 400 })
    const own = await owned(h)
    const first = await h.ctx.projectStorage.read(own.authority, own.meta.id)
    const original = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString()) as Record<string, unknown>
    const invalidOffset = Buffer.from(JSON.stringify({ ...original, offset: Number.MAX_SAFE_INTEGER })).toString('base64url')
    await expect(h.ctx.projectStorage.read(own.authority, own.meta.id, invalidOffset)).rejects.toMatchObject({ status: 400 })
    for (const value of [null, [], false, 1, 'x', { ...original, revision: '' }, { ...original, extra: 1 }]) {
      await expect(h.ctx.projectStorage.read(own.authority, own.meta.id, Buffer.from(JSON.stringify(value)).toString('base64url')))
        .rejects.toMatchObject({ status: 400 })
    }
    const location = h.ctx.sessionPersistence.locate(own.meta)!
    const raw = await readFile(location.path)
    raw[raw.length - 2] = 255
    await writeFile(location.path, raw)
    await expect((async () => {
      let cursor: string | undefined
      do { const page = await h.ctx.projectStorage.read(own.authority, own.meta.id,
        cursor); cursor = page.nextCursor } while (cursor !== undefined)
    })()).rejects.toThrow()
  })
  it.each(['overlap-index', 'overlap-log', 'reverse-overlap', 'root-file', 'root-symlink', 'index-directory',
    'index-symlink', 'index-version'])(
    'refuses unsafe storage setup %s before admitting any owner operations', async (kind) => {
      const root = await mkdtemp(join(tmpdir(), 'arx-storage-invalid-')); roots.push(root)
      const indexPath = join(root, 'index', 'history.sqlite')
      const logRoot = join(root, 'content', 'history'), volumeRoot = join(root, 'content', 'volumes')
      const storageConfig: NonNullable<Parameters<typeof storageHarness>[0]>['storageConfig'] = {}
      if (kind === 'overlap-index') storageConfig.indexPath = join(volumeRoot, 'index.sqlite')
      if (kind === 'overlap-log') storageConfig.logRoot = join(volumeRoot, 'logs')
      if (kind === 'reverse-overlap') storageConfig.volumeRoot = join(logRoot, 'volumes')
      if (kind === 'root-file') { await mkdir(join(root, 'index')); await writeFile(logRoot,
        '') .catch(async () => { await mkdir(join(root, 'content')); await writeFile(logRoot, '') }) }
      if (kind === 'root-symlink') { await mkdir(join(root, 'content'),
        { recursive: true }); await mkdir(join(root, 'target')); await symlink(join(root, 'target'), volumeRoot) }
      if (kind === 'index-directory') await mkdir(indexPath, { recursive: true })
      if (kind === 'index-symlink') { await mkdir(join(root, 'index')); await writeFile(join(root, 'target'),
        ''); await symlink(join(root, 'target'), indexPath) }
      if (kind === 'index-version') { await mkdir(join(root,
        'index')); const db = new DatabaseSync(indexPath); db.exec('PRAGMA user_version=2'); db.close() }
      await expect(storageHarness({ root, initialize: true, readyUsers: 0, storageConfig })).rejects.toThrow()
    })
})
