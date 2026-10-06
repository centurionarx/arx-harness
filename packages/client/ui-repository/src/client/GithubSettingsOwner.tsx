/** Settings composition for the Git-owned workspace selection. */
import type { GithubSettingsOwnerProps } from './props.ts'

/** Supply the selected registered workspace to GitHub repository browsing.
 * @param props - Framework workspace feed, shared viewing store and child render share.
 * @returns The GitHub repository view within Settings.
 */
export function GithubSettingsOwner(props: GithubSettingsOwnerProps) {
  const { useStore, useWorkspaces, actions, renderSlot } = props
  const selection = useStore(state => state)
  const workspaces = useWorkspaces(state => state)
  const workspaceId = workspaces.items.find(row => row.workspaceId === selection.workspaceId)?.workspaceId ?? null
  return renderSlot('repository.github', { workspaceId, selectWorkspace: (id) => { actions.selectWorkspace(id) } })
}
