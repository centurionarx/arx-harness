import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { cp, mkdtemp, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import type { ClientRequest } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import * as BrokerHttp from '../src/broker-http.ts'
import { nativeSupervisorFixture } from './native-supervisor.ts'

const resources: { close(): Promise<void> }[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const item of resources.splice(0).reverse()) await item.close()
})
const request = (method: string, payload: unknown = {}): ClientRequest =>
  ({ type: 'client-request', method, payload, rpcId: RpcId(randomUUID()) })
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
async function setup(options: { stopTimeoutMs?: number; cancellationTimeoutMs?: number } = {}) {
  const supervisor = await nativeSupervisorFixture(options.stopTimeoutMs === undefined ? {}
    : { stopTimeoutMs: options.stopTimeoutMs })
  resources.push(supervisor)
  const harness = await seededHarness({ endpoint: supervisor.endpoint, http: true,
    ...(options.cancellationTimeoutMs === undefined ? {}
      : { runtimeConfig: { cancellationTimeoutMs: options.cancellationTimeoutMs } }),
    extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp }] })
  resources.push(harness)
  const authority = harness.users[0]!.authority
  const project = await harness.ctx.projectStorage.createProject(authority, 'Stop owner')
  const workspace = await harness.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Stop workspace')
  const provision = await harness.ctx.projectStorage.provision(authority, workspace.workspaceId)
  supervisor.assign({ controlOrigin: harness.url!, scope: provision.scope, volumePath: provision.volumePath })
  const meta = await harness.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  await harness.ctx.projectStorage.append(authority, meta.id, oneTurnLog())
  const runtime = harness.ctx.isolatedProjectRuntime
  expect(await runtime.invoke(authority, undefined, request('session.create', { sessionId: meta.id })))
    .toMatchObject({ ok: true, value: { sessionId: meta.id } })
  const headers = (operationId: string) => ({ authorization: 'Bearer disposable-supervisor-fixture',
    'x-arx-user-id': authority.principal.userId, 'x-arx-operation-id': operationId })
  const cancel = (operationId: string) => fetch(new URL('/_arx/operations/' + operationId + '/cancel', supervisor.endpoint),
    { method: 'POST', headers: headers(operationId) })
  // A carrier that holds every request until its abort keeps the operation open without reporting quiescence.
  const holdCarrier = () => {
    const carrier = supervisor.carrierOf(workspace.workspaceId)
    if (carrier === undefined) throw new Error('native worker unavailable')
    let held = 0
    vi.spyOn(carrier, 'fetch').mockImplementation(async (input: Request) => {
      held++
      await new Promise<void>((resolve) => {
        input.signal.addEventListener('abort', () => { resolve() }, { once: true })
        if (input.signal.aborted) resolve()
      })
      throw input.signal.reason
    })
    return { get held() { return held } }
  }
  const send = (operationId: string, path: string) => fetch(new URL(path, supervisor.endpoint), { method: 'POST',
    headers: { ...headers(operationId), 'content-type': 'application/json', 'x-arx-workspace-id': workspace.workspaceId },
    body: JSON.stringify(request('llm.providers')) }).then(response => response.status, () => 0)
  return { supervisor, harness, authority, workspace, meta, runtime, cancel, holdCarrier, send }
}
/** Hold every later worker stop of one fixture; the hold ends on `release()` or at test cleanup, before the fixtures close. */
function holdStop(supervisor: Awaited<ReturnType<typeof nativeSupervisorFixture>>) {
  let release!: () => void
  supervisor.holdStop(new Promise<void>((resolve) => { release = resolve }))
  const hold = { release() { supervisor.holdStop(); release() }, async close() { hold.release() } }
  resources.push(hold)
  return hold
}

describe('native supervisor worker stop', () => {
  it('confirms a sibling operation only after the worker stop it belongs to has ended', async () => {
    const f = await setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const carrier = f.holdCarrier()
    const unary = randomUUID(), stream = randomUUID()
    const sent = [f.send(unary, '/api/llm.providers'), f.send(stream, '/api/events.mux')]
    await vi.waitFor(() => { expect(carrier.held).toBe(2) })
    const stop = holdStop(f.supervisor)
    const worker = f.supervisor.ctxOf(f.workspace.workspaceId)
    const first = f.cancel(unary)
    await vi.waitFor(() => { expect(f.supervisor.ctxOf(f.workspace.workspaceId) === undefined).toBe(true) })
    const second = f.cancel(stream).then(response => response.json())
    expect(await Promise.race([second, sleep(300).then(() => 'stop still running')])).toBe('stop still running')
    stop.release()
    expect(await second).toEqual({ operationId: stream, quiescent: true })
    expect(await (await first).json()).toEqual({ operationId: unary, quiescent: true })
    expect(worker !== undefined).toBe(true)
    expect(f.supervisor.forcedStops).toBe(0)
    await Promise.all(sent)
  })

  it('issues the receipt at the stop deadline when a worker disposal does not finish', async () => {
    const f = await setup({ stopTimeoutMs: 300 })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const carrier = f.holdCarrier()
    const unary = randomUUID()
    const sent = f.send(unary, '/api/llm.providers')
    await vi.waitFor(() => { expect(carrier.held).toBe(1) })
    const stop = holdStop(f.supervisor)
    const started = Date.now()
    const receipt = await f.cancel(unary)
    expect(await receipt.json()).toEqual({ operationId: unary, quiescent: true })
    expect(Date.now() - started).toBeGreaterThanOrEqual(290)
    expect(f.supervisor.forcedStops).toBe(1)
    stop.release()
    await sent
    // The forced stop replaced the worker: the next scoped request mounts a new Context.
    expect(await f.runtime.invoke(f.authority, undefined, request('session.history', { sessionId: f.meta.id })))
      .toMatchObject({ ok: true })
  })

  it('closes the control adapter when the receipt arrives after cancellationTimeoutMs', async () => {
    const f = await setup({ stopTimeoutMs: 800, cancellationTimeoutMs: 200 })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const carrier = f.holdCarrier()
    const caller = new AbortController()
    const prompt = f.runtime.invoke(f.authority, undefined, request('session.prompt',
      { sessionId: f.meta.id, mode: 'queue', content: [{ type: 'text', text: 'Held' }] }), caller.signal)
      .then(() => 'answered', () => 'refused')
    await vi.waitFor(() => { expect(carrier.held).toBe(1) })
    holdStop(f.supervisor)
    caller.abort()
    expect(await prompt).toBe('refused')
    // The supervisor is still stopping the worker when control gives up on the receipt.
    expect(f.supervisor.forcedStops).toBe(0)
    expect(f.harness.ctx.logger.buffer.filter(message => message.type === 'error').map((message): unknown[] => message.args.slice(2)))
      .toEqual([['request-failed', 'TimeoutError']])
    await expect(f.runtime.invoke(f.harness.users[1]!.authority, undefined, request('host.describe')))
      .rejects.toMatchObject({ status: 503 })
    await vi.waitFor(() => { expect(f.supervisor.forcedStops).toBe(1) }, { timeout: 3000 })
    // The late receipt does not reopen the adapter.
    await expect(f.runtime.invoke(f.authority, undefined, request('host.describe'))).rejects.toMatchObject({ status: 503 })
  })
})
