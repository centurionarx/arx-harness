/** Client-safe read-only GitHub DTOs; no credential values. @module @arx-ai/arx-github/types */
import type { Branded } from '@arx-ai/arx-brand'
import type { CredentialKey, CredentialRef } from '@arx-ai/arx-credentials/types'

/** GitHub's numeric identity serialized without precision loss. */
export type GithubId = Branded<'GithubId'>
/** Allowlisted authenticated account fields. */
export interface GithubAccount { readonly id: GithubId; readonly login: string; readonly webUrl: string }
/** Connection status and ability to offer the private authorization flow. */
export interface GithubAccountResult {
  readonly state: 'unconfigured' | 'disconnected' | 'connected'
  readonly account?: GithubAccount
  readonly writable: boolean
  readonly authFlowKey?: CredentialKey
}
/** Allowlisted repository fields. */
export interface GithubRepository {
  readonly id: GithubId
  readonly owner: string
  readonly name: string
  readonly private: boolean
  readonly defaultBranch: string | null
  readonly webUrl: string
}
/** One bounded page; continuation is computed locally, never from external URLs. */
export interface GithubRepositoriesResult { readonly repositories: readonly GithubRepository[]; readonly nextPage?: number }
/** Locally bounded page selector, starting at one. */
export interface GithubRepositoriesRequest { readonly page: number }
/** Operator-only credential choice; no ambient environment fallback. */
export type GithubCredential = {
  /** No credential address selected; no PAT flow is registered. */
  readonly mode: 'unconfigured'
} | {
  /** Read and authorize the plugin-owned durable record. */
  readonly mode: 'record'
  /** Exact plugin-owned key github/account; other scopes or ids reject. */
  readonly key: CredentialKey
} | {
  /** Resolve an explicit provider reference without offering a PAT-writing flow. */
  readonly mode: 'ref'
  /** POSIX reference name; environment layering is owned by the credential provider. */
  readonly ref: CredentialRef
}
/** Operator input; omitted fields resolve to the documented defaults. */
export interface Config {
  /** Operator-selected address; unconfigured by default. */
  readonly credential?: GithubCredential
  /** External body and complete DTO byte budget; default 262144, ceiling 1048576. */
  readonly maxBytes?: number
  /** Repository item budget; default and ceiling 100. */
  readonly maxItems?: number
  /** Whole-operation deadline in milliseconds; default 10000, ceiling 60000. */
  readonly timeoutMs?: number
  /** Requested page size, no larger than maxItems; default 30, ceiling 100. */
  readonly pageSize?: number
  /** Local continuation ceiling; default 100, ceiling 1000. */
  readonly maxPages?: number
  /** Header-safe PAT byte budget; default and ceiling 4096. */
  readonly patBytes?: number
}

/** Validated operation and credential bounds. */
export interface ServiceConfig {
  /** Operator-selected address; unconfigured by default. */
  readonly credential: GithubCredential
  /** External body and complete DTO byte budget; default 262144, ceiling 1048576. */
  readonly maxBytes: number
  /** Repository item budget; default and ceiling 100. */
  readonly maxItems: number
  /** Whole-operation deadline in milliseconds; default 10000, ceiling 60000. */
  readonly timeoutMs: number
  /** Requested page size, no larger than maxItems; default 30, ceiling 100. */
  readonly pageSize: number
  /** Local continuation ceiling; default 100, ceiling 1000. */
  readonly maxPages: number
  /** Header-safe PAT byte budget; default and ceiling 4096. */
  readonly patBytes: number
}
