import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import type { ClientRequest } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import { supervisorFixture } from './supervisor.ts'

it.each(['logout', 'deleteWorkspace'] as const)('releases identity writes before %s quiescence while denying a queued owner allocation', async (operation) => {
  const supervisor = await supervisorFixture()
  const harness = await storageHarness({ endpoint: supervisor.endpoint, readyUsers: 1 })
  const user = harness.users[0]!, identity = harness.ctx.webIdentity, runtime = harness.ctx.isolatedProjectRuntime
  const project = await harness.ctx.projectStorage.createProject(user.authority, 'Revocation queue project')
  const workspace = await harness.ctx.projectStorage.createWorkspace(user.authority, project.projectId, 'Revocation queue workspace')
  const meta = await harness.ctx.projectStorage.register(user.authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  const events = oneTurnLog()
  await harness.ctx.projectStorage.append(user.authority, meta.id, events)
  const envelope: ClientRequest = { type: 'client-request', rpcId: RpcId(randomUUID()), method: 'session.prompt',
    payload: { sessionId: meta.id, mode: 'queue', content: [] } }
  supervisor.hold(true)
  const accepted = supervisor.acceptedSignal()
  const pending = runtime.invoke(user.authority, undefined, envelope).then(value => ({ value }), (error: unknown) => ({ error }))
  await accepted
  const lease = [...supervisor.operations.values()][0]!
  const appendEntered = Promise.withResolvers<undefined>(), appendRelease = Promise.withResolvers<undefined>()
  const cancellationRelease = Promise.withResolvers<undefined>()
  const registerEntered = Promise.withResolvers<undefined>()
  const delegateAppend = harness.ctx.identityAuthorityJournal.append.bind(harness.ctx.identityAuthorityJournal)
  const append = vi.spyOn(harness.ctx.identityAuthorityJournal, 'append').mockImplementationOnce(async (sequence, event) => {
    appendEntered.resolve(undefined)
    await appendRelease.promise
    return delegateAppend(sequence, event)
  })
  const delegateRegister = identity.registerSession.bind(identity)
  const register = vi.spyOn(identity, 'registerSession').mockImplementation((authority, scope, id) => {
    registerEntered.resolve(undefined)
    return delegateRegister(authority, scope, id)
  })
  supervisor.cancellationGate(cancellationRelease.promise)
  const cancelled = supervisor.cancelledSignal()
  let acknowledged = false
  const mutation = (operation === 'logout' ? identity.logout(user.authority) : identity.deleteWorkspace(user.authority,
    workspace.workspaceId))
    .then(() => { acknowledged = true; return { ok: true } }, (error: unknown) => ({ error }))
  let broker: Promise<Response> | undefined
  try {
    await appendEntered.promise
    broker = runtime.broker(new Request('http://fixture/_arx/worker-history', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-arx-worker-capability': lease.capability },
      body: JSON.stringify({ operation: 'allocate-fork', workerId: randomUUID(), workspaceId: workspace.workspaceId,
        sessionId: meta.id, seedLength: events.length }) }))
    await registerEntered.promise
    appendRelease.resolve(undefined)
    await cancelled
    expect(lease.child?.exitCode !== null || lease.child?.signalCode !== null).toBe(true)
    expect(acknowledged).toBe(false)
    const refused = await broker
    expect(refused.status).toBe(operation === 'logout' ? 401 : 403)
    expect(await refused.json()).toEqual({ error: 'Worker operation refused' })
    // Authentication writes must progress independently of the pending process receipt.
    const freshLogin = await identity.login(user.username, user.password, 'user')
    const fresh = await identity.authenticate(freshLogin.token, 'user')
    expect(fresh.principal.userId).toBe(user.userId)
    const allocated = register.mock.calls[0]![2]
    await expect(identity.authorizeOwner(fresh, { kind: 'session', sessionId: allocated })).rejects.toMatchObject({ status: 403 })
    if (operation === 'deleteWorkspace') {
      expect((await identity.authenticate(user.token, 'user')).revision).toBe(user.authority.revision)
      await expect(identity.authorizeOwner(fresh, { kind: 'workspace',
        workspaceId: workspace.workspaceId })).rejects.toMatchObject({ status: 403 })
    } else await expect(identity.authenticate(user.token, 'user')).rejects.toMatchObject({ status: 401 })
    cancellationRelease.resolve(undefined)
    expect(await mutation).toEqual({ ok: true })
    expect(supervisor.operations.size).toBe(0)
    expect(await pending).toHaveProperty('error')
    expect(await harness.ctx.projectStorage.createProject(fresh, 'Post-quiescence project')).toHaveProperty('projectId')
  } finally {
    appendRelease.resolve(undefined); cancellationRelease.resolve(undefined)
    await broker; await mutation; await pending
    append.mockRestore(); register.mockRestore()
    await harness.close(); await supervisor.close()
  }
})
