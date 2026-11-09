import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import type { ClientRequest } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import { WORKER_BROKER_PATH, WORKER_CAPABILITY_HEADER } from '../src/broker-contract.ts'
import { supervisorFixture } from './supervisor.ts'

const resources: { close(): Promise<void> }[] = []
afterEach(async () => { for (const item of resources.splice(0).reverse()) await item.close() })

async function setup(runtimeConfig: Readonly<Record<string, unknown>> = {}) {
  const supervisor = await supervisorFixture(); resources.push(supervisor)
  const h = await storageHarness({ endpoint: supervisor.endpoint, readyUsers: 2, runtimeConfig }); resources.push(h)
  const authority = h.users[0]!.authority
  const project = await h.ctx.projectStorage.createProject(authority, 'Owner')
  const workspace = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Workspace')
  const register = () => h.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  const first = await register(), second = await register()
  const request = (method: string): ClientRequest => ({ type: 'client-request', method, payload: {}, rpcId: RpcId(randomUUID()) })
  const runtime = h.ctx.isolatedProjectRuntime
  supervisor.hold(true)
  // A held scoped request is a live, retained lease whose capability a worker can present to the broker.
  const retained = async (authorityOf = authority, workspaceId = workspace.workspaceId) => {
    const accepted = supervisor.acceptedSignal()
    const outcome = runtime.invoke(authorityOf, { kind: 'workspace', workspaceId }, request('llm.providers'))
      .then(() => 'answered', () => 'cancelled')
    await accepted
    const operation = [...supervisor.operations.values()].at(-1)!
    return { id: operation.id, capability: operation.capability, outcome }
  }
  const broker = (capability: string, workerId: string, sessionId: string, operation = 'snapshot') =>
    runtime.broker(new Request('http://control' + WORKER_BROKER_PATH, { method: 'POST',
      headers: { 'content-type': 'application/json', [WORKER_CAPABILITY_HEADER]: capability },
      body: JSON.stringify({ operation, workerId, workspaceId: workspace.workspaceId, sessionId: sessionId,
        ...(operation === 'append' ? { events: [] } : {}) }) }))
  return { supervisor, h, authority, workspace, first, second, retained, broker, runtime }
}

describe('a restarted worker takes over a session writer only after the old lease is quiescent', () => {
  it('cancels the old writer lease, waits for its receipt, and then hydrates the new worker', async () => {
    const f = await setup()
    const old = await f.retained(), next = await f.retained()
    const oldWorker = randomUUID(), newWorker = randomUUID()
    expect((await f.broker(old.capability, oldWorker, f.first.id)).status).toBe(200)
    expect((await f.broker(next.capability, newWorker, f.first.id, 'append')).status).toBe(409)
    expect(f.supervisor.cancelled).toEqual([])
    const hydrated = await f.broker(next.capability, newWorker, f.first.id)
    expect(hydrated.status).toBe(200)
    expect(f.supervisor.cancelled).toEqual([old.id])
    expect(await old.outcome).toBe('cancelled')
    expect((await f.broker(next.capability, newWorker, f.first.id, 'append')).status).toBe(200)
    expect((await f.broker(old.capability, oldWorker, f.first.id)).status).toBe(403)
  })

  it('never cancels a live writer lease for the same worker', async () => {
    const f = await setup()
    const old = await f.retained(), next = await f.retained()
    const worker = randomUUID()
    expect((await f.broker(old.capability, worker, f.first.id)).status).toBe(200)
    expect((await f.broker(next.capability, worker, f.first.id)).status).toBe(200)
    expect(f.supervisor.cancelled).toEqual([])
    expect((await f.broker(old.capability, worker, f.first.id, 'append')).status).toBe(200)
  })

  it('refuses another worker presenting the writer lease itself without cancelling that lease', async () => {
    const f = await setup()
    const old = await f.retained()
    expect((await f.broker(old.capability, randomUUID(), f.first.id)).status).toBe(200)
    expect((await f.broker(old.capability, randomUUID(), f.first.id)).status).toBe(409)
    expect(f.supervisor.cancelled).toEqual([])
  })

  it('sends one cancellation for concurrent hydration requests of a new worker', async () => {
    const f = await setup()
    const old = await f.retained(), next = await f.retained()
    const oldWorker = randomUUID(), newWorker = randomUUID()
    expect((await f.broker(old.capability, oldWorker, f.first.id)).status).toBe(200)
    expect((await f.broker(old.capability, oldWorker, f.second.id)).status).toBe(200)
    const statuses = await Promise.all([f.broker(next.capability, newWorker, f.first.id),
      f.broker(next.capability, newWorker, f.second.id), f.broker(next.capability, newWorker, f.first.id)])
    expect(statuses.map(response => response.status)).toEqual([200, 200, 200])
    expect(f.supervisor.cancelled).toEqual([old.id])
  })

  it('refuses the takeover and closes the adapter when the old lease has no quiescent receipt', async () => {
    const f = await setup({ cancellationTimeoutMs: 200 })
    const old = await f.retained(), next = await f.retained()
    const oldWorker = randomUUID(), newWorker = randomUUID()
    expect((await f.broker(old.capability, oldWorker, f.first.id)).status).toBe(200)
    f.supervisor.cancellationGate(new Promise<void>(() => {}))
    const refused = await f.broker(next.capability, newWorker, f.first.id)
    expect(refused.status).toBe(503)
    expect(await refused.json()).toEqual({ error: 'Worker operation refused' })
    // A missing receipt closes the adapter: neither worker can write afterwards.
    expect((await f.broker(next.capability, newWorker, f.first.id, 'append')).status).toBe(403)
    await expect(f.runtime.invoke(f.authority, undefined, { type: 'client-request', method: 'llm.providers',
      payload: {}, rpcId: RpcId(randomUUID()) })).rejects.toMatchObject({ status: 503 })
    f.supervisor.cancellationGate()
  })

  it('refuses a takeover request outside the session owner and workspace before cancelling anything', async () => {
    const f = await setup()
    const old = await f.retained()
    const oldWorker = randomUUID(), newWorker = randomUUID()
    expect((await f.broker(old.capability, oldWorker, f.first.id)).status).toBe(200)
    const other = f.h.users[1]!.authority
    const otherProject = await f.h.ctx.projectStorage.createProject(other, 'Other')
    const otherWorkspace = await f.h.ctx.projectStorage.createWorkspace(other, otherProject.projectId, 'Other')
    const foreign = await f.retained(other, otherWorkspace.workspaceId)
    expect((await f.broker(foreign.capability, newWorker, f.first.id)).status).toBe(403)
    expect(f.supervisor.cancelled).toEqual([])
    expect((await f.broker(old.capability, oldWorker, f.first.id, 'append')).status).toBe(200)
  })
})
