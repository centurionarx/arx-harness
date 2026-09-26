/**
 * Wire validation for native accounts; submitted codes have no response counterpart.
 * NativeAccountAttemptId brand cast point: `attemptId`, and only there.
 */
import { z } from 'zod'
import type { NativeAccountAttemptId } from './native-accounts.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
/** NativeAccountAttemptId: one brand cast after UUID validation. */
const attemptId = z.uuid() as unknown as z.ZodType<NativeAccountAttemptId>
const provider = z.enum(['claude-code', 'codex'])
const mode = z.enum(['browser', 'device-code'])
const attempt = z.object({ id: attemptId, provider,
  state: z.enum(['starting', 'waiting', 'connected', 'cancelled', 'expired', 'failed']),
  expiresAt: z.number(), pollAfterMs: z.number(), url: z.string().optional(), code: z.string().optional(),
  message: z.string().optional(), input: z.enum(['code', 'redirect-url']).optional(), rejected: z.boolean().optional() })
const view = z.object({ provider, label: z.string(), availability: z.enum(['available', 'unavailable']),
  status: z.enum(['connected', 'disconnected', 'unknown']), authMode: z.enum(['subscription', 'api-key']).optional(),
  loginModes: z.array(mode), loginInFlight: z.boolean(),
  models: z.array(z.object({
    id: z.string(), name: z.string(), resolvedModel: z.string().optional(), efforts: z.array(z.string()).optional(),
  })).optional() })
/** Safe status request. */
export const nativeAccountsDescribeRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'nativeAccounts.describe'>>>
/** Safe status response. */
export const nativeAccountsDescribeValueSchema = z.object({ accounts: z.array(view) }) satisfies z.ZodType<Wire<ResponseValue<'nativeAccounts.describe'>>>
/** Begin one product flow. */
export const nativeAccountsBeginRequestSchema = z.object({ provider, mode: mode.optional() }) satisfies z.ZodType<Wire<RequestPayload<'nativeAccounts.begin'>>>
/** Initial private attempt. */
export const nativeAccountsBeginValueSchema = z.object({ attempt }) satisfies z.ZodType<Wire<ResponseValue<'nativeAccounts.begin'>>>
/** Read one private attempt. */
export const nativeAccountsPollRequestSchema = z.object({ attemptId }) satisfies z.ZodType<Wire<RequestPayload<'nativeAccounts.poll'>>>
/** Safe attempt progress. */
export const nativeAccountsPollValueSchema = z.object({ attempt }) satisfies z.ZodType<Wire<ResponseValue<'nativeAccounts.poll'>>>
/** Transient single-line answer to the native CLI. */
export const nativeAccountsSubmitRequestSchema = z.object({ attemptId, code: z.string().min(1).max(8192).regex(/^[^\r\n]+$/) }) satisfies z.ZodType<Wire<RequestPayload<'nativeAccounts.submit'>>>
/** Safe progress after an answer; never echoes the answer. */
export const nativeAccountsSubmitValueSchema = z.object({ attempt }) satisfies z.ZodType<Wire<ResponseValue<'nativeAccounts.submit'>>>
/** Withdraw one owned attempt. */
export const nativeAccountsCancelRequestSchema = z.object({ attemptId }) satisfies z.ZodType<Wire<RequestPayload<'nativeAccounts.cancel'>>>
/** Progress after process cleanup. */
export const nativeAccountsCancelValueSchema = z.object({ attempt }) satisfies z.ZodType<Wire<ResponseValue<'nativeAccounts.cancel'>>>
