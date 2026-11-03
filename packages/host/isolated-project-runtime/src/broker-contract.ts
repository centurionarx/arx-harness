/**
 * Narrow worker persistence protocol. No SQL, filesystem target, user token or
 * signing key is accepted from a worker.
 * @module arx-isolated-project-runtime/broker-contract
 */
import { z } from 'zod'
import { SESSION_FORMAT_VERSION } from '@arx-ai/arx-session/types'
import { sessionEventSchema, sessionIdSchema } from '@arx-ai/arx-host-apiproxy/api'

const workerId = z.uuid()
const id = sessionIdSchema
/** Closed transport grammar shared by supervisor and control. */
export const workerBrokerRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('creation-header'), workerId, workspaceId: z.string().min(1), sessionId: id }).strict(),
  z.object({ operation: z.literal('snapshot'), workerId, workspaceId: z.string().min(1), sessionId: id }).strict(),
  z.object({ operation: z.literal('revision'), workerId, workspaceId: z.string().min(1), sessionId: id }).strict(),
  z.object({ operation: z.literal('append'), workerId, workspaceId: z.string().min(1), sessionId: id,
    events: z.array(sessionEventSchema) }).strict(),
  z.object({ operation: z.literal('list'), workerId, workspaceId: z.string().min(1) }).strict(),
  z.object({ operation: z.literal('list-snapshots'), workerId, workspaceId: z.string().min(1) }).strict(),
  z.object({ operation: z.literal('raw-page'), workerId, workspaceId: z.string().min(1), sessionId: id,
    offset: z.number().int().nonnegative(), maxBytes: z.number().int().min(4),
    revision: z.string().min(1).optional() }).strict(),
  z.object({ operation: z.literal('allocate-fork'), workerId, workspaceId: z.string().min(1), sessionId: id,
    seedLength: z.number().int().nonnegative(), agentPreset: z.string().min(1).optional() }).strict(),
])
/** Closed metadata receipt identifies an already allocated, unseeded owned session. */
export const workerCreationHeaderSchema = z.object({
  version: z.literal(SESSION_FORMAT_VERSION), id, createdAt: z.number().int().nonnegative(),
  cwd: z.string().min(1), agentPreset: z.string().min(1).optional(),
}).strict()
/** Closed allocation receipt preserves the exact control-issued fork header. */
export const workerForkHeaderSchema = z.object({
  version: z.literal(SESSION_FORMAT_VERSION), id, createdAt: z.number().int().nonnegative(),
  cwd: z.string().min(1), parentSession: id, seedLength: z.number().int().positive(),
  agentPreset: z.string().min(1).optional(),
}).strict()
/** Validated closed owner-scoped supervisor request. */
export type WorkerBrokerRequest = z.infer<typeof workerBrokerRequestSchema>
/** One fixed private route, independent of the browser's ApiProxy carrier. */
export const WORKER_BROKER_PATH = '/_arx/worker-history'
/** Capability remains confined to trusted supervisor/control traffic. */
export const WORKER_CAPABILITY_HEADER = 'x-arx-worker-capability'
