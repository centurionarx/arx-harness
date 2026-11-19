/** Real native creation must finish admitted header commits without acknowledging an aborted caller. */
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi, afterAll, beforeAll } from 'vitest'
import { cp, mkdtemp, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import * as BrokerHttp from '../src/broker-http.ts'
import { nativeSupervisorFixture } from './native-supervisor.ts'

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

let harness: Awaited<ReturnType<typeof storageHarness>> | undefined
let supervisor: Awaited<ReturnType<typeof nativeSupervisorFixture>> | undefined
let release: (() => void) | undefined
afterEach(async () => {
  release?.()
  vi.restoreAllMocks()
  await harness?.close()
  await supervisor?.close()
  harness = undefined; supervisor = undefined; release = undefined
})

it('commits a genuine admitted native header but gives no RPC success or idle renewal after outer cancellation', async () => {
  supervisor = await nativeSupervisorFixture()
  harness = await seededHarness({ http: true, endpoint: supervisor.endpoint,
    extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp }] })
  const h = harness, peer = supervisor, user = h.users[0], origin = h.url
  if (user === undefined || origin === undefined) throw new Error('native USER fixture unavailable')
  const project = await h.ctx.projectStorage.createProject(user.authority, 'Cancel admitted header')
  const workspace = await h.ctx.projectStorage.createWorkspace(user.authority, project.projectId, 'Owned cancellation workspace')
  const provision = await h.ctx.projectStorage.provision(user.authority, workspace.workspaceId)
  peer.assign({ controlOrigin: origin, scope: provision.scope, volumePath: provision.volumePath })
  const provider = h.ctx.sessionPersistence
  const materialize = provider.materialize.bind(provider)
  const admitted = Promise.withResolvers<undefined>(), retained = Promise.withResolvers<undefined>()
  release = () => { retained.resolve(undefined) }
  let id: SessionId | undefined
  let committed = false
  const barrier = vi.spyOn(provider, 'materialize').mockImplementationOnce(async (sessionId) => {
    id = sessionId
    admitted.resolve(undefined)
    await retained.promise
    await materialize(sessionId)
    committed = true
  })
  const revalidate = vi.spyOn(h.ctx.webIdentity, 'revalidate')
  const outer = new AbortController(), reason = new Error('disposable caller cancellation')
  const pending = h.ctx.isolatedProjectRuntime.invoke(user.authority, undefined, {
    type: 'client-request', method: 'session.create', payload: { workspaceId: workspace.workspaceId }, rpcId: RpcId(randomUUID()),
  }, outer.signal).then(result => ({ acknowledged: result.ok, error: undefined }),
    (error: unknown) => ({ acknowledged: false, error }))
  await admitted.promise
  outer.abort(reason)
  retained.resolve(undefined)
  const outcome = await pending
  expect(barrier).toHaveBeenCalledTimes(1)
  expect(committed).toBe(true)
  if (id === undefined) throw new Error('real native allocation unavailable')
  const page = await h.ctx.projectStorage.read(user.authority, id)
  expect(page).toMatchObject({ sessionId: id, nextSeq: 0 })
  const raw = await provider.readRawPage(id, { offset: 0, maxBytes: 128 * 1024 })
  expect(raw?.content).toBe(page.content)
  expect(raw?.meta).toMatchObject({ id, cwd: provision.volumePath, version: SESSION_FORMAT_VERSION })
  expect(raw?.revision).toBeTruthy()
  expect((await provider.readFrom(id, 0)).events).toEqual([])
  expect(peer.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
  expect(outcome.acknowledged).toBe(false)
  expect(outcome.error).toBe(reason)
  expect(revalidate.mock.calls.filter(call => call[1]?.activity === true)).toEqual([])
}, 30000)
