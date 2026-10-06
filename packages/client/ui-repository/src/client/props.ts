/** The four framework-derived shares of the read-only repository entry. */
import type { HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@arx-ai/arx-client-ui-slots'
import type { WorkspaceId } from '@arx-ai/arx-client-runtime/client'
import type { RepositoryDiffRequest } from '@arx-ai/arx-repository/types'
import type { RepositoryView } from './controller.ts'
import type { createRepositoryViewStore } from './store.ts'
/** Explicit workspace pairing supplied by the Settings composition owner. */
export interface GithubInspectionOwnerProps {
  /** Selected registered workspace; null means no explicit pairing. */
  workspaceId: WorkspaceId | null
  /** Retarget the Git inspection to the explicitly chosen registered workspace. */
  selectWorkspace: (id: WorkspaceId | null) => void
}
declare module '@arx-ai/arx-client-ui-slots' {
  interface SlotMap {
    /** Workspace-selection composition within the GitHub Settings page. */
    'settings.github.repository': { kind: 'single'; scope: 'root'; owner: {} }
    /** GitHub repository browsing with the Git owner's selected workspace. */
    'repository.github': { kind: 'single'; scope: 'root'; owner: GithubInspectionOwnerProps }
  }
}
/** Registrant-private observable and commands. */
export interface RepositoryInjected {
  hooks: { repository: HostObservable<RepositoryView> }
  select(workspaceId: WorkspaceId | null): void
  refresh(): Promise<void>
  show(request: RepositoryDiffRequest): Promise<void>
  close(): void
  cancel(): void
}
/** Settings composition shares the Git owner's workspace-selection store. */
export type GithubSettingsOwnerProps = PropsRuntime<'settings.github.repository'> & PropsRenderSlots<'repository.github'>
  & PropsStore<ReturnType<typeof createRepositoryViewStore>>
/** Repository owns local Git inspection and its native comparison dialog. */
export type RepositoryProps = PropsRuntime<'sidebar.repository'>
  & PropsStore<ReturnType<typeof createRepositoryViewStore>> & InjectFace<RepositoryInjected> & PropsLocale<'repository'>
