/** Browser contract for native account status and caller-owned sign-in attempts. */
import type { NativeAccountAttempt, NativeAccountAttemptId, NativeAccountProvider, NativeAccountView, NativeLoginMode } from '@arx-ai/arx-native-accounts/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'
export type { NativeAccountAttempt, NativeAccountAttemptId, NativeAccountProvider, NativeAccountView, NativeLoginMode, NativeAccountModel } from '@arx-ai/arx-native-accounts/types'
/** Every operation is restricted to the privileged local configuration carrier. */
export interface NativeAccountsApi {
  /** Read only sanitized status and model metadata; no account ids, email, or tokens. */
  describe(request: RpcRequest<{}>): Promise<RpcResponse<{ accounts: NativeAccountView[] }>>
  /** Start a bounded login; the returned attempt id is a private capability. */
  begin(
    request: RpcRequest<{ provider: NativeAccountProvider; mode?: NativeLoginMode }>,
  ): Promise<RpcResponse<{ attempt: NativeAccountAttempt }>>
  /** Read progress using only the initiating surface's private capability. */
  poll(request: RpcRequest<{ attemptId: NativeAccountAttemptId }>): Promise<RpcResponse<{ attempt: NativeAccountAttempt }>>
  /** Answer the native CLI's pending code prompt; the value is never returned. */
  submit(request: RpcRequest<{ attemptId: NativeAccountAttemptId; code: string }>): Promise<RpcResponse<{ attempt: NativeAccountAttempt }>>
  /** Cancel and wait for the owned native process tree to exit. */
  cancel(request: RpcRequest<{ attemptId: NativeAccountAttemptId }>): Promise<RpcResponse<{ attempt: NativeAccountAttempt }>>
}
