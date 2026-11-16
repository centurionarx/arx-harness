import { afterEach, describe, expect, it, vi, afterAll, beforeAll } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { MessageId, freezeMessage } from '@arx-ai/arx-llm'
import { toHeaderLine } from '../../../session/session-persistence-jsonl/src/format.ts'
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

const fixtures: Awaited<ReturnType<typeof storageHarness>>[] = []
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const h of fixtures.splice(0)) await h.close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture(options: Parameters<typeof seededHarness>[0] = {}) {
  const h = await seededHarness(options); fixtures.push(h); return h
}
async function owned(h: Awaited<ReturnType<typeof storageHarness>>) {
  const authority = h.users[0]!.authority
  const project = await h.ctx.projectStorage.createProject(authority, 'Owned lifecycle project')
  const workspace = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Owned lifecycle workspace')
  const meta = await h.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  return { authority, project, workspace, meta }
}
function sql(h: Awaited<ReturnType<typeof storageHarness>>, action: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(h.index)
  try { action(db) } finally { db.close() }
}
describe('owned control index lifecycle and physical recovery', () => {
  it('fails an empty append if its derived row disappears during the real provider operation and acknowledges no cursor', async () => {
    const h = await fixture(), own = await owned(h)
    const original = h.ctx.sessionPersistence.append.bind(h.ctx.sessionPersistence)
    vi.spyOn(h.ctx.sessionPersistence, 'append').mockImplementationOnce(async (...args) => {
      await original(...args)
      sql(h, db => db.prepare('DELETE FROM history WHERE session=?').run(own.meta.id))
    })
    await expect(h.ctx.projectStorage.append(own.authority, own.meta.id, [])).rejects.toThrow('invalid project storage index row')
    expect(await h.ctx.sessionPersistence.readRaw(own.meta.id)).toBeUndefined()
    expect(await h.ctx.webIdentity.authorizeOwner(own.authority, { kind: 'session', sessionId: own.meta.id }))
      .toMatchObject({ workspaceId: own.workspace.workspaceId })
  })
  it('shrinks a metadata page to its complete JSON budget and preserves every original continuation', async () => {
    const h = await fixture({ storageConfig: { maxPageBytes: 768 } }), own = await owned(h)
    const ids = [own.meta.id]
    for (let index = 0; index < 2; index++) {
      const meta = await h.ctx.projectStorage.register(own.authority, own.workspace.workspaceId,
        { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: index + 2 })
      ids.push(meta.id)
    }
    for (const id of ids) await h.ctx.projectStorage.rename(own.authority, id, 'x'.repeat(180))
    const found: string[] = []
    let cursor: string | undefined
    do {
      const page = await h.ctx.projectStorage.list(own.authority, { kind: 'workspace', workspaceId: own.workspace.workspaceId }, cursor)
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(768)
      expect(page.sessions).toHaveLength(1)
      found.push(...page.sessions.map(row => row.sessionId))
      cursor = page.nextCursor
    } while (cursor !== undefined)
    expect(found).toEqual([...ids].sort())
  })
  it('trims an actual Unicode range for its JSON envelope without losing or replacing an original byte', async () => {
    const h = await fixture({ historyPageBytes: 701 }), own = await owned(h)
    const events = oneTurnLog().map(event => event.type === 'user/message' ? {
      ...event, data: freezeMessage({ id: MessageId('owned-unicode-pages'), role: 'user',
        content: [{ type: 'text', text: '€🧪'.repeat(500) }], source: { kind: 'user' } }),
    } : event)
    await h.ctx.projectStorage.append(own.authority, own.meta.id, events)
    const original = (await h.ctx.sessionPersistence.readRaw(own.meta.id))!.content
    const pieces: string[] = []
    let cursor: string | undefined
    do {
      const page = await h.ctx.projectStorage.read(own.authority, own.meta.id, cursor)
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(701)
      expect(page.content).not.toContain('\ufffd')
      pieces.push(page.content)
      expect(pieces.length).toBeLessThan(30)
      cursor = page.nextCursor
    } while (cursor !== undefined)
    expect(pieces.join('')).toBe(original)
    expect(Buffer.from(pieces.join(''))).toEqual(Buffer.from(original))
  })
  it('refuses captured storage operations after the real provider fiber closes while identity remains active', async () => {
    const h = await fixture(), own = await owned(h)
    const store = h.ctx.projectStorage
    const entry = [...h.ctx.loader.entries()].find(entry => entry.options.name === '@arx-ai/arx-project-storage')
    if (entry === undefined) throw new Error('real project storage Loader entry missing')
    await h.ctx.loader.update(entry.id, { disabled: true })
    expect(await h.ctx.webIdentity.revalidate(own.authority)).toBe(own.authority)
    await expect(store.append(own.authority, own.meta.id, [])).rejects.toThrow('project storage is unavailable')
    await expect(store.rename(own.authority, own.meta.id, 'closed title')).rejects.toThrow('project storage is unavailable')
    sql(h, (db) =>{  expect(db.prepare('SELECT title FROM history WHERE session=?').get(own.meta.id)?.title).toBe('') })
  })
  it('refuses an actual JSONL provider outside the configured control root during both registration and recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arx-storage-map-fixture-')); roots.push(root)
    const h = await storageHarness({ root, initialize: true, readyUsers: 1, storageConfig: { logRoot: join(root, 'different-control-logs') } })
    fixtures.push(h)
    const authority = h.users[0]!.authority
    const project = await h.ctx.projectStorage.createProject(authority, 'Mapping project')
    const workspace = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Mapping workspace')
    const provision = await h.ctx.projectStorage.provision(authority, workspace.workspaceId)
    const header = { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 }
    await expect(h.ctx.projectStorage.register(authority, workspace.workspaceId, header))
      .rejects.toThrow('configured private JSONL provider')
    expect((await h.ctx.projectStorage.list(authority, { kind: 'workspace', workspaceId: workspace.workspaceId })).sessions).toEqual([])
    const meta = { ...header, cwd: provision.volumePath }
    await h.ctx.sessionPersistence.create(meta)
    await h.ctx.sessionPersistence.append(meta.id, oneTurnLog())
    const location = h.ctx.sessionPersistence.locate(meta)!
    const original = await readFile(location.path)
    await expect(h.ctx.projectStorage.recover(authority, meta.id)).rejects.toMatchObject({ status: 403 })
    expect(await readFile(location.path)).toEqual(original)
  })
  it('refuses a physically valid own JSONL header rebound to an unassigned volume while keeping sidecar ownership', async () => {
    const h = await fixture(), own = await owned(h)
    await h.ctx.projectStorage.append(own.authority, own.meta.id, oneTurnLog())
    const location = h.ctx.sessionPersistence.locate(own.meta)
    if (location?.kind !== 'jsonl') throw new Error('real original JSONL location missing')
    const original = await readFile(location.path, 'utf8')
    const changedMeta = { ...own.meta, cwd: join(h.volumeRoot, 'unassigned-fixture-volume') }
    const changedLocation = h.ctx.sessionPersistence.locate(changedMeta)
    if (changedLocation?.kind !== 'jsonl') throw new Error('real replacement JSONL location missing')
    const split = original.indexOf('\n')
    if (split < 0) throw new Error('real fixture header missing')
    const changedRaw = JSON.stringify(toHeaderLine(changedMeta)) + '\n' + original.slice(split + 1)
    await mkdir(dirname(changedLocation.path), { recursive: true, mode: 0o700 })
    await writeFile(changedLocation.path, changedRaw, { mode: 0o600, flag: 'wx' })
    await rm(location.path)
    await expect(h.ctx.projectStorage.read(own.authority, own.meta.id))
      .rejects.toMatchObject({ status: 403, message: 'History mapping differs' })
    expect(await h.ctx.webIdentity.authorizeOwner(own.authority, { kind: 'session', sessionId: own.meta.id }))
      .toMatchObject({ workspaceId: own.workspace.workspaceId })
    expect(await readFile(changedLocation.path, 'utf8')).toBe(changedRaw)
  })
  it('recovers a mapped restored header-only original artifact at sequence zero without materializing events', async () => {
    const h = await fixture(), own = await owned(h)
    const location = h.ctx.sessionPersistence.locate(own.meta)!
    await mkdir(dirname(location.path), { recursive: true, mode: 0o700 })
    const raw = JSON.stringify(toHeaderLine(own.meta)) + '\n'
    await writeFile(location.path, raw, { mode: 0o600 })
    expect(await h.ctx.projectStorage.recover(own.authority, own.meta.id)).toEqual({ sessionId: own.meta.id, nextSeq: 0 })
    expect((await h.ctx.sessionPersistence.readFrom(own.meta.id, 0)).events).toEqual([])
    expect(await readFile(location.path, 'utf8')).toBe(raw)
  })
})
