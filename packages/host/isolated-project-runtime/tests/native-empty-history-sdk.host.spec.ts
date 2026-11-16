/** Real native SDK creation commits an owned empty header without model execution. */
import { randomUUID } from 'node:crypto'
import { rm, cp, mkdtemp } from 'node:fs/promises'
import { afterEach, expect, it, afterAll, beforeAll } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER } from '@arx-ai/arx-web-identity'
import { AbstractApiClient } from '@arx-ai/arx-host-apiproxy/client'
import type { IApiClient } from '@arx-ai/arx-host-apiproxy/client'
import { parseHistoryArtifactPage } from '@arx-ai/arx-project-storage/contract'
import { parseHeaderMeta, toHeaderLine } from '../../../session/session-persistence-jsonl/src/format.ts'
import * as Connection from '../../../client/connection/src/index.ts'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import * as BrokerHttp from '../src/broker-http.ts'
import { nativeSupervisorFixture } from './native-supervisor.ts'

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

let harness: Awaited<ReturnType<typeof storageHarness>> | undefined
let supervisor: Awaited<ReturnType<typeof nativeSupervisorFixture>> | undefined
afterEach(async () => {
  await harness?.close()
  await supervisor?.close()
  harness = undefined; supervisor = undefined
})

/** Load the actual SDK client while this fixture supplies only authenticated HTTP. */
async function actualClient(send: typeof globalThis.fetch): Promise<IApiClient> {
  const namespace: unknown = await import(new URL('../../../client/connection/src/client/web-api-client.ts', import.meta.url).href)
  if (typeof namespace !== 'object' || namespace === null || !('WebApiClient' in namespace)
    || typeof namespace.WebApiClient !== 'function') throw new Error('actual WebApiClient export unavailable')
  const client: unknown = Reflect.construct(namespace.WebApiClient, [send])
  if (!(client instanceof AbstractApiClient)) throw new Error('actual SDK wire client unavailable')
  return client
}

for (const compression of ['none', 'zstd'] as const) {
  it(`serves the canonical empty native session immediately with ${compression} and preserves absent-log denials`, async () => {
    supervisor = await nativeSupervisorFixture()
    harness = await seededHarness({ http: true, endpoint: supervisor.endpoint, compression,
      extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp },
        { name: '@arx-ai/arx-client-connection', plugin: Connection, config: { accessMode: 'authenticated' } }] })
    const h = harness, peer = supervisor, user = h.users[0], foreign = h.users[1], origin = h.url
    if (user === undefined || foreign === undefined || origin === undefined) throw new Error('native USER fixture unavailable')
    const project = await h.ctx.projectStorage.createProject(user.authority, 'Empty native session')
    const workspace = await h.ctx.projectStorage.createWorkspace(user.authority, project.projectId, 'Owned empty workspace')
    const provision = await h.ctx.projectStorage.provision(user.authority, workspace.workspaceId)
    peer.assign({ controlOrigin: origin, scope: provision.scope, volumePath: provision.volumePath })
    const state = await h.ctx.webIdentity.state(user.authority)
    const client = await actualClient((input, init) => {
      const url = new URL(input as string | URL, origin), headers = new Headers(init?.headers)
      headers.set('cookie', AUTH_COOKIE_NAMES.user + '=' + user.token)
      headers.set('origin', origin)
      headers.set(AUTH_HEADER, '1')
      headers.set(CSRF_HEADER, state.csrfToken)
      return fetch(new URL(url.pathname + url.search, origin), { ...init, headers })
    })
    const created = await client.sessions.create({ workspaceId: workspace.workspaceId })
    expect(created.result.ok).toBe(true)
    if (!created.result.ok) throw new Error('native session creation failed')
    const id = created.result.value.sessionId
    const history = (token: string, sessionId = id) => fetch(origin + '/user/sessions/' + encodeURIComponent(sessionId) + '/history',
      { headers: { cookie: AUTH_COOKIE_NAMES.user + '=' + token } })
    const response = await history(user.token)
    expect(response.status).toBe(200)
    const page = parseHistoryArtifactPage(await response.json())
    expect(page).toMatchObject({ sessionId: id, nextSeq: 0 })
    expect(page.nextCursor).toBeUndefined()
    const meta = parseHeaderMeta(page.content.split('\n')[0]!)
    expect(meta).toMatchObject({ id, cwd: provision.volumePath, version: SESSION_FORMAT_VERSION })
    const raw = await h.ctx.sessionPersistence.readRawPage(id, { offset: 0, maxBytes: 128 * 1024 })
    expect(raw?.content).toBe(page.content)
    expect(raw?.revision).toBeTruthy()
    expect((await h.ctx.sessionPersistence.readFrom(id, 0)).events).toEqual([])
    const native = peer.ctxOf(workspace.workspaceId)
    if (native === undefined) throw new Error('created native worker unavailable')
    const liveSession = native.sessions.get(id)
    if (liveSession === undefined) throw new Error('canonical live native session unavailable')
    expect(JSON.stringify(toHeaderLine(liveSession.header)) + '\n').toBe(page.content)
    const download = await fetch(origin + '/api/session.export?sessionId=' + encodeURIComponent(id), {
      headers: { cookie: AUTH_COOKIE_NAMES.user + '=' + user.token, origin,
        [AUTH_HEADER]: '1', [CSRF_HEADER]: state.csrfToken },
    })
    expect(download.status).toBe(200)
    expect(download.headers.get('content-type')).toBe('application/zip')
    const exported = unzipSync(new Uint8Array(await download.arrayBuffer()))
    expect(Object.keys(exported)).toEqual(['session.jsonl'])
    const nativeContent = strFromU8(exported['session.jsonl']!)
    expect(nativeContent).toBe(page.content)
    expect(nativeContent.trimEnd().split('\n').slice(1)).toEqual([])
    const nativeHistory = await client.sessions.history({ sessionId: id })
    expect(nativeHistory.result.ok).toBe(true)
    if (!nativeHistory.result.ok) throw new Error('authenticated native history unavailable')
    expect(nativeHistory.result.value.events).toEqual([])
    expect(peer.counts).toEqual({ modelCalls: 0, toolCalls: 0 })
    expect((await history(foreign.token)).status).toBe(403)

    const lazy = await h.ctx.projectStorage.register(user.authority, workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
    expect(await h.ctx.projectStorage.executionRevision(user.authority, lazy.id)).toBeUndefined()
    expect(await h.ctx.projectStorage.executionRawPage(user.authority, lazy.id, { offset: 0, maxBytes: 400 })).toBeUndefined()
    expect((await history(user.token, lazy.id)).status).toBe(404)

    const location = h.ctx.sessionPersistence.locate(raw!.meta)
    if (location?.kind !== 'jsonl') throw new Error('canonical native JSONL location unavailable')
    await rm(location.path)
    expect((await history(user.token)).status).toBe(404)
  }, 30000)
}
