/** Browser-safe authorization flow directory and private interaction capabilities. */
import type { Branded } from '@arx-ai/arx-brand'
import type { AuthorizationEntry, AuthorizationNotice } from '@arx-ai/arx-authorization/types'
import type { CredentialKey, CredentialRecord } from '@arx-ai/arx-credentials/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Private capability returned only to the surface that starts an attempt. */
export type AuthorizationAttemptId = Branded<'AuthorizationAttemptId'>
/** Identifies one prompt so a delayed answer cannot satisfy a later question. */
export type AuthorizationPromptId = Branded<'AuthorizationPromptId'>
/** Public flow metadata and credential presence; never a stored credential value. */
export type AuthorizationFlowView = AuthorizationEntry & { configured: boolean; writable: boolean; kind?: CredentialRecord['kind'] }
/** Serializable prompt with a private revision, excluding its process-local signal. */
export type AuthorizationPromptView = { id: AuthorizationPromptId } & (
  | { kind: 'text' | 'secret'; message: string; placeholder?: string }
  | { kind: 'select'; message: string; options: { id: string; label: string; description?: string }[] }
)
/** Safe progress for the initiating browser surface. Submitted answers are never retained. */
export interface AuthorizationAttemptView {
  id: AuthorizationAttemptId
  key: CredentialKey
  state: 'starting' | 'waiting' | 'authorized' | 'cancelled' | 'expired' | 'failed'
  expiresAt: number
  pollAfterMs: number
  notice?: AuthorizationNotice
  prompt?: AuthorizationPromptView
  message?: string
}
/** Privileged local configuration operations; attempt ids stay private to their caller. */
export interface AuthorizationApi {
  /** List registered flows and safe credential presence. */
  describe(request: RpcRequest<{}>): Promise<RpcResponse<{ flows: AuthorizationFlowView[] }>>
  /** Begin an independently bounded authorization attempt. */
  begin(request: RpcRequest<{ key: CredentialKey; method?: string }>): Promise<RpcResponse<{ attempt: AuthorizationAttemptView }>>
  /** Read progress with the initiating surface's capability. */
  poll(request: RpcRequest<{ attemptId: AuthorizationAttemptId }>): Promise<RpcResponse<{ attempt: AuthorizationAttemptView }>>
  /** Answer one prompt; secret values have no response counterpart. */
  submit(
    request: RpcRequest<{ attemptId: AuthorizationAttemptId; promptId: AuthorizationPromptId; answer: string }>,
  ): Promise<RpcResponse<{ attempt: AuthorizationAttemptView }>>
  /** Cancel only the owned attempt and join its authorization service call. */
  cancel(request: RpcRequest<{ attemptId: AuthorizationAttemptId }>): Promise<RpcResponse<{ attempt: AuthorizationAttemptView }>>
}
