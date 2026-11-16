import { afterEach, describe, expect, it, vi, afterAll, beforeAll } from 'vitest'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import { storageHarness } from './harness.ts'

// Identity bootstrap hashes several passwords, so it runs once; every test opens its own copy of that root.
const seed = { root: '', users: [] as Awaited<ReturnType<typeof storageHarness>>['users'], master: '',
  passwords: {} as Awaited<ReturnType<typeof storageHarness>>['passwords'] }
beforeAll(async () => {
  const harness = await storageHarness({ readyUsers: 1 })
  seed.root = harness.paths.root
  seed.users = harness.users
  seed.passwords = harness.passwords
  seed.master = (await harness.ctx.webIdentity.login('arxadmin', harness.passwords.master, 'admin')).token
  await harness.close(false)
})
afterAll(() => rm(seed.root, { recursive: true, force: true }))
async function seededHarness(options: Omit<Parameters<typeof storageHarness>[0] & object, 'root' | 'readyUsers' | 'initialize'> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arx-project-fixture-'))
  await cp(seed.root, root, { recursive: true })
  const harness = await storageHarness({ ...options, root })
  const users = await Promise.all(seed.users.map(async user => ({ ...user,
    authority: await harness.ctx.webIdentity.authenticate(user.token, 'user') })))
  return { ...harness, users, passwords: seed.passwords,
    master: await harness.ctx.webIdentity.authenticate(seed.master, 'admin'),
    async close() { await harness.close(false); await rm(root, { recursive: true, force: true }) } }
}

const fixtures: Awaited<ReturnType<typeof storageHarness>>[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fixture of fixtures.splice(0)) await fixture.close()
})
async function fixture() {
  const h = await seededHarness(); fixtures.push(h); return h
}
async function owned(h: Awaited<ReturnType<typeof storageHarness>>) {
  const authority = h.users[0]!.authority
  const project = await h.ctx.projectStorage.createProject(authority, 'Owned authority race')
  const workspace = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Owned race workspace')
  const meta = await h.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  return { authority, project, workspace, meta }
}
describe('owner revalidation and append serialization through the real journal', () => {
  it('omits an identity-owned project whose derived presentation row was never created', async () => {
    const h = await fixture()
    const authority = h.users[0]!.authority
    const projectId = await h.ctx.webIdentity.createProject(authority)
    expect(await h.ctx.webIdentity.authorizeOwner(authority, { kind: 'project', projectId })).toMatchObject({ projectId })
    expect(await h.ctx.projectStorage.projects(authority)).toEqual({ projects: [] })
  })
  it('rejects registration after revocation between real provisioning and owner lookup without creating an orphan row', async () => {
    const h = await fixture(), own = await owned(h)
    const id = SessionId(randomUUID())
    const original = h.ctx.projectStorage.provision.bind(h.ctx.projectStorage)
    vi.spyOn(h.ctx.projectStorage, 'provision').mockImplementationOnce(async (...args) => {
      const result = await original(...args)
      await h.ctx.webIdentity.logout(own.authority)
      return result
    })
    await expect(h.ctx.projectStorage.register(own.authority, own.workspace.workspaceId,
      { id, version: SESSION_FORMAT_VERSION, createdAt: 2 })).rejects.toMatchObject({ status: 401 })
    expect(await h.ctx.sessionPersistence.readRaw(id)).toBeUndefined()
    const login = await h.ctx.webIdentity.login(h.users[0]!.username, h.users[0]!.password, 'user')
    const fresh = await h.ctx.webIdentity.authenticate(login.token, 'user')
    await expect(h.ctx.webIdentity.authorizeOwner(fresh, { kind: 'session', sessionId: id })).rejects.toMatchObject({ status: 403 })
    expect((await h.ctx.projectStorage.list(fresh, { kind: 'workspace', workspaceId: own.workspace.workspaceId }))
      .sessions.map(session => session.sessionId)).toEqual([own.meta.id])
  })
  it.each(['list', 'executionHeaders'] as const)('propagates actual revocation during %s instead of reporting an empty successful projection', async (operation) => {
    const h = await fixture(), own = await owned(h)
    await h.ctx.projectStorage.append(own.authority, own.meta.id, oneTurnLog())
    const original = h.ctx.webIdentity.authorizeOwner.bind(h.ctx.webIdentity)
    let revoked = false
    vi.spyOn(h.ctx.webIdentity, 'authorizeOwner').mockImplementation(async (...args) => {
      if (!revoked && args[1].kind === 'session') {
        revoked = true
        await h.ctx.webIdentity.logout(own.authority)
      }
      return original(...args)
    })
    const result = operation === 'list'
      ? h.ctx.projectStorage.list(own.authority, { kind: 'workspace', workspaceId: own.workspace.workspaceId })
      : h.ctx.projectStorage.executionHeaders(own.authority, own.workspace.workspaceId)
    await expect(result).rejects.toMatchObject({ status: 401 })
    expect(revoked).toBe(true)
  })
  it('keeps a queued append serialized after the first real fsync acknowledges and retains the newer queue tail', async () => {
    const h = await fixture(), own = await owned(h)
    let entered!: () => void
    const accepted = new Promise<void>((resolve) => { entered = resolve })
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const original = h.ctx.sessionPersistence.append.bind(h.ctx.sessionPersistence)
    let calls = 0
    vi.spyOn(h.ctx.sessionPersistence, 'append').mockImplementation(async (...args) => {
      calls++
      if (calls === 1) { entered(); await barrier }
      await original(...args)
    })
    const events = oneTurnLog()
    const first = h.ctx.projectStorage.append(own.authority, own.meta.id, events)
    void first.catch(() => undefined)
    await accepted
    const second = h.ctx.projectStorage.append(own.authority, own.meta.id, [])
    void second.catch(() => undefined)
    expect(calls).toBe(1)
    release()
    expect(await first).toEqual({ sessionId: own.meta.id, nextSeq: events.length })
    expect(await second).toEqual({ sessionId: own.meta.id, nextSeq: events.length })
    expect(calls).toBe(2)
    expect((await h.ctx.sessionPersistence.readFrom(own.meta.id, 0)).events).toEqual(events)
  })
})
