/** Deterministic service replies; all runtime reads use the real controller. */
import type { WorkspaceId } from '@arx-ai/arx-client-runtime/client'
import type { RepositoryInspection, RepositoryStatus } from '@arx-ai/arx-repository/types'
import type { RepositoryReads } from '../src/client/controller.ts'
export const wid = (id: string): WorkspaceId => id as WorkspaceId
export const inspection: RepositoryInspection = {
  root: '/work/project', branch: 'main', head: 'abc123', aheadBehind: { ahead: 1, behind: 2 },
  remotes: [{ name: 'origin', host: 'github.com', transport: 'https' }],
}
const entry = (path: string) => ({ path, xy: 'MM', submodule: 'N...' })
export const status: RepositoryStatus = {
  staged: [entry('same.ts')], unstaged: [entry('same.ts')],
  untracked: [entry('new.ts')], unmerged: [entry('conflict.ts')],
}
export function reads(overrides: Partial<RepositoryReads> = {}): RepositoryReads {
  return {
    inspect: async () => inspection, status: async () => status,
    diff: async request => ({ ...request, binary: false, text: '@@ -1 +1 @@\n-old\n+<script>alert(1)</script>\n' }),
    ...overrides,
  }
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
