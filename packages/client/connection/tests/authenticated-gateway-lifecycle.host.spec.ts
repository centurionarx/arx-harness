/** Real identity providers protect availability and shutdown races at the native boundary. */
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { Context } from '@arx-ai/cordis'
import WebSocket from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER, WebIdentityError } from '@arx-ai/arx-web-identity'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import { supervisorFixture } from '../../../host/isolated-project-runtime/tests/supervisor.ts'
import { AuthenticatedGateway, authenticationProblem } from '../src/authenticated-gateway.ts'
import { WebSocketDownlinks } from '../src/websocket-downlink.ts'
import { HOST_EVENTS_PATH, MUX_EVENTS_PATH } from '../src/api-path.ts'

const resources: { close(): Promise<void> }[] = []
afterEach(async () => {
  try { for (const item of resources.splice(0).reverse()) await item.close() }
  finally { vi.restoreAllMocks() }
})
async function fixture(audience: 'user' | 'admin' = 'user') {
  const f = await identityHarness({ api: audience, readyUsers: audience === 'user' ? 1 : 0 })
  resources.push(f)
  const authority = audience === 'user' ? f.users[0]!.authority : f.master!
  const login = audience === 'user' ? undefined : await f.ctx.webIdentity.login('arxadmin', f.passwords.master, 'admin')
  const state = await f.ctx.webIdentity.state(authority)
  const token = audience === 'user' ? f.users[0]!.token : login!.token
  const live = audience === 'user' ? state : login!.state
  const headers = { origin: f.url!, host: new URL(f.url!).host, [AUTH_HEADER]: '1', [CSRF_HEADER]: live.csrfToken,
    cookie: AUTH_COOKIE_NAMES[audience] + '=' + token }
  return { ...f, headers, gateway: new AuthenticatedGateway(f.ctx) }
}
function request(url: string, headers: HeadersInit, method = 'GET'): Request {
  return new Request(url, { method, headers })
}
async function refusal(url: string, headers: Record<string, string>): Promise<number> {
  const socket = new WebSocket(url, { headers })
  socket.on('error', () => {})
  return new Promise<number>((resolve, reject) => {
    socket.once('open', () => { socket.terminate(); reject(new Error('Unexpected accepted handshake')) })
    socket.once('unexpected-response', (req, res) => {
      res.resume(); req.destroy(); socket.terminate()
      resolve(res.statusCode!)
    })
  })
}
describe('authenticated gateway lifecycle', () => {
  it('returns closed availability problems when providers or the runtime are absent', async () => {
    const absent = new AuthenticatedGateway(new Context())
    expect((await absent.fetch(request('https://missing.fixture.test/api/example', {}))).status).toBe(503)
    await absent.close()
    expect((await absent.fetch(request('https://missing.fixture.test/api/example', {}))).status).toBe(503)
    const identityOnly = await identityHarness({ readyUsers: 1 })
    resources.push(identityOnly)
    expect((await new AuthenticatedGateway(identityOnly.ctx).fetch(request('https://missing.fixture.test/api/example', {}))).status).toBe(503)
    const f = await fixture()
    expect((await f.gateway.fetch(request(f.url! + '/api/example', f.headers))).status).toBe(503)
    const unregister = f.ctx.webServer.registerUpgrade({ path: '/carrier',
      handler: (req, socket, head) => f.gateway.upgrade('mux', req, socket, head) })
    try { expect(await refusal(f.url!.replace('http:', 'ws:') + '/carrier', f.headers)).toBe(503) }
    finally { unregister(); await f.gateway.close() }
  }, 30000)

  it('requires upgrades for each native event stream and refuses the real administrative audience', async () => {
    const f = await fixture()
    for (const path of [MUX_EVENTS_PATH, HOST_EVENTS_PATH]) {
      const response = await f.gateway.fetch(request(f.url! + path, f.headers))
      expect(response.status).toBe(426)
      expect(response.headers.get('upgrade')).toBe('websocket')
    }
    const admin = await fixture('admin')
    expect((await admin.gateway.fetch(request(admin.url! + '/api/host.describe', admin.headers))).status).toBe(403)
    await f.gateway.close(); await admin.gateway.close()
  }, 30000)

  it('does not dispatch a request authenticated just before gateway shutdown', async () => {
    const f = await fixture()
    const original = f.ctx.webIdentityApi.authenticateRequest.bind(f.ctx.webIdentityApi)
    let entered!: () => void, release!: () => void
    const authenticated = new Promise<void>((resolve) => { entered = resolve })
    const pending = new Promise<void>((resolve) => { release = resolve })
    vi.spyOn(f.ctx.webIdentityApi, 'authenticateRequest').mockImplementation(async (req, options) => {
      const realAuthority = await original(req, options)
      entered()
      await pending
      return realAuthority
    })
    const response = f.gateway.fetch(request(f.url! + '/api/host.describe', f.headers))
    await authenticated
    await f.gateway.close()
    release()
    expect((await response).status).toBe(503)
  }, 30000)

  it('refuses an upgrade when shutdown starts after its last authority validation', async () => {
    const supervisor = await supervisorFixture()
    resources.push(supervisor)
    const f = await storageHarness({ http: true, endpoint: supervisor.endpoint })
    resources.push(f)
    const user = f.users[0]!
    const headers = { origin: f.url!, cookie: AUTH_COOKIE_NAMES.user + '=' + user.token, [AUTH_HEADER]: '1' }
    const gateway = new AuthenticatedGateway(f.ctx)
    const revalidate = f.ctx.webIdentity.revalidate.bind(f.ctx.webIdentity)
    let scheduled = false, closing: Promise<void> | undefined
    vi.spyOn(f.ctx.webIdentity, 'revalidate').mockImplementation(async (...args) => {
      const authority = await revalidate(...args)
      if (!scheduled) {
        scheduled = true
        queueMicrotask(() => { queueMicrotask(() => { closing = gateway.close() }) })
      }
      return authority
    })
    const stream = vi.spyOn(f.ctx.isolatedProjectRuntime, 'streamHost')
    const unregister = f.ctx.webServer.registerUpgrade({ path: '/carrier',
      handler: (req, socket, head) => gateway.upgrade('host', req, socket, head) })
    try {
      expect(await refusal(f.url!.replace('http:', 'ws:') + '/carrier', headers)).toBe(503)
      expect(closing).toBeDefined()
      await closing
      expect(stream).not.toHaveBeenCalled()
      expect(supervisor.operations.size).toBe(0)
    } finally { unregister(); await closing; await gateway.close() }
  }, 30000)

  it('awaits real stream shutdown once and reports an injected post-cleanup disposal failure', async () => {
    const supervisor = await supervisorFixture()
    resources.push(supervisor)
    const f = await storageHarness({ http: true, endpoint: supervisor.endpoint })
    resources.push(f)
    const user = f.users[0]!
    const state = await f.ctx.webIdentity.state(user.authority)
    const headers = { origin: f.url!, cookie: AUTH_COOKIE_NAMES.user + '=' + user.token,
      [AUTH_HEADER]: '1', [CSRF_HEADER]: state.csrfToken }
    const project = await f.ctx.projectStorage.createProject(user.authority, 'Lifecycle fixture')
    const workspace = await f.ctx.projectStorage.createWorkspace(user.authority, project.projectId, 'Lifecycle workspace')
    const header = await f.ctx.projectStorage.register(user.authority, workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1000 })
    supervisor.frame({ type: 'server-request', rpcId: randomUUID(), method: 'events.host',
      payload: { type: 'host/session-status', sessionId: header.id, running: true } })
    const gateway = new AuthenticatedGateway(f.ctx)
    const unregister = f.ctx.webServer.registerUpgrade({ path: '/carrier',
      handler: (req, socket, head) => gateway.upgrade('host', req, socket, head) })
    const close: unknown = Object.getOwnPropertyDescriptor(WebSocketDownlinks.prototype, 'close')?.value
    if (typeof close !== 'function') throw new Error('Fixture expected the real downlink close method')
    vi.spyOn(WebSocketDownlinks.prototype, 'close').mockImplementation(async function (this: WebSocketDownlinks) {
      await Reflect.apply(close, this, [])
      throw new Error('fixture failure after real socket and pump cleanup')
    })
    const socket = new WebSocket(f.url!.replace('http:', 'ws:') + '/carrier', { headers })
    socket.on('error', () => {})
    try {
      await once(socket, 'open')
      // A later workspace-scoped request attaches that workspace's sub-stream once the downlink is registered.
      await vi.waitFor(async () => {
        await f.ctx.isolatedProjectRuntime.invoke(user.authority, undefined, { type: 'client-request',
          rpcId: RpcId(randomUUID()), method: 'session.history', payload: { sessionId: header.id } })
        expect(supervisor.operations.size).toBe(1)
      })
      const closed = once(socket, 'close')
      await expect(gateway.close()).rejects.toThrow('Authenticated downlink disposal failed')
      await closed
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      expect(supervisor.operations.size).toBe(0)
      await expect(gateway.close()).rejects.toThrow('Authenticated downlink disposal failed')
    } finally { socket.terminate(); unregister() }
  }, 30000)

  it('refuses a real authenticated WebSocket when its provider fails unexpectedly', async () => {
    const f = await fixture()
    const original = f.ctx.webIdentityApi.authenticateRequest.bind(f.ctx.webIdentityApi)
    vi.spyOn(f.ctx.webIdentityApi, 'authenticateRequest').mockImplementation(async (req, options) => {
      await original(req, options)
      throw new Error('fixture provider unavailable after actual authentication')
    })
    const unregister = f.ctx.webServer.registerUpgrade({ path: '/carrier',
      handler: (req, socket, head) => f.gateway.upgrade('mux', req, socket, head) })
    try { expect(await refusal(f.url!.replace('http:', 'ws:') + '/carrier', f.headers)).toBe(503) }
    finally { unregister(); await f.gateway.close() }
  }, 30000)

  it('does not reflect arbitrary exception text and folds unsupported status codes', async () => {
    const unknown = authenticationProblem(new Error('fixture-secret-must-not-be-reflected'))
    expect(unknown.status).toBe(503)
    expect(await unknown.json()).toEqual({ error: { code: 'AUTH_UNAVAILABLE', message: 'Request unavailable' } })
    const unsupported = authenticationProblem(new WebIdentityError('AUTH_ABORTED', 499, 'fixture-secret-must-not-be-reflected'))
    expect(unsupported.status).toBe(503)
    expect(await unsupported.json()).toEqual({ error: { code: 'AUTH_ABORTED', message: 'Request unavailable' } })
  })
})
