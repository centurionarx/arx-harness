/** Framework-derived owner, viewing store, locale and private observable shares. */
import type { HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@arx-ai/arx-client-ui-slots'
import type {} from '@arx-ai/arx-client-ui-repository/client'
import type {} from '@arx-ai/arx-client-ui-settings/client'
import type { GithubAuthorizationView, GithubView } from './controller.ts'
import type { createGithubViewStore } from './store.ts'
/** Shared public metadata reads and repository navigation callbacks. */
export interface GithubInjected {
  hooks: { github: HostObservable<GithubView> }
  refresh(): Promise<void>
  more(): Promise<void>
}
/** Settings-page-owned private authorization commands; no service object or draft state. */
export interface GithubAccountInjected {
  hooks: { github: HostObservable<GithubView>; authorization: HostObservable<GithubAuthorizationView> }
  refresh(): Promise<void>
  begin(): Promise<void>
  submit(answer: string): Promise<void>
  cancel(): Promise<void>
  watch(): () => void
}
/** The repository entry derives shared workspace selection from its owner. */
export type GithubProps = PropsRuntime<'repository.github'> & PropsStore<ReturnType<typeof createGithubViewStore>>
  & InjectFace<GithubInjected> & PropsLocale<'github'>
/** The account section derives the settings owner share and requires no workspace. */
export type GithubAccountProps = PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.github.repository'> & InjectFace<GithubAccountInjected> & PropsLocale<'github'>
