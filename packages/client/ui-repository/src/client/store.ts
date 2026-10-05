/** Entry viewing state only; repository facts belong to the private controller. */
import { defineStore, type EngineStoreHandle, type WorkspaceId } from '@arx-ai/arx-client-runtime/client'
import type { RepositoryDiffRequest } from '@arx-ai/arx-repository/types'
interface ViewState { workspaceId: WorkspaceId | null; selectedFile: RepositoryDiffRequest | null }
type ViewActions = {
  selectWorkspace(draft: ViewState, workspaceId: WorkspaceId | null): void
  selectFile(draft: ViewState, file: RepositoryDiffRequest | null): void
}
/** Create isolated workspace selection and modal viewing state.
 * @returns A root-scoped store handle.
 */
export function createRepositoryViewStore(): EngineStoreHandle<ViewState, ViewActions> {
  return defineStore({
    init: (): ViewState => ({ workspaceId: null, selectedFile: null }),
    actions: {
      selectWorkspace: (draft, workspaceId: WorkspaceId | null) => { draft.workspaceId = workspaceId; draft.selectedFile = null },
      selectFile: (draft, file: RepositoryDiffRequest | null) => { draft.selectedFile = file },
    },
  })
}
