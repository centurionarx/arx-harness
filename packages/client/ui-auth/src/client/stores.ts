/** Slot stores are constructed per plugin tree and never persisted. */
import { defineStore, type EngineStoreHandle } from '@arx-ai/arx-client-slots/client'
import type { AdminUserSummary, WebModule } from '@arx-ai/arx-web-identity/contract'
import type { ProjectSummary, UserWorkspaceSummary, StoredSessionSummary } from '@arx-ai/arx-project-storage/contract'

/**
 * Keyed administrative pages in one application tree.
 */
export type AdminPage = 'users' | 'modules' | 'account'
/**
 * Transient administrative metadata and mutation feedback for one tree.
 */
export interface AdminState {
  page: AdminPage
  users: AdminUserSummary[]
  modules: WebModule[]
  nextCursor: string | undefined
  busy: boolean
  error: string | undefined
  notice: 'accepted' | 'userCreated' | undefined
}
/**
 * Construct a fresh administrative store; no identity metadata is browser-persisted.
 * @returns Store factory whose instances belong to their mounting tree.
 */
export function createAdminStore(): EngineStoreHandle<AdminState, {
  select: (draft: AdminState, page: AdminPage) => void
  pending: (draft: AdminState, busy: boolean) => void
  fail: (draft: AdminState, code: string) => void
  loaded: (draft: AdminState, users: readonly AdminUserSummary[], modules: readonly WebModule[],
    cursor: string | undefined, append: boolean) => void
  notify: (draft: AdminState, notice: 'accepted' | 'userCreated') => void
  clear: (draft: AdminState) => void
}> {
  return defineStore({
    init: (): AdminState => ({ page: 'users', users: [], modules: [], nextCursor: undefined, busy: false, error: undefined, notice: undefined }),
    actions: {
      select: (d, page: AdminPage) => { d.page = page },
      pending: (d, busy: boolean) => { d.busy = busy; if (busy) { d.error = undefined; d.notice = undefined } },
      fail: (d, code: string) => { d.busy = false; d.error = code },
      loaded: (d, users: readonly AdminUserSummary[], modules: readonly WebModule[], cursor: string | undefined, append: boolean) => {
        d.users = append ? [...new Map([...d.users, ...users].map(row => [row.userId, row])).values()] : [...users]
        d.modules = [...modules]; d.nextCursor = cursor; d.busy = false
      },
      notify: (d, notice: 'accepted' | 'userCreated') => { d.notice = notice; d.busy = false },
      clear: (d) => { d.users = []; d.modules = []; d.nextCursor = undefined; d.error = undefined; d.notice = undefined },
    },
  })
}
/**
 * Transient own-project selection, pagination, and raw-history view for one tree.
 */
export interface UserBrowserState {
  projects: ProjectSummary[]
  projectId: string | undefined
  workspaces: UserWorkspaceSummary[]
  sessions: StoredSessionSummary[]
  projectCursor: string | undefined
  workspaceCursor: string | undefined
  sessionCursor: string | undefined
  busy: boolean
  error: string | undefined
  history: { sessionId: StoredSessionSummary['sessionId']; content: string; cursor: string | undefined } | undefined
}
/**
 * Construct a fresh owner browser store without cross-principal persistence.
 * @returns Store factory with independent project selection and history in each tree.
 */
export function createUserBrowserStore(): EngineStoreHandle<UserBrowserState, {
  pending: (draft: UserBrowserState) => void
  fail: (draft: UserBrowserState, code: string) => void
  projects: (draft: UserBrowserState, rows: readonly ProjectSummary[], cursor: string | undefined, append: boolean) => void
  select: (draft: UserBrowserState, projectId: string) => void
  workspaces: (draft: UserBrowserState, rows: readonly UserWorkspaceSummary[], cursor: string | undefined, append: boolean) => void
  sessions: (draft: UserBrowserState, rows: readonly StoredSessionSummary[], cursor: string | undefined, append: boolean) => void
  history: (draft: UserBrowserState, sessionId: StoredSessionSummary['sessionId'], content: string, cursor: string | undefined, append: boolean) => void
  closeHistory: (draft: UserBrowserState) => void
  ready: (draft: UserBrowserState) => void
  clear: (draft: UserBrowserState) => void
}> {
  return defineStore({
    init: (): UserBrowserState => ({
      projects: [], projectId: undefined, workspaces: [], sessions: [],
      projectCursor: undefined, workspaceCursor: undefined, sessionCursor: undefined,
      busy: false, error: undefined, history: undefined,
    }),
    actions: {
      pending: (d) => { d.busy = true; d.error = undefined },
      fail: (d, code: string) => { d.busy = false; d.error = code },
      projects: (d, rows: readonly ProjectSummary[], cursor: string | undefined, append: boolean) => {
        d.projects = append ? [...new Map([...d.projects, ...rows].map(row => [row.projectId, row])).values()] : [...rows]
        d.projectCursor = cursor; d.busy = false
      },
      select: (d, projectId: string) => {
        d.projectId = projectId; d.workspaces = []; d.sessions = []; d.history = undefined
        d.workspaceCursor = undefined; d.sessionCursor = undefined
      },
      workspaces: (d, rows: readonly UserWorkspaceSummary[], cursor: string | undefined, append: boolean) => {
        d.workspaces = append ? [...new Map([...d.workspaces, ...rows].map(row => [row.workspaceId, row])).values()] : [...rows]
        d.workspaceCursor = cursor; d.busy = false
      },
      sessions: (d, rows: readonly StoredSessionSummary[], cursor: string | undefined, append: boolean) => {
        d.sessions = append ? [...new Map([...d.sessions, ...rows].map(row => [row.sessionId, row])).values()] : [...rows]
        d.sessionCursor = cursor; d.busy = false
      },
      history: (d, sessionId: StoredSessionSummary['sessionId'], content: string, cursor: string | undefined, append: boolean) => {
        d.history = { sessionId, content: append && d.history?.sessionId === sessionId ? d.history.content + content : content, cursor }
        d.busy = false
      },
      closeHistory: (d) => { d.history = undefined },
      ready: (d) => { d.busy = false },
      clear: (d) => {
        d.projects = []; d.projectId = undefined; d.workspaces = []; d.sessions = []
        d.projectCursor = undefined; d.workspaceCursor = undefined; d.sessionCursor = undefined
        d.history = undefined; d.error = undefined; d.busy = false
      },
    },
  })
}
