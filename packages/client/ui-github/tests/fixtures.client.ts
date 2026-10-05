/** Typed deterministic service metadata and private authorization carrier fixtures. */
import { vi } from 'vitest'
import type { IApiClient, AuthorizationAttemptView, AuthorizationFlowView, AuthorizationAttemptId, AuthorizationPromptId, RpcResponse, RpcId, WorkspaceId } from '@arx-ai/arx-api-remotes/client'
import type { CredentialKey } from '@arx-ai/arx-credentials/types'
import type { GithubId, GithubAccountResult, GithubRepository } from '@arx-ai/arx-github/types'
import type { GithubReads } from '../src/client/controller.ts'
export const gid = (id: string): GithubId => id as GithubId
export const wid = (id: string): WorkspaceId => id as WorkspaceId
const key = 'github/account' as CredentialKey
export const flow: AuthorizationFlowView = { key, label: 'GitHub', methods: [{ id: 'pat', label: 'PAT' }], configured: false, writable: true, inFlight: false }
export const account: GithubAccountResult = { state: 'connected', writable: true, authFlowKey: key, account: { id: gid('7'), login: '<script>login</script>', webUrl: 'https://github.com/human' } }
export const repository: GithubRepository = { id: gid('9'), owner: '<b>owner</b>', name: 'repo', private: false, defaultBranch: 'main', webUrl: 'https://github.com/owner/repo' }
export const attempt: AuthorizationAttemptView = { id: '77777777-7777-4777-8777-777777777777' as AuthorizationAttemptId, key, state: 'waiting', expiresAt: 90000, pollAfterMs: 1000, prompt: { id: '99999999-9999-4999-8999-999999999999' as AuthorizationPromptId, kind: 'secret', message: 'PAT' } }
export function reply<T>(value: T): RpcResponse<T> { return { rpcId: 'fixture' as RpcId, result: { ok: true, value } } }
export function auth() {
  return {
    describe: vi.fn<IApiClient['authorization']['describe']>().mockResolvedValue(reply({ flows: [flow] })),
    begin: vi.fn<IApiClient['authorization']['begin']>().mockResolvedValue(reply({ attempt })),
    submit: vi.fn<IApiClient['authorization']['submit']>().mockResolvedValue(reply({ attempt: { id: attempt.id, key: attempt.key, state: 'authorized', expiresAt: attempt.expiresAt, pollAfterMs: attempt.pollAfterMs } })),
    poll: vi.fn<IApiClient['authorization']['poll']>().mockResolvedValue(reply({ attempt })),
    cancel: vi.fn<IApiClient['authorization']['cancel']>().mockResolvedValue(reply({ attempt: { ...attempt, state: 'cancelled' } })),
  }
}
export function reads(overrides: Partial<GithubReads> = {}): GithubReads {
  return { account: async () => account, repositories: async () => ({ repositories: [repository], nextPage: 2 }), ...overrides }
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
