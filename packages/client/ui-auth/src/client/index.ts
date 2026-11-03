/** One Cordis UI plugin, three independently assembled native identity compositions. */
import type { Context } from '@arx-ai/cordis'
import { flushSync } from 'react-dom'
import type { HostObservable, BoundActions } from '@arx-ai/arx-client-ui-slots'
import type {} from '@arx-ai/arx-client-slots/client'
import type {} from '@arx-ai/arx-client-locale/client'
import type {} from '@arx-ai/arx-client-runtime/client'
import type { AuthView, BrowserAuthClient } from '../browser.ts'
import { AuthHttpError } from '../browser.ts'
import { ProjectId } from '@arx-ai/arx-web-identity/contract'
import {
  parseProjectsPage, parseWorkspacesPage, parseHistoryPage, parseHistoryArtifactPage,
  parseCreatedProject, parseCreatedWorkspace,
} from '@arx-ai/arx-project-storage/contract'
import type { StoredSessionSummary } from '@arx-ai/arx-project-storage/contract'
import { createAdminStore, createUserBrowserStore } from './stores.ts'
import type { PublicInjected, AdminInjected, UserBrowserInjected } from './contract.ts'
import { PublicRoot, Account, LogoutFooter, AccountFooter } from './forms.tsx'
import { AdminRoot, AdminUsers, AdminModules, AdminAccount } from './Admin.tsx'
import { UserHome, UserHomeAccount } from './UserHome.tsx'
import { UserBrowser } from './UserBrowser.tsx'
import { authErrorCode } from './errors.ts'
import { en, pt } from './locales.ts'

declare module '@arx-ai/cordis' {
  interface Context {
    /** Auth transport supplied by verified Client boot; this provider binds its UI. */
    readonly webAuth: BrowserAuthClient
  }
}

export const inject = ['slots', 'locale']
export type { PublicProps, AccountProps, AdminProps, AdminPageProps, UserBrowserProps } from './contract.ts'

/** This plugin does no work on the explicit legacy local profile. */
export function apply(ctx: Context): void {
  const composition = ctx.get('clientComposition')
  const auth = ctx.get('webAuth')
  if (composition === undefined && auth === undefined) return
  if (composition === undefined || auth === undefined) throw new Error('native identity requires a verified boot')
  ctx.effect(() => ctx.locale.register('auth', { en, pt }), 'ui-auth: dictionaries')
  // Recovery is a native event callback. Retire its old form before the fresh GET;
  // normal auth updates retain React's usual notification scheduling.
  const readonlyAuthView: HostObservable<AuthView> = Object.freeze({
    getSnapshot: () => auth.getSnapshot(),
    subscribe(listener: () => void) {
      let previous = auth.getSnapshot().recovery?.revision
      return auth.subscribe(() => {
        const recovery = auth.getSnapshot().recovery
        const retract = recovery?.phase === 'checking' && recovery.revision !== previous
        previous = recovery?.revision
        if (retract) flushSync(listener)
        else listener()
      })
    },
  })
  const publicFace = (): PublicInjected => ({
    hooks: { auth: readonlyAuthView }, initialRoute: auth.initialRoute,
    login: (identifier, password, revision) => auth.login(identifier, password, revision),
    forgot: (identifier, revision) => auth.forgotPassword(identifier, revision),
    reset: (password, revision) => auth.resetPassword(password, revision),
    accept: (password, revision) => auth.acceptInvitation(password, revision),
    change: (current, password, revision) => auth.changePassword(current, password, revision),
    logout: revision => auth.logout(revision),
    returnToEntry: (revision) => { auth.returnToEntry(revision) },
  })
  if (composition.kind !== 'user') {
    if (ctx.slots.runtime !== 'application' || ctx.get('sessions') !== undefined
      || ctx.get('workspaces') !== undefined || ctx.get('connection') !== undefined) {
      throw new Error('public/admin identity tree must not contain project services')
    }
  }
  if (composition.kind === 'public') {
    ctx.slots.register({ name: 'root', runtime: 'application', locale: 'auth', inject: publicFace }, PublicRoot)
    return
  }
  const principal = auth.getSnapshot().principal
  if (principal === undefined || principal.status !== 'ACTIVE' || principal.mustChangePassword
    || (composition.kind === 'admin' ? principal.role !== 'MASTER_ADMIN' : principal.role !== 'USER')) {
    throw new Error('identity composition is not coherent with the current server session')
  }
  if (composition.kind === 'admin') {
    installAdmin(ctx, publicFace)
    return
  }
  if (ctx.slots.runtime === 'application') {
    installUser(ctx, publicFace, false)
    return
  }
  // A real user project tree owns these services. There is no application-mode
  // substitute and no fake sessions/workspaces to make public/admin render.
  ctx.inject(['sessions', 'workspaces'], (scope) => { installUser(scope, publicFace) })
}

function installAdmin(ctx: Context, publicFace: () => PublicInjected): void {
  const auth = ctx.webAuth
  const store = createAdminStore()
  let live = true
  let sequence = 0
  let bound: BoundActions<typeof store> | undefined
  ctx.effect(() => () => { live = false; sequence += 1; bound?.clear(); bound = undefined }, 'ui-auth: administration lifetime')
  const face = (actions: BoundActions<typeof store>): AdminInjected => {
    bound = actions
    const refresh = async (cursor?: string): Promise<void> => {
      const current = ++sequence
      actions.pending(true)
      try {
        const [users, modules] = await Promise.all([auth.listUsers(cursor), auth.listModules()])
        if (live && current === sequence) actions.loaded(users.users, modules.modules, users.nextCursor, cursor !== undefined)
      } catch (cause) { if (live && current === sequence) actions.fail(authErrorCode(cause)) }
    }
    const mutate = async (operation: () => Promise<void>, notice: 'accepted' | 'userCreated' = 'accepted'): Promise<void> => {
      const current = ++sequence
      actions.pending(true)
      try {
        await operation()
        const [users, modules] = await Promise.all([auth.listUsers(), auth.listModules()])
        if (live && current === sequence) {
          actions.loaded(users.users, modules.modules, users.nextCursor, false)
          actions.notify(notice)
        }
      } catch (cause) { if (live && current === sequence) actions.fail(authErrorCode(cause)) }
    }
    return {
      refresh: (cursor) => { void refresh(cursor) },
      create: (username, email) => { void mutate(() => auth.createUser(username, email), 'userCreated') },
      status: (userId, status) => { void mutate(() => auth.setUserStatus(userId, status)) },
      modules: (userId, grants) => { void mutate(() => auth.setUserModules(userId, grants)) },
      invite: (userId) => { void mutate(() => auth.inviteUser(userId)) },
      invitationEmail: (userId, email) => { void mutate(() => auth.changeInvitationEmail(userId, email)) },
    }
  }
  ctx.slots.register({
    name: 'root', runtime: 'application', store, locale: 'auth',
    children: { 'auth.admin.page': { kind: 'keyed', scope: 'root' } },
    inject: actions => ({ ...publicFace(), ...face(actions) }),
  }, AdminRoot)
  ctx.slots.register({ name: 'auth.admin.page', runtime: 'application', key: 'users', store, locale: 'auth', inject: face }, AdminUsers)
  ctx.slots.register({ name: 'auth.admin.page', runtime: 'application', key: 'modules', store, locale: 'auth', inject: face }, AdminModules)
  ctx.slots.register({ name: 'auth.admin.page', runtime: 'application', key: 'account', locale: 'auth', inject: publicFace }, AdminAccount)
}

function installUser(ctx: Context, publicFace: () => PublicInjected, projectRuntimeAvailable = true): void {
  const auth = ctx.webAuth
  const store = createUserBrowserStore()
  let live = true
  let selection = 0
  let selectedProject: string | undefined
  let bound: BoundActions<typeof store> | undefined
  const downloads = new Set<string>()
  ctx.effect(() => () => {
    live = false; selection += 1; selectedProject = undefined
    bound?.clear(); bound = undefined
    for (const url of downloads) URL.revokeObjectURL(url)
    downloads.clear()
  }, 'ui-auth: own project/history lifetime')
  const injected = (actions: BoundActions<typeof store>): UserBrowserInjected => {
    bound = actions
    const perform = async (operation: (epoch: number) => void | Promise<void>): Promise<void> => {
      const epoch = selection
      actions.pending()
      try { await operation(epoch) }
      catch (cause) { if (live && epoch === selection) actions.fail(authErrorCode(cause)) }
    }
    const same = (epoch: number): boolean => live && epoch === selection
    const projectRoute = (): string => {
      if (selectedProject === undefined) throw new Error('no selected project')
      return '/user/projects/' + encodeURIComponent(selectedProject)
    }
    const workspaces = async (epoch: number, cursor?: string): Promise<void> => {
      const result = parseWorkspacesPage(await auth.userRequest('GET', projectRoute() + '/workspaces'
        + (cursor === undefined ? '' : '?cursor=' + encodeURIComponent(cursor))))
      if (same(epoch)) actions.workspaces(result.workspaces, result.nextCursor, cursor !== undefined)
    }
    const sessions = async (epoch: number, cursor?: string): Promise<void> => {
      const result = parseHistoryPage(await auth.userRequest('GET', projectRoute() + '/sessions'
        + (cursor === undefined ? '' : '?cursor=' + encodeURIComponent(cursor))))
      if (same(epoch)) actions.sessions(result.sessions, result.nextCursor, cursor !== undefined)
    }
    const refreshProjects = async (epoch: number, cursor?: string): Promise<void> => {
      const result = parseProjectsPage(await auth.userRequest('GET', '/user/projects'
        + (cursor === undefined ? '' : '?cursor=' + encodeURIComponent(cursor))))
      if (same(epoch)) actions.projects(result.projects, result.nextCursor, cursor !== undefined)
    }
    const refreshProject = async (epoch: number): Promise<void> => { await Promise.all([workspaces(epoch), sessions(epoch)]) }
    const mutateSession = async (epoch: number, sessionId: StoredSessionSummary['sessionId'], method: 'DELETE' | 'PATCH', body?: unknown): Promise<void> => {
      await auth.userRequest(method, '/user/sessions/' + encodeURIComponent(sessionId), body)
      if (same(epoch)) { actions.closeHistory(); await sessions(epoch) }
    }
    return {
      projectRuntimeAvailable,
      refreshProjects: (cursor) => { void perform(epoch => refreshProjects(epoch, cursor)) },
      selectProject: (projectId) => {
        selection += 1
        selectedProject = projectId === '' ? undefined : ProjectId(projectId)
        if (selectedProject === undefined) { actions.clear(); void perform(epoch => refreshProjects(epoch)); return }
        actions.select(selectedProject)
        void perform(epoch => refreshProject(epoch))
      },
      createProject: (name) => { void perform(async (epoch) => {
        const project = parseCreatedProject(await auth.userRequest('POST', '/user/projects', { name }))
        if (!same(epoch)) return
        await refreshProjects(epoch)
        if (!same(epoch)) return
        selectedProject = project.projectId; actions.select(project.projectId)
        await refreshProject(epoch)
      }) },
      createWorkspace: (name) => { void perform(async (epoch) => {
        parseCreatedWorkspace(await auth.userRequest('POST', projectRoute() + '/workspaces', { name }))
        if (same(epoch)) await workspaces(epoch)
      }) },
      moreWorkspaces: (cursor) => { void perform(epoch => workspaces(epoch, cursor)) },
      moreSessions: (cursor) => { void perform(epoch => sessions(epoch, cursor)) },
      openWorkspace: (workspaceId) => { void perform(async (epoch) => {
        if (!projectRuntimeAvailable) throw new AuthHttpError(403, 'PROJECT_RUNTIME_REQUIRED')
        // HTTP provisioned workspaces may not be in the older runtime baseline yet.
        // The existing create protocol admits the opaque owned workspace id;
        // it allocates a genuine session without inventing a path or WorkspaceView.
        const sessionId = await ctx.workspaces.connectWorkspace(workspaceId)
        if (same(epoch)) { ctx.sessions.open(sessionId); actions.ready(); await sessions(epoch) }
      }) },
      resume: (sessionId) => { void perform((epoch) => {
        if (!projectRuntimeAvailable) throw new AuthHttpError(403, 'PROJECT_RUNTIME_REQUIRED')
        // Open consumes existing runtime metadata/history. It does not issue a user message.
        if (same(epoch)) { ctx.sessions.open(sessionId); actions.ready() }
      }) },
      fork: (sessionId) => { void perform(async (epoch) => {
        if (!projectRuntimeAvailable) throw new AuthHttpError(403, 'PROJECT_RUNTIME_REQUIRED')
        const child = await ctx.sessions.fork({ sessionId, increaseTitle: true })
        if (same(epoch)) { ctx.sessions.open(child); await sessions(epoch) }
      }) },
      history: (sessionId, cursor) => { void perform(async (epoch) => {
        const result = parseHistoryArtifactPage(await auth.userRequest('GET', '/user/sessions/' + encodeURIComponent(sessionId)
          + '/history' + (cursor === undefined ? '' : '?cursor=' + encodeURIComponent(cursor))))
        if (same(epoch) && result.sessionId === sessionId) {
          actions.history(sessionId, result.content, result.nextCursor, cursor !== undefined)
        }
      }) },
      export: (sessionId) => { void perform(async (epoch) => {
        const blob = await auth.exportHistory(sessionId)
        if (!same(epoch)) return
        const url = URL.createObjectURL(blob); downloads.add(url)
        const anchor = document.createElement('a')
        anchor.href = url; anchor.download = 'historico.jsonl'; anchor.rel = 'noopener'; anchor.click()
        setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url) }, 0)
        actions.ready()
      }) },
      deleteSession: (sessionId) => { void perform(epoch => mutateSession(epoch, sessionId, 'DELETE')) },
      rename: (sessionId, title) => { void perform(epoch => mutateSession(epoch, sessionId, 'PATCH', { title })) },
      ungroup: (workspaceId) => { void perform(async (epoch) => {
        await auth.userRequest('DELETE', '/user/workspaces/' + encodeURIComponent(workspaceId) + '/grouping')
        if (same(epoch)) await refreshProject(epoch)
      }) },
    }
  }
  if (!projectRuntimeAvailable) {
    ctx.slots.register({ name: 'root', runtime: 'application', locale: 'auth',
      children: { 'auth.user.page': { kind: 'keyed', scope: 'root' } }, inject: publicFace }, UserHome)
    ctx.slots.register({ name: 'auth.user.page', runtime: 'application', key: 'projects', store, locale: 'auth', inject: injected }, UserBrowser)
    ctx.slots.register({ name: 'auth.user.page', runtime: 'application', key: 'account', locale: 'auth', inject: publicFace }, UserHomeAccount)
    return
  }
  const t = ctx.locale.bind('auth')
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
    name: 'sidebar.workspaces', runtime: 'application', priority: -100, store, locale: 'auth', inject: injected,
  }, UserBrowser))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', runtime: 'application', id: 'account', order: 30, label: () => t('account'),
    locale: 'auth', inject: publicFace,
  }, Account))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', runtime: 'application', id: 'account', order: 20, locale: 'auth',
    inject: publicFace,
  }, AccountFooter))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', runtime: 'application', id: 'signout', order: 30, locale: 'auth',
    inject: () => ({ logout: () => auth.logout() }),
  }, LogoutFooter))
}
