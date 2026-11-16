import { afterEach, describe, expect, it, vi, afterAll, beforeAll } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, cp, mkdtemp, rm } from 'node:fs/promises'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { MessageId, freezeMessage } from '@arx-ai/arx-llm'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER } from '@arx-ai/arx-web-identity/contract'
import { parseProjectsPage, parseWorkspacesPage, parseHistoryPage, parseHistoryArtifactPage,
  parseCreatedProject, parseCreatedWorkspace } from '../src/contract.ts'
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

const fixtures: Awaited<ReturnType<typeof storageHarness>>[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const fixture of fixtures.splice(0)) await fixture.close() })
async function setup(options: Parameters<typeof seededHarness>[0] = {}) {
  const fixture = await seededHarness({ http: true, ...options }); fixtures.push(fixture)
  const user = fixture.users[0]!
  const state = await fixture.ctx.webIdentity.state(user.authority)
  const headers = { Cookie: AUTH_COOKIE_NAMES.user + '=' + user.token, Origin: fixture.url!,
    [AUTH_HEADER]: '1', [CSRF_HEADER]: state.csrfToken, 'Content-Type': 'application/json' }
  const request = (path: string, options: RequestInit = {}) => {
    const combined = new Headers(headers)
    new Headers(options.headers).forEach((value, key) =>{  combined.set(key, value) })
    return fetch(fixture.url! + path, { ...options, headers: combined })
  }
  return { fixture, user, headers, request }
}
describe('private USER HTTP storage', () => {
  it('creates server-owned projects and workspaces, pages raw history and exports only its original bytes', async () => {
    const { fixture, user, request } = await setup()
    const created = await request('/user/projects', { method: 'POST', body: JSON.stringify({ name: 'Private project' }) })
    expect(created.status).toBe(201)
    const project = parseCreatedProject(await created.json())
    const workspaceResult = await request('/user/projects/' + project.projectId + '/workspaces',
      { method: 'POST', body: JSON.stringify({ name: 'Private workspace' }) })
    expect(workspaceResult.status).toBe(201)
    const workspace = parseCreatedWorkspace(await workspaceResult.json())
    const header = await fixture.ctx.projectStorage.register(user.authority, workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
    await fixture.ctx.projectStorage.append(user.authority, header.id, oneTurnLog())
    const raw = (await fixture.ctx.sessionPersistence.readRaw(header.id))!.content
    const projects = await request('/user/projects')
    expect(parseProjectsPage(await projects.json()).projects).toEqual([project])
    expect(projects.headers.get('Cache-Control')).toBe('no-store')
    const workspaces = parseWorkspacesPage(await (await request('/user/projects/' + project.projectId + '/workspaces')).json())
    expect(workspaces.workspaces).toEqual([workspace])
    const history = parseHistoryPage(await (await request('/user/projects/' + project.projectId + '/sessions?workspaceId=' + workspace.workspaceId)).json())
    expect(history.sessions[0]!.sessionId).toBe(header.id)
    const page = parseHistoryArtifactPage(await (await request('/user/sessions/' + header.id + '/history')).json())
    expect(page.content).toBe(raw)
    const download = await request('/user/sessions/' + header.id + '/export')
    expect(download.status).toBe(200)
    expect(download.headers.get('Content-Disposition')).not.toContain(fixture.paths.root)
    expect(await download.text()).toBe(raw)
    const renamed = await request('/user/sessions/' + header.id, { method: 'PATCH', body: JSON.stringify({ title: 'Renamed' }) })
    expect(renamed.status).toBe(200)
    expect(await renamed.json()).toMatchObject({ session: { title: 'Renamed' } })
    expect((await request('/user/workspaces/' + workspace.workspaceId + '/grouping', { method: 'DELETE' })).status).toBe(200)
    expect((await request('/user/sessions/' + header.id + '/history')).status).toBe(200)
    expect((await request('/user/sessions/' + header.id, { method: 'DELETE' })).status).toBe(200)
    expect((await request('/user/sessions/' + header.id + '/history')).status).toBe(403)
    const location = fixture.ctx.sessionPersistence.locate(header)!
    expect(await readFile(location.path, 'utf8')).toBe(raw)
  })
  it('rejects anonymous, foreign, MASTER-audience, origin and CSRF requests before touching storage', async () => {
    const { fixture, user, request, headers } = await setup()
    const project = await fixture.ctx.projectStorage.createProject(user.authority, 'Owner')
    const workspace = await fixture.ctx.projectStorage.createWorkspace(user.authority, project.projectId, 'Owner')
    const header = await fixture.ctx.projectStorage.register(user.authority, workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
    await fixture.ctx.projectStorage.append(user.authority, header.id, oneTurnLog())
    const path = '/user/sessions/' + header.id + '/history'
    expect((await fetch(fixture.url! + path)).status).toBe(401)
    expect((await request(path, { headers: { Cookie: AUTH_COOKIE_NAMES.user + '=' + fixture.users[1]!.token } })).status).toBe(403)
    const masterLogin = await fixture.ctx.webIdentity.login('arxadmin', fixture.passwords.master, 'admin')
    expect((await request(path, { headers: { Cookie: AUTH_COOKIE_NAMES.user + '=' + masterLogin.token } })).status).toBe(401)
    expect((await request(path, { headers: { Origin: 'https://foreign.invalid' } })).status).toBe(403)
    expect((await request('/user/projects', { method: 'POST', body: '{"name":"blocked"}',
      headers: { [CSRF_HEADER]: 'bad' } })).status).toBe(403)
    expect((await request('/user/projects', { method: 'POST', body: '{"name":"blocked"}',
      headers: { [AUTH_HEADER]: '0' } })).status).toBe(403)
    expect((await fetch(fixture.url! + '/user/projects', { method: 'POST', headers: { ...headers, Origin: '' },
      body: '{"name":"blocked"}' })).status).toBe(403)
    expect((await fixture.ctx.projectStorage.projects(user.authority)).projects).toHaveLength(1)
  })
  it('rejects ambiguous names, malformed JSON, invalid ids, query aliases and missing artifacts without exposing paths', async () => {
    const { fixture, user, request } = await setup()
    for (const body of ['[]','null','false','{bad','{"name":""}','{"name":"x","path":"/etc"}','{"name":1}',
      '{"name":"' + 'x'.repeat(121) + '"}']) {
      expect((await request('/user/projects', { method: 'POST', body })).status).toBe(400)
    }
    expect((await request('/user/projects', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' })).status).toBe(415)
    expect((await request('/user/projects?unexpected=1')).status).toBe(400)
    expect((await request('/user/projects/not-an-id/workspaces')).status).toBe(400)
    expect((await request('/user/unknown')).status).toBe(404)
    expect((await request('/userbad/projects')).status).toBe(404)
    const project = await fixture.ctx.projectStorage.createProject(user.authority, 'Owner')
    const otherProject = await fixture.ctx.projectStorage.createProject(user.authority, 'Separate')
    const workspace = await fixture.ctx.projectStorage.createWorkspace(user.authority, otherProject.projectId, 'Separate')
    expect((await request('/user/projects/' + project.projectId + '/sessions?workspaceId=' + workspace.workspaceId)).status).toBe(403)
    const noEvents = await fixture.ctx.projectStorage.register(user.authority, workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
    const missing = await request('/user/sessions/' + noEvents.id + '/history')
    expect(missing.status).toBe(404)
    expect(JSON.stringify(await missing.json())).not.toContain(fixture.paths.root)
    const failure = vi.spyOn(fixture.ctx.projectStorage,
      'projects').mockRejectedValueOnce(new Error('fixture private path ' + fixture.paths.root))
    const unavailable = await request('/user/projects')
    expect(unavailable.status).toBe(500)
    expect(JSON.stringify(await unavailable.json())).not.toContain(fixture.paths.root)
    failure.mockRestore()
  })
  it('bounds bodies and serves project-wide pagination and multi-page UTF-8 export without alternate routes', async () => {
    const fixture = await seededHarness({ http: true, historyPageBytes: 400 }); fixtures.push(fixture)
    const user = fixture.users[0]!, state = await fixture.ctx.webIdentity.state(user.authority)
    const headers = { Cookie: AUTH_COOKIE_NAMES.user + '=' + user.token, Origin: fixture.url!,
      [AUTH_HEADER]: '1', [CSRF_HEADER]: state.csrfToken, 'Content-Type': 'application/json' }
    const project = await fixture.ctx.projectStorage.createProject(user.authority, 'Owner')
    const workspace = await fixture.ctx.projectStorage.createWorkspace(user.authority, project.projectId, 'Owner')
    const header = await fixture.ctx.projectStorage.register(user.authority, workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
    await fixture.ctx.projectStorage.append(user.authority, header.id, oneTurnLog())
    expect((await fetch(fixture.url! + '/user/projects', { method: 'POST', headers,
      body: JSON.stringify({ name: 'x'.repeat(1100) }) })).status).toBe(413)
    for (const path of ['/user/projects', '/user/projects/' + project.projectId + '/workspaces',
      '/user/projects/' + project.projectId + '/sessions', '/user/sessions/' + header.id + '/export']) {
      expect((await fetch(fixture.url! + path, { method: 'PUT', headers })).status).toBe(404)
    }
    const page = await fetch(fixture.url! + '/user/projects/' + project.projectId + '/sessions', { headers })
    expect(parseHistoryPage(await page.json()).sessions[0]!.sessionId).toBe(header.id)
    const raw = (await fixture.ctx.sessionPersistence.readRaw(header.id))!.content
    const exported = await fetch(fixture.url! + '/user/sessions/' + header.id + '/export', { headers })
    expect(await exported.text()).toBe(raw)
  })
  it('closes an export stream if a later physical read fails after its headers are sent', async () => {
    const { fixture, user, headers } = await setup({ historyPageBytes: 400 })
    const project = await fixture.ctx.projectStorage.createProject(user.authority, 'Owner')
    const workspace = await fixture.ctx.projectStorage.createWorkspace(user.authority, project.projectId, 'Owner')
    const header = await fixture.ctx.projectStorage.register(user.authority, workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
    await fixture.ctx.projectStorage.append(user.authority, header.id, oneTurnLog())
    const original = fixture.ctx.sessionPersistence.readRawPage.bind(fixture.ctx.sessionPersistence)
    let reads = 0
    vi.spyOn(fixture.ctx.sessionPersistence, 'readRawPage').mockImplementation(async (...args) => {
      if (++reads === 2) throw Object.assign(new Error('fixture late disk failure'), { code: 'EIO' })
      return original(...args)
    })
    await expect((async () => {
      const response = await fetch(fixture.url! + '/user/sessions/' + header.id + '/export', { headers })
      await response.text()
    })()).rejects.toThrow()
  })
  it('streams a large original owned artifact through real HTTP backpressure without buffering its entire log in navigation', async () => {
    const { fixture, user, request } = await setup()
    const project = await fixture.ctx.projectStorage.createProject(user.authority, 'Large own export')
    const workspace = await fixture.ctx.projectStorage.createWorkspace(user.authority, project.projectId, 'Large own export')
    const header = await fixture.ctx.projectStorage.register(user.authority, workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
    const events = oneTurnLog().map(event => event.type === 'user/message' ? { ...event, data: freezeMessage({
      id: MessageId('large-own-export'), role: 'user', content: [{ type: 'text', text: 'x'.repeat(200_000) }], source: { kind: 'user' },
    }) } : event)
    await fixture.ctx.projectStorage.append(user.authority, header.id, events)
    const original = (await fixture.ctx.sessionPersistence.readRaw(header.id))!.content
    const page = await fixture.ctx.projectStorage.read(user.authority, header.id)
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(128 * 1024)
    expect(page.nextCursor).toBeDefined()
    const exported = await request('/user/sessions/' + header.id + '/export')
    expect(exported.status).toBe(200)
    expect(await exported.text()).toBe(original)
  })
  it('refuses to mount USER project routes in the ADMIN audience', async () => {
    await expect(storageHarness({ http: true, apiAudience: 'admin', readyUsers: 0 })).rejects.toThrow('USER audience')
  })

})
