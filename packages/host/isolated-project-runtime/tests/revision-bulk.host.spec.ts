/** Closed bulk metadata RPC over a real native SSE lease and control HTTP broker. */
import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import * as BrokerHttp from '../src/broker-http.ts'
import { WORKER_CAPABILITY_HEADER, WORKER_BROKER_PATH } from '../src/broker-contract.ts'
import { nativeSupervisorFixture } from './native-supervisor.ts'

it('serves a single scoped bulk receipt and rejects malformed or foreign workspace requests on the actual broker', async () => {
  const supervisor = await nativeSupervisorFixture()
  const h = await storageHarness({ endpoint: supervisor.endpoint, http: true,
    extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp }] })
  const controller = new AbortController()
  let iterator: AsyncIterator<unknown> | undefined
  try {
    const authority = h.users[0]!.authority
    const project = await h.ctx.projectStorage.createProject(authority, 'Bulk protocol')
    const workspace = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Bulk protocol workspace')
    const provision = await h.ctx.projectStorage.provision(authority, workspace.workspaceId)
    const meta = await h.ctx.projectStorage.register(authority, workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
    await h.ctx.projectStorage.append(authority, meta.id, oneTurnLog())
    if (h.url === undefined) throw new Error('real control HTTP origin missing')
    supervisor.assign({ controlOrigin: h.url, scope: provision.scope, volumePath: provision.volumePath })
    const created = await h.ctx.isolatedProjectRuntime.invoke(authority, undefined,
      { type: 'client-request', rpcId: RpcId(randomUUID()), method: 'session.create', payload: { sessionId: meta.id } })
    expect(created).toMatchObject({ ok: true })
    iterator = h.ctx.isolatedProjectRuntime.streamMux(authority, controller.signal)[Symbol.asyncIterator]()
    expect((await iterator.next()).done).toBe(false)
    const captured = supervisor.headersOf(workspace.workspaceId), worker = supervisor.ctxOf(workspace.workspaceId)
    if (captured === undefined || worker === undefined) throw new Error('native active lease missing')
    const capability = captured.get(WORKER_CAPABILITY_HEADER)
    if (capability === null) throw new Error('native private capability missing')
    const request = { operation: 'list-snapshots', workerId: worker.ownedWorkerHistory.config.workerId,
      workspaceId: workspace.workspaceId }
    const post = (body: unknown) => fetch(h.url! + WORKER_BROKER_PATH, { method: 'POST',
      headers: { 'content-type': 'application/json', [WORKER_CAPABILITY_HEADER]: capability }, body: JSON.stringify(body) })
    const response = await post(request)
    expect(response.status).toBe(200)
    const receipt = await response.json() as { value: { header: { id: string }; revision: string }[] }
    expect(receipt.value.map(snapshot => snapshot.header.id)).toEqual([meta.id])
    expect(receipt.value[0]?.revision).toBe(await h.ctx.sessionPersistence.readRevision(meta.id))
    for (const invalid of [{ ...request, sql: 'SELECT * FROM authority' }, { ...request, workspaceId: [] },
      { ...request, operation: 'delete-control-plane' }]) expect((await post(invalid)).status).toBe(400)
    const foreign = h.users[1]!.authority
    const other = await h.ctx.projectStorage.createProject(foreign, 'Foreign bulk project')
    const otherWorkspace = await h.ctx.projectStorage.createWorkspace(foreign, other.projectId, 'Foreign workspace')
    expect((await post({ ...request, workspaceId: otherWorkspace.workspaceId })).status).toBe(403)
    expect((await h.ctx.projectStorage.executionSnapshots(authority, workspace.workspaceId)).map(snapshot => snapshot.header.id))
      .toEqual([meta.id])
  } finally {
    controller.abort()
    await iterator?.return?.()
    await h.close(); await supervisor.close()
  }
})
