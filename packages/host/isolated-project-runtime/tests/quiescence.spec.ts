import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import type { ClientRequest } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import { supervisorFixture } from './supervisor.ts'

it('refuses new owner execution while the actual child has exited but quiescence acknowledgement is pending', async () => {
  const supervisor = await supervisorFixture()
  const harness = await storageHarness({ endpoint: supervisor.endpoint, readyUsers: 1 })
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
