/**
 * Owner-scoped fetch carrier for an operator-declared isolated supervisor.
 * HTTP fixtures exercise authorization and quiescence, never VM isolation.
 * @module @arx-ai/arx-isolated-project-runtime
 */
import { Context, Service } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import type { ZodError } from 'zod'
import { randomUUID, randomBytes } from 'node:crypto'
import { credentialRef } from '@arx-ai/arx-credentials'
import type {} from '@arx-ai/arx-credentials'
import { UNDECLARED_APP_VERSION } from '@arx-ai/arx-host-apiproxy'
import { InProcessApiClient } from '@arx-ai/arx-host-apiproxy/client'
import { RpcId, SESSION_SEARCH_RESULT_LIMIT, clientRequestSchema, clientResponseSchema, serverResponseSchema,
  parseApiMethodPayload } from '@arx-ai/arx-host-apiproxy/api'
import type { ClientRequest, MuxFrame, HostFrame, RpcRequest, ServerResponse } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId as sessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { ModuleId, ProjectId, WebIdentityError, allowsProjectAccess } from '@arx-ai/arx-web-identity'
import type { OwnerResource, OwnedResource, RequestAuthority, WebUserId, WebAuthSessionId } from '@arx-ai/arx-web-identity'
import type { WorkspaceId } from '@arx-ai/arx-workspace'
import type {} from '@arx-ai/arx-project-storage'
import { workerBrokerRequestSchema, WORKER_BROKER_PATH, WORKER_CAPABILITY_HEADER } from './broker-contract.ts'
import type { WorkerBrokerRequest } from './broker-contract.ts'
import { ownerRemoteAdmission, ownerRemoteEventAdmission, isOwnerRemoteActivity } from './allowed-remotes.ts'

/** Deployment configuration is not mutable through USER or MASTER APIs. */
export interface Config {
  /** Trusted supervisor origin; absent leaves every execution unavailable. */
  endpoint?: string
  /** Operator-managed credential reference, never a browser-supplied secret. */
  credentialRef?: string
  /** Explicit loopback-only HTTP permission for disposable fixtures. */
  fixtureLoopback?: boolean
  /**
   * Deadline for a unary exchange, or a stream's response headers. A workspace-scoped unary exchange
   * and the sub-stream attach that precedes it share this one deadline.
   */
  requestTimeoutMs: number
  /**
   * Deadline for each cancellation request to return its quiescent receipt. Cancellations of one user
   * run in parallel, each with its own deadline. The value must exceed, with margin, the longest time
   * the supervisor takes to stop a worker, including its forced kill, and deliver the receipt. A receipt
   * that is missing, invalid or later than this deadline closes the adapter for every user.
   */
  cancellationTimeoutMs: number
  /** Largest buffered HTTP request body. */
  maxRequestBytes: number
  /** Largest unary result or individual SSE frame. */
  maxResponseBytes: number
}

const METHODS: ReadonlyMap<string, 'passive' | 'active' | 'new-session'> = new Map([
  ['session.list', 'passive'],
  ['session.search', 'passive'],
  ['session.create', 'new-session'],
  ['session.history', 'passive'],
  ['session.models', 'passive'],
  ['session.selectModel', 'active'],
  ['session.rename', 'active'],
  ['session.fork', 'active'],
  ['session.prompt', 'active'],
  ['session.attachment', 'passive'],
  ['session.updateQueue', 'active'],
  ['session.cancel', 'active'],
  ['subagent.list', 'passive'],
  ['subagent.history', 'passive'],
  ['subagent.prompt', 'active'],
  ['subagent.interrupt', 'active'],
  ['host.describe', 'passive'],
  ['workspace.list', 'passive'],
  ['workspace.create', 'active'],
  ['workspace.rename', 'active'],
  ['workspace.delete', 'active'],
  ['workspace.insertBefore', 'active'],
  ['workspace.insertSessionBefore', 'active'],
  ['workspace.archiveSession', 'active'],
  ['skill.list', 'passive'],
  ['agentPreset.list', 'passive'],
  ['agentPreset.select', 'active'],
  ['goal.create', 'active'],
  ['goal.edit', 'active'],
  ['goal.pause', 'active'],
  ['goal.resume', 'active'],
  ['goal.complete', 'active'],
  ['goal.clear', 'active'],
  ['llm.providers', 'passive'],
  ['llm.models', 'passive'],
  ['web.providers', 'passive'],
])
/**
 * Fixed request allowlist excludes operator configuration, native dialogs,
 * arbitrary filesystem targets, credentials and plugin installation.
 * @param method - Existing ApiProxy wire method.
 * @returns Whether isolated USER dispatch admits the method.
 */
export function isIsolatedProjectMethod(method: string): boolean { return METHODS.has(method) }

interface Lease {
  readonly capability: string
  readonly brokerTasks: Set<Promise<unknown>>
  readonly allocations: Set<ReturnType<typeof sessionId>>
  readonly operationId: string
  readonly authority: RequestAuthority
  readonly scope?: OwnedResource
  readonly controller: AbortController
  readonly settled: Promise<void>
  settle(): void
  cancelling?: Promise<void>
}
/**
 * What made control cancel a lease. The first cancellation of a lease decides the trigger named
 * in the diagnostic when its quiescent receipt is missing.
 */
type CancellationTrigger = 'authority-invalidated' | 'ownership-deleted' | 'session-expired' | 'disposal'
  | 'quiesce-call' | 'writer-handoff' | 'request-failed' | 'downlink-closed'
/** A frame waiting for the consumer; control-authored frames have no sub-lease. */
interface QueuedFrame {
  readonly frame: RpcRequest<MuxFrame | HostFrame>
  readonly lease?: Lease
  delivered(): void
}
/** One browser downlink: a merged stream over one workspace-scoped sub-stream per attached workspace. */
interface Downlink {
  readonly authority: RequestAuthority
  readonly channel: 'mux' | 'host'
  readonly closed: AbortController
  readonly attached: Map<WorkspaceId, Promise<void>>
  readonly leases: Set<Lease>
  readonly queue: QueuedFrame[]
  failure?: { error: unknown }
  wake?: () => void
}
declare module '@arx-ai/cordis' {
  interface Context { isolatedProjectRuntime: IsolatedProjectRuntime }
}

function failure(code: string, status: number, message: string): never {
  throw new WebIdentityError(code, status, message)
}
function moduleFor(method: string): string {
  if (method === 'session.history' || method === 'session.list' || method === 'session.search'
    || method === 'session.export') return 'storage'
  if (method.startsWith('workspace.') || method.startsWith('messageFeedback/')) return 'storage'
  return 'runtime'
}
function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/** Settle with `promise`, or reject with the reason of `signal`; the caller passes a signal that is not yet aborted. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = (): void => { reject(signal.reason as Error) }
    signal.addEventListener('abort', stop, { once: true })
    promise.then(resolve, reject).finally(() => { signal.removeEventListener('abort', stop) })
  })
}

async function boundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > maxBytes) failure('RUNTIME_LIMIT', 502, 'Worker response limit exceeded')
      chunks.push(chunk.value)
    }
    return Buffer.concat(chunks, size)
  } finally { await reader.cancel() }
}

/** One trusted supervisor serves owner-assigned workers, never the shared host. */
export class IsolatedProjectRuntime extends Service {
  static inject = ['webIdentity', 'credentials', 'projectStorage']
  static Config: z<Config> = z.object({
    endpoint: z.string(), credentialRef: z.string(), fixtureLoopback: z.boolean().default(false),
    requestTimeoutMs: z.number().step(1).min(1).required(),
    cancellationTimeoutMs: z.number().step(1).min(1).required(),
    maxRequestBytes: z.number().step(1).min(1).required(),
    maxResponseBytes: z.number().step(1).min(1).required(),
  })
  private readonly endpoint?: URL
  private readonly leases = new Map<string, Lease>()
  private readonly quiescences = new Map<WebUserId | undefined, Promise<void>>()
  private readonly sessionQuiescences = new Map<WebAuthSessionId, Promise<void>>()
  private readonly pendingReplies = new Map<string, { lease: Lease
    sessionId: ReturnType<typeof sessionId>
    approvalId?: string }>()
  private readonly brokerQueues = new Map<string, Promise<unknown>>()
  private readonly downlinks = new Set<Downlink>()
  // ponytail: last known archive per workspace and one ordering tail for each user, kept for the process lifetime and never pruned.
  // Upgrade path: drop a user's entry on ownership deletion and a workspace's entry when its grouping is removed.
  private readonly archives = new Map<WebUserId, Map<WorkspaceId, readonly unknown[]>>()
  private readonly archiveTails = new Map<WebUserId, Promise<void>>()
  private readonly writers = new Map<ReturnType<typeof sessionId>, { workerId: string
    lease: Lease }>()
  private closing = false
  private unsafe = false

  constructor(ctx: Context, readonly config: Config) {
    super(ctx, 'isolatedProjectRuntime')
    if ((config.endpoint === undefined) !== (config.credentialRef === undefined)) throw new Error('isolated runtime endpoint and credentialRef must be configured together')
    if (config.endpoint !== undefined) {
      const endpoint = new URL(config.endpoint)
      const fixture = config.fixtureLoopback === true && endpoint.protocol === 'http:'
        && ['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname)
      if ((!fixture && endpoint.protocol !== 'https:') || endpoint.username !== ''
        || endpoint.password !== '' || endpoint.search !== '' || endpoint.hash !== '' || endpoint.pathname !== '/') {
        throw new Error('isolated runtime endpoint must be a credential-free HTTPS origin')
      }
      credentialRef((config.credentialRef as string))
      this.endpoint = endpoint
    }
    ctx.on('web-identity/invalidated', async (userId) => { await this.quiesceFor(userId, 'authority-invalidated') })
    ctx.on('web-identity/ownership-deleted', async (userId) => { await this.quiesceFor(userId, 'ownership-deleted') })
    ctx.on('web-identity/session-expired', async (userId, authSessionId) => {
      this.closeDownlinks(downlink => downlink.authority.principal.userId === userId
        && downlink.authority.authSessionId === authSessionId)
      const prior = this.quiescences.get(undefined) ?? this.quiescences.get(userId) ?? this.sessionQuiescences.get(authSessionId)
      if (prior !== undefined) { await prior; return }
      const selected = [...this.leases.values()].filter(lease => lease.authority.principal.userId === userId
        && lease.authority.authSessionId === authSessionId)
      // Install the SID barrier before running abort callbacks or cancellation.
      const joined = Promise.resolve().then(async () => {
        const settled = await Promise.allSettled(selected.map(lease => this.cancel(lease, 'session-expired')))
        if (settled.some(result => result.status === 'rejected')) failure('RUNTIME_QUIESCENCE', 503, 'Worker quiescence was not confirmed')
      }).finally(() => { this.sessionQuiescences.delete(authSessionId) })
      this.sessionQuiescences.set(authSessionId, joined)
      await joined
    })
    ctx.effect(() => async () => {
      this.closing = true
      await this.quiesceFor(undefined, 'disposal')
    })
  }

  private available(): URL {
    if (this.endpoint === undefined || this.closing || this.unsafe) failure('RUNTIME_UNAVAILABLE', 503, 'Isolated execution is unavailable')
    return this.endpoint
  }

  private async authorize(authority: RequestAuthority, resource: OwnerResource | undefined,
    method: string): Promise<OwnedResource | undefined> {
    await this.ctx.webIdentity.revalidate(authority)
    const principal = authority.principal
    if (!allowsProjectAccess(principal, authority.audience)) {
      failure('RUNTIME_FORBIDDEN', 403, 'Project execution is forbidden')
    }
    const module = ModuleId(moduleFor(method))
    if (!principal.grants.includes(module)) failure('MODULE_DENIED', 403, 'Module unavailable')
    const scope = resource === undefined ? undefined : await this.ctx.webIdentity.authorizeOwner(authority, resource, module)
    this.assertAdmission(authority)
    return scope
  }

  private assertAdmission(authority: RequestAuthority): void {
    if (this.closing || this.unsafe || this.quiescences.has(undefined) || this.quiescences.has(authority.principal.userId)
      || this.sessionQuiescences.has(authority.authSessionId)) {
      failure('RUNTIME_UNAVAILABLE', 503, 'Isolated execution is unavailable')
    }
  }

  private async headers(lease: Lease): Promise<Headers> {
    const credential = await this.ctx.credentials.resolve(credentialRef((this.config.credentialRef as string)))
    if (credential === undefined) failure('RUNTIME_UNAVAILABLE', 503, 'Isolated execution is unavailable')
    const headers = new Headers({
      authorization: `Bearer ${credential.value}`,
      'x-arx-operation-id': lease.operationId,
      'x-arx-user-id': lease.authority.principal.userId,
      'x-arx-authority-revision': String(lease.authority.revision),
      [WORKER_CAPABILITY_HEADER]: lease.capability,
    })
    if (lease.scope !== undefined) {
      headers.set('x-arx-project-id', lease.scope.projectId)
      if (lease.scope.workspaceId !== undefined) headers.set('x-arx-workspace-id', lease.scope.workspaceId)
    }
    return headers
  }

  private lease(authority: RequestAuthority, scope: OwnedResource | undefined): Lease {
    this.assertAdmission(authority)
    let settle!: () => void
    const settled = new Promise<void>((resolve) => { settle = resolve })
    const lease: Lease = { operationId: randomUUID(), capability: randomBytes(32).toString('base64url'),
      brokerTasks: new Set(), allocations: new Set(), authority, ...(scope === undefined ? {} : { scope }),
      controller: new AbortController(), settled, settle }
    this.leases.set(lease.operationId, lease)
    return lease
  }

  private async cancel(lease: Lease, trigger: CancellationTrigger): Promise<void> {
    if (lease.cancelling !== undefined) return lease.cancelling
    lease.controller.abort(new Error('Authority invalidated'))
    lease.cancelling = (async () => {
      try {
        const response = await fetch(new URL(`/_arx/operations/${lease.operationId}/cancel`, this.endpoint), {
          method: 'POST', headers: await this.headers(lease), redirect: 'error',
          signal: AbortSignal.timeout(this.config.cancellationTimeoutMs),
        })
        if (!response.ok) failure('RUNTIME_QUIESCENCE', 503, 'Worker quiescence was not confirmed')
        const result: unknown = JSON.parse(Buffer.from(await boundedBody(response, this.config.maxResponseBytes)).toString())
        const receipt = object(result)
        if (receipt?.operationId !== lease.operationId || receipt.quiescent !== true) {
          failure('RUNTIME_QUIESCENCE', 503, 'Worker quiescence was not confirmed')
        }
        await lease.settled
        await Promise.allSettled([...lease.brokerTasks])
        this.leases.delete(lease.operationId)
        for (const [id, writer] of this.writers) if (writer.lease === lease) this.writers.delete(id)
        for (const [id, pending] of this.pendingReplies) if (pending.lease === lease) this.pendingReplies.delete(id)
      } catch (error) {
        const closes = !this.unsafe
        this.unsafe = true
        // The adapter stays closed until the process restarts; this line is the only record of what closed it.
        // It names the error class only: a message can carry the supervisor credential or response bytes.
        if (closes) {
          this.ctx.logger.error('isolated runtime adapter closed: operation %s has no quiescent receipt (trigger: %s, cause: %s)',
            lease.operationId, trigger, String((Object(error) as { name?: unknown }).name))
        }
        failure('RUNTIME_QUIESCENCE', 503, 'Worker quiescence was not confirmed')
      }
    })()
    return lease.cancelling
  }

  /**
   * Close the affected downlinks, abort all affected transports, cancel every supervisor lease, and await
   * process-tree receipts. Concurrent requests share the barrier, and new owner
   * execution refuses until it settles. A missing receipt permanently closes this adapter.
   * @param userId - Affected account, or all accounts during disposal.
   */
  quiesce(userId?: WebUserId): Promise<void> { return this.quiesceFor(userId, 'quiesce-call') }

  private quiesceFor(userId: WebUserId | undefined, trigger: CancellationTrigger): Promise<void> {
    this.closeDownlinks(downlink => userId === undefined || downlink.authority.principal.userId === userId)
    const existing = this.quiescences.get(undefined) ?? this.quiescences.get(userId)
    if (existing !== undefined) return existing
    const leases = [...this.leases.values()].filter(lease => userId === undefined || lease.authority.principal.userId === userId)
    const operation = Promise.allSettled(leases.map(lease => this.cancel(lease, trigger))).then((settled) => {
      if (settled.some(result => result.status === 'rejected')) failure('RUNTIME_QUIESCENCE', 503, 'Worker quiescence was not confirmed')
    }).finally(() => { this.quiescences.delete(userId) })
    this.quiescences.set(userId, operation)
    return operation
  }

  /**
   * Execute the closed worker-history protocol using a control-issued lease.
   * Capabilities authorize only the current USER workspace and never carry SQL
   * or path operations. Broker errors omit private locations and source bytes.
   * @param request - Private supervisor-to-control Request.
   * @returns Durable receipt or a fixed refusal.
   */
  async broker(request: Request): Promise<Response> {
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
    try {
      request.signal.throwIfAborted()
      if (request.method !== 'POST'
        || new URL(request.url).pathname !== WORKER_BROKER_PATH) failure('RUNTIME_BROKER', 404, 'Worker operation unavailable')
      if (request.headers.get('content-type')?.split(';',
        1)[0]?.trim().toLowerCase() !== 'application/json') failure('RUNTIME_BROKER', 415, 'JSON required')
      const capability = request.headers.get(WORKER_CAPABILITY_HEADER)
      const lease = [...this.leases.values()].find(value => value.capability === capability)
      if (lease === undefined || lease.controller.signal.aborted || this.closing || this.unsafe
      ) failure('RUNTIME_BROKER', 403, 'Worker operation unavailable')
      const text = Buffer.from(await boundedBody(new Response(request.body), this.config.maxRequestBytes)).toString()
      request.signal.throwIfAborted()
      const parsed = workerBrokerRequestSchema.safeParse(JSON.parse(text))
      if (!parsed.success) failure('RUNTIME_BROKER', 400, 'Invalid worker operation')
      const signal = AbortSignal.any([request.signal, lease.controller.signal])
      signal.throwIfAborted()
      const job = this.brokerOperation(lease, parsed.data, signal)
      lease.brokerTasks.add(job)
      try {
        const value = await job
        await this.authorize(lease.authority, { kind: 'workspace', workspaceId: parsed.data.workspaceId as WorkspaceId },
          parsed.data.operation === 'append' || parsed.data.operation === 'allocate-fork' ? 'session.prompt' : 'session.history')
        signal.throwIfAborted()
        return Response.json({ value }, { headers })
      } finally { lease.brokerTasks.delete(job) }
    } catch (error) {
      return Response.json({ error: 'Worker operation refused' },
        { status: error instanceof WebIdentityError ? error.status : 503, headers })
    }
  }

  private async brokerOperation(lease: Lease, request: WorkerBrokerRequest, signal: AbortSignal): Promise<unknown> {
    if (request.operation === 'snapshot') await this.releaseStaleWriter(lease, request, signal)
    const key = request.operation === 'list' || request.operation === 'list-snapshots' ? request.workspaceId : request.sessionId
    const previous = this.brokerQueues.get(key)
    const task = (previous ?? Promise.resolve()).catch(() => {}).then(() => {
      signal.throwIfAborted()
      return this.brokerOperationCore(lease, request, signal)
    })
    this.brokerQueues.set(key, task)
    try { return await task }
    finally { if (this.brokerQueues.get(key) === task) this.brokerQueues.delete(key) }
  }

  /**
   * A different worker hydrating a session whose writer lease is still live is a restarted worker.
   * After the same scope and owner checks as the operation itself, control cancels the old lease by
   * its operation id and waits for its quiescent receipt; the writer then moves in the queued snapshot.
   * Concurrent requests share the lease's single cancellation; a missing receipt closes the adapter.
   * This runs before the per-session queue, so the old lease's queued broker work can settle.
   * Control cancels only the writer it read before the checks, and only while the same worker id and lease are
   * still the writer and that lease is still live: a lease that ended with a quiescent receipt receives no cancellation.
   */
  private async releaseStaleWriter(lease: Lease, request: Extract<WorkerBrokerRequest, { operation: 'snapshot' }>,
    signal: AbortSignal): Promise<void> {
    const writer = this.writers.get(request.sessionId)
    // The requester's own lease is the current operation, not a stopped one: the core refuses it.
    if (writer === undefined || writer.workerId === request.workerId || writer.lease === lease
      || !this.leases.has(writer.lease.operationId)) return
    const scope = await this.brokerScope(lease, request)
    await this.ownedReferences(lease.authority, { sessionId: request.sessionId }, scope)
    signal.throwIfAborted()
    // Every append or snapshot records the writer again, so compare its worker and lease, not the entry object.
    const current = this.writers.get(request.sessionId)
    if (current?.lease !== writer.lease || current.workerId !== writer.workerId
      || !this.leases.has(writer.lease.operationId)) return
    // An aborted requester stops waiting; the shared cancellation continues for the other requesters.
    await untilAborted(this.cancel(writer.lease, 'writer-handoff'), signal)
  }

  private async brokerScope(lease: Lease, request: WorkerBrokerRequest): Promise<OwnedResource | undefined> {
    const workspaceId = request.workspaceId as WorkspaceId
    const scope = await this.authorize(lease.authority, { kind: 'workspace', workspaceId },
      request.operation === 'append' || request.operation === 'allocate-fork' ? 'session.prompt' : 'session.history')
    if (lease.scope === undefined || (scope?.projectId !== lease.scope.projectId
      || (lease.scope.workspaceId !== undefined
        && workspaceId !== lease.scope.workspaceId))) failure('RUNTIME_BROKER', 403, 'Worker scope differs')
    return scope
  }

  private async brokerOperationCore(lease: Lease, request: WorkerBrokerRequest, signal: AbortSignal): Promise<unknown> {
    const workspaceId = request.workspaceId as WorkspaceId
    const scope = await this.brokerScope(lease, request)
    signal.throwIfAborted()
    if (request.operation === 'list') return this.ctx.projectStorage.executionHeaders(lease.authority, workspaceId, signal)
    if (request.operation === 'list-snapshots') return this.ctx.projectStorage.executionSnapshots(lease.authority, workspaceId, signal)
    const id = request.sessionId
    await this.ownedReferences(lease.authority, { sessionId: id }, scope)
    signal.throwIfAborted()
    if (request.operation === 'creation-header') return this.ctx.projectStorage.executionCreationHeader(lease.authority, id, signal)
    if (request.operation === 'revision') return await this.ctx.projectStorage.executionRevision(lease.authority, id, signal) ?? null
    if (request.operation === 'raw-page') return await this.ctx.projectStorage.executionRawPage(lease.authority, id,
      { offset: request.offset, maxBytes: request.maxBytes,
        ...(request.revision === undefined ? {} : { revision: request.revision as import('@arx-ai/arx-session-persistence').SessionPersistenceRevision }) },
      signal) ?? null
    const old = this.writers.get(id)
    const activeOther = old !== undefined && old.workerId !== request.workerId
      && this.leases.has(old.lease.operationId) && !old.lease.controller.signal.aborted
    if (activeOther) failure('RUNTIME_WRITER', 409, 'Another worker owns the session writer')
    const cold = old === undefined || old.workerId !== request.workerId
    if (request.operation === 'snapshot') {
      const snapshot = await this.ctx.projectStorage.executionSnapshot(lease.authority, id, cold, signal)
      signal.throwIfAborted()
      this.writers.set(id, { workerId: request.workerId, lease })
      return snapshot ?? null
    }
    if (request.operation === 'append') {
      if (cold) failure('RUNTIME_WRITER', 409, 'Worker must hydrate before append')
      this.writers.set(id, { workerId: request.workerId, lease })
      return this.ctx.projectStorage.append(lease.authority, id, request.events, signal)
    }
    const source = await this.ctx.projectStorage.executionSnapshot(lease.authority, id, false, signal)
    signal.throwIfAborted()
    if (source === undefined || request.seedLength === 0
      || request.seedLength > source.events.length) failure('RUNTIME_BROKER', 409, 'Fork source unavailable')
    const childId = sessionId(randomUUID())
    const header = await this.ctx.projectStorage.register(lease.authority, workspaceId, {
      id: childId, version: SESSION_FORMAT_VERSION, createdAt: Date.now(),
      parentSession: id, seedLength: request.seedLength,
      ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
    }, signal)
    signal.throwIfAborted()
    lease.allocations.add(childId)
    return header
  }

  private async ownedReferences(authority: RequestAuthority, value: unknown, scope?: OwnedResource): Promise<void> {
    if (Array.isArray(value)) {
      for (const child of value) await this.ownedReferences(authority, child, scope)
      return
    }
    const record = object(value)
    if (record === undefined) return
    for (const [key, child] of Object.entries(record)) {
      let owner: OwnedResource | undefined
      if (['sessionId', 'parentSessionId', 'childSessionId', 'sourceSessionId', 'beforeSessionId'].includes(key)
        && typeof child === 'string') {
        owner = await this.ctx.webIdentity.authorizeOwner(authority, { kind: 'session', sessionId: sessionId(child) })
      } else if (key === 'workspaceId' && typeof child === 'string') {
        owner = await this.ctx.webIdentity.authorizeOwner(authority, { kind: 'workspace', workspaceId: child as WorkspaceId })
      } else if (key === 'projectId' && typeof child === 'string') {
        owner = await this.ctx.webIdentity.authorizeOwner(authority, { kind: 'project', projectId: ProjectId(child) })
      } else if (['sessionIds', 'archivedSessionIds', 'workspaceIds'].includes(key) && Array.isArray(child)) {
        for (const id of child) {
          if (typeof id !== 'string') failure('RUNTIME_PROTOCOL', 502, 'Invalid worker reference')
          await this.ctx.webIdentity.authorizeOwner(authority, key === 'workspaceIds'
            ? { kind: 'workspace', workspaceId: id as WorkspaceId }
            : { kind: 'session', sessionId: sessionId(id) })
        }
      }
      if (owner !== undefined && scope !== undefined && (owner.projectId !== scope.projectId
        || (scope.workspaceId !== undefined && owner.workspaceId !== scope.workspaceId))) {
        failure('RUNTIME_FORBIDDEN', 403, 'Worker reference is outside the selected workspace')
      }
      // Event/tool data is opaque content. Resource references belong to the
      // protocol metadata, not to arbitrary user code or model-visible text.
      if (!['event', 'args', 'message', 'data', 'questions', 'view'].includes(key)) {
        await this.ownedReferences(authority, child, scope)
      }
    }
  }

  private assertReplyLease(lease: Lease): void {
    if (lease.controller.signal.aborted || !this.leases.has(lease.operationId)) {
      failure('RUNTIME_FORBIDDEN', 403, 'Response is not pending')
    }
  }

  private async revalidateReplyLease(lease: Lease): Promise<void> {
    this.assertReplyLease(lease)
    try { await this.ctx.webIdentity.revalidate(lease.authority) }
    catch (error) {
      // An expired interaction does not invalidate another login answering it.
      if (error instanceof WebIdentityError && error.status === 401) {
        failure('RUNTIME_FORBIDDEN', 403, 'Response is not pending')
      }
      throw error
    }
    this.assertReplyLease(lease)
  }

  /**
   * A unary exchange is bounded by requestTimeoutMs end to end, including the sub-stream attach. A stream is
   * bounded only until its response headers arrive; afterwards the lease and
   * the caller signal end its body. A workspace-scoped unary exchange first
   * attaches that workspace's sub-stream to each open downlink of the user.
   */
  private async dispatch(phase: 'unary' | 'stream', authority: RequestAuthority, resource: OwnerResource | undefined,
    method: string, path: string, init: RequestInit, signal?: AbortSignal, linkedLease?: Lease): Promise<{ response: Response
    lease: Lease }> {
    const endpoint = this.available()
    const scope = await this.authorize(authority, resource, method)
    if (linkedLease !== undefined) await this.revalidateReplyLease(linkedLease)
    signal?.throwIfAborted()
    const lease = this.lease(authority, scope)
    try {
      // The lease exists before the attach, so a downlink opening concurrently finds this workspace.
      const unaryDeadline = phase === 'unary' ? AbortSignal.timeout(this.config.requestTimeoutMs) : undefined
      const workspaceId = scope?.workspaceId
      if (unaryDeadline !== undefined && workspaceId !== undefined) {
        await untilAborted(Promise.allSettled([...this.downlinks]
          .filter(downlink => downlink.authority.principal.userId === authority.principal.userId)
          .map(downlink => this.attach(downlink, workspaceId))),
        AbortSignal.any([unaryDeadline, lease.controller.signal, ...(signal === undefined ? [] : [signal])]))
      }
      const headers = await this.headers(lease)
      if (linkedLease !== undefined) this.assertReplyLease(linkedLease)
      for (const [key, value] of new Headers(init.headers)) headers.set(key, value)
      await this.authorize(authority, resource, method)
      if (linkedLease !== undefined) await this.revalidateReplyLease(linkedLease)
      signal?.throwIfAborted()
      lease.controller.signal.throwIfAborted()
      if (this.closing || this.unsafe) failure('RUNTIME_UNAVAILABLE', 503, 'Isolated execution is unavailable')
      const headerDeadline = new AbortController()
      const timer = phase === 'stream' ? setTimeout(() => {
        headerDeadline.abort(new DOMException('Worker response headers timed out', 'TimeoutError'))
      }, this.config.requestTimeoutMs) : undefined
      let response: Response
      try {
        response = await fetch(new URL(path, endpoint), { ...init, headers, redirect: 'error',
          signal: AbortSignal.any([lease.controller.signal,
            unaryDeadline ?? headerDeadline.signal,
            ...(signal === undefined ? [] : [signal])]) })
      } finally { clearTimeout(timer) }
      if (response.headers.get('x-arx-operation-id') !== lease.operationId) failure('RUNTIME_PROTOCOL', 502,
        'Worker operation receipt is invalid')
      if (!response.ok) failure('RUNTIME_UNAVAILABLE', 502, 'Worker request failed')
      return { response, lease }
    } catch (error) {
      lease.settle()
      await this.cancel(lease, 'request-failed')
      throw error
    }
  }

  /**
   * Forward one existing RPC request after the final ownership/revision check.
   * No cookie, bearer, browser Origin or arbitrary endpoint crosses to workers.
   * @param authority - Current provider-issued USER authority.
   * @param resource - Authoritative selected resource, if the method addresses one.
   * @param request - Existing ApiProxy request envelope.
   * @param signal - Local caller cancellation.
   * @returns Existing RPC business result.
   */
  async invoke(authority: RequestAuthority, resource: OwnerResource | undefined, request: ClientRequest,
    signal?: AbortSignal): Promise<ServerResponse['result']> {
    const remote = ownerRemoteAdmission(request.method, request.payload)
    if (!isIsolatedProjectMethod(request.method) && remote === undefined) failure('RUNTIME_METHOD', 403, 'Method unavailable')
    if (remote !== undefined) resource = remote.resource
    await this.authorize(authority, undefined, request.method)
    const rawPayload = object(request.payload)
    if (rawPayload !== undefined && ['session.create', 'workspace.create'].includes(request.method)
      && ['cwd', 'path', 'directory', 'agentPreset'].some(key => key in rawPayload)) {
      failure('RUNTIME_FORBIDDEN', 403, 'Server-managed workspace required')
    }
    let validated: unknown
    try { validated = remote === undefined ? parseApiMethodPayload(request.method, request.payload) : request.payload }
    catch (error) {
      const issues = object(error)?.issues
      return { ok: false, error: { code: 'bad-request', message: `invalid payload for ${request.method}`,
        details: { issues: Array.isArray(issues) ? issues as ZodError['issues'] : [] } } }
    }
    const parsedPayload = object(validated)
    if (rawPayload !== undefined && parsedPayload !== undefined
      && Object.keys(rawPayload).some(key => !Object.hasOwn(parsedPayload, key))) {
      return { ok: false, error: { code: 'bad-request', message: `invalid payload for ${request.method}`,
        details: { issues: [] } } }
    }
    request = { ...request, payload: validated }
    if (request.method === 'host.describe') {
      this.available()
      // Control answers the readiness handshake: no worker cwd, attached count or host home leaves a worker.
      return { ok: true, value: { version: this.ctx.get('appVersion') ?? UNDECLARED_APP_VERSION, cwd: '',
        attachedSessions: 0, home: '', canOpenPath: false } }
    }
    const activity = remote === undefined && (METHODS.get(request.method) === 'active'
      || (METHODS.get(request.method) === 'new-session' && parsedPayload?.sessionId === undefined))
    const payloadResource = parsedPayload
    if (resource === undefined && payloadResource !== undefined) {
      const selectedSession = payloadResource.sessionId ?? payloadResource.parentSessionId
      if (typeof selectedSession === 'string') resource = { kind: 'session', sessionId: sessionId(selectedSession) }
      else if (typeof payloadResource.workspaceId === 'string') {
        resource = { kind: 'workspace', workspaceId: payloadResource.workspaceId as WorkspaceId }
      }
    }
    const selectedScope = await this.authorize(authority, resource, request.method)
    await this.ownedReferences(authority, remote === undefined ? request.payload : object(request.payload)?.args, selectedScope)
    if (resource === undefined && ['session.list', 'workspace.list', 'session.search'].includes(request.method)) {
      return this.listAcrossWorkspaces(authority, request, signal)
    }
    if (request.method === 'workspace.insertBefore') {
      return this.orderWorkspace(authority, request.payload as ReturnType<typeof parseApiMethodPayload<'workspace.insertBefore'>>)
    }
    let allocatedSessionId: ReturnType<typeof sessionId> | undefined
    let newSessionId: ReturnType<typeof sessionId> | undefined
    if (request.method === 'session.create') {
      const payload = request.payload as ReturnType<typeof parseApiMethodPayload<'session.create'>>
      this.available()
      if (typeof payload.sessionId === 'string') {
        // Existing SDK resume shape selects an already owned sidecar row. It
        // cannot allocate a browser-selected id or infer authority from a path.
        const owned = await this.ctx.webIdentity.authorizeOwner(authority,
          { kind: 'session', sessionId: sessionId(payload.sessionId) }, ModuleId('runtime'))
        if (payload.workspaceId !== undefined && payload.workspaceId !== owned.workspaceId) {
          failure('RUNTIME_FORBIDDEN', 403, 'Session workspace differs')
        }
        allocatedSessionId = sessionId(payload.sessionId)
        resource = { kind: 'workspace', workspaceId: owned.workspaceId }
        request = { ...request, payload: { ...payload, workspaceId: owned.workspaceId } }
      } else {
        if (resource?.kind !== 'workspace') failure('RUNTIME_FORBIDDEN', 403, 'Server-managed workspace required')
        const id = sessionId(randomUUID())
        allocatedSessionId = id
        newSessionId = id
        await this.ctx.projectStorage.register(authority, resource.workspaceId, {
          id, version: SESSION_FORMAT_VERSION, createdAt: Date.now(),
        })
        request = { ...request, payload: { ...payload, sessionId: id } }
      }
    }
    const body = JSON.stringify(request)
    if (Buffer.byteLength(body) > this.config.maxRequestBytes) failure('RUNTIME_LIMIT', 413, 'Worker request limit exceeded')
    const { response, lease } = await this.dispatch('unary', authority, resource, request.method, `/api/${request.method}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body }, signal)
    try {
      const result = serverResponseSchema.parse(JSON.parse(Buffer.from(await boundedBody(response,
        this.config.maxResponseBytes)).toString()))
      if (result.rpcId !== request.rpcId) failure('RUNTIME_PROTOCOL', 502, 'Worker RPC receipt is invalid')
      if (result.result.ok) {
        const value = object(result.result.value)
        if ((allocatedSessionId !== undefined && value?.sessionId !== allocatedSessionId)
          || (request.method === 'session.fork' && (typeof value?.sessionId !== 'string'
            || !lease.allocations.has(sessionId(value.sessionId))))) failure('RUNTIME_PROTOCOL', 502,
          'Worker session allocation receipt is invalid')
        // The worker first opens the genuinely new lifecycle; only its validated
        // success commits the empty owned header before the external receipt.
        if (newSessionId !== undefined) {
          const materializeSignal = signal === undefined ? lease.controller.signal
            : AbortSignal.any([signal, lease.controller.signal])
          this.available()
          materializeSignal.throwIfAborted()
          await this.ctx.projectStorage.materialize(authority, newSessionId, materializeSignal)
          this.available()
          materializeSignal.throwIfAborted()
        }
        if (value !== undefined && ['session.list', 'session.search', 'workspace.list'].includes(request.method)
          && Array.isArray(value.items)) {
          const items: unknown[] = []
          for (const item of value.items) {
            try { await this.ownedReferences(authority, item); items.push(item) }
            catch (error) {
              if (!(error instanceof WebIdentityError) || error.status !== 403) throw error
            }
          }
          value.items = items
        }
        await this.ownedReferences(authority, result.result.value, lease.scope)
      } else { await this.ownedReferences(authority, result.result.error.details, lease.scope) }
      await this.authorize(authority, resource, request.method)
      lease.controller.signal.throwIfAborted()
      if (result.result.ok && (remote === undefined ? activity : isOwnerRemoteActivity(request.method, result.result.value))) {
        await this.ctx.webIdentity.revalidate(authority, { activity: true })
        await this.authorize(authority, resource, request.method)
        lease.controller.signal.throwIfAborted()
      }
      if (response.headers.get('x-arx-quiescent') === 'true') this.leases.delete(lease.operationId)
      const archived = result.result.ok && request.method === 'workspace.archiveSession'
        ? object(result.result.value)?.archivedSessionIds : undefined
      if (Array.isArray(archived) && lease.scope?.workspaceId !== undefined) {
        const archivedSessionIds = await this.recordArchive(authority, [[lease.scope.workspaceId, archived]])
        return { ok: true, value: { archivedSessionIds } }
      }
      return result.result
    } catch (error) {
      lease.settle()
      await this.cancel(lease, 'request-failed')
      throw error
    } finally { lease.settle() }
  }

  private async listAcrossWorkspaces(authority: RequestAuthority, request: ClientRequest,
    signal?: AbortSignal): Promise<ServerResponse['result']> {
    this.available()
    const workspaceIds = await this.ctx.projectStorage.workspaceOrder(authority)
    // ponytail: every unscoped listing sends one request to each workspace worker of the user and wakes it.
    // Upgrade path: control keeps per-workspace summaries current from the downlinks and answers without workers.
    const results = await Promise.all(workspaceIds.map(workspaceId => this.invoke(authority, { kind: 'workspace', workspaceId },
      request, signal)))
    const items: unknown[] = []
    const archives: (readonly [WorkspaceId, readonly unknown[]])[] = []
    let hasMore = false
    for (const [index, result] of results.entries()) {
      if (!result.ok) failure('RUNTIME_UNAVAILABLE', 502, 'Workspace listing failed')
      const value = object(result.value)
      if (!Array.isArray(value?.items) || (request.method === 'workspace.list' && !Array.isArray(value.archivedSessionIds))
        || (request.method === 'session.search' && typeof value.hasMore !== 'boolean')) {
        failure('RUNTIME_PROTOCOL', 502, 'Workspace listing is invalid')
      }
      items.push(...value.items as unknown[])
      hasMore ||= value.hasMore === true
      if (request.method === 'workspace.list') {
        archives.push([workspaceIds[index] as WorkspaceId, value.archivedSessionIds as unknown[]])
      }
    }
    if (request.method === 'workspace.list') {
      return { ok: true, value: { items, archivedSessionIds: await this.recordArchive(authority, archives) } }
    }
    // Search results keep each worker's ranking and are concatenated in workspace order within the wire limit.
    if (request.method === 'session.search') {
      return { ok: true, value: { items: items.slice(0, SESSION_SEARCH_RESULT_LIMIT),
        hasMore: hasMore || items.length > SESSION_SEARCH_RESULT_LIMIT } }
    }
    return { ok: true, value: { items } }
  }

  /**
   * Record workspace archives for the user; a worker reports only its own workspace. Calls of one
   * user apply in call order, so a later answer or frame never carries an older union.
   * @returns Archived ids of every workspace control has seen for the user that the user still owns.
   */
  private recordArchive(authority: RequestAuthority, entries: readonly (readonly [WorkspaceId, readonly unknown[]])[]): Promise<unknown[]> {
    const userId = authority.principal.userId
    const task = (this.archiveTails.get(userId) ?? Promise.resolve()).then(async () => {
      const archives = this.archives.get(userId) ?? new Map<WorkspaceId, readonly unknown[]>()
      for (const [workspaceId, archivedSessionIds] of entries) archives.set(workspaceId, archivedSessionIds)
      this.archives.set(userId, archives)
      // Ids learned from other workspaces are published only while the user still owns them.
      const owned: unknown[] = []
      for (const id of new Set([...archives.values()].flat())) {
        try {
          await this.ownedReferences(authority, { sessionIds: [id] })
          owned.push(id)
        } catch (error) {
          if (!(error instanceof WebIdentityError) || error.status !== 403) throw error
        }
      }
      return owned
    })
    this.archiveTails.set(userId, task.then(() => {}, () => {}))
    return task
  }

  /** Store one move, then notify host downlinks; an identity failure while notifying can follow the committed order. */
  private async orderWorkspace(authority: RequestAuthority,
    payload: ReturnType<typeof parseApiMethodPayload<'workspace.insertBefore'>>): Promise<ServerResponse['result']> {
    this.available()
    const workspaceId = payload.workspaceId as WorkspaceId
    await this.authorize(authority, { kind: 'workspace', workspaceId }, 'workspace.insertBefore')
    const workspaceIds = await this.ctx.projectStorage.moveWorkspace(authority, workspaceId,
      payload.beforeWorkspaceId as WorkspaceId | undefined)
    await this.ctx.webIdentity.revalidate(authority, { activity: true })
    await this.authorize(authority, { kind: 'workspace', workspaceId }, 'workspace.insertBefore')
    for (const downlink of [...this.downlinks]) {
      if (downlink.channel !== 'host' || downlink.authority.principal.userId !== authority.principal.userId) continue
      // Each receiving login is revalidated and its references authorized like a worker frame.
      try {
        await this.ctx.webIdentity.revalidate(downlink.authority)
        await this.ownedReferences(downlink.authority, { workspaceIds })
      } catch (error) {
        if (!(error instanceof WebIdentityError) || (error.status !== 401 && error.status !== 403)) throw error
        continue
      }
      downlink.queue.push({ frame: { rpcId: RpcId(randomUUID()), payload: { type: 'host/workspace-order-changed', workspaceIds } },
        delivered: () => {} })
      downlink.wake?.()
    }
    return { ok: true, value: { workspaceIds } }
  }

  /**
   * Existing HTTP carrier entry for unary RPC and owned log downloads.
   * @param authority - Current issued USER authority.
   * @param request - Incoming browser carrier request.
   * @param resource - Resource selected by the trusted gateway parser.
   * @param signal - Caller cancellation.
   * @returns Existing ServerResponse JSON envelope.
   */
  async fetch(authority: RequestAuthority, request: Request, resource?: OwnerResource, signal?: AbortSignal): Promise<Response> {
    const path = new URL(request.url).pathname
    if ((request.method === 'GET' || request.method === 'HEAD') && path === '/api/session.export') {
      const url = new URL(request.url)
      const id = url.searchParams.get('sessionId')
      if (id === null || [...url.searchParams.keys()].some(key => !['sessionId', 'includeDescendants'].includes(key))) {
        failure('RUNTIME_PROTOCOL', 400, 'Invalid export request')
      }
      const ownerResource: OwnerResource = { kind: 'session', sessionId: sessionId(id) }
      const { response, lease } = await this.dispatch('unary', authority, ownerResource, 'session.export',
        path + url.search, { method: request.method }, signal ?? request.signal)
      try {
        const manifest = response.headers.get('x-arx-export-sessions')
        if (manifest === null) failure('RUNTIME_PROTOCOL', 502, 'Worker export receipt is invalid')
        const ids: unknown = JSON.parse(manifest)
        if (!Array.isArray(ids) || !ids.includes(id)) failure('RUNTIME_PROTOCOL', 502, 'Worker export receipt is invalid')
        await this.ownedReferences(authority, { sessionIds: ids }, lease.scope)
        const body = request.method === 'HEAD' ? null : await boundedBody(response, this.config.maxResponseBytes)
        await this.authorize(authority, ownerResource, 'session.export')
        lease.controller.signal.throwIfAborted()
        if (response.headers.get('x-arx-quiescent') === 'true') this.leases.delete(lease.operationId)
        return new Response(body === null ? null : new Uint8Array(body), { headers: { 'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="session.zip"', 'cache-control': 'no-store',
          'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } })
      } catch (error) {
        lease.settle()
        await this.cancel(lease, 'request-failed')
        throw error
      } finally { lease.settle() }
    }
    if (request.method !== 'POST' || !path.startsWith('/api/')) failure('RUNTIME_METHOD', 403, 'Method unavailable')
    if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') failure('RUNTIME_MEDIA', 415, 'JSON required')
    const body = await boundedBody(new Response(request.body), this.config.maxRequestBytes)
    const parsedBody: unknown = JSON.parse(Buffer.from(body).toString())
    if (path === '/api/respond') return this.respond(authority, parsedBody, signal ?? request.signal)
    const envelope = clientRequestSchema.parse(parsedBody)
    if (path !== `/api/${envelope.method}`) failure('RUNTIME_PROTOCOL', 400, 'RPC path mismatch')
    const result = await this.invoke(authority, resource, envelope, signal ?? request.signal)
    return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result },
      { headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
  }

  private async respond(authority: RequestAuthority, body: unknown, signal: AbortSignal): Promise<Response> {
    const parsed = clientResponseSchema.safeParse(body)
    if (!parsed.success) failure('RUNTIME_PROTOCOL', 400, 'Invalid client response')
    const pending = this.pendingReplies.get(parsed.data.rpcId)
    if (pending === undefined || pending.lease.controller.signal.aborted || !this.leases.has(pending.lease.operationId)
      || pending.lease.authority.principal.userId !== authority.principal.userId) failure('RUNTIME_FORBIDDEN', 403,
      'Response is not pending')
    const assertPending = (): void => {
      if (this.pendingReplies.get(parsed.data.rpcId) !== pending) failure('RUNTIME_FORBIDDEN', 403, 'Response is not pending')
      this.assertReplyLease(pending.lease)
    }
    const resource: OwnerResource = { kind: 'session', sessionId: pending.sessionId }
    const responseScope = await this.authorize(authority, resource, 'session.prompt')
    assertPending()
    if (parsed.data.result.ok) {
      await this.ownedReferences(authority, parsed.data.result.value, responseScope)
      assertPending()
    }
    const linkedSignal = AbortSignal.any([pending.lease.controller.signal, signal])
    const { response, lease } = await this.dispatch('unary', authority, resource, 'session.prompt', '/api/respond',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed.data) }, linkedSignal, pending.lease)
    try {
      this.assertReplyLease(pending.lease)
      const receipt: unknown = JSON.parse(Buffer.from(await boundedBody(response, this.config.maxResponseBytes)).toString())
      this.assertReplyLease(pending.lease)
      const value = object(receipt)
      if (typeof value?.accepted !== 'boolean') failure('RUNTIME_PROTOCOL', 502, 'Invalid response receipt')
      await this.authorize(authority, resource, 'session.prompt')
      await this.revalidateReplyLease(pending.lease)
      lease.controller.signal.throwIfAborted()
      if (value.accepted) {
        await this.ctx.webIdentity.revalidate(authority, { activity: true })
        await this.authorize(authority, resource, 'session.prompt')
        await this.revalidateReplyLease(pending.lease)
        lease.controller.signal.throwIfAborted()
      }
      if (value.accepted) this.pendingReplies.delete(parsed.data.rpcId)
      if (response.headers.get('x-arx-quiescent') === 'true') this.leases.delete(lease.operationId)
      return Response.json(value, { headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
    } catch (error) {
      lease.settle()
      await this.cancel(lease, 'request-failed')
      throw error
    } finally { lease.settle() }
  }

  /**
   * Open the existing owner-filtered mux downlink.
   * @param authority - Current issued USER authority.
   * @param signal - Downlink cancellation.
   * @returns Existing mux frames.
   */
  async *streamMux(authority: RequestAuthority, signal: AbortSignal): AsyncIterable<RpcRequest<MuxFrame>> {
    for await (const frame of this.streams(authority, 'mux', signal)) yield frame as RpcRequest<MuxFrame>
  }

  /**
   * Open the existing owner-filtered host downlink.
   * @param authority - Current issued USER authority.
   * @param signal - Downlink cancellation.
   * @returns Existing host frames.
   */
  async *streamHost(authority: RequestAuthority, signal: AbortSignal): AsyncIterable<RpcRequest<HostFrame>> {
    for await (const frame of this.streams(authority, 'host', signal)) yield frame as RpcRequest<HostFrame>
  }

  /**
   * Merge one workspace-scoped sub-stream per attached workspace into one
   * downlink. The initial set is the user's workspaces with a live lease;
   * dispatch() attaches others before forwarding their first request. Each
   * frame is authorized against its sub-lease's workspace before exposure.
   * Any sub-stream end or failure ends the whole downlink and cancels every
   * sub-lease. Remote host events are denied.
   * @param authority - Current issued USER authority.
   * @param channel - Existing host or mux channel.
   * @param signal - Local downlink cancellation.
   * @returns Existing narrow RpcRequest frames filtered by identity ownership.
   */
  async *streams(authority: RequestAuthority, channel: 'mux' | 'host', signal: AbortSignal):
  AsyncIterable<RpcRequest<MuxFrame | HostFrame>> {
    this.available()
    await this.authorize(authority, undefined, 'runtime')
    signal.throwIfAborted()
    const downlink: Downlink = { authority, channel, closed: new AbortController(), attached: new Map(), leases: new Set(), queue: [] }
    const stop = (): void => { this.endDownlink(downlink) }
    signal.addEventListener('abort', stop, { once: true })
    this.downlinks.add(downlink)
    let current: QueuedFrame | undefined
    try {
      const live = new Set<WorkspaceId>()
      for (const lease of this.leases.values()) {
        const workspaceId = lease.scope?.workspaceId
        if (workspaceId !== undefined && lease.authority.principal.userId === authority.principal.userId
          && !lease.controller.signal.aborted) live.add(workspaceId)
      }
      await Promise.all([...live].map(workspaceId => this.attach(downlink, workspaceId)))
      for (;;) {
        current = downlink.queue.shift()
        if (current !== undefined) {
          // Exposure is checked at dequeue: a frame queued before quiescence or closure is never published.
          if (downlink.closed.signal.aborted || this.closing || this.unsafe || this.quiescences.has(undefined)
            || this.quiescences.has(authority.principal.userId) || this.sessionQuiescences.has(authority.authSessionId)
            || [...downlink.leases].some(lease => lease.controller.signal.aborted)) {
            for (const pending of [current, ...downlink.queue.splice(0)]) pending.delivered()
            current = undefined
            continue
          }
          yield current.frame
          current.delivered()
          current = undefined
          continue
        }
        if (downlink.failure !== undefined) throw downlink.failure.error
        if (downlink.closed.signal.aborted) return
        await new Promise<void>((resolve) => { downlink.wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', stop)
      this.downlinks.delete(downlink)
      this.endDownlink(downlink)
      for (const pending of [...current === undefined ? [] : [current], ...downlink.queue.splice(0)]) pending.delivered()
      await Promise.allSettled([...downlink.attached.values()])
      const settled = await Promise.allSettled([...downlink.leases].map(lease => this.cancel(lease, 'downlink-closed')))
      const rejected = settled.find(result => result.status === 'rejected')
      if (rejected !== undefined) throw rejected.reason
    }
  }

  /** Close selected idle downlinks; a downlink with sub-streams ends through its cancelled sub-leases, keeping their failure. */
  private closeDownlinks(selected: (downlink: Downlink) => boolean): void {
    for (const downlink of this.downlinks) if (downlink.attached.size === 0 && selected(downlink)) this.endDownlink(downlink)
  }

  private endDownlink(downlink: Downlink, failed?: { error: unknown }): void {
    if (!downlink.closed.signal.aborted) {
      if (failed !== undefined) downlink.failure = failed
      downlink.closed.abort()
    }
    downlink.wake?.()
  }

  private attach(downlink: Downlink, workspaceId: WorkspaceId): Promise<void> {
    const existing = downlink.attached.get(workspaceId)
    if (existing !== undefined) return existing
    const attaching = (async () => {
      const { response, lease } = await this.dispatch('stream', downlink.authority, { kind: 'workspace', workspaceId }, 'runtime',
        `/api/events.${downlink.channel}`, { method: 'GET' }, downlink.closed.signal)
      lease.settle()
      downlink.leases.add(lease)
      void this.pump(downlink, response, lease)
    })()
    attaching.catch((error: unknown) => { this.endDownlink(downlink, { error }) })
    downlink.attached.set(workspaceId, attaching)
    return attaching
  }

  /** Reuse the existing carrier's SSE parser for one sub-stream and queue each authorized frame. */
  private async pump(downlink: Downlink, response: Response, lease: Lease): Promise<void> {
    const authority = downlink.authority
    try {
      let previous = -1
      let size = 0
      const bounded = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => {
          for (const byte of chunk) {
            size++
            if (size > this.config.maxResponseBytes) failure('RUNTIME_LIMIT', 502, 'Worker frame limit exceeded')
            if (byte === 10 && previous === 10) size = 0
            previous = byte
          }
          controller.enqueue(chunk)
        },
      }))
      if (bounded === undefined) failure('RUNTIME_PROTOCOL', 502, 'Worker stream unavailable')
      const client = new InProcessApiClient({ fetch: () => new Promise<Response>((resolve) => {
        resolve(new Response(bounded, { headers: response.headers }))
      }) }, this.config.requestTimeoutMs)
      const signal = downlink.closed.signal
      const stream = downlink.channel === 'mux' ? client.events.mux({}, signal) : client.events.host({}, signal)
      for await (const frame of stream) {
        // Control owns workspace order; a worker only knows its own workspace.
        if (frame.payload.type === 'stream/error' || frame.payload.type === 'host/workspace-order-changed') continue
        if (frame.payload.type === 'host/remote-event') {
          const event = ownerRemoteEventAdmission(frame.payload.event, frame.payload.args)
          if (event === undefined) continue
          if (event.resource !== undefined) await this.ctx.webIdentity.authorizeOwner(authority, event.resource)
        }
        try { await this.ownedReferences(authority, frame.payload, lease.scope) }
        catch (error) {
          if (error instanceof WebIdentityError && error.status === 403) continue
          throw error
        }
        await this.ctx.webIdentity.revalidate(authority)
        if (lease.controller.signal.aborted || this.closing || signal.aborted) break
        if (frame.payload.type === 'approval/requested' || frame.payload.type === 'question/requested') {
          const previous = this.pendingReplies.get(frame.rpcId)
          if (previous !== undefined && (previous.lease.authority.principal.userId !== authority.principal.userId
            || previous.sessionId !== frame.payload.sessionId)) failure('RUNTIME_PROTOCOL', 502, 'Pending response identity differs')
          this.pendingReplies.set(frame.rpcId, { lease, sessionId: frame.payload.sessionId,
            ...(frame.payload.type === 'approval/requested' ? { approvalId: frame.payload.approvalId } : {}) })
        } else if (frame.payload.type === 'question/resolved') this.pendingReplies.delete(frame.payload.questionRpcId)
        else if (frame.payload.type === 'approval/resolved') {
          for (const [id, pending] of this.pendingReplies) {
            if (pending.approvalId === frame.payload.approvalId) this.pendingReplies.delete(id)
          }
        }
        let exposed: RpcRequest<MuxFrame | HostFrame> = frame
        if (frame.payload.type === 'host/archived-sessions-changed' && lease.scope?.workspaceId !== undefined) {
          exposed = { rpcId: frame.rpcId, payload: { type: 'host/archived-sessions-changed',
            archivedSessionIds: await this.recordArchive(authority, [[lease.scope.workspaceId,
              frame.payload.archivedSessionIds]]) as typeof frame.payload.archivedSessionIds } }
        }
        // The downlink can close during the archive filter; its drained queue has no consumer left to deliver this frame.
        if (downlink.closed.signal.aborted) break
        await new Promise<void>((resolve) => {
          downlink.queue.push({ frame: exposed, lease, delivered: resolve })
          downlink.wake?.()
        })
      }
      this.endDownlink(downlink)
    } catch (error) { this.endDownlink(downlink, { error }) }
  }
}
export default IsolatedProjectRuntime
