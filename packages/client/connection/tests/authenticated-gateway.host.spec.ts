/** Native auth reaches real Loader providers and HTTP, never a shared-host fallback. */
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER } from '@arx-ai/arx-web-identity'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import { supervisorFixture } from '../../../host/isolated-project-runtime/tests/supervisor.ts'
import * as Connection from '../src/index.ts'

function envelopeField(value: unknown, key: 'result' | 'payload'): unknown {
  if (typeof value === 'object' && value !== null) {
    if (key === 'result' && 'result' in value) return value.result
    if (key === 'payload' && 'payload' in value) return value.payload
  }
  throw new Error('Fixture expected the real transport envelope')
}

const resources: { close(): Promise<void> }[] = []
afterEach(async () => { for (const item of resources.splice(0).reverse()) await item.close() })

async function setup(configured = true) {
  const supervisor = await supervisorFixture()
  resources.push(supervisor)
  const fixture = await storageHarness({
    http: true,
    ...(configured ? { endpoint: supervisor.endpoint } : {}),
    extraPlugins: [{ name: '@arx-ai/arx-client-connection', plugin: Connection, config: { accessMode: 'authenticated' } }],
  })
  resources.push(fixture)
  const user = fixture.users[0]!
  const state = await fixture.ctx.webIdentity.state(user.authority)
  const headers = {
    'content-type': 'application/json',
    origin: fixture.url!,
    [AUTH_HEADER]: '1',
    [CSRF_HEADER]: state.csrfToken,
    cookie: AUTH_COOKIE_NAMES.user + '=' + user.token,
  }
  const project = await fixture.ctx.projectStorage.createProject(user.authority, 'USER A')
  const workspace = await fixture.ctx.projectStorage.createWorkspace(user.authority, project.projectId, 'Workspace A')
  const header = await fixture.ctx.projectStorage.register(user.authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1000 })
  const request = (method: string, payload: unknown = {}) => ({
    type: 'client-request', rpcId: RpcId(randomUUID()), method, payload,
  })
  const post = (method: string, payload: unknown = {}, supplied: Record<string, string> = headers, channel = '/api') =>
    fetch(fixture.url! + channel + '/' + method, { method: 'POST', headers: supplied, body: JSON.stringify(request(method, payload)) })
  return { fixture, supervisor, user, headers, header, workspace, request, post }
}

async function refusedSocket(url: string, headers: Record<string, string>): Promise<number> {
  const socket = new WebSocket(url, { headers })
  socket.on('error', () => {})
  return new Promise<number>((resolve, reject) => {
    socket.once('open', () => { socket.terminate(); reject(new Error('Unexpected accepted handshake')) })
    socket.once('unexpected-response', (request, response) => {
      const status = response.statusCode
      response.resume()
      request.destroy()
      socket.terminate()
      if (status === undefined) reject(new Error('Missing refusal status'))
      else resolve(status)
    })
  })
}

describe('authenticated Connection composed with native providers', () => {
  it('enforces cookies, CSRF, origin, owner and method policy before both generic and API handlers', async () => {
    const f = await setup()
    let hostCalls = 0
    const handler = async () => { hostCalls++; return { ok: true as const, value: { operatorSecret: 'must-never-leave-control' } } }
    f.fixture.ctx.connection.rpc.intercept('/api', () => true, handler, { authority: 'loopback' })
    f.fixture.ctx.connection.rpc.handle('/private-control', handler, { authority: 'loopback' })
    expect(f.fixture.ctx.get('apiProxy')).toBeUndefined()
    const earlyRefusal = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(f.fixture.url! + '/api/host.describe', {
        method: 'POST', headers: { origin: f.fixture.url!, 'content-type': 'application/json', 'content-length': '314572801' },
      }, (response) => {
        response.resume()
        response.once('end', () => { resolve(response.statusCode!); request.destroy() })
      })
      request.on('error', reject)
      request.flushHeaders()
    })
    expect(earlyRefusal).toBe(401)

    expect((await f.post('host.describe', {}, { 'content-type': 'application/json', origin: f.fixture.url! })).status).toBe(401)
    expect((await f.post('host.describe', {}, { ...f.headers, [CSRF_HEADER]: 'incorrect' })).status).toBe(403)
    expect((await f.post('host.describe', {}, { ...f.headers, origin: 'https://foreign.invalid' })).status).toBe(403)
    expect((await f.post('credentials.describe')).status).toBe(403)
    expect((await f.post('unknown.call')).status).toBe(403)
    expect((await f.post('any.call', {}, f.headers, '/private-control')).status).toBe(403)
    const other = f.fixture.users[1]!
    const otherState = await f.fixture.ctx.webIdentity.state(other.authority)
    expect((await f.post('session.history', { sessionId: f.header.id }, { ...f.headers,
      cookie: AUTH_COOKIE_NAMES.user + '=' + other.token, [CSRF_HEADER]: otherState.csrfToken })).status).toBe(403)
    await expect(f.fixture.ctx.webIdentity.login('arxadmin', f.fixture.passwords.master, 'user')).rejects.toMatchObject({ status: 401 })
    f.supervisor.result({ isolated: true })
    const accepted = await f.post('host.describe')
    expect(accepted.status).toBe(200)
    expect(accepted.headers.get('cache-control')).toBe('no-store')
    expect(envelopeField(await accepted.json(), 'result')).toEqual({ ok: true, value: { isolated: true } })
    expect(f.supervisor.accepted).toHaveLength(1)
    expect(hostCalls).toBe(0)
  }, 30000)

  it('keeps an unconfigured isolated endpoint unavailable rather than selecting an operator handler', async () => {
    const f = await setup(false)
    let hostCalls = 0
    f.fixture.ctx.connection.rpc.intercept('/api', () => true, async () => { hostCalls++; return { ok: true, value: {} } }, { authority: 'loopback' })
    const response = await f.post('host.describe')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: { code: 'RUNTIME_UNAVAILABLE', message: 'Request unavailable' } })
    expect(hostCalls).toBe(0)
    expect(f.supervisor.accepted).toEqual([])
  }, 30000)

  it('seals both WebSocket handshakes and closes owner streams after awaited revocation', async () => {
    const f = await setup()
    const wsOrigin = f.fixture.url!.replace('http:', 'ws:')
    for (const path of [Connection.MUX_EVENTS_PATH, Connection.HOST_EVENTS_PATH]) {
      expect(await refusedSocket(wsOrigin + path, { origin: f.fixture.url! })).toBe(401)
      expect(await refusedSocket(wsOrigin + path, { origin: 'https://foreign.invalid', cookie: f.headers.cookie })).toBe(403)
    }
    f.supervisor.frame({ type: 'server-request', rpcId: 'mux-frame', method: 'events.mux',
      payload: { type: 'session/subscribed', sessionId: f.header.id, lastSeq: 0 } })
    const mux = new WebSocket(wsOrigin + Connection.MUX_EVENTS_PATH, { headers: { origin: f.fixture.url!, cookie: f.headers.cookie } })
    mux.on('error', () => {})
    const muxMessage = once(mux, 'message')
    await once(mux, 'open')
    expect(envelopeField(JSON.parse(String((await muxMessage)[0])), 'payload')).toEqual({ type: 'session/subscribed', sessionId: f.header.id, lastSeq: 0 })
    f.supervisor.frame({ type: 'server-request', rpcId: 'host-frame', method: 'events.host',
      payload: { type: 'host/session-status', sessionId: f.header.id, running: true } })
    const host = new WebSocket(wsOrigin + Connection.HOST_EVENTS_PATH, { headers: { origin: f.fixture.url!, cookie: f.headers.cookie } })
    host.on('error', () => {})
    const hostMessage = once(host, 'message')
    await once(host, 'open')
    expect(envelopeField(JSON.parse(String((await hostMessage)[0])), 'payload')).toEqual({ type: 'host/session-status', sessionId: f.header.id, running: true })
    expect(f.supervisor.operations.size).toBe(2)
    const closed = Promise.all([once(mux, 'close'), once(host, 'close')])
    await f.fixture.ctx.webIdentity.setStatus(f.fixture.master!, f.user.userId, 'BLOCKED')
    await closed
    expect(f.supervisor.operations.size).toBe(0)
    expect((await f.post('host.describe')).status).toBe(401)
  }, 30000)
})
