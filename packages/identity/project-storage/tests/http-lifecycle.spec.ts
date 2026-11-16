import { afterEach, beforeEach, describe, expect, it, vi, afterAll, beforeAll } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { subscribe, unsubscribe } from 'node:diagnostics_channel'
import { IncomingMessage, ServerResponse, request as httpRequest } from 'node:http'
import { readFile, cp, mkdtemp, rm } from 'node:fs/promises'
import { setImmediate as nextTick } from 'node:timers/promises'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER } from '@arx-ai/arx-web-identity/contract'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import { storageHarness } from './harness.ts'

// Identity bootstrap hashes several passwords, so it runs once; every test opens its own copy of that root.
const seed = { root: '', users: [] as Awaited<ReturnType<typeof storageHarness>>['users'], master: '',
  passwords: {} as Awaited<ReturnType<typeof storageHarness>>['passwords'] }
beforeAll(async () => {
  const harness = await storageHarness({ readyUsers: 1 })
  try {
    seed.root = harness.paths.root
    seed.users = harness.users
    seed.passwords = harness.passwords
    seed.master = (await harness.ctx.webIdentity.login('arxadmin', harness.passwords.master, 'admin')).token
  } finally { await harness.close(false) }
})
afterAll(() => rm(seed.root, { recursive: true, force: true }))
async function seededHarness(options: Omit<Parameters<typeof storageHarness>[0] & object, 'root' | 'readyUsers' | 'initialize'> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arx-project-fixture-'))
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

let h: Awaited<ReturnType<typeof storageHarness>> | undefined
let headers: Record<string, string>
const observers: ((message: unknown) => void)[] = []
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
function observe(marker: string, callback: (request: IncomingMessage, onClose: (listener: () => void) => void) => void) {
  const observer = (message: unknown) => {
    if (typeof message !== 'object' || message === null || !('request' in message) || !('response' in message)) return
    if (!(message.request instanceof IncomingMessage) || !(message.response instanceof ServerResponse)) return
    if (message.request.headers['x-arx-fixture-case'] !== marker) return
    const response = message.response
    callback(message.request, (listener) => { response.once('close', listener) })
  }
  subscribe('http.server.request.start', observer); observers.push(observer)
}
beforeEach(async () => {
  h = await seededHarness({ http: true })
  const user = h.users[0]!
  const state = await h.ctx.webIdentity.state(user.authority)
  headers = { Cookie: AUTH_COOKIE_NAMES.user + '=' + user.token, Origin: h.url!,
    [AUTH_HEADER]: '1', [CSRF_HEADER]: state.csrfToken, 'Content-Type': 'application/json' }
})
afterEach(async () => {
  for (const observer of observers.splice(0)) unsubscribe('http.server.request.start', observer)
  vi.restoreAllMocks()
  await h?.close(); h = undefined
})
async function owned() {
  if (h === undefined) throw new Error('real HTTP Loader missing')
  const authority = h.users[0]!.authority
  const project = await h.ctx.projectStorage.createProject(authority, 'Owned HTTP lifecycle')
  const workspace = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Owned HTTP workspace')
  const meta = await h.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  await h.ctx.projectStorage.append(authority, meta.id, oneTurnLog())
  const location = h.ctx.sessionPersistence.locate(meta)!
  return { authority, meta, location }
}
describe('real USER HTTP request encoding and disconnect lifecycle', () => {
  it('keeps raw Node dot-segment and adjacent-prefix targets outside the normalized USER handler', async () => {
    if (h === undefined || h.url === undefined) throw new Error('real HTTP Loader missing')
    const fixture = h
    const origin = h.url
    const authenticate = vi.spyOn(fixture.ctx.webIdentityApi, 'authenticateRequest')
    for (const path of ['/userish/projects', '/user/../escaped', '/user/%2e%2e/escaped']) {
      const marker = randomUUID()
      let observedPath: string | undefined
      observe(marker, (request) => { observedPath = request.url })
      const status = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(origin, { path, method: 'GET', agent: false,
          headers: { ...headers, 'x-arx-fixture-case': marker } }, (response) => {
          response.resume()
          response.once('end', () => { resolve(response.statusCode ?? 0) })
        })
        request.once('error', reject)
        request.end()
      })
      expect(observedPath).toBe(path)
      expect(status).toBe(404)
      expect(authenticate).not.toHaveBeenCalled()
    }
    const valid = await fetch(origin + '/user/projects', { headers })
    expect(valid.status).toBe(200)
    expect(authenticate).toHaveBeenCalledTimes(1)
  })
  it('preserves a genuine decoded IncomingMessage body with Unicode display names', async () => {
    if (h === undefined) throw new Error('real HTTP Loader missing')
    const marker = randomUUID()
    let decoded = false
    observe(marker, (request) => { request.setEncoding('utf8'); decoded = true })
    const response = await fetch(h.url! + '/user/projects', { method: 'POST',
      headers: { ...headers, 'x-arx-fixture-case': marker }, body: JSON.stringify({ name: 'Privado ☂' }) })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ project: { name: 'Privado ☂' } })
    expect(decoded).toBe(true)
  })
  it('rejects an unsupported method on the actual own-session route without changing its durable artifact', async () => {
    if (h === undefined) throw new Error('real HTTP Loader missing')
    const own = await owned()
    const original = await readFile(own.location.path)
    const response = await fetch(h.url! + '/user/sessions/' + own.meta.id, { method: 'POST', headers, body: '{}' })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'PROJECT_ROUTE' } })
    expect(await readFile(own.location.path)).toEqual(original)
  })
  it.each(['after-read', 'during-read'] as const)('stops export on an actual client disconnect %s without publishing content', async (phase) => {
    if (h === undefined) throw new Error('real HTTP Loader missing')
    const fixture = h
    const own = await owned()
    const originalBytes = await readFile(own.location.path)
    const marker = randomUUID()
    const entered = deferred(), release = deferred(), serverClosed = deferred(), observed = deferred()
    observe(marker, (_request, onClose) => { onClose(serverClosed.resolve) })
    const original = fixture.ctx.projectStorage.read.bind(fixture.ctx.projectStorage)
    let released = false
    let cancelledRead = false
    vi.spyOn(fixture.ctx.projectStorage, 'read').mockImplementationOnce(async (...args) => {
      if (phase === 'after-read') {
        const page = await original(...args)
        entered.resolve()
        await release.promise
        released = true
        return page
      }
      entered.resolve()
      await release.promise
      try { return await original(...args) } catch (error) { cancelledRead = true; observed.resolve(); throw error }
    })
    const revalidate = fixture.ctx.webIdentity.revalidate.bind(fixture.ctx.webIdentity)
    vi.spyOn(fixture.ctx.webIdentity, 'revalidate').mockImplementation(async (...args) => {
      const authority = await revalidate(...args)
      if (released) observed.resolve()
      return authority
    })
    let received = false
    const client = httpRequest(fixture.url! + '/user/sessions/' + own.meta.id + '/export',
      { headers: { ...headers, 'x-arx-fixture-case': marker } },
      (response) => { received = true; response.resume() })
    client.on('error', () => undefined)
    client.end()
    await entered.promise
    client.destroy()
    await serverClosed.promise
    release.resolve()
    await observed.promise
    await nextTick()
    expect(received).toBe(false)
    expect(cancelledRead).toBe(phase === 'during-read')
    expect(await readFile(own.location.path)).toEqual(originalBytes)
  })
})
