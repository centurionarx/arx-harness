/** Real native creation must finish admitted header commits without acknowledging an aborted caller. */
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import * as BrokerHttp from '../src/broker-http.ts'
import { nativeSupervisorFixture } from './native-supervisor.ts'

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
  harness = await storageHarness({ http: true, endpoint: supervisor.endpoint, readyUsers: 1,
    extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp }] })
  const h = harness, peer = supervisor, user = h.users[0], origin = h.url
  if (user === undefined || origin === undefined) throw new Error('native USER fixture unavailable')
  const project = await h.ctx.projectStorage.createProject(user.authority, 'Cancel admitted header')
  const workspace = await h.ctx.projectStorage.createWorkspace(user.authority, project.projectId, 'Owned cancellation workspace')
  const provision = await h.ctx.projectStorage.provision(user.authority, workspace.workspaceId)
  peer.assign({ controlOrigin: origin, scope: provision.scope, volumePath: provision.volumePath })
  const provider = h.ctx.sessionPersistence
  const materialize = provider.materialize.bind(provider)
  const admitted = Promise.withResolvers<void>(), retained = Promise.withResolvers<void>()
  release = retained.resolve
  let id: SessionId | undefined
  let committed = false
  const barrier = vi.spyOn(provider, 'materialize').mockImplementationOnce(async (sessionId) => {
    id = sessionId
    admitted.resolve()
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
  retained.resolve()
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
