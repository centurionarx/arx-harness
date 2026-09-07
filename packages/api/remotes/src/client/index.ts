/** Platform-neutral assembly of generated Host Remote contributions. */

import type { Context } from '@arx-ai/cordis'
import commandsRemote from '@arx-ai/arx-commands/remote'
import goalsRemote from '@arx-ai/arx-goal/remote'
import dynamicRemote from '@arx-ai/arx-cordis-host-runner/remote'
import fileReferencesRemote from '@arx-ai/arx-file-reference/remote'
import pluginInventoryRemote from '@arx-ai/arx-host-plugin-inventory/remote'
import messageFeedbackRemote from '@arx-ai/arx-message-feedback/remote'
import sessionReferencesRemote from '@arx-ai/arx-session-reference/remote'
import type { TypertClientRemote } from '@arx-ai/arx-typert-protocol'

export type { TypertClientRemote as ClientRemote } from '@arx-ai/arx-typert-protocol'
export type { PluginInventorySnapshot } from '@arx-ai/arx-host-plugin-inventory/types'
export type {} from '@arx-ai/arx-commands/remote'
export type {} from '@arx-ai/arx-file-reference/remote'
export type {} from '@arx-ai/arx-goal/remote'
export type {} from '@arx-ai/arx-host-plugin-inventory/remote'
export type {} from '@arx-ai/arx-message-feedback/remote'
export type {} from '@arx-ai/arx-session-reference/remote'
// The forwarded-event allowlist's selection seat: without it in the consumer's
// compilation face `TypertRemoteEvent` is `never` and every `$on` call fails.
export type { ApiRemoteForwardedEvent } from '../types.ts'
// The owner packages' client-safe `./types` exports supply the `Events`
// signatures `$on` hands to a listener, so a consumer reads the very
// declaration the Host emits rather than a flattened restatement of it.
export type {} from '@arx-ai/arx-commands/types'
export type {} from '@arx-ai/arx-cordis-host-runner/types'
export type {} from '@arx-ai/arx-credentials/types'
export type {} from '@arx-ai/arx-llm/types'
export type {} from '@arx-ai/arx-web/types'
export type {} from '@arx-ai/arx-agent-presets/types'
export type {} from '@arx-ai/arx-settings/types'

/**
 * The carrier's Client-facing types, re-exported so a business package names one
 * assembly package instead of both this facade and the Connection plugin. Type-only:
 * the carrier's runtime values stay behind their own module edge.
 */
export type {
  ClientResponse, ConfigurableProviderView, ConnectionHandle, ConnectionSinks, ContentBlock,
  CredentialView, DirectoryListing, DiscoveredModelView, HistoryEntry, HostFrame, IApiClient,
  MessageId, ModelCatalogFailure, ModelProviderGroup, ModelReasoningEffort, ModelSelection,
  MuxFrame, PromptContentPart, QuestionResponsePayload, QueueAction, RpcError, RpcId, RpcReceipt,
  RpcRequest, RpcResponse, RpcResult, SessionId, SessionModels, SessionSearchItem,
  SessionSummary, SettingsNamespaceView, SettingsPathOpView, SkillEntry, StreamChunk,
  SubagentAddress, SubagentCatalog, JobView, ToolCallView, ToolEventView, ToolResultView,
  WebApi, WebProviderView, WebSelectionFailureView, WebSelectionView, WorkspaceId, WorkspaceView,
} from '@arx-ai/arx-client-connection/client'
export type {} from '@arx-ai/arx-api-gateway/client'
export type {} from '@arx-ai/arx-cordis-host-runner/remote'

// The payload vocabulary of the selected namespaces, re-exported so a Client
// contribution can name what it sends and receives without importing a Host
// package: this assembly is the one place both planes legitimately meet.
export type {
  ApprovalRequestId,
  CordisHalfState,
  CordisDynamicPackageId,
  CordisDynamicPluginId,
  CordisDynamicPluginRunId,
  CordisDynamicRunMode,
  CordisInspectMethodManifest,
  CordisInspectPlatform,
  CordisInspectProviderManifest,
  CordisInspectProviderView,
  CordisInspectQueryRequest,
  CordisInspectQueryResolution,
  CordisInspectQueryResolved,
  CordisInspectRequestId,
  CordisInspectResolveAck,
  CordisRunDiagnostic,
  CordisRunStatus,
  DynamicCordisClientSource,
  DynamicCordisHostHalfResult,
  DynamicCordisInventoryRow,
  DynamicCordisInvokeResult,
  DynamicCordisPackage,
  DynamicCordisRequestResolved,
  DynamicCordisResolveAck,
  DynamicCordisRetracted,
  DynamicCordisRunRequest,
  DynamicCordisRunResolution,
  DynamicCordisRunAttempt,
  DynamicCordisRunResponse,
  DynamicCordisStopResponse,
  DynamicCordisUndefineReceipt,
  RequestRunOutcome,
} from '@arx-ai/arx-cordis-host-runner/types'
// The JSON vocabulary those payloads are built from, re-exported for the same
// reason: a Client contribution names what it sends without importing a Host
// package, and this assembly is where both planes legitimately meet.
export type { JsonValue } from '@arx-ai/arx-session/types'
// Reference-discovery result vocabulary for the fileReferences and
// sessionReferenceResolver namespaces.
export type { FileReferenceCandidate } from '@arx-ai/arx-file-reference/types'
export type { SessionReferenceMentionCandidate } from '@arx-ai/arx-session-reference/types'

declare module '@arx-ai/cordis' {
  interface Context {
    /** Generated Remote namespaces selected by this Client assembly. */
    remote: TypertClientRemote
  }
}

/** Required service: the typed Client Remote contribution mount. */
export const inject = ['remote']

/**
 * Mount the Host capabilities explicitly selected for this Client assembly.
 * @param ctx - Client Cordis root carrying the typed API service.
 * @returns disposer after every selected Remote namespace is ready.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    for (const contribution of [
      commandsRemote, goalsRemote, dynamicRemote, fileReferencesRemote,
      pluginInventoryRemote, messageFeedbackRemote, sessionReferencesRemote,
    ]) {
      disposers.push(await ctx.remote.$mount(contribution))
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose()
    throw error
  }
  // Unwound in reverse mount order, so a namespace never outlives one mounted
  // after it.
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
