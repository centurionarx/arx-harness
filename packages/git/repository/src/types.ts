/** Read-only workspace repository Remote requests and results. @module @arx-ai/arx-repository/types */
import type { WorkspaceId } from '@arx-ai/arx-workspace/types'

/** Registered host workspace selection; no caller-selected cwd or repository root. */
export interface RepositoryRequest { workspaceId: WorkspaceId }
/** One independent index, working tree, or new-file comparison. */
export type DiffSide = 'staged' | 'unstaged' | 'untracked'
/** A path selected from the current status response, relative to the repository root. */
export interface RepositoryDiffRequest extends RepositoryRequest { path: string; side: DiffSide }
/** Remote identity without URLs, user information, queries, or repository paths. */
export interface RepositoryRemote { name: string; host: string | null; transport: string | null }
/** Current repository identity; null branch means detached and null head means unborn. */
export interface RepositoryInspection {
  root: string
  branch: string | null
  head: string | null
  aheadBehind: { ahead: number; behind: number } | null
  remotes: RepositoryRemote[]
}
/** One porcelain-v2 entry; renames retain their original path, and conflicts remain separate. */
export interface RepositoryEntry { path: string; originalPath?: string; xy: string; submodule: string }
/** Independent groups: the same path can appear in both staged and unstaged. */
export interface RepositoryStatus {
  staged: RepositoryEntry[]
  unstaged: RepositoryEntry[]
  untracked: RepositoryEntry[]
  unmerged: RepositoryEntry[]
}
/** Complete, bounded unified patch; binary comparisons have metadata but no encoded blob. */
export interface RepositoryDiff { path: string; side: DiffSide; binary: boolean; text: string }
