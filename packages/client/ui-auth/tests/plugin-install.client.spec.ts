// @vitest-environment jsdom
/** Plugin installation over a hand-built Cordis context; async ordering is driven by explicit deferred requests. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@arx-ai/cordis'
import { WebUserId } from '@arx-ai/arx-web-identity/contract'
import { AuthHttpError } from '../src/browser.ts'
import * as plugin from '../src/client/index.ts'
import { createAdminStore, createUserBrowserStore } from '../src/client/stores.ts'
import type { AdminInjected, PublicInjected, UserBrowserInjected } from '../src/client/contract.ts'

type Kind = 'public' | 'admin' | 'user'
interface Principal { status: string; mustChangePassword: boolean; role: string }
interface Registration { opts: Record<string, unknown>; component: unknown }
interface Call { method: string; path: string; body: unknown; resolve(value: unknown): void; reject(cause: unknown): void }

const uuid = (): string => WebUserId(crypto.randomUUID())
const noop = (): void => {}
const settle = async (): Promise<void> => { for (let i = 0; i < 30; i += 1) await Promise.resolve() }
const user: Principal = { status: 'ACTIVE', mustChangePassword: false, role: 'USER' }
const master: Principal = { status: 'ACTIVE', mustChangePassword: false, role: 'MASTER_ADMIN' }

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function makeAuth(principal: Principal | undefined) {
  let snapshot: { principal: Principal | undefined; recovery?: { revision: number; phase: string } } = { principal }
  const listeners = new Set<() => void>()
  const calls: Call[] = []
  const auth = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    initialRoute: 'login',
    login: vi.fn(() => Promise.resolve()), forgotPassword: vi.fn(() => Promise.resolve()),
    resetPassword: vi.fn(() => Promise.resolve()), acceptInvitation: vi.fn(() => Promise.resolve()),
    changePassword: vi.fn(() => Promise.resolve()), logout: vi.fn(() => Promise.resolve()),
    returnToEntry: vi.fn(),
    listUsers: vi.fn(), listModules: vi.fn(),
    createUser: vi.fn(() => Promise.resolve()), setUserStatus: vi.fn(() => Promise.resolve()),
    setUserModules: vi.fn(() => Promise.resolve()), inviteUser: vi.fn(() => Promise.resolve()),
    changeInvitationEmail: vi.fn(() => Promise.resolve()),
    exportHistory: vi.fn(),
    userRequest: vi.fn((method: string, path: string, body?: unknown) =>
      new Promise<unknown>((resolve, reject) => { calls.push({ method, path, body, resolve, reject }) })),
  }
  return {
    auth, calls,
    emit(next: typeof snapshot) { snapshot = next; for (const listener of [...listeners]) listener() },
    /** Resolve the oldest unanswered request to this exact method and path. */
    answer(method: string, path: string, value: unknown): void {
      const index = calls.findIndex(call => call.method === method && call.path === path)
      if (index < 0) throw new Error('no pending request ' + method + ' ' + path)
      calls.splice(index, 1)[0]!.resolve(value)
    },
    fail(method: string, path: string, cause: unknown): void {
      const index = calls.findIndex(call => call.method === method && call.path === path)
      if (index < 0) throw new Error('no pending request ' + method + ' ' + path)
      calls.splice(index, 1)[0]!.reject(cause)
    },
  }
}

interface Options {
  kind?: Kind | undefined
  principal?: Principal | undefined
  runtime?: string
  services?: readonly string[]
  withAuth?: boolean
  withComposition?: boolean
}
function makeCtx(options: Options = {}) {
  const harness = makeAuth('principal' in options ? options.principal : user)
  const registrations: Registration[] = []
  const injects: Array<[string, () => unknown]> = []
  const disposers: Array<() => void> = []
  const dictionaries: unknown[] = []
  // The runtime list holds the sessions the client can select; resume never creates one.
  const listed = new Set<string>()
  const sessions = {
    open: vi.fn((id: string) => { if (!listed.has(id)) throw new Error('sessions.select: unknown session ' + id) }),
    fork: vi.fn(), refresh: vi.fn(() => Promise.resolve()),
    list: { getSnapshot: () => ({ byId: Object.fromEntries([...listed].map(id => [id, { sessionId: id }])) }) },
  }
  const workspaces = { connectWorkspace: vi.fn() }
  const provided: Record<string, unknown> = {}
  if (options.withAuth !== false) provided.webAuth = harness.auth
  if (options.withComposition !== false) provided.clientComposition = { kind: options.kind ?? 'user' }
  for (const name of options.services ?? []) provided[name] = name === 'sessions' ? sessions : name === 'workspaces' ? workspaces : {}
  const ctx = {
    get: (name: string) => provided[name],
    webAuth: harness.auth, sessions, workspaces,
    effect: (fn: () => unknown) => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose as () => void) },
    locale: { register: (_ns: string, dict: unknown) => { dictionaries.push(dict); return noop }, bind: () => (key: string) => key },
    slots: {
      runtime: options.runtime ?? 'application',
      register: (opts: Record<string, unknown>, component: unknown) => { registrations.push({ opts, component }); return noop },
      inject: (name: string, fn: () => unknown) => { injects.push([name, fn]) },
    },
    inject: (_names: string[], callback: (scope: unknown) => void) => { callback(ctx) },
  }
  if (options.withAuth === false) Reflect.deleteProperty(ctx, 'webAuth')
  return { ...harness, ctx: ctx as unknown as Context, registrations, injects, dictionaries, sessions, workspaces,
    listed,
    dispose() { for (const dispose of disposers.splice(0)) dispose() },
    find(name: string, key?: string) {
      const hit = registrations.find(entry => entry.opts.name === name && entry.opts.key === key)
      if (hit === undefined) throw new Error('registration missing ' + name)
      return hit
    } }
}
const injectOf = (entry: Registration) => entry.opts.inject as (actions: unknown) => never

const restores: Array<() => void> = []
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); for (const restore of restores.splice(0)) restore() })

describe('plugin activation', () => {
  it('does nothing without composition and auth, and refuses a half-verified boot', () => {
    const none = makeCtx({ withComposition: false, withAuth: false })
    plugin.apply(none.ctx)
    expect(none.registrations).toEqual([])
    expect(none.dictionaries).toEqual([])
    expect(() => { plugin.apply(makeCtx({ withAuth: false }).ctx) }).toThrow('native identity requires a verified boot')
    expect(() => { plugin.apply(makeCtx({ withComposition: false }).ctx) }).toThrow('native identity requires a verified boot')
  })

  it('registers only the public root for a public composition and maps its commands to revisioned auth calls', async () => {
    const t = makeCtx({ kind: 'public', principal: undefined })
    plugin.apply(t.ctx)
    expect(t.registrations.map(entry => entry.opts.name)).toEqual(['root'])
    expect(t.dictionaries).toHaveLength(1)
    const face = injectOf(t.find('root'))(undefined) as unknown as PublicInjected
    await face.login('who', 'pw', 3); await face.forgot('who', 4); await face.reset('new', 5)
    await face.accept('inv', 6); await face.change('old', 'new', 7); await face.logout(8); face.returnToEntry(9)
    expect(t.auth.login).toHaveBeenCalledWith('who', 'pw', 3)
    expect(t.auth.forgotPassword).toHaveBeenCalledWith('who', 4)
    expect(t.auth.resetPassword).toHaveBeenCalledWith('new', 5)
    expect(t.auth.acceptInvitation).toHaveBeenCalledWith('inv', 6)
    expect(t.auth.changePassword).toHaveBeenCalledWith('old', 'new', 7)
    expect(t.auth.logout).toHaveBeenCalledWith(8)
    expect(t.auth.returnToEntry).toHaveBeenCalledWith(9)
    expect(face.initialRoute).toBe('login')
  })

  it.each([
    ['a non-application runtime', { runtime: 'project' }],
    ['a sessions service', { services: ['sessions'] }],
    ['a workspaces service', { services: ['workspaces'] }],
    ['a connection service', { services: ['connection'] }],
  ])('rejects a public or administrative tree that contains %s', (_label, extra) => {
    for (const kind of ['public', 'admin'] as const) {
      expect(() => { plugin.apply(makeCtx({ kind, principal: master, ...extra }).ctx) })
        .toThrow('public/admin identity tree must not contain project services')
    }
  })

  it('exposes a frozen auth view that retracts the form synchronously only when recovery restarts checking', () => {
    const t = makeCtx({ kind: 'public', principal: undefined })
    plugin.apply(t.ctx)
    const view = (injectOf(t.find('root'))(undefined) as unknown as PublicInjected).hooks.auth
    expect(Object.isFrozen(view)).toBe(true)
    expect(view.getSnapshot()).toBe(t.auth.getSnapshot())
    const listener = vi.fn()
    const unsubscribe = view.subscribe(listener)
    t.emit({ principal: undefined, recovery: { revision: 1, phase: 'checking' } })
    t.emit({ principal: undefined, recovery: { revision: 1, phase: 'checking' } })
    t.emit({ principal: undefined, recovery: { revision: 1, phase: 'ready' } })
    t.emit({ principal: undefined })
    expect(listener).toHaveBeenCalledTimes(4)
    unsubscribe()
    t.emit({ principal: undefined })
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it.each([
    ['no principal', 'admin', undefined],
    ['a blocked principal', 'admin', { ...master, status: 'BLOCKED' }],
    ['a principal who must change the password', 'user', { ...user, mustChangePassword: true }],
    ['a USER where an administrator is required', 'admin', user],
    ['a MASTER_ADMIN where a USER is required', 'user', master],
  ] as const)('refuses a composition that disagrees with the server session: %s', (_label, kind, principal) => {
    expect(() => { plugin.apply(makeCtx({ kind, principal }).ctx) })
      .toThrow('identity composition is not coherent with the current server session')
  })
})

describe('administration install', () => {
  function admin() {
    const t = makeCtx({ kind: 'admin', principal: master })
    plugin.apply(t.ctx)
    const handle = createAdminStore().create()
    const face = injectOf(t.find('auth.admin.page', 'users'))(handle.actions) as unknown as AdminInjected
    return { ...t, handle, face }
  }
  const row = (id: string) => ({ userId: id, username: 'u' + id.slice(0, 4), email: 'e@x.test', role: 'USER', status: 'ACTIVE',
    mustChangePassword: false, grants: [], passwordEstablished: true })

  it('registers root, users, modules and account pages with the right faces', () => {
    const t = admin()
    expect(t.registrations.map(entry => [entry.opts.name, entry.opts.key])).toEqual([
      ['root', undefined], ['auth.admin.page', 'users'], ['auth.admin.page', 'modules'], ['auth.admin.page', 'account']])
    const rootFace = injectOf(t.find('root'))(createAdminStore().create().actions) as unknown as PublicInjected & AdminInjected
    expect(typeof rootFace.login).toBe('function')
    expect(typeof rootFace.refresh).toBe('function')
    expect(typeof (injectOf(t.find('auth.admin.page', 'account'))(undefined) as unknown as PublicInjected).logout).toBe('function')
  })

  it('loads users and modules, appends further pages, and reports failures as sanitized codes', async () => {
    const t = admin()
    const first = uuid(), second = uuid()
    t.auth.listUsers.mockResolvedValueOnce({ users: [row(first)], nextCursor: 'c2' })
    t.auth.listModules.mockResolvedValueOnce({ modules: [{ id: 'storage', label: 'Storage', operations: [] }] })
    t.face.refresh()
    expect(t.handle.store.getSnapshot().busy).toBe(true)
    await settle()
    expect(t.handle.store.getSnapshot()).toMatchObject({ busy: false, nextCursor: 'c2' })
    expect(t.handle.store.getSnapshot().users).toHaveLength(1)
    t.auth.listUsers.mockResolvedValueOnce({ users: [row(second)] })
    t.auth.listModules.mockResolvedValueOnce({ modules: [] })
    t.face.refresh('c2')
    await settle()
    expect(t.auth.listUsers).toHaveBeenLastCalledWith('c2')
    expect(t.handle.store.getSnapshot().users).toHaveLength(2)
    t.auth.listUsers.mockRejectedValueOnce(new AuthHttpError(403, 'FORBIDDEN'))
    t.auth.listModules.mockResolvedValueOnce({ modules: [] })
    t.face.refresh()
    await settle()
    expect(t.handle.store.getSnapshot()).toMatchObject({ busy: false, error: 'FORBIDDEN' })
  })

  it('ignores a refresh result superseded by a newer operation, for both success and failure', async () => {
    const t = admin()
    const slowUsers = deferred<unknown>(), slowFail = deferred<unknown>()
    t.auth.listUsers.mockReturnValueOnce(slowUsers.promise).mockReturnValueOnce(slowFail.promise)
    t.auth.listModules.mockResolvedValue({ modules: [] })
    t.face.refresh(); t.face.refresh('later')
    slowUsers.resolve({ users: [row(uuid())] })
    await settle()
    expect(t.handle.store.getSnapshot().users).toEqual([])
    expect(t.handle.store.getSnapshot().busy).toBe(true)
    slowFail.reject(new AuthHttpError(500, 'BOOM'))
    await settle()
    expect(t.handle.store.getSnapshot()).toMatchObject({ busy: false, error: 'BOOM' })
    const stale = deferred<unknown>()
    t.auth.listUsers.mockReturnValueOnce(stale.promise)
    t.face.refresh()
    t.auth.listUsers.mockResolvedValueOnce({ users: [] })
    t.face.refresh()
    stale.reject(new Error('late'))
    await settle()
    expect(t.handle.store.getSnapshot().error).toBeUndefined()
  })

  it('runs each mutation, reloads the first page, and notifies; failures surface a code', async () => {
    const t = admin()
    const id = uuid()
    t.auth.listUsers.mockResolvedValue({ users: [row(id)], nextCursor: undefined })
    t.auth.listModules.mockResolvedValue({ modules: [] })
    t.face.create('name', 'a@b.test'); await settle()
    expect(t.auth.createUser).toHaveBeenCalledWith('name', 'a@b.test')
    expect(t.handle.store.getSnapshot().notice).toBe('userCreated')
    t.face.status(row(id).userId as never, 'BLOCKED'); await settle()
    expect(t.auth.setUserStatus).toHaveBeenCalledWith(id, 'BLOCKED')
    t.face.modules(id as never, ['storage'] as never); await settle()
    expect(t.auth.setUserModules).toHaveBeenCalledWith(id, ['storage'])
    t.face.invite(id as never); await settle()
    expect(t.auth.inviteUser).toHaveBeenCalledWith(id)
    t.face.invitationEmail(id as never, 'n@b.test'); await settle()
    expect(t.auth.changeInvitationEmail).toHaveBeenCalledWith(id, 'n@b.test')
    expect(t.handle.store.getSnapshot().notice).toBe('accepted')
    t.auth.inviteUser.mockRejectedValueOnce(new AuthHttpError(409, 'CONFLICT'))
    t.face.invite(id as never); await settle()
    expect(t.handle.store.getSnapshot().error).toBe('CONFLICT')
  })

  it('drops a mutation outcome after a newer operation or disposal, and clears the store on disposal', async () => {
    const t = admin()
    const id = uuid()
    const slow = deferred<undefined>()
    t.auth.listUsers.mockResolvedValue({ users: [row(id)] })
    t.auth.listModules.mockResolvedValue({ modules: [] })
    t.auth.inviteUser.mockReturnValueOnce(slow.promise)
    t.face.invite(id as never)
    t.face.refresh(); await settle()
    expect(t.handle.store.getSnapshot().users).toHaveLength(1)
    t.handle.actions.notify('accepted'); t.handle.actions.pending(false)
    slow.resolve(undefined); await settle()
    expect(t.handle.store.getSnapshot().notice).toBe('accepted')
    const failing = deferred<undefined>()
    t.auth.inviteUser.mockReturnValueOnce(failing.promise)
    t.face.invite(id as never)
    t.dispose()
    expect(t.handle.store.getSnapshot().users).toEqual([])
    failing.reject(new Error('after dispose')); await settle()
    expect(t.handle.store.getSnapshot().error).toBeUndefined()
    const afterDispose = deferred<undefined>()
    t.auth.inviteUser.mockReturnValueOnce(afterDispose.promise)
    t.face.invite(id as never)
    t.dispose()
    afterDispose.resolve(undefined); await settle()
    expect(t.handle.store.getSnapshot().notice).toBeUndefined()
    t.auth.listUsers.mockRejectedValueOnce(new Error('x'))
    t.face.refresh(); t.dispose(); await settle()
    expect(t.handle.store.getSnapshot().error).toBeUndefined()
  })
})

describe('owner browser install', () => {
  const project = (projectId: string, name = 'P') => ({ projectId, name, createdAt: 1 })
  const workspace = (workspaceId: string, projectId: string, grouped = false) => ({ workspaceId, projectId, name: 'W', createdAt: 1, grouped })
  const session = (sessionId: string, projectId: string, title = 'S') => ({ sessionId, projectId, workspaceId: uuid(), createdAt: 1, nextSeq: 4, title, grouped: false })
  function owner(options: Options = {}) {
    const t = makeCtx({ kind: 'user', principal: user, runtime: 'project', services: ['sessions', 'workspaces'], ...options })
    plugin.apply(t.ctx)
    const handle = createUserBrowserStore().create()
    for (const [name, install] of t.injects) if (name === 'sidebar.workspaces') install()
    const face = injectOf(t.find('sidebar.workspaces'))(handle.actions) as unknown as UserBrowserInjected
    return { ...t, handle, face }
  }

  it('registers the project sidebar, settings, account and sign-out contributions inside a project tree', () => {
    const t = owner()
    for (const [, install] of t.injects) install()
    const names = t.registrations.map(entry => [entry.opts.name, entry.opts.id])
    expect(names).toEqual(expect.arrayContaining([['sidebar.workspaces', undefined], ['settings.section', 'account'],
      ['sidebar.footer.action', 'account'], ['sidebar.footer.action', 'signout']]))
    expect((t.find('settings.section').opts.label as () => string)()).toBe('account')
    const signout = t.registrations.find(entry => entry.opts.id === 'signout')!
    void (injectOf(signout)(undefined) as unknown as { logout(): Promise<void> }).logout()
    expect(t.auth.logout).toHaveBeenCalledWith()
    expect(t.face.projectRuntimeAvailable).toBe(true)
  })

  it('serves an HTTP-only user home without project services and denies execution actions', async () => {
    const t = makeCtx({ kind: 'user', principal: user })
    plugin.apply(t.ctx)
    expect(t.registrations.map(entry => [entry.opts.name, entry.opts.key])).toEqual([
      ['root', undefined], ['auth.user.page', 'projects'], ['auth.user.page', 'account']])
    const handle = createUserBrowserStore().create()
    const face = injectOf(t.find('auth.user.page', 'projects'))(handle.actions) as unknown as UserBrowserInjected
    expect(face.projectRuntimeAvailable).toBe(false)
    expect(typeof (injectOf(t.find('root'))(undefined) as unknown as PublicInjected).logout).toBe('function')
    face.openWorkspace(uuid() as never); await settle()
    expect(handle.store.getSnapshot().error).toBe('PROJECT_RUNTIME_REQUIRED')
    face.resume(uuid() as never); await settle()
    expect(handle.store.getSnapshot().error).toBe('PROJECT_RUNTIME_REQUIRED')
    face.fork(uuid() as never); await settle()
    expect(handle.store.getSnapshot().error).toBe('PROJECT_RUNTIME_REQUIRED')
    expect(t.sessions.open).not.toHaveBeenCalled()
  })

  it('lists projects with cursors and clears the selection when the empty project is chosen', async () => {
    const t = owner()
    const a = uuid()
    t.face.refreshProjects(); await settle()
    t.answer('GET', '/user/projects', { projects: [project(a)], nextCursor: 'p2' })
    await settle()
    expect(t.handle.store.getSnapshot()).toMatchObject({ busy: false, projectCursor: 'p2' })
    t.face.refreshProjects('p 2'); await settle()
    t.answer('GET', '/user/projects?cursor=p%202', { projects: [project(uuid())] })
    await settle()
    expect(t.handle.store.getSnapshot().projects).toHaveLength(2)
    t.face.selectProject(a); await settle()
    expect(t.handle.store.getSnapshot().projectId).toBe(a)
    t.face.selectProject(''); await settle()
    expect(t.handle.store.getSnapshot()).toMatchObject({ projectId: undefined, projects: [] })
    t.answer('GET', '/user/projects', { projects: [] }); await settle()
    t.auth.userRequest.mockClear()
    t.face.refreshProjects(); await settle()
    t.fail('GET', '/user/projects', new AuthHttpError(401, 'AUTH_REQUIRED')); await settle()
    expect(t.handle.store.getSnapshot().error).toBe('AUTH_REQUIRED')
  })

  it('applies workspace and session pages for the selected project and appends later pages', async () => {
    const t = owner()
    const p = uuid(), w = uuid(), s = uuid()
    const base = '/user/projects/' + p
    t.face.selectProject(p); await settle()
    t.answer('GET', base + '/workspaces', { workspaces: [workspace(w, p)], nextCursor: 'w2' })
    t.answer('GET', base + '/sessions', { sessions: [session(s, p)], nextCursor: 's2' })
    await settle()
    expect(t.handle.store.getSnapshot()).toMatchObject({ workspaceCursor: 'w2', sessionCursor: 's2', busy: false })
    t.face.moreWorkspaces('w 2'); t.face.moreSessions('s 2'); await settle()
    t.answer('GET', base + '/workspaces?cursor=w%202', { workspaces: [workspace(uuid(), p)] })
    t.answer('GET', base + '/sessions?cursor=s%202', { sessions: [session(uuid(), p)] })
    await settle()
    expect(t.handle.store.getSnapshot().workspaces).toHaveLength(2)
    expect(t.handle.store.getSnapshot().sessions).toHaveLength(2)
  })

  it('discards a stale sessions page when the selection changes before it arrives', async () => {
    const t = owner()
    const first = uuid(), second = uuid()
    t.face.selectProject(first); await settle()
    const staleSession = session(uuid(), first, 'stale')
    t.face.selectProject(second); await settle()
    t.answer('GET', '/user/projects/' + second + '/workspaces', { workspaces: [] })
    t.answer('GET', '/user/projects/' + second + '/sessions', { sessions: [session(uuid(), second, 'fresh')] })
    await settle()
    t.answer('GET', '/user/projects/' + first + '/sessions', { sessions: [staleSession], nextCursor: 'stale-cursor' })
    t.answer('GET', '/user/projects/' + first + '/workspaces', { workspaces: [workspace(uuid(), first)] })
    await settle()
    expect(t.handle.store.getSnapshot().projectId).toBe(second)
    expect(t.handle.store.getSnapshot().sessions.map(row => row.title)).toEqual(['fresh'])
    expect(t.handle.store.getSnapshot().workspaces).toEqual([])
    expect(t.handle.store.getSnapshot().sessionCursor).toBeUndefined()
  })

  it('discards sessions, workspaces and project pages that arrive after disposal', async () => {
    const t = owner()
    const p = uuid()
    t.face.refreshProjects()
    t.face.selectProject(p); await settle()
    t.dispose()
    t.answer('GET', '/user/projects', { projects: [project(uuid())] })
    t.answer('GET', '/user/projects/' + p + '/workspaces', { workspaces: [workspace(uuid(), p)] })
    t.answer('GET', '/user/projects/' + p + '/sessions', { sessions: [session(uuid(), p)] })
    await settle()
    expect(t.handle.store.getSnapshot()).toMatchObject({ projects: [], workspaces: [], sessions: [], projectId: undefined })
  })

  it('does not report the failure of a superseded or disposed operation', async () => {
    const t = owner()
    const p = uuid()
    t.face.selectProject(p); await settle()
    t.face.selectProject(uuid()); await settle()
    t.fail('GET', '/user/projects/' + p + '/workspaces', new Error('stale failure'))
    await settle()
    expect(t.handle.store.getSnapshot().error).toBeUndefined()
    t.dispose()
    t.face.refreshProjects(); t.dispose()
    t.fail('GET', '/user/projects', new Error('after dispose')); await settle()
    expect(t.handle.store.getSnapshot().error).toBeUndefined()
  })

  it('creates a project, selects it and loads its content, stopping when the epoch changes meanwhile', async () => {
    const t = owner()
    const p = uuid()
    t.face.createProject('New'); await settle()
    expect(t.calls.at(-1)).toMatchObject({ method: 'POST', path: '/user/projects', body: { name: 'New' } })
    t.answer('POST', '/user/projects', { project: project(p, 'New') }); await settle()
    t.answer('GET', '/user/projects', { projects: [project(p, 'New')] }); await settle()
    expect(t.handle.store.getSnapshot().projectId).toBe(p)
    t.answer('GET', '/user/projects/' + p + '/workspaces', { workspaces: [] })
    t.answer('GET', '/user/projects/' + p + '/sessions', { sessions: [] })
    await settle()
    // Selection changes while the creation response is in flight.
    t.face.createProject('Raced'); await settle()
    t.face.selectProject(uuid()); await settle()
    t.answer('POST', '/user/projects', { project: project(uuid(), 'Raced') }); await settle()
    expect(t.calls.some(call => call.path === '/user/projects' && call.method === 'GET')).toBe(false)
    // Selection changes while the follow-up project list is in flight.
    t.calls.length = 0
    t.face.createProject('Raced2'); await settle()
    t.answer('POST', '/user/projects', { project: project(uuid(), 'Raced2') }); await settle()
    t.face.selectProject(uuid()); await settle()
    const before = t.handle.store.getSnapshot().projectId
    t.answer('GET', '/user/projects', { projects: [] }); await settle()
    expect(t.handle.store.getSnapshot().projectId).toBe(before)
  })

  it('creates a workspace and refreshes only while the selection is unchanged', async () => {
    const t = owner()
    const p = uuid()
    t.face.selectProject(p); await settle()
    t.answer('GET', '/user/projects/' + p + '/workspaces', { workspaces: [] })
    t.answer('GET', '/user/projects/' + p + '/sessions', { sessions: [] }); await settle()
    t.face.createWorkspace('Work'); await settle()
    t.answer('POST', '/user/projects/' + p + '/workspaces', { workspace: workspace(uuid(), p) }); await settle()
    t.answer('GET', '/user/projects/' + p + '/workspaces', { workspaces: [workspace(uuid(), p)] }); await settle()
    expect(t.handle.store.getSnapshot().workspaces).toHaveLength(1)
    t.calls.length = 0
    t.face.createWorkspace('Late'); await settle()
    t.face.selectProject(uuid()); await settle()
    t.answer('POST', '/user/projects/' + p + '/workspaces', { workspace: workspace(uuid(), p) }); await settle()
    expect(t.calls.some(call => call.method === 'GET' && call.path === '/user/projects/' + p + '/workspaces')).toBe(false)
  })

  it('opens workspaces and sessions through the project runtime and refreshes sessions afterwards', async () => {
    const t = owner()
    const p = uuid(), w = uuid(), s = uuid(), child = uuid()
    // Runtime create and fork resolve only after their session is in the list.
    t.listed.add(s); t.listed.add(child)
    t.face.selectProject(p); await settle()
    t.workspaces.connectWorkspace.mockResolvedValueOnce(s)
    t.face.openWorkspace(w as never); await settle()
    expect(t.sessions.open).toHaveBeenCalledWith(s)
    t.answer('GET', '/user/projects/' + p + '/sessions', { sessions: [session(s, p)] }); await settle()
    expect(t.handle.store.getSnapshot().sessions).toHaveLength(1)
    t.face.resume(s as never); await settle()
    expect(t.sessions.open).toHaveBeenCalledTimes(2)
    t.sessions.fork.mockResolvedValueOnce(child)
    t.face.fork(s as never); await settle()
    expect(t.sessions.fork).toHaveBeenCalledWith({ sessionId: s, increaseTitle: true })
    expect(t.sessions.open).toHaveBeenLastCalledWith(child)
    t.answer('GET', '/user/projects/' + p + '/sessions', { sessions: [] }); await settle()
    // Selection moves on before the runtime answers: nothing is opened.
    const slowConnect = deferred<string>(), slowFork = deferred<string>()
    t.workspaces.connectWorkspace.mockReturnValueOnce(slowConnect.promise)
    t.sessions.fork.mockReturnValueOnce(slowFork.promise)
    t.face.openWorkspace(w as never); t.face.fork(s as never); await settle()
    t.face.selectProject(uuid()); await settle()
    t.sessions.open.mockClear()
    slowConnect.resolve(uuid()); slowFork.resolve(uuid()); await settle()
    expect(t.sessions.open).not.toHaveBeenCalled()
    t.face.resume(s as never); t.face.selectProject(uuid())
    await settle()
    expect(t.sessions.open).toHaveBeenCalledTimes(1)
  })

  it('waits for the runtime session list pull before resuming a session the list does not hold yet', async () => {
    const t = owner()
    const s = uuid()
    const pull = deferred<undefined>()
    t.sessions.refresh.mockReturnValueOnce(pull.promise)
    t.face.resume(s as never); await settle()
    expect(t.sessions.refresh).toHaveBeenCalledTimes(1)
    expect(t.sessions.open).not.toHaveBeenCalled()
    t.listed.add(s); pull.resolve(undefined); await settle()
    expect(t.sessions.open).toHaveBeenCalledWith(s)
    expect(t.handle.store.getSnapshot().error).toBeUndefined()
    t.face.resume(s as never); await settle()
    expect(t.sessions.refresh).toHaveBeenCalledTimes(1)
    expect(t.sessions.fork).not.toHaveBeenCalled()
    expect(t.workspaces.connectWorkspace).not.toHaveBeenCalled()
  })

  it('shows an error for a session still unknown after the pull, creates nothing, and pulls again on retry', async () => {
    const t = owner()
    const s = uuid()
    t.face.resume(s as never); await settle()
    expect(t.handle.store.getSnapshot()).toMatchObject({ error: 'OPERATION_FAILED', busy: false })
    expect(t.sessions.fork).not.toHaveBeenCalled()
    expect(t.workspaces.connectWorkspace).not.toHaveBeenCalled()
    t.sessions.refresh.mockImplementationOnce(() => { t.listed.add(s); return Promise.resolve() })
    t.face.resume(s as never); await settle()
    expect(t.sessions.refresh).toHaveBeenCalledTimes(2)
    expect(t.sessions.open).toHaveBeenLastCalledWith(s)
    expect(t.handle.store.getSnapshot().error).toBeUndefined()
  })

  it('shows a history page only for the requested session and ignores a mismatched or stale response', async () => {
    const t = owner()
    const s = uuid(), other = uuid()
    t.face.history(s as never); await settle()
    t.answer('GET', '/user/sessions/' + s + '/history', { sessionId: s, nextSeq: 1, content: 'one\n', nextCursor: 'h2' }); await settle()
    expect(t.handle.store.getSnapshot().history).toEqual({ sessionId: s, content: 'one\n', cursor: 'h2' })
    t.face.history(s as never, 'h 2'); await settle()
    t.answer('GET', '/user/sessions/' + s + '/history?cursor=h%202', { sessionId: s, nextSeq: 2, content: 'two\n' }); await settle()
    expect(t.handle.store.getSnapshot().history).toEqual({ sessionId: s, content: 'one\ntwo\n', cursor: undefined })
    t.face.history(s as never); await settle()
    t.answer('GET', '/user/sessions/' + s + '/history', { sessionId: other, nextSeq: 1, content: 'wrong\n' }); await settle()
    expect(t.handle.store.getSnapshot().history?.content).toBe('one\ntwo\n')
    t.face.history(s as never); await settle()
    t.face.selectProject(uuid()); await settle()
    t.answer('GET', '/user/sessions/' + s + '/history', { sessionId: s, nextSeq: 1, content: 'stale\n' }); await settle()
    expect(t.handle.store.getSnapshot().history).toBeUndefined()
  })

  it('exports history as a downloadable file that is released after the click, and revokes pending downloads on disposal', async () => {
    vi.useFakeTimers()
    const t = owner()
    const create = vi.fn(() => 'blob:one'), revoke = vi.fn()
    const originals = { create: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'), revoke: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL') }
    Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true, writable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true, writable: true })
    restores.push(() => {
      for (const [key, descriptor] of [['createObjectURL', originals.create], ['revokeObjectURL', originals.revoke]] as const) {
        if (descriptor === undefined) Reflect.deleteProperty(URL, key)
        else Object.defineProperty(URL, key, descriptor)
      }
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(noop)
    const s = uuid()
    t.auth.exportHistory.mockResolvedValue(new Blob(['x']))
    t.face.export(s as never); await settle()
    expect(click).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(revoke).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:one')
    revoke.mockClear()
    t.auth.exportHistory.mockResolvedValue(new Blob(['y']))
    t.face.export(s as never); await settle()
    t.dispose()
    expect(revoke).toHaveBeenCalledWith('blob:one')
    // A response that arrives after the selection changed produces no download.
    const t2 = owner()
    const slow = deferred<Blob>()
    t2.auth.exportHistory.mockReturnValueOnce(slow.promise)
    t2.face.export(s as never); t2.face.selectProject(uuid())
    slow.resolve(new Blob(['z'])); await settle()
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('deletes and renames sessions through the owner route and refreshes the list while selected', async () => {
    const t = owner()
    const p = uuid(), s = uuid()
    t.face.selectProject(p); await settle()
    t.handle.actions.history(s as never, 'text', undefined, false)
    t.face.deleteSession(s as never); await settle()
    t.answer('DELETE', '/user/sessions/' + s, {}); await settle()
    expect(t.handle.store.getSnapshot().history).toBeUndefined()
    t.answer('GET', '/user/projects/' + p + '/sessions', { sessions: [] }); await settle()
    t.face.rename(s as never, 'New title'); await settle()
    expect(t.calls.at(-1)).toMatchObject({ method: 'PATCH', body: { title: 'New title' } })
    t.answer('PATCH', '/user/sessions/' + s, {}); await settle()
    t.answer('GET', '/user/projects/' + p + '/sessions', { sessions: [session(s, p, 'New title')] }); await settle()
    expect(t.handle.store.getSnapshot().sessions[0]?.title).toBe('New title')
    t.calls.length = 0
    t.face.deleteSession(s as never); await settle()
    t.face.selectProject(uuid()); await settle()
    t.answer('DELETE', '/user/sessions/' + s, {}); await settle()
    expect(t.calls.some(call => call.path === '/user/projects/' + p + '/sessions')).toBe(false)
  })

  it('ungroups a workspace and reloads the project only while it is still selected', async () => {
    const t = owner()
    const p = uuid(), w = uuid()
    t.face.selectProject(p); await settle()
    t.calls.length = 0
    t.face.ungroup(w as never); await settle()
    t.answer('DELETE', '/user/workspaces/' + w + '/grouping', {}); await settle()
    expect(t.calls.map(call => call.path).sort()).toEqual(['/user/projects/' + p + '/sessions', '/user/projects/' + p + '/workspaces'])
    t.calls.length = 0
    t.face.ungroup(w as never); await settle()
    t.face.selectProject(uuid()); await settle()
    t.answer('DELETE', '/user/workspaces/' + w + '/grouping', {}); await settle()
    expect(t.calls.some(call => call.path.startsWith('/user/projects/' + p))).toBe(false)
  })

  it('refuses project-scoped actions before a project is selected and ignores resume after disposal', async () => {
    const t = owner()
    t.face.createWorkspace('Orphan'); await settle()
    expect(t.handle.store.getSnapshot().error).toBe('OPERATION_FAILED')
    t.face.moreSessions('c'); await settle()
    expect(t.handle.store.getSnapshot().error).toBe('OPERATION_FAILED')
    expect(t.calls).toEqual([])
    t.dispose()
    t.face.resume(uuid() as never); await settle()
    expect(t.sessions.open).not.toHaveBeenCalled()
  })
})
