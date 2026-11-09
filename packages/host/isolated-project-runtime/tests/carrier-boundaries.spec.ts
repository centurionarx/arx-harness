import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { IncomingMessage, request as httpRequest } from 'node:http'
import { subscribe, unsubscribe } from 'node:diagnostics_channel'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import type { ClientRequest } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { ModuleId } from '@arx-ai/arx-web-identity'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import * as BrokerHttp from '../src/broker-http.ts'
import { WORKER_BROKER_PATH, WORKER_CAPABILITY_HEADER } from '../src/broker-contract.ts'
import { supervisorFixture } from './supervisor.ts'

const resources: { close(): Promise<void> }[] = []
afterEach(async () => { for (const item of resources.splice(0).reverse()) await item.close() })
async function setup(runtimeConfig: NonNullable<Parameters<typeof storageHarness>[0]>['runtimeConfig'] = {}, readyUsers = 1) {
  const supervisor = await supervisorFixture(); resources.push(supervisor)
  const h = await storageHarness({ endpoint: supervisor.endpoint, readyUsers, http: true, runtimeConfig,
    extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp }] }); resources.push(h)
  const authority = h.users[0]!.authority
  const project = await h.ctx.projectStorage.createProject(authority, 'Owner')
  const workspace = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Workspace')
  const meta = await h.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  const request = (method: string, payload: unknown = {}): ClientRequest => ({ type: 'client-request', method, payload, rpcId: RpcId(randomUUID()) })
  // A workspace-scoped request attaches that workspace's sub-stream to every open downlink; its own reply may fail.
  const attach = () => h.ctx.isolatedProjectRuntime.invoke(authority, { kind: 'workspace', workspaceId: workspace.workspaceId },
    request('llm.providers')).then(() => undefined, () => undefined)
  return { supervisor, h, authority, project, workspace, meta, request, attach, runtime: h.ctx.isolatedProjectRuntime }
}
describe('isolated carrier limits and private broker admission', () => {
  it.each([
    { endpoint: 'http://external.invalid', credentialRef: 'ARX_FIXTURE', fixtureLoopback: true },
    { endpoint: 'http://127.0.0.1', credentialRef: 'ARX_FIXTURE', fixtureLoopback: false },
    { endpoint: 'https://user@fixture.invalid', credentialRef: 'ARX_FIXTURE' },
    { endpoint: 'https://:password@fixture.invalid', credentialRef: 'ARX_FIXTURE' },
    { endpoint: 'https://fixture.invalid/path', credentialRef: 'ARX_FIXTURE' },
    { endpoint: 'https://fixture.invalid/?query=1', credentialRef: 'ARX_FIXTURE' },
    { endpoint: 'https://fixture.invalid/#hash', credentialRef: 'ARX_FIXTURE' },
    { endpoint: 'https://fixture.invalid', credentialRef: undefined },
    { endpoint: undefined, credentialRef: 'ARX_FIXTURE' },
  ])('rejects operator configuration that is not one explicit credential-free origin: $endpoint', async (runtimeConfig) => {
    await expect(storageHarness({ readyUsers: 0, runtimeConfig })).rejects.toThrow()
  })
  it('rejects unsupported carrier methods, empty responses and oversized browser bodies before dispatch', async () => {
    const f = await setup({ maxRequestBytes: 200 })
    await expect(f.runtime.fetch(f.authority, new Request('http://fixture/api/host.describe'))).rejects.toMatchObject({ status: 403 })
    await expect(f.runtime.fetch(f.authority, new Request('http://fixture/elsewhere', { method: 'POST' }))).rejects.toMatchObject({ status: 403 })
    await expect(f.runtime.fetch(f.authority, new Request('http://fixture/api/respond', { method: 'POST',
      headers: { 'content-type': 'application/json' } }))).rejects.toThrow()
    await expect(f.runtime.fetch(f.authority, new Request('http://fixture/api/respond', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: 'null' }))).rejects.toMatchObject({ status: 400 })
    await expect(f.runtime.fetch(f.authority, new Request('http://fixture/api/host.describe', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: 'x'.repeat(201) }))).rejects.toMatchObject({ status: 502, code: 'RUNTIME_LIMIT' })
    await expect(f.runtime.invoke(f.authority, undefined, f.request('session.prompt',
      { sessionId: f.meta.id, mode: 'queue', content: [{ type: 'text', text: 'x'.repeat(300) }] }))).rejects.toMatchObject({ status: 413 })
    expect(f.supervisor.accepted).toEqual([])
  })
  it('bounds actual worker responses and validates export receipt selection for GET and HEAD', async () => {
    const f = await setup({ maxResponseBytes: 300 })
    f.supervisor.result({ text: 'x'.repeat(1000) })
    await expect(f.runtime.invoke(f.authority, undefined, f.request('llm.providers'))).rejects.toMatchObject({ status: 502, code: 'RUNTIME_LIMIT' })
    await expect(f.runtime.fetch(f.authority, new Request('http://fixture/api/session.export'))).rejects.toMatchObject({ status: 400 })
    await expect(f.runtime.fetch(f.authority, new Request('http://fixture/api/session.export?sessionId=' + f.meta.id + '&path=/etc')))
      .rejects.toMatchObject({ status: 400 })
    for (const selection of [null, 'none', [], [42]]) {
      f.supervisor.result(selection)
      await expect(f.runtime.fetch(f.authority, new Request('http://fixture/api/session.export?sessionId=' + f.meta.id)))
        .rejects.toMatchObject({ status: 502 })
    }
    f.supervisor.result([f.meta.id])
    const head = await f.runtime.fetch(f.authority, new Request('http://fixture/api/session.export?sessionId=' + f.meta.id, { method: 'HEAD' }))
    expect(head.status).toBe(200); expect(await head.text()).toBe('')
    const get = await f.runtime.fetch(f.authority, new Request('http://fixture/api/session.export?sessionId=' + f.meta.id))
    expect(await get.text()).toBe('fixture-zip'); expect(get.headers.get('x-arx-operation-id')).toBeNull()
  })
  it('answers a genuine Node HTTP TRACE conversion failure without allocating any owner resource', async () => {
    const f = await setup()
    const origin = f.h.url
    if (origin === undefined) throw new Error('real broker HTTP origin missing')
    const before = await f.h.ctx.projectStorage.list(f.authority, { kind: 'workspace', workspaceId: f.workspace.workspaceId })
    const response = await new Promise<{
      status: number | undefined
      cacheControl: string | undefined
      text: string
    }>((resolve, reject) => {
      const client = httpRequest(origin, { method: 'TRACE', path: WORKER_BROKER_PATH, agent: false }, (incoming) => {
        let text = ''
        incoming.setEncoding('utf8')
        incoming.on('data', (chunk: string) => { text += chunk })
        incoming.once('error', reject)
        incoming.once('end', () => { resolve({ status: incoming.statusCode, cacheControl: incoming.headers['cache-control'], text }) })
      })
      client.once('error', reject)
      client.end()
    })
    expect(response).toEqual({ status: 503, cacheControl: 'no-store', text: '' })
    expect((await f.h.ctx.projectStorage.list(f.authority, { kind: 'workspace', workspaceId: f.workspace.workspaceId })).sessions)
      .toEqual(before.sessions)
    expect(f.supervisor.accepted).toEqual([])
  })
  it('sends a genuine project scope without inventing a workspace and refuses a sibling-workspace resume', async () => {
    const f = await setup()
    const seen: { project: string | string[] | undefined; workspace: string | string[] | undefined }[] = []
    const observer = (value: unknown) => {
      if (typeof value !== 'object' || value === null || !('request' in value) || !(value.request instanceof IncomingMessage)) return
      const incoming = value.request
      if (incoming.url === '/api/llm.providers' && incoming.headers['x-arx-user-id'] === f.authority.principal.userId) {
        seen.push({ project: incoming.headers['x-arx-project-id'], workspace: incoming.headers['x-arx-workspace-id'] })
      }
    }
    subscribe('http.server.request.start', observer)
    try {
      expect(await f.runtime.invoke(f.authority, { kind: 'project', projectId: f.project.projectId }, f.request('llm.providers')))
        .toEqual({ ok: true, value: {} })
    } finally { unsubscribe('http.server.request.start', observer) }
    expect(seen).toEqual([{ project: f.project.projectId, workspace: undefined }])
    const sibling = await f.h.ctx.projectStorage.createWorkspace(f.authority, f.project.projectId, 'Sibling own workspace')
    const accepted = [...f.supervisor.accepted]
    await expect(f.runtime.invoke(f.authority, { kind: 'project', projectId: f.project.projectId },
      f.request('session.create', { sessionId: f.meta.id, workspaceId: sibling.workspaceId })))
      .rejects.toMatchObject({ status: 403, message: 'Session workspace differs' })
    expect(f.supervisor.accepted).toEqual(accepted)
    expect(await f.h.ctx.webIdentity.authorizeOwner(f.authority, { kind: 'session', sessionId: f.meta.id }))
      .toMatchObject({ workspaceId: f.workspace.workspaceId })
  })
  it('refuses a missing export manifest and keeps a nonquiescent export lease until its real cancellation receipt', async () => {
    const f = await setup()
    const request = () => new Request('http://fixture/api/session.export?sessionId=' + f.meta.id)
    f.supervisor.rawReply('fixture-zip', { 'content-type': 'application/zip' })
    await expect(f.runtime.fetch(f.authority, request())).rejects.toMatchObject({ status: 502, code: 'RUNTIME_PROTOCOL' })
    f.supervisor.rawReply('fixture-zip', { 'content-type': 'application/zip',
      'x-arx-export-sessions': JSON.stringify([f.meta.id]), 'x-arx-quiescent': 'false' })
    expect(await (await f.runtime.fetch(f.authority, request())).text()).toBe('fixture-zip')
    const cancelled = f.supervisor.cancelledSignal()
    await f.runtime.quiesce(f.authority.principal.userId)
    await cancelled
    expect(await f.h.ctx.webIdentity.revalidate(f.authority)).toBe(f.authority)
    f.supervisor.resetReply()
    expect(await f.runtime.invoke(f.authority, undefined, f.request('llm.providers'))).toEqual({ ok: true, value: {} })
  })
  it('enforces module grants again before every carrier and private broker request', async () => {
    const f = await setup()
    await f.h.ctx.webIdentity.setModules(f.h.master!, f.authority.principal.userId, [ModuleId('storage')])
    const login = await f.h.ctx.webIdentity.login(f.h.users[0]!.username, f.h.users[0]!.password, 'user')
    const authority = await f.h.ctx.webIdentity.authenticate(login.token, 'user')
    await expect(f.runtime.invoke(authority, undefined, f.request('llm.providers'))).rejects.toMatchObject({ status: 403, code: 'MODULE_DENIED' })
    expect(await f.runtime.invoke(authority, undefined, f.request('session.history', { sessionId: f.meta.id }))).toEqual({ ok: true, value: {} })
  })
  it('admits only the private closed broker contract and refuses oversize HTTP before any tool/history effects', async () => {
    const f = await setup({ maxRequestBytes: 1024 })
    const broker = (path: string, method: string, body?: string, headers?: Record<string, string>) =>
      f.runtime.broker(new Request('http://fixture' + path, { method, ...(headers === undefined ? {} : { headers }), ...(body === undefined ? {} : { body }) }))
    expect((await broker(WORKER_BROKER_PATH, 'GET')).status).toBe(404)
    expect((await broker('/unknown', 'POST')).status).toBe(404)
    expect((await broker(WORKER_BROKER_PATH, 'POST')).status).toBe(415)
    expect((await broker(WORKER_BROKER_PATH, 'POST', '{}', { 'content-type': 'application/json' })).status).toBe(403)
    expect((await fetch(f.h.url! + WORKER_BROKER_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(1025) })).status).toBe(413)
    f.supervisor.hold(true)
    const accepted = f.supervisor.acceptedSignal()
    const pending = f.runtime.invoke(f.authority, undefined, f.request('session.prompt', { sessionId: f.meta.id, mode: 'queue', content: [] }))
      .then(() => 'unexpected', () => 'cancelled')
    await accepted
    const operation = [...f.supervisor.operations.values()][0]!
    const headers = { 'content-type': 'application/json', [WORKER_CAPABILITY_HEADER]: operation.capability }
    expect((await broker(WORKER_BROKER_PATH, 'POST', '{bad', headers)).status).toBe(503)
    expect((await broker(WORKER_BROKER_PATH, 'POST', '{}', headers)).status).toBe(400)
    expect((await broker(WORKER_BROKER_PATH, 'POST', undefined, headers)).status).toBe(503)
    expect((await broker(WORKER_BROKER_PATH, 'POST', 'x'.repeat(1025), headers)).status).toBe(502)
    const exiting = once(operation.child!, 'close')
    await f.runtime.quiesce(f.authority.principal.userId); await exiting
    expect(await pending).toBe('cancelled')
    expect((await broker(WORKER_BROKER_PATH, 'POST', '{}', headers)).status).toBe(403)
  })
  it('preserves canonical RPC errors, rejects mismatched correlation and refuses empty/malformed peer bodies', async () => {
    const f = await setup()
    const input = f.request('session.history', { sessionId: f.meta.id })
    const canonical = { ok: false, error: { code: 'session-not-found', message: 'fixture failure', details: { sessionId: f.meta.id } } }
    f.supervisor.rawReply(JSON.stringify({ type: 'server-response', rpcId: input.rpcId, result: canonical }))
    expect(await f.runtime.invoke(f.authority, undefined, input)).toEqual(canonical)
    f.supervisor.rawReply(JSON.stringify({ type: 'server-response', rpcId: 'wrong-rpc', result: { ok: true, value: [] } }))
    await expect(f.runtime.invoke(f.authority, undefined, f.request('llm.providers'))).rejects.toMatchObject({ status: 502 })
    f.supervisor.rawReply('', {}, 204)
    await expect(f.runtime.invoke(f.authority, undefined, f.request('llm.providers'))).rejects.toThrow()
    f.supervisor.rawReply('bad JSON')
    await expect(f.runtime.invoke(f.authority, undefined, f.request('llm.providers'))).rejects.toThrow()
    f.supervisor.rawReply('refused', {}, 503)
    await expect(f.runtime.invoke(f.authority, undefined, f.request('llm.providers'))).rejects.toMatchObject({ status: 502 })
  })
  it('accepts only allowed neutral/owned host Remote events and bounds each SSE frame before parsing', async () => {
    const f = await setup({ maxResponseBytes: 600 })
    const frame = (event: string, args: unknown[]) => ({ type: 'server-request', rpcId: randomUUID(),
      method: 'events.host', payload: { type: 'host/remote-event', event, args } })
    const values = [frame('credentials/change', []), frame('commands/change', []),
      frame('agent-preset/selected', [f.meta.id, 'owned-preset']), frame('settings/document-updated', ['private-global'])]
    f.supervisor.rawReply(values.map(value => 'data: ' + JSON.stringify(value) + '\n\n').join(''), { 'content-type': 'text/event-stream' })
    const controller = new AbortController(), seen: unknown[] = []
    const downlink = f.runtime.streamHost(f.authority, controller.signal)
    const collected = (async () => { for await (const value of downlink) seen.push(value.payload) })()
    await f.attach()
    await collected
    expect(seen).toEqual([values[1]!.payload, values[2]!.payload])
    f.supervisor.rawReply('', { 'content-type': 'text/event-stream' }, 204)
    const empty = f.runtime.streamHost(f.authority, controller.signal)[Symbol.asyncIterator]().next()
    await Promise.all([expect(empty).rejects.toMatchObject({ status: 502 }), f.attach()])
    f.supervisor.rawReply('data: ' + 'x'.repeat(601), { 'content-type': 'text/event-stream' })
    const bounded = f.runtime.streamMux(f.authority, controller.signal)[Symbol.asyncIterator]().next()
    await Promise.all([expect(bounded).rejects.toMatchObject({ status: 502, code: 'RUNTIME_LIMIT' }), f.attach()])
  })
  it('refuses the final dispatch when another USER cancellation fails between genuine revalidation and dispatch continuation', async () => {
    const f = await setup({}, 2)
    const other = f.h.users[1]
    if (other === undefined) throw new Error('second actual USER missing')
    const project = await f.h.ctx.projectStorage.createProject(other.authority, 'Cancellation owner')
    const workspace = await f.h.ctx.projectStorage.createWorkspace(other.authority, project.projectId, 'Cancellation workspace')
    const meta = await f.h.ctx.projectStorage.register(other.authority, workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 2 })
    f.supervisor.hold(true)
    const accepted = f.supervisor.acceptedSignal()
    const otherOutcome = f.runtime.invoke(other.authority, undefined,
      f.request('session.prompt', { sessionId: meta.id, mode: 'queue', content: [] })).then(() => 'unexpected', () => 'cancelled')
    await accepted
    const operation = [...f.supervisor.operations.values()].find(value => value.userId === other.userId)
    if (operation === undefined) throw new Error('actual second USER child lease missing')
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    const fetchOriginal = globalThis.fetch.bind(globalThis)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
      const response = await fetchOriginal(...args)
      const path = new URL(args[0] instanceof Request ? args[0].url : String(args[0])).pathname
      if (path === '/_arx/operations/' + operation.id + '/cancel') {
        expect(response.status).toBe(503)
        entered.resolve(undefined)
        await release.promise
      }
      return response
    })
    const revalidateOriginal = f.h.ctx.webIdentity.revalidate.bind(f.h.ctx.webIdentity)
    let validations = 0
    const revalidateSpy = vi.spyOn(f.h.ctx.webIdentity, 'revalidate').mockImplementation(async (...args) => {
      const value = await revalidateOriginal(...args)
      if (value.principal.userId === f.authority.principal.userId && ++validations === 4) release.resolve(undefined)
      return value
    })
    try {
      f.supervisor.cancelStatus(503)
      const quiescence = f.runtime.quiesce(other.userId).then(() => undefined, (error: unknown) => error)
      await entered.promise
      f.supervisor.cancelStatus(200)
      f.supervisor.hold(false)
      await expect(f.runtime.invoke(f.authority, undefined, f.request('llm.providers')))
        .rejects.toMatchObject({ status: 503, code: 'RUNTIME_UNAVAILABLE' })
      expect(validations).toBe(4)
      expect(await quiescence).toMatchObject({ status: 503, code: 'RUNTIME_QUIESCENCE' })
      expect(await otherOutcome).toBe('cancelled')
      expect(f.supervisor.accepted.filter(value => value.method === 'llm.providers')).toEqual([])
    } finally { release.resolve(undefined); revalidateSpy.mockRestore(); fetchSpy.mockRestore() }
  })
  it('marks failed HTTP quiescence as unsafe and admits no further execution after the barrier settles', async () => {
    const f = await setup()
    f.supervisor.hold(true); f.supervisor.cancelStatus(503)
    const accepted = f.supervisor.acceptedSignal()
    const outcome = f.runtime.invoke(f.authority, undefined, f.request('session.prompt', { sessionId: f.meta.id, mode: 'queue', content: [] }))
      .then(() => 'unexpected', () => 'cancelled')
    await accepted
    await expect(f.runtime.quiesce(f.authority.principal.userId)).rejects.toMatchObject({ status: 503 })
    expect(await outcome).toBe('cancelled')
    await expect(f.runtime.invoke(f.authority, undefined, f.request('llm.providers'))).rejects.toMatchObject({ status: 503 })
  })

})
