/** Source-qualified per-id observations and one-scan metadata over real providers. */
import { afterEach, expect, it, vi, afterAll, beforeAll } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, cp, mkdtemp, rm, realpath } from 'node:fs/promises'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import type { SessionEvent, SessionHeader } from '@arx-ai/arx-session'
import { SessionPersistence } from '@arx-ai/arx-session-persistence'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import { storageHarness } from './harness.ts'

// Identity bootstrap hashes several passwords, so it runs once; every test opens its own copy of that root.
const seed = { root: '', users: [] as Awaited<ReturnType<typeof storageHarness>>['users'], master: '',
  passwords: {} as Awaited<ReturnType<typeof storageHarness>>['passwords'] }
beforeAll(async () => {
  const harness = await storageHarness({ readyUsers: 2 })
  try {
    seed.root = harness.paths.root
    seed.users = harness.users
    seed.passwords = harness.passwords
    seed.master = (await harness.ctx.webIdentity.login('arxadmin', harness.passwords.master, 'admin')).token
  } finally { await harness.close(false) }
})
afterAll(() => rm(seed.root, { recursive: true, force: true }))
async function seededHarness(options: Omit<Parameters<typeof storageHarness>[0] & object, 'root' | 'readyUsers' | 'initialize'> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arx-project-fixture-')))
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
afterEach(async () => {
  vi.restoreAllMocks()
  for (const h of fixtures.splice(0)) await h.close()
})
async function fixture(persistence: 'jsonl' | 'sqlite' = 'jsonl') {
  const h = await seededHarness({ persistence }); fixtures.push(h); return h
}
async function owned(h: Awaited<ReturnType<typeof storageHarness>>, user = 0) {
  const authority = h.users[user]!.authority
  const project = await h.ctx.projectStorage.createProject(authority, 'Revision metadata')
  const workspace = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Revision workspace')
  const meta = await h.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  return { authority, workspace, meta }
}
it('reads the original JSONL source revision by id without global listing', async () => {
  const h = await fixture(), own = await owned(h)
  const events = oneTurnLog()
  await h.ctx.projectStorage.append(own.authority, own.meta.id, events)
  const original = (await h.ctx.sessionPersistence.listSnapshots()).find(value => value.header.id === own.meta.id)
  expect(original).toBeDefined()
  const global = vi.spyOn(h.ctx.sessionPersistence, 'listSnapshots')
  expect(await h.ctx.projectStorage.executionRevision(own.authority, own.meta.id)).toBe(original!.revision)
  expect(global).not.toHaveBeenCalled()
  const more: SessionEvent[] = [{ type: 'turn/start', seq: events.length, time: 10, data: { turn: 2 } },
    { type: 'turn/end', seq: events.length + 1, time: 11, data: { turn: 2, reason: { kind: 'completed' } } }]
  await h.ctx.projectStorage.append(own.authority, own.meta.id, more)
  expect(await h.ctx.sessionPersistence.readRevision(own.meta.id)).not.toBe(original!.revision)
  expect(global).not.toHaveBeenCalled()
  const lazy = await h.ctx.projectStorage.register(own.authority, own.workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 2 })
  expect(await h.ctx.projectStorage.executionRevision(own.authority, lazy.id)).toBeUndefined()
  expect(await h.ctx.projectStorage.executionSnapshot(own.authority, lazy.id)).toBeUndefined()
  await expect(h.ctx.projectStorage.executionRevision(h.users[1]!.authority, own.meta.id)).rejects.toMatchObject({ status: 403 })
  const master = h.master
  if (master === undefined) throw new Error('Real MASTER authority fixture missing')
  await expect(h.ctx.projectStorage.executionRevision(master, own.meta.id)).rejects.toMatchObject({ status: 403 })
  const aborted = AbortSignal.abort(new Error('revision cancelled'))
  await expect(h.ctx.projectStorage.executionRevision(own.authority, own.meta.id, aborted)).rejects.toThrow('revision cancelled')
  expect(global).not.toHaveBeenCalled()
})
it('reads the original SQLite source revision directly through the real provider', async () => {
  const h = await fixture('sqlite')
  const meta: SessionHeader = { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 }
  const events = oneTurnLog()
  await h.ctx.sessionPersistence.create(meta)
  await h.ctx.sessionPersistence.append(meta.id, events)
  const original = (await h.ctx.sessionPersistence.listSnapshots())[0]!
  const global = vi.spyOn(h.ctx.sessionPersistence, 'listSnapshots')
  expect(await h.ctx.sessionPersistence.readRevision(meta.id)).toBe(original.revision)
  const more: SessionEvent[] = [{ type: 'turn/start', seq: events.length, time: 10, data: { turn: 2 } },
    { type: 'turn/end', seq: events.length + 1, time: 11, data: { turn: 2, reason: { kind: 'completed' } } }]
  await h.ctx.sessionPersistence.append(meta.id, more)
  expect(await h.ctx.sessionPersistence.readRevision(meta.id)).not.toBe(original.revision)
  const lazy: SessionHeader = { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 2 }
  await h.ctx.sessionPersistence.create(lazy)
  expect(await h.ctx.sessionPersistence.readRevision(lazy.id)).toBeUndefined()
  await expect(h.ctx.sessionPersistence.readRevision(meta.id, AbortSignal.abort(new Error('SQLite cancelled'))))
    .rejects.toThrow('SQLite cancelled')
  expect(global).not.toHaveBeenCalled()
})
it('pairs only materialized current owner rows with one actual provider snapshot scan', async () => {
  const h = await fixture(), a = await owned(h), b = await owned(h, 1)
  await h.ctx.projectStorage.append(a.authority, a.meta.id, oneTurnLog())
  await h.ctx.projectStorage.append(b.authority, b.meta.id, oneTurnLog())
  const lazy = await h.ctx.projectStorage.register(a.authority, a.workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 2 })
  const deleted = await h.ctx.projectStorage.register(a.authority, a.workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 3 })
  await h.ctx.projectStorage.append(a.authority, deleted.id, oneTurnLog())
  await h.ctx.webIdentity.deleteSession(a.authority, deleted.id)
  const original = (await h.ctx.sessionPersistence.listSnapshots()).find(value => value.header.id === a.meta.id)
  const global = vi.spyOn(h.ctx.sessionPersistence, 'listSnapshots')
  const result = await h.ctx.projectStorage.executionSnapshots(a.authority, a.workspace.workspaceId)
  expect(result).toEqual([{ header: a.meta, revision: original!.revision }])
  expect(global).toHaveBeenCalledTimes(1)
  expect(result.map(value => value.header.id)).not.toContain(lazy.id)
  expect(result.map(value => value.header.id)).not.toContain(b.meta.id)
  expect(result.map(value => value.header.id)).not.toContain(deleted.id)
  global.mockClear()
  await expect(h.ctx.projectStorage.executionSnapshots(b.authority, a.workspace.workspaceId)).rejects.toMatchObject({ status: 403 })
  const master = h.master
  if (master === undefined) throw new Error('Real MASTER authority fixture missing')
  await expect(h.ctx.projectStorage.executionSnapshots(master, a.workspace.workspaceId)).rejects.toMatchObject({ status: 403 })
  expect(global).not.toHaveBeenCalled()
})
it('withholds metadata when cancellation arrives after the real provider scan', async () => {
  const h = await fixture(), own = await owned(h)
  await h.ctx.projectStorage.append(own.authority, own.meta.id, oneTurnLog())
  const controller = new AbortController()
  const actual = h.ctx.sessionPersistence.listSnapshots.bind(h.ctx.sessionPersistence)
  vi.spyOn(h.ctx.sessionPersistence, 'listSnapshots').mockImplementationOnce(async (signal) => {
    const result = await actual(signal)
    controller.abort(new Error('metadata cancelled'))
    return result
  })
  await expect(h.ctx.projectStorage.executionSnapshots(own.authority, own.workspace.workspaceId, controller.signal))
    .rejects.toThrow('metadata cancelled')
  expect((await h.ctx.sessionPersistence.readFrom(own.meta.id, 0)).events).toEqual(oneTurnLog())
})
it('keeps the Service Definition metadata fallback usable by legacy providers', async () => {
  const h = await fixture(), own = await owned(h)
  await h.ctx.projectStorage.append(own.authority, own.meta.id, oneTurnLog())
  const existing = (await h.ctx.sessionPersistence.listSnapshots())[0]!
  const global = vi.spyOn(h.ctx.sessionPersistence, 'listSnapshots')
  // Invoke the public default on the real provider to test third-party inheritance.
  const fallback = SessionPersistence.prototype.readRevision.bind(h.ctx.sessionPersistence)
  expect(await fallback(own.meta.id)).toBe(existing.revision)
  expect(await fallback(SessionId(randomUUID()))).toBeUndefined()
  expect(global).toHaveBeenCalledTimes(2)
  await expect(fallback(own.meta.id, AbortSignal.abort(new Error('legacy cancelled')))).rejects.toThrow('legacy cancelled')
})
it('still validates the complete stored header before an execution snapshot publishes history', async () => {
  const h = await fixture(), own = await owned(h)
  await h.ctx.projectStorage.append(own.authority, own.meta.id, oneTurnLog())
  const location = h.ctx.sessionPersistence.locate(own.meta)
  if (location?.kind !== 'jsonl') throw new Error('real JSONL fixture location missing')
  const bytes = await readFile(location.path, 'utf8')
  const end = bytes.indexOf('\n'), header = JSON.parse(bytes.slice(0, end)) as { id: string }
  header.id = randomUUID()
  await writeFile(location.path, JSON.stringify(header) + bytes.slice(end))
  const revision = await h.ctx.projectStorage.executionRevision(own.authority, own.meta.id)
  expect(revision).toBeDefined()
  await expect(h.ctx.projectStorage.executionSnapshot(own.authority, own.meta.id)).rejects.toThrow(/requested id.*header id/u)
})
