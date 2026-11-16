import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { appendFile, cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import { storageHarness } from './harness.ts'

const active: Awaited<ReturnType<typeof seededHarness>>[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const fixture of active.splice(0)) await fixture.close() })
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
async function fixture(options: Parameters<typeof seededHarness>[0] = {}) {
  const harness = await seededHarness(options); active.push(harness); return harness
}
async function seeded(harness: Awaited<ReturnType<typeof seededHarness>>, user = 0) {
  const authority = harness.users[user]!.authority
  const project = await harness.ctx.projectStorage.createProject(authority, 'Owned project')
  const workspace = await harness.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Owned workspace')
  const header = await harness.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1000 })
  const events = oneTurnLog()
  const receipt = await harness.ctx.projectStorage.append(authority, header.id, events)
  return { authority, project, workspace, header, events, receipt }
}
describe('owned project storage through Loader', () => {
  it('keeps control artifacts outside the volume and denies USER_B and MASTER on every operation', async () => {
    const harness = await fixture()
    const own = await seeded(harness)
    expect(own.receipt.nextSeq).toBe(own.events.length)
    expect((await harness.ctx.projectStorage.list(own.authority, { kind: 'project', projectId: own.project.projectId })).sessions)
      .toEqual([{ sessionId: own.header.id, projectId: own.project.projectId, workspaceId: own.workspace.workspaceId,
        createdAt: 1000, nextSeq: own.events.length, title: '', grouped: true }])
    const location = harness.ctx.sessionPersistence.locate(own.header)!
    expect(location.kind).toBe('jsonl')
    if (location.kind !== 'jsonl') throw new Error('fixture JSONL provider absent')
    expect(location.path.startsWith(harness.logRoot)).toBe(true)
    expect(own.header.cwd!.startsWith(harness.volumeRoot)).toBe(true)
    expect((await stat(own.header.cwd!)).mode & 0o777).toBe(0o700)
    expect((await stat(harness.index)).mode & 0o777).toBe(0o600)
    const before = await readFile(location.path)
    for (const denied of [harness.users[1]!.authority, harness.master]) {
      const api = harness.ctx.projectStorage
      for (const action of [
        () => api.provision(denied, own.workspace.workspaceId),
        () => api.read(denied, own.header.id),
        () => api.append(denied, own.header.id, []),
        () => api.recover(denied, own.header.id),
        () => api.list(denied, { kind: 'project', projectId: own.project.projectId }),
        () => api.rename(denied, own.header.id, 'stolen'),
        () => api.removeGrouping(denied, own.workspace.workspaceId),
        () => api.deleteSession(denied, own.header.id),
      ]) await expect(action()).rejects.toMatchObject({ status: 403 })
    }
    expect(await readFile(location.path)).toEqual(before)
    const metadata = JSON.stringify(await harness.ctx.projectStorage.projects(own.authority))
    expect(metadata).not.toContain(harness.paths.root)
  })
  it('acknowledges neither index progress nor changed bytes when the real persistence rejects an append', async () => {
    const harness = await fixture()
    const own = await seeded(harness)
    const location = harness.ctx.sessionPersistence.locate(own.header)!
    if (location.kind !== 'jsonl') throw new Error('fixture JSONL provider absent')
    const before = await readFile(location.path)
    await expect(harness.ctx.projectStorage.append(own.authority, own.header.id, own.events)).rejects.toThrow()
    const list = await harness.ctx.projectStorage.list(own.authority, { kind: 'workspace', workspaceId: own.workspace.workspaceId })
    expect(list.sessions[0]!.nextSeq).toBe(own.events.length)
    expect(await readFile(location.path)).toEqual(before)
    const injection = vi.spyOn(harness.ctx.sessionPersistence,
      'append').mockRejectedValueOnce(Object.assign(new Error('fixture full disk'), { code: 'ENOSPC' }))
    await expect(harness.ctx.projectStorage.append(own.authority, own.header.id, [])).rejects.toMatchObject({ code: 'ENOSPC' })
    injection.mockRestore()
    expect((await harness.ctx.projectStorage.list(own.authority, { kind: 'project',
      projectId: own.project.projectId })).sessions[0]!.nextSeq).toBe(own.events.length)
  })
  it('repairs a torn append and rebuilds a missing index only with current authoritative ownership', async () => {
    const harness = await fixture()
    const own = await seeded(harness)
    const location = harness.ctx.sessionPersistence.locate(own.header)!
    if (location.kind !== 'jsonl') throw new Error('fixture JSONL provider absent')
    await appendFile(location.path, '{"torn')
    const index = new DatabaseSync(harness.index)
    index.prepare('DELETE FROM history WHERE session=?').run(own.header.id); index.close()
    await expect(harness.ctx.projectStorage.recover(harness.users[1]!.authority, own.header.id)).rejects.toMatchObject({ status: 403 })
    expect((await readFile(location.path, 'utf8')).endsWith('{"torn')).toBe(true)
    const receipt = await harness.ctx.projectStorage.recover(own.authority, own.header.id)
    expect(receipt.nextSeq).toBe(own.events.length)
    expect((await readFile(location.path, 'utf8')).endsWith('{"torn')).toBe(false)
    expect((await harness.ctx.projectStorage.read(own.authority, own.header.id)).nextSeq).toBe(own.events.length)
    await expect(harness.ctx.projectStorage.recover(own.authority, SessionId('unmapped-legacy'))).rejects.toMatchObject({ status: 403 })
  })
  it('preserves history and volume files when only grouping is removed, and keeps tombstones after an older index restore', async () => {
    const harness = await fixture()
    const own = await seeded(harness)
    const location = harness.ctx.sessionPersistence.locate(own.header)!
    if (location.kind !== 'jsonl') throw new Error('fixture JSONL provider absent')
    const marker = own.header.cwd! + '/keep.txt'
    await writeFile(marker, 'owned')
    const index = new DatabaseSync(harness.index)
    const older = index.prepare('SELECT * FROM history WHERE session=?').get(own.header.id)!
    index.close()
    await harness.ctx.projectStorage.removeGrouping(own.authority, own.workspace.workspaceId)
    expect((await harness.ctx.projectStorage.workspaces(own.authority, own.project.projectId)).workspaces).toEqual([])
    expect((await harness.ctx.projectStorage.read(own.authority, own.header.id)).content).toContain('"turn/end"')
    expect(await readFile(marker, 'utf8')).toBe('owned')
    await harness.ctx.projectStorage.deleteSession(own.authority, own.header.id)
    const restored = new DatabaseSync(harness.index)
    restored.prepare('INSERT INTO history VALUES(?,?,?,?,?,?,?,?,?)')
      .run(older.session!, older.user!, older.project!, older.workspace!, older.created!, older.next_seq!,
        older.header!, older.title!, older.grouped!)
    restored.close()
    await expect(harness.ctx.projectStorage.read(own.authority, own.header.id)).rejects.toMatchObject({ status: 403 })
    expect((await harness.ctx.projectStorage.list(own.authority, { kind: 'project',
      projectId: own.project.projectId })).sessions).toEqual([])
    expect(await readFile(marker, 'utf8')).toBe('owned')
    expect(await readFile(location.path, 'utf8')).toContain('"turn/end"')
  })
  it('bounds complete UTF-8 pages and reconstructs the original Zstandard artifact without split code points', async () => {
    const harness = await fixture({ compression: 'zstd', historyPageBytes: 400 })
    const own = await seeded(harness)
    const raw = (await harness.ctx.sessionPersistence.readRaw(own.header.id))!.content
    let cursor: string | undefined
    let output = ''
    do {
      const page = await harness.ctx.projectStorage.read(own.authority, own.header.id, cursor)
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(400)
      expect(page.content).not.toContain('\ufffd')
      output += page.content; cursor = page.nextCursor
    } while (cursor !== undefined)
    expect(output).toBe(raw)
    for (const invalid of ['-1','01','nan','1.5',
      '999999999']) await expect(harness.ctx.projectStorage.read(own.authority, own.header.id,
      invalid)).rejects.toMatchObject({ status: 400 })
  })
  it('binds continuation to source and session, and never falls back to a full-log read', async () => {
    const harness = await fixture({ historyPageBytes: 400 })
    const own = await seeded(harness)
    const forbidden = vi.spyOn(harness.ctx.sessionPersistence, 'readRaw').mockRejectedValue(new Error('full read forbidden'))
    const first = await harness.ctx.projectStorage.read(own.authority, own.header.id)
    expect(first.nextCursor).toBeDefined()
    const altered = Buffer.from(JSON.stringify({ sessionId: own.header.id, offset: 1.5, revision: 'invalid' })).toString('base64url')
    await expect(harness.ctx.projectStorage.read(own.authority, own.header.id, altered)).rejects.toMatchObject({ status: 400 })
    const other = await seeded(harness)
    await expect(harness.ctx.projectStorage.read(own.authority, other.header.id, first.nextCursor)).rejects.toMatchObject({ status: 400 })
    const location = harness.ctx.sessionPersistence.locate(own.header)!
    await appendFile(location.path, '{"torn')
    await expect(harness.ctx.projectStorage.read(own.authority, own.header.id, first.nextCursor)).rejects.toMatchObject({ status: 409 })
    expect(forbidden).not.toHaveBeenCalled()
    forbidden.mockRestore()
  })
})
