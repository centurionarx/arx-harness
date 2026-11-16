import { afterEach, beforeEach, describe, expect, it, vi, afterAll, beforeAll } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, cp, mkdtemp, rm } from 'node:fs/promises'
import { IncomingMessage, ServerResponse, request as httpRequest } from 'node:http'
import { subscribe, unsubscribe } from 'node:diagnostics_channel'
import { setImmediate as nextTick } from 'node:timers/promises'
import { freezeMessage, MessageId } from '@arx-ai/arx-llm'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER } from '@arx-ai/arx-web-identity/contract'
import { DatabaseSync } from 'node:sqlite'
import type { RequestAuthority } from '@arx-ai/arx-web-identity'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import { storageHarness } from './harness.ts'

// Identity bootstrap hashes several passwords, so it runs once; every test opens its own copy of that root.
const seed = { root: '', users: [] as Awaited<ReturnType<typeof storageHarness>>['users'], master: '',
  passwords: {} as Awaited<ReturnType<typeof storageHarness>>['passwords'] }
beforeAll(async () => {
  const harness = await storageHarness({ readyUsers: 2 })
  seed.root = harness.paths.root
  seed.users = harness.users
  seed.passwords = harness.passwords
  seed.master = (await harness.ctx.webIdentity.login('arxadmin', harness.passwords.master, 'admin')).token
  await harness.close(false)
})
afterAll(() => rm(seed.root, { recursive: true, force: true }))
async function seededHarness(options: Omit<Parameters<typeof storageHarness>[0] & object, 'root' | 'readyUsers' | 'initialize'> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arx-project-fixture-'))
  await cp(seed.root, root, { recursive: true })
  const harness = await storageHarness({ ...options, root })
  const users = await Promise.all(seed.users.map(async user => ({ ...user,
    authority: await harness.ctx.webIdentity.authenticate(user.token, 'user') })))
  return { ...harness, users, passwords: seed.passwords,
    master: await harness.ctx.webIdentity.authenticate(seed.master, 'admin'),
    async close() { await harness.close(false); await rm(root, { recursive: true, force: true }) } }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
let fixture: Awaited<ReturnType<typeof storageHarness>> | undefined
const observers: ((value: unknown) => void)[] = []
const releases: (() => void)[] = []
beforeEach(async () => { fixture = await seededHarness({ http: true }) })
afterEach(async () => {
  for (const release of releases.splice(0)) release()
  for (const observer of observers.splice(0)) unsubscribe('http.server.request.start', observer)
  vi.restoreAllMocks()
  await fixture?.close(); fixture = undefined
})
function mounted() {
  if (fixture === undefined || fixture.url === undefined) throw new Error('real storage HTTP fixture unavailable')
  return { h: fixture, origin: fixture.url }
}
async function owned(user = 0, large = false, alternate?: { authority: RequestAuthority; token: string }) {
  const { h, origin } = mounted()
  const account = h.users[user]
  if (account === undefined) throw new Error('real USER fixture unavailable')
  const authority = alternate?.authority ?? account.authority
  const project = await h.ctx.projectStorage.createProject(authority, 'Private publication ' + String(user))
  const workspace = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Owned publication ' + String(user))
  const meta = await h.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  const events = oneTurnLog().map(event => large && event.type === 'user/message' ? { ...event, data: freezeMessage({
    id: MessageId('large-owned-publication'), role: 'user', content: [{ type: 'text', text: 'x'.repeat(200_000) }],
    source: { kind: 'user' },
  }) } : event)
  await h.ctx.projectStorage.append(authority, meta.id, events)
  const location = h.ctx.sessionPersistence.locate(meta)
  if (location?.kind !== 'jsonl') throw new Error('real owned JSONL fixture unavailable')
  const original = await readFile(location.path)
  const state = await h.ctx.webIdentity.state(authority)
  const headers = { Cookie: AUTH_COOKIE_NAMES.user + '=' + (alternate?.token ?? account.token), Origin: origin,
    [AUTH_HEADER]: '1', [CSRF_HEADER]: state.csrfToken, 'Content-Type': 'application/json' }
  return { h, origin, account, authority, project, workspace, meta, location, original, headers }
}
function observe(marker: string, callback: (request: IncomingMessage, response: Pick<ServerResponse, 'once'>) => void) {
  const observer = (value: unknown) => {
    if (typeof value !== 'object' || value === null || !('request' in value) || !('response' in value)) return
    if (!(value.request instanceof IncomingMessage) || !(value.response instanceof ServerResponse)) return
    if (value.request.headers['x-arx-fixture-publication'] !== marker) return
    callback(value.request, value.response)
  }
  subscribe('http.server.request.start', observer); observers.push(observer)
}
async function remove(own: Awaited<ReturnType<typeof owned>>, ancestor: 'workspace' | 'project') {
  if (ancestor === 'workspace') await own.h.ctx.webIdentity.deleteWorkspace(own.authority, own.workspace.workspaceId)
  else await own.h.ctx.webIdentity.deleteProject(own.authority, own.project.projectId)
}
const readCases = (['workspace', 'project'] as const).flatMap(ancestor =>
  (['navigation', 'worker-page', 'worker-source', 'worker-revision'] as const).map(reader => ({ ancestor, reader })))
describe('current ownership at the physical read and HTTP publication points', () => {
  it.each(readCases)('refuses $reader after a $ancestor tombstone while its original cookie stays valid', async ({ ancestor, reader }) => {
    const own = await owned()
    const entered = deferred(), release = deferred()
    releases.push(release.resolve)
    const persistence = own.h.ctx.sessionPersistence
    if (reader === 'worker-source') {
      const original = persistence.readFrom.bind(persistence)
      vi.spyOn(persistence, 'readFrom').mockImplementationOnce(async (...args) => {
        const result = await original(...args); entered.resolve(); await release.promise; return result
      })
    } else if (reader === 'worker-revision') {
      const original = persistence.readRevision.bind(persistence)
      vi.spyOn(persistence, 'readRevision').mockImplementationOnce(async (...args) => {
        const result = await original(...args); entered.resolve(); await release.promise; return result
      })
    } else {
      const original = persistence.readRawPage.bind(persistence)
      vi.spyOn(persistence, 'readRawPage').mockImplementationOnce(async (...args) => {
        const result = await original(...args); entered.resolve(); await release.promise; return result
      })
    }
    const storage = own.h.ctx.projectStorage
    const action = reader === 'navigation' ? storage.read(own.authority, own.meta.id)
      : reader === 'worker-page' ? storage.executionRawPage(own.authority, own.meta.id, { offset: 0, maxBytes: 400 })
        : reader === 'worker-source' ? storage.executionSnapshot(own.authority, own.meta.id)
          : storage.executionRevision(own.authority, own.meta.id)
    const outcome = action.then(value => ({ value }), (error: unknown) => ({ error }))
    await entered.promise
    await remove(own, ancestor)
    const resumed = await own.h.ctx.webIdentity.authenticate(own.account.token, 'user')
    expect(resumed.revision).toBe(own.authority.revision)
    release.resolve()
    expect(await outcome).toMatchObject({ error: { code: 'OWNER_FORBIDDEN', status: 403 } })
    expect(await readFile(own.location.path)).toEqual(own.original)
  })
  it.each((['workspace', 'project'] as const).flatMap(ancestor =>
    (['history', 'export'] as const).map(route => ({ ancestor, route }))))
  ('closes the real $route channel before $ancestor deletion ACK and rejects its late page', async ({ ancestor, route }) => {
    const own = await owned(), other = await owned(1)
    const marker = randomUUID()
    const entered = deferred(), release = deferred(), closed = deferred(), readFinished = deferred()
    releases.push(release.resolve)
    const order: string[] = []
    observe(marker, (_request, response) => {
      response.once('close', () => { order.push('carrier-close'); closed.resolve() })
    })
    const persistence = own.h.ctx.sessionPersistence
    const physicalRead = persistence.readRawPage.bind(persistence)
    let physicalSignal: AbortSignal | undefined
    vi.spyOn(persistence, 'readRawPage').mockImplementationOnce(async (...args) => {
      const page = await physicalRead(...args)
      physicalSignal = args[2]
      entered.resolve(); await release.promise; return page
    })
    const read = own.h.ctx.projectStorage.read.bind(own.h.ctx.projectStorage)
    vi.spyOn(own.h.ctx.projectStorage, 'read').mockImplementationOnce(async (...args) => {
      try { return await read(...args) }
      finally { readFinished.resolve() }
    })
    let receivedHeaders = false, bytesReceived = 0
    const client = httpRequest(own.origin + '/user/sessions/' + own.meta.id + '/' + route,
      { method: 'GET', agent: false, headers: { ...own.headers, 'x-arx-fixture-publication': marker } }, (response) => {
        receivedHeaders = true
        response.on('data', (chunk: Buffer) => { bytesReceived += chunk.length })
        response.resume()
      })
    client.on('error', () => undefined)
    client.end()
    try {
      await entered.promise
      await remove(own, ancestor)
      order.push('delete-ack')
      await closed.promise
      expect(order).toEqual(['carrier-close', 'delete-ack'])
      expect(physicalSignal?.aborted).toBe(true)
      expect(receivedHeaders).toBe(false)
      expect(bytesReceived).toBe(0)
      expect((await own.h.ctx.webIdentity.authenticate(own.account.token, 'user')).revision).toBe(own.authority.revision)
      // ACK closed the carrier without waiting for private I/O. Settle that
      // original read before starting another read of the same exclusive ID.
      release.resolve(); await readFinished.promise; await nextTick()
      expect(bytesReceived).toBe(0)
      const ownDenied = await fetch(own.origin + '/user/sessions/' + own.meta.id + '/history', { headers: own.headers })
      expect(ownDenied.status).toBe(403)
      const otherPage = await fetch(other.origin + '/user/sessions/' + other.meta.id + '/history', { headers: other.headers })
      expect(otherPage.status).toBe(200)
      expect(await otherPage.json()).toMatchObject({ sessionId: other.meta.id, content: other.original.toString() })
      expect(await readFile(own.location.path)).toEqual(own.original)
    } finally { release.resolve(); client.destroy() }
  })
  it.each(['workspace', 'project'] as const)('closes an actual drained export before %s ACK without publishing a subsequent page', async (ancestor) => {
    const own = await owned(0, true), other = await owned(1)
    const marker = randomUUID()
    const drained = deferred(), drainRelease = deferred(), callbackDelivered = deferred(), closed = deferred()
    releases.push(drainRelease.resolve)
    const order: string[] = []
    observe(marker, (_request, response) => {
      response.once('close', () => { order.push('carrier-close'); closed.resolve() })
      const originalOnce = response.once.bind(response)
      vi.spyOn(response, 'once').mockImplementation((event: string | symbol, listener: (...args: unknown[]) => void) => {
        if (event !== 'drain') return originalOnce(event, listener)
        // The real Node write/socket delivered drain. Delay only its original
        // continuation, preserving the original once return and event args.
        return originalOnce(event, (...args: unknown[]) => {
          order.push('real-drain'); drained.resolve()
          void drainRelease.promise.then(() => {
            order.push('late-drain-callback'); listener(...args); callbackDelivered.resolve()
          })
        })
      })
    })
    const read = own.h.ctx.projectStorage.read.bind(own.h.ctx.projectStorage)
    let pageReads = 0
    vi.spyOn(own.h.ctx.projectStorage, 'read').mockImplementation(async (...args) => {
      if (args[1] === own.meta.id) pageReads++
      return read(...args)
    })
    let receivedBytes = 0
    const client = httpRequest(own.origin + '/user/sessions/' + own.meta.id + '/export',
      { method: 'GET', agent: false, headers: { ...own.headers, 'x-arx-fixture-publication': marker } }, (response) => {
        response.on('error', () => undefined)
        response.on('data', (chunk: Buffer) => { receivedBytes += chunk.length })
        response.resume()
      })
    client.on('error', () => undefined); client.end()
    try {
      await drained.promise
      expect(pageReads).toBe(1)
      await remove(own, ancestor); order.push('delete-ack')
      await closed.promise
      expect(order).toEqual(['real-drain', 'carrier-close', 'delete-ack'])
      drainRelease.resolve(); await callbackDelivered.promise; await nextTick()
      expect(order).toEqual(['real-drain', 'carrier-close', 'delete-ack', 'late-drain-callback'])
      expect(pageReads).toBe(1)
      // The first page was authorized before deletion; already-buffered socket
      // bytes may arrive after ACK. No subsequent control page was requested.
      expect(receivedBytes).toBeLessThanOrEqual(128 * 1024)
      expect((await own.h.ctx.webIdentity.authenticate(own.account.token, 'user')).revision).toBe(own.authority.revision)
      const otherPage = await fetch(other.origin + '/user/sessions/' + other.meta.id + '/history', { headers: other.headers })
      expect(otherPage.status).toBe(200)
      expect(await otherPage.json()).toMatchObject({ sessionId: other.meta.id, content: other.original.toString() })
      expect(await readFile(own.location.path)).toEqual(own.original)
    } finally { drainRelease.resolve(); client.destroy() }
  })
  it('shares the real close barrier for concurrent ancestor deletions and refuses new USER publication until both ACKs', async () => {
    const own = await owned(), independent = await owned(), other = await owned(1)
    const marker = randomUUID(), physicalEntered = deferred(), physicalRelease = deferred(), readFinished = deferred()
    const realClosed = deferred(), closeRelease = deferred(), projectNotified = deferred()
    releases.push(physicalRelease.resolve, closeRelease.resolve)
    let acks = 0
    observe(marker, (_request, response) => {
      response.once('close', realClosed.resolve)
      const originalOnce = response.once.bind(response)
      vi.spyOn(response, 'once').mockImplementation((event: string | symbol, listener: (...args: unknown[]) => void) => {
        if (event !== 'close') return originalOnce(event, listener)
        return originalOnce(event, (...args: unknown[]) => {
          // The real close event occurred. Hold only the original subscriber
          // delivery to observe both journaled deletions sharing its barrier.
          void closeRelease.promise.then(() => { listener(...args) })
        })
      })
    })
    own.h.ctx.on('web-identity/ownership-deleted', (_user, resource) => {
      if (resource.kind === 'project' && resource.projectId === own.project.projectId) projectNotified.resolve()
    })
    const persistence = own.h.ctx.sessionPersistence, originalPage = persistence.readRawPage.bind(persistence)
    vi.spyOn(persistence, 'readRawPage').mockImplementationOnce(async (...args) => {
      const page = await originalPage(...args); physicalEntered.resolve(); await physicalRelease.promise; return page
    })
    const read = own.h.ctx.projectStorage.read.bind(own.h.ctx.projectStorage)
    vi.spyOn(own.h.ctx.projectStorage, 'read').mockImplementationOnce(async (...args) => {
      try { return await read(...args) } finally { readFinished.resolve() }
    })
    const client = httpRequest(own.origin + '/user/sessions/' + own.meta.id + '/history',
      { agent: false, headers: { ...own.headers, 'x-arx-fixture-publication': marker } })
    client.on('error', () => undefined); client.end()
    try {
      await physicalEntered.promise
      const first = remove(own, 'workspace').then(() => { acks++ }, (error: unknown) => error)
      await realClosed.promise
      const second = remove(own, 'project').then(() => { acks++ }, (error: unknown) => error)
      await projectNotified.promise
      expect(acks).toBe(0)
      const blocked = await fetch(independent.origin + '/user/sessions/' + independent.meta.id + '/history', { headers: independent.headers })
      expect(blocked.status).toBe(503)
      expect(await blocked.json()).toMatchObject({ error: { code: 'PROJECT_UNAVAILABLE' } })
      const otherPage = await fetch(other.origin + '/user/sessions/' + other.meta.id + '/history', { headers: other.headers })
      expect(otherPage.status).toBe(200)
      closeRelease.resolve()
      expect(await Promise.all([first, second])).toEqual([undefined, undefined])
      expect(acks).toBe(2)
      physicalRelease.resolve(); await readFinished.promise
      const permitted = await fetch(independent.origin + '/user/sessions/' + independent.meta.id + '/history', { headers: independent.headers })
      expect(permitted.status).toBe(200)
      expect(await permitted.json()).toMatchObject({ content: independent.original.toString() })
      expect((await own.h.ctx.webIdentity.authenticate(own.account.token, 'user')).revision).toBe(own.authority.revision)
      expect(await readFile(own.location.path)).toEqual(own.original)
    } finally { closeRelease.resolve(); physicalRelease.resolve(); client.destroy() }
  })
  it('quietly closes only the expired SID publisher while another login of that USER retains its original private page', async () => {
    const own = await owned(), login = await own.h.ctx.webIdentity.login(own.account.username, own.account.password, 'user')
    const secondAuthority = await own.h.ctx.webIdentity.authenticate(login.token, 'user')
    const second = await owned(0, false, { authority: secondAuthority, token: login.token }), other = await owned(1)
    const marker = randomUUID(), secondMarker = randomUUID(), firstEntered = deferred(), secondEntered = deferred()
    const firstRelease = deferred(), secondRelease = deferred(), firstClosed = deferred(), firstFinished = deferred()
    releases.push(firstRelease.resolve, secondRelease.resolve)
    let secondClosed = false, receivedHeaders = false, receivedBytes = 0
    observe(marker, (_request, response) => { response.once('close', firstClosed.resolve) })
    observe(secondMarker, (_request, response) => { response.once('close', () => { secondClosed = true }) })
    const persistence = own.h.ctx.sessionPersistence, originalPage = persistence.readRawPage.bind(persistence)
    let firstSignal: AbortSignal | undefined, secondSignal: AbortSignal | undefined
    vi.spyOn(persistence, 'readRawPage').mockImplementation(async (...args) => {
      const page = await originalPage(...args)
      if (args[0] === own.meta.id) { firstSignal = args[2]; firstEntered.resolve(); await firstRelease.promise }
      if (args[0] === second.meta.id) { secondSignal = args[2]; secondEntered.resolve(); await secondRelease.promise }
      return page
    })
    const read = own.h.ctx.projectStorage.read.bind(own.h.ctx.projectStorage)
    vi.spyOn(own.h.ctx.projectStorage, 'read').mockImplementation(async (...args) => {
      try { return await read(...args) }
      finally { if (args[1] === own.meta.id) firstFinished.resolve() }
    })
    const client = httpRequest(own.origin + '/user/sessions/' + own.meta.id + '/history',
      { agent: false, headers: { ...own.headers, 'x-arx-fixture-publication': marker } }, (response) => {
        receivedHeaders = true; response.on('data', (chunk: Buffer) => { receivedBytes += chunk.length }); response.resume()
      })
    client.on('error', () => undefined); client.end()
    const secondResponse = fetch(second.origin + '/user/sessions/' + second.meta.id + '/history',
      { headers: { ...second.headers, 'x-arx-fixture-publication': secondMarker } })
      .then(value => ({ value }), (error: unknown) => ({ error }))
    const database = new DatabaseSync(own.h.paths.database)
    let restoreDate: (() => void) | undefined
    try {
      await Promise.all([firstEntered.promise, secondEntered.promise])
      const row = database.prepare('SELECT expires_at,idle_expires_at FROM web_sessions WHERE id=?').get(own.authority.authSessionId)
      if (row === undefined) throw new Error('real publisher idle deadline unavailable')
      const idle = Number(row.idle_expires_at)
      expect(idle).toBeLessThan(Number(row.expires_at))
      const realNow = Date.now.bind(Date), offset = idle - realNow() - 250
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset)
      restoreDate = () => { clock.mockRestore() }
      await own.h.ctx.webIdentity.revalidate(second.authority, { activity: true })
      await own.h.ctx.webIdentity.revalidate(other.authority, { activity: true })
      await own.h.ctx.webIdentity.authenticate(own.account.token, 'user')
      // The genuine provider timer, with no new A request/frame/cancel, closes
      // only the publisher whose issued authSessionId reached its deadline.
      await firstClosed.promise
      expect(firstSignal?.aborted).toBe(true)
      expect(secondSignal?.aborted).toBe(false)
      expect(secondClosed).toBe(false)
      expect(receivedHeaders).toBe(false)
      expect(receivedBytes).toBe(0)
      expect(Number(database.prepare('SELECT revoked FROM web_sessions WHERE id=?').get(own.authority.authSessionId)?.revoked)).toBe(1)
      firstRelease.resolve(); secondRelease.resolve(); await firstFinished.promise
      const permitted = await secondResponse
      expect(permitted).toHaveProperty('value')
      if (!('value' in permitted)) throw new Error('unexpired own SID carrier refused')
      expect(permitted.value.status).toBe(200)
      expect(await permitted.value.json()).toMatchObject({ content: second.original.toString() })
      const otherPage = await fetch(other.origin + '/user/sessions/' + other.meta.id + '/history', { headers: other.headers })
      expect(otherPage.status).toBe(200)
      expect((await own.h.ctx.webIdentity.authenticate(login.token, 'user')).revision).toBe(own.authority.revision)
      expect(receivedBytes).toBe(0)
      expect(await readFile(own.location.path)).toEqual(own.original)
      expect(await readFile(second.location.path)).toEqual(second.original)
    } finally {
      firstRelease.resolve(); secondRelease.resolve(); restoreDate?.(); database.close(); client.destroy()
    }
  })
  it('disposes its real HTTP Loader entry by closing active publishers and refusing an already-authenticated late admission', async () => {
    const own = await owned(), late = await owned(1)
    const physicalEntered = deferred(), physicalRelease = deferred(), authEntered = deferred(), authRelease = deferred()
    const closed = deferred(), finished = deferred(), marker = randomUUID()
    releases.push(physicalRelease.resolve, authRelease.resolve)
    observe(marker, (_request, response) => { response.once('close', closed.resolve) })
    const persistence = own.h.ctx.sessionPersistence, originalPage = persistence.readRawPage.bind(persistence)
    vi.spyOn(persistence, 'readRawPage').mockImplementationOnce(async (...args) => {
      const page = await originalPage(...args); physicalEntered.resolve(); await physicalRelease.promise; return page
    })
    const read = own.h.ctx.projectStorage.read.bind(own.h.ctx.projectStorage)
    vi.spyOn(own.h.ctx.projectStorage, 'read').mockImplementationOnce(async (...args) => {
      try { return await read(...args) } finally { finished.resolve() }
    })
    let receivedHeaders = false
    const client = httpRequest(own.origin + '/user/sessions/' + own.meta.id + '/history',
      { agent: false, headers: { ...own.headers, 'x-arx-fixture-publication': marker } }, (response) => {
        receivedHeaders = true; response.resume()
      })
    client.on('error', () => undefined); client.end()
    try {
      await physicalEntered.promise
      const authenticate = own.h.ctx.webIdentityApi.authenticateRequest.bind(own.h.ctx.webIdentityApi)
      vi.spyOn(own.h.ctx.webIdentityApi, 'authenticateRequest').mockImplementationOnce(async (...args) => {
        const authority = await authenticate(...args); authEntered.resolve(); await authRelease.promise; return authority
      })
      const lateResponse = fetch(late.origin + '/user/sessions/' + late.meta.id + '/history', { headers: late.headers })
        .then(value => ({ value }), (error: unknown) => ({ error }))
      await authEntered.promise
      const entry = [...own.h.ctx.loader.entries()].find(row => row.options.name === '@arx-ai/arx-project-storage/http')
      if (entry === undefined) throw new Error('genuine HTTP Loader entry unavailable')
      await own.h.ctx.loader.remove(entry.id)
      await closed.promise
      expect(receivedHeaders).toBe(false)
      // The actual entry has finished disposal before either private I/O or
      // the successfully authenticated late callback is released.
      authRelease.resolve()
      const outcome = await lateResponse
      expect(outcome).toHaveProperty('value')
      if (!('value' in outcome)) throw new Error('late HTTP admission channel unavailable')
      expect(outcome.value.status).toBe(503)
      expect(await outcome.value.json()).toMatchObject({ error: { code: 'PROJECT_UNAVAILABLE' } })
      physicalRelease.resolve(); await finished.promise; await nextTick()
      expect(receivedHeaders).toBe(false)
      expect(await readFile(own.location.path)).toEqual(own.original)
      expect(await readFile(late.location.path)).toEqual(late.original)
    } finally { authRelease.resolve(); physicalRelease.resolve(); client.destroy() }
  })
  it('deletes a session while its cancelled HTTP read is queued behind the same exclusive without self-deadlock', async () => {
    const own = await owned()
    const appendEntered = deferred(), appendRelease = deferred(), readEntered = deferred(), readFinished = deferred()
    releases.push(appendRelease.resolve)
    const persistence = own.h.ctx.sessionPersistence
    const append = persistence.append.bind(persistence)
    vi.spyOn(persistence, 'append').mockImplementationOnce(async (...args) => {
      appendEntered.resolve(); await appendRelease.promise; return append(...args)
    })
    const blocker = own.h.ctx.projectStorage.append(own.authority, own.meta.id, [])
    const handledBlocker = blocker.then(() => undefined, (error: unknown) => error)
    await appendEntered.promise
    const deletion = own.h.ctx.projectStorage.deleteSession(own.authority, own.meta.id)
    const handledDeletion = deletion.then(() => undefined, (error: unknown) => error)
    const read = own.h.ctx.projectStorage.read.bind(own.h.ctx.projectStorage)
    vi.spyOn(own.h.ctx.projectStorage, 'read').mockImplementationOnce(async (...args) => {
      readEntered.resolve()
      try { return await read(...args) }
      finally { readFinished.resolve() }
    })
    const response = fetch(own.origin + '/user/sessions/' + own.meta.id + '/history', { headers: own.headers })
    const outcome = response.then(value => ({ value }), (error: unknown) => ({ error }))
    await readEntered.promise
    appendRelease.resolve()
    expect(await handledBlocker).toBeUndefined()
    expect(await handledDeletion).toBeUndefined()
    await readFinished.promise
    expect(await outcome).toHaveProperty('error')
    expect((await own.h.ctx.webIdentity.authenticate(own.account.token, 'user')).revision).toBe(own.authority.revision)
    await expect(own.h.ctx.webIdentity.authorizeOwner(own.authority, { kind: 'session', sessionId: own.meta.id }))
      .rejects.toMatchObject({ code: 'OWNER_FORBIDDEN', status: 403 })
    expect(await readFile(own.location.path)).toEqual(own.original)
  })
})
