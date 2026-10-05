/** Only explicit viewing choices survive entry rerenders; no business facts or secrets. */
import { defineStore, type EngineStoreHandle } from '@arx-ai/arx-client-runtime/client'
import type { GithubId } from '@arx-ai/arx-github/types'
interface ViewState { repositoryId: GithubId | null }
type ViewActions = {
  selectRepository(draft: ViewState, id: GithubId | null): void
}
/** Create isolated, nonpersistent viewing selections.
 * @returns The entry store handle.
 */
export function createGithubViewStore(): EngineStoreHandle<ViewState, ViewActions> {
  return defineStore({
    init: (): ViewState => ({ repositoryId: null }),
    actions: {
      selectRepository: (draft, id: GithubId | null) => { draft.repositoryId = id },
    },
  })
}
