import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RpcId, serverResponseSchema } from '@arx-ai/arx-host-apiproxy/api'
import type { ClientRequest } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { credentialRef } from '@arx-ai/arx-credentials'
import { storageHarness, FIXTURE_CREDENTIAL } from '../../../identity/project-storage/tests/harness.ts'
import { supervisorFixture } from './supervisor.ts'

const resources: { close(): Promise<void> }[] = []
afterEach(async () => { for (const item of resources.splice(0).reverse()) await item.close() })
// Identity bootstrap hashes several passwords, so it runs once; every test opens its own copy of that root.
const seed = { root: '', users: [] as Awaited<ReturnType<typeof storageHarness>>['users'], master: '' }
beforeAll(async () => {
  const harness = await storageHarness()
  seed.root = harness.paths.root
  seed.users = harness.users
  seed.master = (await harness.ctx.webIdentity.login('arxadmin', harness.passwords.master, 'admin')).token
  await harness.close(false)
})
afterAll(() => rm(seed.root, { recursive: true, force: true }))
async function seededHarness(options: Parameters<typeof storageHarness>[0] = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arx-project-fixture-'))
  await cp(seed.root, root, { recursive: true })
  const harness = await storageHarness({ ...options, root })
  const users = await Promise.all(seed.users.map(async user => ({ ...user,
    authority: await harness.ctx.webIdentity.authenticate(user.token, 'user') })))
  return { ...harness, users, master: await harness.ctx.webIdentity.authenticate(seed.master, 'admin'),
    async close() { await harness.close(false); await rm(root, { recursive: true, force: true }) } }
}
async function setup() {
  const supervisor = await supervisorFixture(); resources.push(supervisor)
  const harness = await seededHarness({ endpoint: supervisor.endpoint }); resources.push(harness)
  const authority = harness.users[0]!.authority
  const project = await harness.ctx.projectStorage.createProject(authority, 'USER_A')
  const workspace = await harness.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Workspace A')
  const header = await harness.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1000 })
  const request = (method: string, payload: unknown = {}): ClientRequest => ({ type: 'client-request', method,
    payload, rpcId: RpcId(randomUUID()) })
  return { supervisor, harness, authority, project, workspace, header, request, runtime: harness.ctx.isolatedProjectRuntime }
}

describe('isolated project runtime through Loader and HTTP', () => {
  it('denies an unconfigured endpoint without reaching a local host', async () => {
    const unconfigured = await seededHarness(); resources.push(unconfigured)
    await expect(unconfigured.ctx.isolatedProjectRuntime.fetch(unconfigured.users[0]!.authority,
      new Request('http://fixture/api/llm.providers', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method: 'llm.providers', payload: {} }) })))
      .rejects.toMatchObject({ status: 503 })
  })
  it('denies unknown/operator methods, copied authority and cross-owner resources before dispatch', async () => {
    const f = await setup()
    for (const method of ['credentials.describe', 'settings.replace', 'host.openPath', 'host.exit', 'agentPreset.copy', 'unknown.call']) {
      await expect(f.runtime.invoke(f.authority, undefined, f.request(method))).rejects.toMatchObject({ status: 403 })
    }
    await expect(f.runtime.invoke({ ...f.authority }, undefined, f.request('llm.providers'))).rejects.toMatchObject({ status: 401 })
    for (const denied of [f.harness.users[1]!.authority, f.harness.master]) {
      await expect(f.runtime.invoke(denied, undefined, f.request('session.history',
        { sessionId: f.header.id }))).rejects.toMatchObject({ status: 403 })
    }
    expect(f.supervisor.accepted).toEqual([])
  })
  it('validates HTTP envelopes and generated session ownership while stripping every browser credential from worker headers', async () => {
    const f = await setup()
    f.supervisor.result({ accepted: true })
    const result = await f.runtime.invoke(f.authority, undefined, f.request('session.prompt',
      { sessionId: f.header.id, mode: 'queue', content: [] }))
    expect(result).toEqual({ ok: true, value: { accepted: true } })
    await expect(f.runtime.invoke(f.authority, undefined, f.request('session.create',
      { cwd: '/etc' }))).rejects.toMatchObject({ status: 403 })
    await expect(f.runtime.invoke(f.authority, undefined, f.request('session.create',
      { workspaceId: f.workspace.workspaceId, sessionId: 'browser-supplied' }))).rejects.toMatchObject({ status: 403 })
    const response = await f.runtime.fetch(f.authority, new Request('http://fixture/api/llm.providers', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: 'never-forward',
        authorization: 'never-forward', origin: 'http://untrusted' },
      body: JSON.stringify(f.request('llm.providers')),
    }))
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(serverResponseSchema.parse(await response.json()).result).toEqual({ ok: true, value: { accepted: true } })
    await expect(f.runtime.fetch(f.authority, new Request('http://fixture/api/host.describe', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
    }))).rejects.toMatchObject({ status: 415 })
    await expect(f.runtime.fetch(f.authority, new Request('http://fixture/api/session.history', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f.request('host.describe')),
    }))).rejects.toMatchObject({ status: 400 })
  })
  it('rejects invalid method payloads before any worker allocation and accepts only a control-generated creation receipt', async () => {
    const f = await setup()
    expect(await f.runtime.invoke(f.authority, undefined, f.request('session.prompt', { sessionId: f.header.id })))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await f.runtime.invoke(f.authority, undefined, f.request('host.describe', { hiddenPath: '/etc' })))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(f.supervisor.accepted).toEqual([])
    const result = await f.runtime.invoke(f.authority, undefined, f.request('session.create', { workspaceId: f.workspace.workspaceId }))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('fixture allocation denied')
    const id = SessionId((result.value as { sessionId: string }).sessionId)
    expect(id).not.toBe(f.header.id)
    expect((f.supervisor.accepted[0]!.payload as { sessionId: string }).sessionId).toBe(id)
    expect(await f.harness.ctx.webIdentity.authorizeOwner(f.authority, { kind: 'session', sessionId: id }))
      .toMatchObject({ userId: f.authority.principal.userId, projectId: f.project.projectId, workspaceId: f.workspace.workspaceId })
    f.supervisor.result({ sessionId: f.header.id })
    await expect(f.runtime.invoke(f.authority, undefined, f.request('session.create', { workspaceId: f.workspace.workspaceId })))
      .rejects.toMatchObject({ status: 502, code: 'RUNTIME_PROTOCOL' })
  })
  it('quiesces a deleted resource before ACK while preserving its user cookie and denying late results', async () => {
    const f = await setup()
    f.supervisor.hold(true)
    const accepted = f.supervisor.acceptedSignal()
    const action = f.runtime.invoke(f.authority, undefined, f.request('session.prompt', { sessionId: f.header.id,
      mode: 'queue', content: [] }))
    const outcome = action.then(() => 'unexpected-success', () => 'denied')
    await accepted
    const operation = [...f.supervisor.operations.values()][0]!
    expect(operation.child?.pid).toBeTypeOf('number')
    const exited = once(operation.child!, 'close')
    await f.harness.ctx.projectStorage.deleteSession(f.authority, f.header.id)
    await exited
    expect(operation.child!.exitCode !== null || operation.child!.signalCode !== null).toBe(true)
    expect(f.supervisor.operations.size).toBe(0)
    expect(await outcome).toBe('denied')
    const resumed = await f.harness.ctx.webIdentity.authenticate(f.harness.users[0]!.token, 'user')
    expect(resumed.revision).toBe(f.authority.revision)
    await expect(f.harness.ctx.webIdentity.authorizeOwner(resumed, { kind: 'session',
      sessionId: f.header.id })).rejects.toMatchObject({ status: 403 })
    f.supervisor.hold(false)
    expect(await f.runtime.invoke(resumed, undefined, f.request('llm.providers'))).toEqual({ ok: true, value: {} })
  })
  it('filters all-session metadata with sidecar ownership and rejects malicious foreign direct results', async () => {
    const f = await setup()
    const other = f.harness.users[1]!.authority
    const project = await f.harness.ctx.projectStorage.createProject(other, 'USER_B')
    const workspace = await f.harness.ctx.projectStorage.createWorkspace(other, project.projectId, 'Workspace B')
    const header = await f.harness.ctx.projectStorage.register(other, workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1000 })
    f.supervisor.result({ items: [{ sessionId: f.header.id, title: 'A' }, { sessionId: header.id, title: 'SECRET_B' }] })
    const result = await f.runtime.invoke(f.authority, undefined, f.request('session.list'))
    expect(result).toEqual({ ok: true, value: { items: [{ sessionId: f.header.id, title: 'A' }] } })
    f.supervisor.result({ sessionId: header.id, title: 'SECRET_B' })
    await expect(f.runtime.invoke(f.authority, undefined, f.request('session.history',
      { sessionId: f.header.id }))).rejects.toMatchObject({ status: 403 })
  })
  it('blocks late results and waits for real child termination before revocation ACK', async () => {
    const f = await setup()
    f.supervisor.hold(true)
    const accepted = f.supervisor.acceptedSignal()
    const action = f.runtime.invoke(f.authority, undefined, f.request('session.prompt', { sessionId: f.header.id,
      mode: 'queue', content: [] }))
    const outcome = action.then(() => 'unexpected-success', () => 'denied')
    await accepted
    const operation = [...f.supervisor.operations.values()][0]!
    expect(operation.child?.pid).toBeTypeOf('number')
    const exited = once(operation.child!, 'close')
    await f.harness.ctx.webIdentity.setStatus(f.harness.master, f.authority.principal.userId, 'BLOCKED')
    await exited
    expect(operation.child!.exitCode !== null || operation.child!.signalCode !== null).toBe(true)
    expect(f.supervisor.operations.size).toBe(0)
    expect(await outcome).toBe('denied')
    await expect(f.runtime.invoke(f.authority, undefined, f.request('llm.providers'))).rejects.toMatchObject({ status: 401 })
  })
  it('closes an unsafe supervisor after an invalid quiescence receipt without reviving auth', async () => {
    const f = await setup()
    f.supervisor.hold(true); f.supervisor.invalidQuiescence(true)
    const accepted = f.supervisor.acceptedSignal()
    const action = f.runtime.invoke(f.authority, undefined, f.request('session.prompt', { sessionId: f.header.id,
      mode: 'queue', content: [] }))
      .then(() => 'unexpected-success', () => 'denied')
    await accepted
    await expect(f.harness.ctx.webIdentity.setStatus(f.harness.master, f.authority.principal.userId,
      'BLOCKED')).rejects.toMatchObject({ status: 503 })
    expect(await action).toBe('denied')
    await expect(f.harness.ctx.webIdentity.authenticate(f.harness.users[0]!.token, 'user')).rejects.toMatchObject({ status: 401 })
    await expect(f.runtime.invoke(f.harness.users[1]!.authority, undefined,
      f.request('llm.providers'))).rejects.toMatchObject({ status: 503 })
    expect(f.harness.ctx.logger.buffer.filter(message => message.type === 'error').map((message): unknown[] => message.args))
      .toEqual([['isolated runtime adapter closed: operation %s has no quiescent receipt (trigger: %s, cause: %s)',
        f.supervisor.cancelled[0], 'authority-invalidated', 'WebIdentityError']])
  })
  it('rejects mismatched operation receipts, and a missing operator credential never falls back to the host', async () => {
    const f = await setup()
    f.supervisor.corruptEcho(true)
    await expect(f.runtime.invoke(f.authority, undefined, f.request('llm.providers'))).rejects.toMatchObject({ status: 502 })
    f.supervisor.corruptEcho(false)
    await f.harness.ctx.credentials.unset(credentialRef(FIXTURE_CREDENTIAL))
    await expect(f.runtime.invoke(f.authority, undefined, f.request('llm.providers'))).rejects.toMatchObject({ status: 503 })
  })
  it('reuses mux frames, blocks remote host control events and closes suspended streams on revocation', async () => {
    const f = await setup()
    f.supervisor.frame({ type: 'server-request', rpcId: 'frame-1', method: 'events.mux',
      payload: { type: 'session/subscribed', sessionId: f.header.id, lastSeq: 0 } })
    const controller = new AbortController()
    const stream = f.runtime.streamMux(f.authority, controller.signal)[Symbol.asyncIterator]()
    const next = stream.next()
    await f.runtime.invoke(f.authority, { kind: 'workspace', workspaceId: f.workspace.workspaceId }, f.request('llm.providers'))
    const frame = await next
    if (frame.done) throw new Error('expected a native mux frame')
    expect(frame.value.payload).toEqual({ type: 'session/subscribed', sessionId: f.header.id, lastSeq: 0 })
    await f.harness.ctx.webIdentity.setStatus(f.harness.master, f.authority.principal.userId, 'BLOCKED')
    await stream.return?.()
    expect(f.supervisor.operations.size).toBe(0)
  })
})
