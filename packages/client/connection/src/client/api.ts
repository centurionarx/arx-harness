// Central contract re-export point: every contract import inside
// web-runtime goes through this single file.
// Types and runtime protocol helpers/bounds come from the apiproxy api/ layer
// (zero Node deps, browser-safe); AbstractApiClient is the client boundary.
// NEVER import the package root: it drags bootHost/cordis into the browser bundle.
// The ./api and ./client subpath exports are the browser-safe channels.

export type {
  ApiProxy, SessionsApi, SessionSearchItem, SessionSummary, PromptContentPart, HostApi, EventsApi, MuxFrame, HostFrame,
  ApprovalResponsePayload, QuestionResponsePayload, HistoryEntry, ToolEventView,
  DirectoryEntry, DirectoryListing,
  ResponseValue, WorkspaceApi, WorkspaceId, WorkspaceView,
  SkillsApi, SkillEntry,
  ModelCatalogFailure, ModelCatalogModel, ModelProviderGroup, ModelReasoning,
  ModelReasoningEffort, ModelSelection, QueueAction, QueuedInboxItem, SessionModels,
  GoalsApi, GoalRef,
  SettingsApi, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView,
  CredentialsApi, CredentialView, ConfigurableProviderView, DiscoveredModelView, LlmApi,
  WebApi, WebProviderView, WebSelectionFailureView, WebSelectionView,
  SubagentsApi, SubagentAddress, SubagentCatalog, SubagentListEntry, SubagentPromptReceipt,
  JobView,
} from '@arx-ai/arx-host-apiproxy/api'
export type { ToolCallView, ToolResultView } from '@arx-ai/arx-tools/presentation'
export type {
  RpcRequest, RpcResponse, RpcResult, RpcError, RpcErrorCode,
  ClientRequest, ServerResponse, ServerRequest, ClientResponse, RpcMessage, RpcReceipt,
} from '@arx-ai/arx-host-apiproxy/api'
// transportError lives in the apiproxy api layer (beside RpcResult, its
// subject); re-exported here so connection consumers keep one contract
// entry point.
export {
  RpcId,
  SESSION_SEARCH_RESULT_LIMIT,
  transportError,
} from '@arx-ai/arx-host-apiproxy/api'
export { AbstractApiClient } from '@arx-ai/arx-host-apiproxy/client'
export type { IApiClient } from '@arx-ai/arx-host-apiproxy/client'
export type { SessionId, SessionEvent } from '@arx-ai/arx-session/types'
export type { MessageId } from '@arx-ai/arx-llm/brand'
export type { ContentBlock, StreamChunk } from '@arx-ai/arx-llm/types'

/** Successful value returned by the connection-generation host handshake. */
export type HostDescription = import('@arx-ai/arx-host-apiproxy/api').ResponseValue<'host.describe'>

import type { RpcResponse, RpcResult } from '@arx-ai/arx-host-apiproxy/api'

/**
 * Unwrap a unary response: RpcResponse<T> -> RpcResult<T> (business code only
 * cares about the result slot).
 * @param response - the unary response.
 * @returns its result slot.
 */
export function resultOf<T>(response: RpcResponse<T>): RpcResult<T> {
  return response.result
}
