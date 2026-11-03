/** Component faces derive all framework props from the shared slot contracts. */
import type {
  HostObservable, InjectFace, PropsApplication, PropsLocale, PropsRenderSlots, PropsStore,
} from '@arx-ai/arx-client-ui-slots'
import type { AuthView, BrowserAuthClient } from '../browser.ts'
import type { ModuleId, WebUserId, WebUserStatus } from '@arx-ai/arx-web-identity/contract'
import type { StoredSessionSummary, UserWorkspaceSummary } from '@arx-ai/arx-project-storage/contract'
import type { createAdminStore, createUserBrowserStore } from './stores.ts'
import type { AuthKey } from './locales.ts'
import type {} from '@arx-ai/arx-client-ui-sidebar/client'
import type {} from '@arx-ai/arx-client-ui-settings-general/client'

declare module '@arx-ai/arx-client-ui-slots' {
  interface LocaleNamespaceMap { auth: AuthKey }
  interface SlotMap {
    /**
     * Own USER application pages selected by UserHome through projects/account keys.
     * Registrants receive root application props and their declared store, auth and locale faces;
     * the page owner adds no fields. An entry replaces only that selected page's content.
     * An absent key renders no page content and never supplies project hooks.
     */
    'auth.user.page': { kind: 'keyed'; scope: 'root'; keyProps: { projects: object; account: object } }
    /**
     * Identity-only MASTER pages selected by AdminRoot through users/modules/account keys.
     * Registrants receive root application props and their declared administrative store,
     * auth and locale faces; the page owner adds no fields. An entry replaces one selected page.
     * An absent key renders no page content; navigation stays owned by AdminRoot.
     */
    'auth.admin.page': { kind: 'keyed'; scope: 'root'; keyProps: { users: object; modules: object; account: object } }
  }
}
/**
 * Auth commands and a readonly observable; no credential or token is projected into component state.
 */
export interface PublicInjected {
  hooks: { auth: HostObservable<AuthView> }
  initialRoute: BrowserAuthClient['initialRoute']
  login: BrowserAuthClient['login']
  forgot: BrowserAuthClient['forgotPassword']
  reset: BrowserAuthClient['resetPassword']
  accept: BrowserAuthClient['acceptInvitation']
  change: BrowserAuthClient['changePassword']
  logout: BrowserAuthClient['logout']
  returnToEntry: BrowserAuthClient['returnToEntry']
}
/**
 * Application props for public login, invitation, and recovery forms.
 */
export type PublicProps = PropsApplication<'root'> & InjectFace<PublicInjected> & PropsLocale<'auth'>
/**
 * Application props for the own-account settings contribution.
 */
export type AccountProps = PropsApplication<'settings.section'> & InjectFace<PublicInjected> & PropsLocale<'auth'>
/**
 * Application props for the own-account sidebar dialog.
 */
export type AccountFooterProps = PropsApplication<'sidebar.footer.action'> & InjectFace<PublicInjected> & PropsLocale<'auth'>
/**
 * Application props for the sidebar sign-out action.
 */
export type FooterProps = PropsApplication<'sidebar.footer.action'> & Pick<InjectFace<PublicInjected>, 'logout'> & PropsLocale<'auth'>

/**
 * Administrative identity commands and per-tree metadata store bindings.
 */
export interface AdminInjected {
  refresh(this: void, cursor?: string): void
  create(username: string, email: string): void
  status(userId: WebUserId, status: Exclude<WebUserStatus, 'PENDING'>): void
  modules(userId: WebUserId, grants: readonly ModuleId[]): void
  invite(userId: WebUserId): void
  invitationEmail(userId: WebUserId, email: string): void
}
/**
 * Application root props for identity administration only.
 */
export type AdminProps =
  PropsApplication<'root'> & PropsRenderSlots<'auth.admin.page'>
  & PropsStore<ReturnType<typeof createAdminStore>> & InjectFace<PublicInjected> & AdminInjected & PropsLocale<'auth'>
/**
 * Application props shared by user and module administration pages.
 */
export type AdminPageProps =
  PropsApplication<'auth.admin.page'> & PropsStore<ReturnType<typeof createAdminStore>> & AdminInjected & PropsLocale<'auth'>
/**
 * Application props for the administrator's own password form.
 */
export type AdminAccountProps =
  PropsApplication<'auth.admin.page'> & InjectFace<PublicInjected> & PropsLocale<'auth'>

/**
 * Owner HTTP navigation commands with execution available only in a genuine project tree.
 */
export interface UserBrowserInjected {
  readonly projectRuntimeAvailable: boolean
  refreshProjects(this: void, cursor?: string): void
  selectProject(projectId: string): void
  createProject(name: string): void
  createWorkspace(name: string): void
  moreWorkspaces(cursor: string): void
  moreSessions(cursor: string): void
  resume(sessionId: StoredSessionSummary['sessionId']): void
  fork(sessionId: StoredSessionSummary['sessionId']): void
  history(sessionId: StoredSessionSummary['sessionId'], cursor?: string): void
  export(sessionId: StoredSessionSummary['sessionId']): void
  deleteSession(sessionId: StoredSessionSummary['sessionId']): void
  ungroup(workspaceId: UserWorkspaceSummary['workspaceId']): void
  rename(sessionId: StoredSessionSummary['sessionId'], title: string): void
  openWorkspace(workspaceId: UserWorkspaceSummary['workspaceId']): void
}
/**
 * Application contribution props for the private browser in a project sidebar.
 */
export type UserBrowserProps =
  PropsApplication<'sidebar.workspaces'> & PropsStore<ReturnType<typeof createUserBrowserStore>>
  & UserBrowserInjected & PropsLocale<'auth'>

/** USER without runtime remains an application tree with real owner HTTP storage. */
export type UserHomeProps =
  PropsApplication<'root'> & PropsRenderSlots<'auth.user.page'> & InjectFace<PublicInjected> & PropsLocale<'auth'>
/**
 * Application props for the private HTTP-only USER home.
 */
export type UserHomeBrowserProps =
  PropsApplication<'auth.user.page'> & PropsStore<ReturnType<typeof createUserBrowserStore>>
  & UserBrowserInjected & PropsLocale<'auth'>
/**
 * Application props for the own-account page in an HTTP-only USER tree.
 */
export type UserHomeAccountProps =
  PropsApplication<'auth.user.page'> & InjectFace<PublicInjected> & PropsLocale<'auth'>
