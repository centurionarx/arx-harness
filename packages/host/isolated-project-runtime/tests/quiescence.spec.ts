import { expect, it, afterAll, beforeAll } from 'vitest'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import type { ClientRequest } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import { supervisorFixture } from './supervisor.ts'

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

it('refuses new owner execution while the actual child has exited but quiescence acknowledgement is pending', async () => {
  const supervisor = await supervisorFixture()
  const harness = await seededHarness({ endpoint: supervisor.endpoint })
  const authority = harness.users[0]!.authority
  const runtime = harness.ctx.isolatedProjectRuntime
  const project = await harness.ctx.projectStorage.createProject(authority, 'Quiescence project')
  const workspace = await harness.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Quiescence workspace')
  const meta = await harness.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  const request = (): ClientRequest => ({ type: 'client-request', rpcId: RpcId(randomUUID()), method: 'session.prompt',
    payload: { sessionId: meta.id, mode: 'queue', content: [] } })
  const barrier = Promise.withResolvers<undefined>()
  let quiescence: Promise<void> | undefined
  supervisor.cancellationGate(barrier.promise)
  supervisor.hold(true)
  const entered = supervisor.acceptedSignal()
  const pending = runtime.invoke(authority, undefined, request()).then(value => ({ value }), (error: unknown) => ({ error }))
  try {
    await entered
    const operation = [...supervisor.operations.values()][0]!
    const cancelled = supervisor.cancelledSignal()
    quiescence = runtime.quiesce(authority.principal.userId)
    expect(runtime.quiesce(authority.principal.userId)).toBe(quiescence)
    const global = runtime.quiesce()
    expect(runtime.quiesce(authority.principal.userId)).toBe(global)
    await cancelled
    expect(operation.child?.exitCode !== null || operation.child?.signalCode !== null).toBe(true)
    supervisor.hold(false); supervisor.result({ accepted: true })
    const before = supervisor.accepted.length
    await expect(runtime.invoke(authority, undefined, request())).rejects.toMatchObject({ status: 503 })
    expect(supervisor.accepted).toHaveLength(before)
    barrier.resolve(undefined)
    await Promise.all([quiescence, global])
    expect(await pending).toHaveProperty('error')
    expect(await runtime.invoke(authority, undefined, request())).toEqual({ ok: true, value: { accepted: true } })
  } finally {
    barrier.resolve(undefined)
    await quiescence
    await pending
    await harness.close()
    await supervisor.close()
  }
})
