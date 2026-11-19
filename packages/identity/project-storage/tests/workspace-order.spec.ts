import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cp, mkdtemp, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WebIdentityError } from '@arx-ai/arx-web-identity'
import { storageHarness } from './harness.ts'

const fixtures: Awaited<ReturnType<typeof seededHarness>>[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fixture of fixtures.splice(0)) await fixture.close()
})
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
async function fixture() {
  const h = await seededHarness(); fixtures.push(h)
  const authority = h.users[0]!.authority
  const project = await h.ctx.projectStorage.createProject(authority, 'Ordered')
  const ids = []
  for (const name of ['First', 'Second', 'Third']) {
    ids.push((await h.ctx.projectStorage.createWorkspace(authority, project.projectId, name)).workspaceId)
  }
  const [first, second, third] = ids as [typeof ids[0], typeof ids[0], typeof ids[0]]
  return { h, authority, project, first, second, third, storage: h.ctx.projectStorage }
}

describe('workspace display order in the control index', () => {
  it('lists grouped workspaces in creation order until an order is stored', async () => {
    const f = await fixture()
    expect(await f.storage.workspaceOrder(f.authority)).toEqual([f.first, f.second, f.third])
  })

  it('stores a move before an anchor or to the end and appends workspaces absent from the stored order', async () => {
    const f = await fixture()
    expect(await f.storage.moveWorkspace(f.authority, f.third, f.first)).toEqual([f.third, f.first, f.second])
    expect(await f.storage.workspaceOrder(f.authority)).toEqual([f.third, f.first, f.second])
    expect(await f.storage.moveWorkspace(f.authority, f.third)).toEqual([f.first, f.second, f.third])
    const fourth = (await f.storage.createWorkspace(f.authority, f.project.projectId, 'Fourth')).workspaceId
    expect(await f.storage.moveWorkspace(f.authority, f.second, f.first)).toEqual([f.second, f.first, f.third, fourth])
    const fifth = (await f.storage.createWorkspace(f.authority, f.project.projectId, 'Fifth')).workspaceId
    expect(await f.storage.workspaceOrder(f.authority)).toEqual([f.second, f.first, f.third, fourth, fifth])
  })

  it('applies concurrent moves of one user one at a time, after a refused move as well', async () => {
    const f = await fixture()
    await f.storage.removeGrouping(f.authority, f.second)
    const refused = f.storage.moveWorkspace(f.authority, f.first, f.second)
    const moved = f.storage.moveWorkspace(f.authority, f.third, f.first)
    const appended = f.storage.moveWorkspace(f.authority, f.first)
    await expect(refused).rejects.toMatchObject({ status: 403 })
    expect(await moved).toEqual([f.third, f.first])
    expect(await appended).toEqual([f.third, f.first])
    expect(await f.storage.workspaceOrder(f.authority)).toEqual([f.third, f.first])
  })

  it('excludes removed groupings and refuses them as moved workspace or anchor', async () => {
    const f = await fixture()
    await f.storage.moveWorkspace(f.authority, f.second, f.first)
    await f.storage.removeGrouping(f.authority, f.second)
    expect(await f.storage.workspaceOrder(f.authority)).toEqual([f.first, f.third])
    await expect(f.storage.moveWorkspace(f.authority, f.second, f.first)).rejects.toMatchObject({ status: 403 })
    await expect(f.storage.moveWorkspace(f.authority, f.first, f.second)).rejects.toMatchObject({ status: 403 })
    expect(await f.storage.workspaceOrder(f.authority)).toEqual([f.first, f.third])
  })

  it('refuses a foreign owner for the moved workspace and the anchor without changing either order', async () => {
    const f = await fixture()
    const other = f.h.users[1]!.authority
    const foreign = await f.storage.createWorkspace(other, (await f.storage.createProject(other, 'Foreign')).projectId, 'Foreign')
    await expect(f.storage.moveWorkspace(other, f.first)).rejects.toMatchObject({ status: 403 })
    await expect(f.storage.moveWorkspace(f.authority, foreign.workspaceId)).rejects.toMatchObject({ status: 403 })
    await expect(f.storage.moveWorkspace(f.authority, f.first, foreign.workspaceId)).rejects.toMatchObject({ status: 403 })
    expect(await f.storage.workspaceOrder(f.authority)).toEqual([f.first, f.second, f.third])
    expect(await f.storage.workspaceOrder(other)).toEqual([foreign.workspaceId])
  })

  it('skips an indexed row that identity no longer authorizes and propagates any other failure', async () => {
    const f = await fixture()
    const authorize = f.h.ctx.webIdentity.authorizeOwner.bind(f.h.ctx.webIdentity)
    let failure: Error = new WebIdentityError('AUTH_FORBIDDEN', 403, 'fixture unowned row')
    vi.spyOn(f.h.ctx.webIdentity, 'authorizeOwner').mockImplementation(async (...args) => {
      if (args[1].kind === 'workspace' && args[1].workspaceId === f.second) throw failure
      return authorize(...args)
    })
    expect(await f.storage.workspaceOrder(f.authority)).toEqual([f.first, f.third])
    failure = new Error('fixture identity unavailable')
    await expect(f.storage.workspaceOrder(f.authority)).rejects.toThrow('fixture identity unavailable')
  })

  it('refuses a stored order that is not a JSON array of strings instead of applying part of it', async () => {
    const f = await fixture()
    await f.storage.moveWorkspace(f.authority, f.third, f.first)
    for (const corrupt of ['{', '{}', JSON.stringify([f.third, 7]), JSON.stringify([null]), 'null']) {
      const database = new DatabaseSync(f.h.index)
      try { database.prepare('UPDATE workspace_order SET workspaces=?').run(corrupt) } finally { database.close() }
      await expect(f.storage.workspaceOrder(f.authority)).rejects.toThrow('corrupt project storage workspace order')
      await expect(f.storage.moveWorkspace(f.authority, f.second, f.first)).rejects.toThrow('corrupt project storage workspace order')
    }
  })
})
