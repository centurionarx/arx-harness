/**
 * Browser-safe method payload registry shared by every unary fetch boundary.
 * Schemas retain the existing wire payload contracts and map completeness.
 * @module arx-host-apiproxy/api/method-payloads
 */
import type { z } from 'zod'
import type { RequestPayload, RpcMethodMap } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import {
  sessionCancelRequestSchema,
  sessionAttachmentRequestSchema,
  sessionCreateRequestSchema,
  sessionForkRequestSchema,
  sessionHistoryRequestSchema,
  sessionListRequestSchema,
  sessionModelsRequestSchema,
  sessionPromptRequestSchema,
  sessionRenameRequestSchema,
  sessionSearchRequestSchema,
  sessionSelectModelRequestSchema,
  sessionUpdateQueueRequestSchema,
} from './sessions.schema.ts'
import {
  hostCreateDirectoryRequestSchema, hostDescribeRequestSchema,
  hostExitRequestSchema, hostListDirectoryRequestSchema, hostOpenPathRequestSchema,
  hostPickDirectoryRequestSchema,
} from './host.schema.ts'
import {
  workspaceArchiveSessionRequestSchema,
  workspaceCreateRequestSchema,
  workspaceDeleteRequestSchema,
  workspaceInsertBeforeRequestSchema,
  workspaceInsertSessionBeforeRequestSchema,
  workspaceListRequestSchema,
  workspaceRenameRequestSchema,
} from './workspace.schema.ts'
import { skillListRequestSchema } from './skills.schema.ts'
import {
  agentPresetCopyRequestSchema, agentPresetListRequestSchema, agentPresetOpenDocumentRequestSchema,
  agentPresetReadRequestSchema, agentPresetRemoveRequestSchema, agentPresetSelectRequestSchema,
} from './agent-presets.schema.ts'
import {
  goalCreateRequestSchema,
  goalEditRequestSchema,
  goalPauseRequestSchema,
  goalResumeRequestSchema,
  goalCompleteRequestSchema,
  goalClearRequestSchema,
} from './goals.schema.ts'
import {
  settingsDescribeRequestSchema, settingsMutateRequestSchema, settingsOpenDocumentRequestSchema,
  settingsReplaceRequestSchema, settingsUpdateRequestSchema,
} from './settings.schema.ts'
import { authorizationDescribeRequestSchema, authorizationBeginRequestSchema, authorizationPollRequestSchema, authorizationSubmitRequestSchema, authorizationCancelRequestSchema } from './authorization.schema.ts'
import { nativeAccountsDescribeRequestSchema, nativeAccountsBeginRequestSchema, nativeAccountsPollRequestSchema, nativeAccountsSubmitRequestSchema, nativeAccountsCancelRequestSchema } from './native-accounts.schema.ts'
import {
  credentialsDescribeRequestSchema, credentialsSetRequestSchema, credentialsUnsetRequestSchema,
} from './credentials.schema.ts'
import { llmDiscoverModelsRequestSchema, llmModelsRequestSchema, llmProvidersRequestSchema } from './llm.schema.ts'
import { webProvidersRequestSchema } from './web.schema.ts'
import {
  subagentHistoryRequestSchema,
  subagentInterruptRequestSchema,
  subagentListRequestSchema,
  subagentPromptRequestSchema,
} from './subagents.schema.ts'

/** Payload schema registry locked to every existing unary RpcMethodMap row. */
export type ApiMethodPayloadSchemas = {
  readonly [K in keyof RpcMethodMap]: z.ZodType<Wire<RequestPayload<K>>>
}

/** Canonical compiler-locked payload schemas shared by all unary carriers. */
export const API_METHOD_PAYLOAD_SCHEMAS: ApiMethodPayloadSchemas = {
  'session.list': sessionListRequestSchema,
  'session.search': sessionSearchRequestSchema,
  'session.create': sessionCreateRequestSchema,
  'session.history': sessionHistoryRequestSchema,
  'session.models': sessionModelsRequestSchema,
  'session.selectModel': sessionSelectModelRequestSchema,
  'session.rename': sessionRenameRequestSchema,
  'session.fork': sessionForkRequestSchema,
  'session.prompt': sessionPromptRequestSchema,
  'session.attachment': sessionAttachmentRequestSchema,
  'session.updateQueue': sessionUpdateQueueRequestSchema,
  'session.cancel': sessionCancelRequestSchema,
  'subagent.list': subagentListRequestSchema,
  'subagent.history': subagentHistoryRequestSchema,
  'subagent.prompt': subagentPromptRequestSchema,
  'subagent.interrupt': subagentInterruptRequestSchema,
  'host.describe': hostDescribeRequestSchema,
  'host.pickDirectory': hostPickDirectoryRequestSchema,
  'host.listDirectory': hostListDirectoryRequestSchema,
  'host.createDirectory': hostCreateDirectoryRequestSchema,
  'host.openPath': hostOpenPathRequestSchema,
  'host.exit': hostExitRequestSchema,
  'workspace.list': workspaceListRequestSchema,
  'workspace.create': workspaceCreateRequestSchema,
  'workspace.rename': workspaceRenameRequestSchema,
  'workspace.delete': workspaceDeleteRequestSchema,
  'workspace.insertBefore': workspaceInsertBeforeRequestSchema,
  'workspace.insertSessionBefore': workspaceInsertSessionBeforeRequestSchema,
  'workspace.archiveSession': workspaceArchiveSessionRequestSchema,
  'skill.list': skillListRequestSchema,
  'agentPreset.list': agentPresetListRequestSchema,
  'agentPreset.select': agentPresetSelectRequestSchema,
  'agentPreset.read': agentPresetReadRequestSchema,
  'agentPreset.copy': agentPresetCopyRequestSchema,
  'agentPreset.openDocument': agentPresetOpenDocumentRequestSchema,
  'agentPreset.remove': agentPresetRemoveRequestSchema,
  'goal.create': goalCreateRequestSchema,
  'goal.edit': goalEditRequestSchema,
  'goal.pause': goalPauseRequestSchema,
  'goal.resume': goalResumeRequestSchema,
  'goal.complete': goalCompleteRequestSchema,
  'goal.clear': goalClearRequestSchema,
  'settings.describe': settingsDescribeRequestSchema,
  'settings.openDocument': settingsOpenDocumentRequestSchema,
  'settings.update': settingsUpdateRequestSchema,
  'settings.replace': settingsReplaceRequestSchema,
  'settings.mutate': settingsMutateRequestSchema,
  'authorization.describe': authorizationDescribeRequestSchema,
  'authorization.begin': authorizationBeginRequestSchema,
  'authorization.poll': authorizationPollRequestSchema,
  'authorization.submit': authorizationSubmitRequestSchema,
  'authorization.cancel': authorizationCancelRequestSchema,
  'nativeAccounts.describe': nativeAccountsDescribeRequestSchema,
  'nativeAccounts.begin': nativeAccountsBeginRequestSchema,
  'nativeAccounts.poll': nativeAccountsPollRequestSchema,
  'nativeAccounts.submit': nativeAccountsSubmitRequestSchema,
  'nativeAccounts.cancel': nativeAccountsCancelRequestSchema,
  'credentials.describe': credentialsDescribeRequestSchema,
  'credentials.set': credentialsSetRequestSchema,
  'credentials.unset': credentialsUnsetRequestSchema,
  'llm.providers': llmProvidersRequestSchema,
  'llm.models': llmModelsRequestSchema,
  'llm.discoverModels': llmDiscoverModelsRequestSchema,
  'web.providers': webProvidersRequestSchema,
}

/**
 * Narrow an untrusted method name to one declared unary API method.
 * @param method - Method name from a carrier boundary.
 * @returns A declared method, or undefined for unknown/prototype names.
 */
export function apiMethodForName(method: string): keyof RpcMethodMap | undefined {
  return Object.hasOwn(API_METHOD_PAYLOAD_SCHEMAS, method) ? method as keyof RpcMethodMap : undefined
}

/**
 * Parse one method's payload with the same schema used by the fetch carrier.
 * @param method - Existing method name, refined at the boundary.
 * @param payload - Untrusted wire JSON payload.
 * @returns The existing method's validated Wire payload.
 * @throws For unknown methods or an invalid method payload.
 */
export function parseApiMethodPayload<K extends keyof RpcMethodMap>(method: K, payload: unknown): Wire<RequestPayload<K>>
/**
 * Validate an existing named API payload at the carrier boundary.
 * @param method - Canonical existing RPC method name.
 * @param payload - Untrusted payload received from the transport.
 * @returns The validated canonical method payload.
 */
export function parseApiMethodPayload(method: string, payload: unknown): Wire<RequestPayload<keyof RpcMethodMap>>
export function parseApiMethodPayload(method: string, payload: unknown): Wire<RequestPayload<keyof RpcMethodMap>> {
  const declared = apiMethodForName(method)
  if (declared === undefined) throw new Error('unknown API method')
  return API_METHOD_PAYLOAD_SCHEMAS[declared].parse(payload)
}
