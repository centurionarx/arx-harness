/** The four framework-derived shares of the read-only repository entry. */
import type { HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@arx-ai/arx-client-ui-slots'
import type { SidebarSectionOwnerProps } from '@arx-ai/arx-client-ui-sidebar/client'
import type { WorkspaceId } from '@arx-ai/arx-client-runtime/client'
import type { RepositoryDiffRequest } from '@arx-ai/arx-repository/types'
import type { RepositoryView } from './controller.ts'
import type { createRepositoryViewStore } from './store.ts'
/** Explicit workspace pairing supplied to the optional GitHub inspection child. */
export interface GithubInspectionOwnerProps extends SidebarSectionOwnerProps {
  /** Selected registered workspace; null means no explicit pairing. */
  workspaceId: WorkspaceId | null
  /** Retarget the Git inspection to the explicitly chosen registered workspace. */
  selectWorkspace: (id: WorkspaceId | null) => void
}
declare module '@arx-ai/arx-client-ui-slots' {
  interface SlotMap {
    /** Optional GitHub inspection above the local Git view, owned by ui-repository. */
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
/** Repository owns its optional GitHub inspection child and native comparison dialog. */
export type RepositoryProps = PropsRuntime<'sidebar.repository'> & PropsRenderSlots<'repository.github'>
  & PropsStore<ReturnType<typeof createRepositoryViewStore>> & InjectFace<RepositoryInjected> & PropsLocale<'repository'>
