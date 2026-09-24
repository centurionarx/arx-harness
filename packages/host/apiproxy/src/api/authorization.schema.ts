/**
 * Wire validation for registered authorization flows and caller-owned attempts.
 * Brand cast points: `key`, `attemptId` and `promptId`, one each.
 */
import { z } from 'zod'
import type { CredentialKey } from '@arx-ai/arx-credentials/types'
import type { AuthorizationAttemptId, AuthorizationPromptId } from './authorization.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
/** CredentialKey: one brand cast after `<namespace>/<name>` validation. */
const key = z.string().regex(/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/) as unknown as z.ZodType<CredentialKey>
/** AuthorizationAttemptId: one brand cast after UUID validation. */
const attemptId = z.uuid() as unknown as z.ZodType<AuthorizationAttemptId>
/** AuthorizationPromptId: one brand cast after UUID validation. */
const promptId = z.uuid() as unknown as z.ZodType<AuthorizationPromptId>
const prompt = z.discriminatedUnion('kind', [
  z.object({ id: promptId, kind: z.literal('text'), message: z.string(), placeholder: z.string().optional() }),
  z.object({ id: promptId, kind: z.literal('secret'), message: z.string(), placeholder: z.string().optional() }),
  z.object({ id: promptId, kind: z.literal('select'), message: z.string(), options: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().optional() })) }),
])
const attempt = z.object({ id: attemptId, key,
  state: z.enum(['starting', 'waiting', 'authorized', 'cancelled', 'expired', 'failed']),
  expiresAt: z.number(), pollAfterMs: z.number(), message: z.string().optional(), prompt: prompt.optional(),
  notice: z.object({ message: z.string(), url: z.string().optional(), code: z.string().optional() }).optional() })
const flow = z.object({ key, label: z.string(), inFlight: z.boolean(), configured: z.boolean(), writable: z.boolean(),
  kind: z.enum(['api-key', 'grant']).optional(), methods: z.array(z.object({ id: z.string(), label: z.string() })) })
/** Registered-flow directory request. */
export const authorizationDescribeRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'authorization.describe'>>>
/** Safe directory rows. */
export const authorizationDescribeValueSchema = z.object({ flows: z.array(flow) }) satisfies z.ZodType<Wire<ResponseValue<'authorization.describe'>>>
/** Begin only a registered flow and its declared method. */
export const authorizationBeginRequestSchema = z.object({ key, method: z.string().min(1).optional() }) satisfies z.ZodType<Wire<RequestPayload<'authorization.begin'>>>
/** Initial caller-private capability. */
export const authorizationBeginValueSchema = z.object({ attempt }) satisfies z.ZodType<Wire<ResponseValue<'authorization.begin'>>>
/** Private progress request. */
export const authorizationPollRequestSchema = z.object({ attemptId }) satisfies z.ZodType<Wire<RequestPayload<'authorization.poll'>>>
/** Progress without submitted answers. */
export const authorizationPollValueSchema = z.object({ attempt }) satisfies z.ZodType<Wire<ResponseValue<'authorization.poll'>>>
/** Transient answer, further bounded by the controller's configured limit. */
export const authorizationSubmitRequestSchema = z.object({ attemptId, promptId, answer: z.string() }) satisfies z.ZodType<Wire<RequestPayload<'authorization.submit'>>>
/** Updated progress without echoing the answer. */
export const authorizationSubmitValueSchema = z.object({ attempt }) satisfies z.ZodType<Wire<ResponseValue<'authorization.submit'>>>
/** Cancel only an attempt the caller owns. */
export const authorizationCancelRequestSchema = z.object({ attemptId }) satisfies z.ZodType<Wire<RequestPayload<'authorization.cancel'>>>
/** Progress after joining the authorization service call. */
export const authorizationCancelValueSchema = z.object({ attempt }) satisfies z.ZodType<Wire<ResponseValue<'authorization.cancel'>>>
