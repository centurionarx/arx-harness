/**
 * Worker persistence over an owner-scoped control capability.
 * The existing coordinator retains write queues, seed adoption and flushes.
 * @module arx-isolated-project-runtime/worker-persistence
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { Context } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import {
  CoordinatedSessionPersistence, SessionPersistenceRevision, PersistenceCoordinator,
  DEFAULT_PREPARED_SESSION_CACHE_SIZE, DEFAULT_WRITE_BATCH_MAX_DELAY_MS,
} from '@arx-ai/arx-session-persistence'
import type {
  PersistenceBackend, SessionLocation, SessionPersistenceSnapshot, SessionRawArtifact,
  SessionRawArtifactPage, SessionRawArtifactPageRequest, StoredPrefix,
} from '@arx-ai/arx-session-persistence'
import type { SessionEvent, SessionHeader, SessionId } from '@arx-ai/arx-session'
import type { OwnerScope } from '@arx-ai/arx-web-identity'
import { WORKER_BROKER_PATH, WORKER_CAPABILITY_HEADER, workerCreationHeaderSchema, workerForkHeaderSchema } from './broker-contract.ts'
import type { WorkerBrokerRequest } from './broker-contract.ts'

/** Worker composition receives one assigned workspace and a private control origin. */
export interface WorkerPersistenceConfig {
  controlOrigin: string
  workerId: string
  userId: string
  projectId: string
  workspaceId: string
  /** Operator-assigned worker mount path, never supplied by browser RPC. */
  volumePath: string
  fixtureLoopback?: boolean
  requestTimeoutMs: number
  maxResponseBytes: number
  /** Bounded decoded pages used only while assembling an explicit raw export. */
  rawPageBytes: number
}
declare module '@arx-ai/cordis' {
  interface Context { ownedWorkerHistory: OwnedWorkerPersistence }
}

/** JSON round trips validate through coordinator before Session publication. */
interface SnapshotReceipt { meta: SessionHeader; events: SessionEvent[]; revision: string }
interface BrokerResult { value?: unknown; error?: string }
type WorkerCall = WorkerBrokerRequest extends infer Request
  ? Request extends { workerId: string } ? Omit<Request, 'workerId' | 'workspaceId'> : never : never

/** Existing SessionPersistence provider, with no local history database/files. */
export class OwnedWorkerPersistence extends CoordinatedSessionPersistence implements PersistenceBackend {
  static inject = ['sessions']
  static Config: z<WorkerPersistenceConfig> = z.object({
    controlOrigin: z.string().required(), workerId: z.string().required(),
    userId: z.string().required(), projectId: z.string().required(), workspaceId: z.string().required(),
    volumePath: z.string().required(), fixtureLoopback: z.boolean().default(false),
    requestTimeoutMs: z.number().step(1).min(1).required(), maxResponseBytes: z.number().step(1).min(1).required(),
    rawPageBytes: z.number().step(1).min(4).required(),
  })
  override readonly supportsRawArtifacts: boolean = true
  override readonly supportsRawArtifactPages: boolean = true
  override readonly name: string = 'owned-worker-persistence'
  private readonly origin: URL
  protected override readonly coordinator: PersistenceCoordinator
  // Latest bound capability: backs broker calls made outside any bound request, such as at mount.
  private capability: string | undefined
  // Capability of the bound request whose asynchronous work is running.
  private readonly requestCapability = new AsyncLocalStorage<string>()

  constructor(ctx: Context, readonly config: WorkerPersistenceConfig) {
    super(ctx)
    this.origin = new URL(config.controlOrigin)
    const fixture = config.fixtureLoopback === true && this.origin.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '[::1]'].includes(this.origin.hostname)
    if ((!fixture && this.origin.protocol !== 'https:') || this.origin.pathname !== '/'
      || this.origin.username !== '' || this.origin.password !== '' || this.origin.hash !== '' || this.origin.search !== '') {
      throw new Error('worker control origin must be a credential-free HTTPS origin')
    }
    ctx.provide('ownedWorkerHistory', this)
    this.coordinator = new PersistenceCoordinator(ctx, this, {
      preparedSessionCacheSize: DEFAULT_PREPARED_SESSION_CACHE_SIZE,
      writeBatchMaxDelayMs: DEFAULT_WRITE_BATCH_MAX_DELAY_MS,
    })
  }

  /**
   * Bind a trusted supervisor request to this fixed workspace.
   * @param capability - Opaque control-issued lease capability.
   * @param scope - Fixed assigned scope carried by trusted supervisor metadata.
   */
  bind(capability: string, scope: OwnerScope): void {
    if (!/^[A-Za-z0-9_-]{43}$/.test(capability) || scope.userId !== this.config.userId
      || scope.projectId !== this.config.projectId || scope.workspaceId !== this.config.workspaceId) {
      throw new Error('worker capability scope differs')
    }
    this.capability = capability
  }

  /**
   * Bind a trusted supervisor request and run its work under that request's own capability. Every broker call that
   * `work` makes, including deferred writes it schedules and background turns it starts, carries this capability even
   * after later requests bind theirs; control keeps it valid while the request runs and, after a non-quiescent
   * response, until it cancels the operation. A broker call outside any bound request uses the latest bound capability.
   * @param capability - Opaque control-issued lease capability of this request.
   * @param scope - Fixed assigned scope carried by trusted supervisor metadata.
   * @param work - The request's handling.
   * @returns The result of `work`.
   */
  runBound<T>(capability: string, scope: OwnerScope, work: () => Promise<T>): Promise<T> {
    this.bind(capability, scope)
    return this.requestCapability.run(capability, work)
  }

  private async call(request: WorkerCall, signal?: AbortSignal): Promise<unknown> {
    const capability = this.requestCapability.getStore() ?? this.capability
    if (capability === undefined) throw new Error('worker history capability unavailable')
    const response = await fetch(new URL(WORKER_BROKER_PATH, this.origin), {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', [WORKER_CAPABILITY_HEADER]: capability },
      body: JSON.stringify({ ...request, workerId: this.config.workerId, workspaceId: this.config.workspaceId }),
      signal: AbortSignal.any([AbortSignal.timeout(this.config.requestTimeoutMs), ...(signal === undefined ? [] : [signal])]),
    })
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    if (reader !== undefined) {
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          length += chunk.value.byteLength
          if (length > this.config.maxResponseBytes) throw new Error('worker history response limit')
          chunks.push(chunk.value)
        }
      } finally { await reader.cancel() }
    }
    const receipt = JSON.parse(Buffer.concat(chunks, length).toString()) as BrokerResult
    if (!response.ok || receipt.error !== undefined) throw new Error('worker history operation refused')
    return receipt.value
  }

  /**
   * Read original private bytes over the bounded broker contract.
   * @param id - Owned session within this operator-mounted workspace.
   * @param request - Existing persistence page request.
   * @param signal - Carrier cancellation.
   * @returns Original page or refusal when no materialized artifact exists.
   */
  override async readRawPage(id: SessionId, request: SessionRawArtifactPageRequest, signal?: AbortSignal): Promise<SessionRawArtifactPage> {
    const page = await this.call({ operation: 'raw-page', sessionId: id, offset: request.offset, maxBytes: request.maxBytes,
      ...(request.revision === undefined ? {} : { revision: request.revision }) }, signal) as SessionRawArtifactPage | null
    if (page === null) throw new Error('worker raw artifact unavailable')
    return page
  }

  /**
   * Assemble an explicit raw export without reserializing any recorded event.
   * Navigation continues to use bounded control pages, never this full reader.
   * @param id - Owned session.
   * @param signal - Export cancellation.
   * @returns The unchanged logical artifact, absent for a lazy log.
   */
  override async readRaw(id: SessionId, signal?: AbortSignal): Promise<SessionRawArtifact | undefined> {
    if (await this.readStoredRevision(id, signal) === undefined) return undefined
    const pieces: string[] = []
    let offset = 0, revision: SessionPersistenceRevision | undefined, first: SessionRawArtifactPage | undefined
    let bytes = 0
    for (;;) {
      const page = await this.readRawPage(id, { offset, maxBytes: this.config.rawPageBytes,
        ...(revision === undefined ? {} : { revision }) }, signal)
      first ??= page
      revision = page.revision
      bytes += Buffer.byteLength(page.content)
      if (bytes > this.config.maxResponseBytes) throw new Error('worker raw artifact response limit')
      pieces.push(page.content)
      if (page.nextOffset === undefined) return { meta: first.meta, filename: first.filename, content: pieces.join('') }
      if (page.nextOffset <= offset) throw new Error('worker raw artifact cursor did not advance')
      offset = page.nextOffset
    }
  }

  /**
   * Obtain an existing control allocation before native Agent publication.
   * @param sessionId - Registered unseeded session in this fixed workspace.
   * @returns Canonical immutable metadata without materializing its lazy log.
   */
  async readCreationHeader(sessionId: SessionId): Promise<SessionHeader> {
    const header = workerCreationHeaderSchema.parse(await this.call({ operation: 'creation-header', sessionId }))
    if (header.id !== sessionId || header.cwd !== this.config.volumePath) {
      throw new Error('worker creation header differs')
    }
    const { agentPreset, ...meta } = header
    return agentPreset === undefined ? meta : { ...meta, agentPreset }
  }

  /**
   * Allocate fork lineage in control before the worker creates its child.
   * @param sessionId - Existing owned parent session.
   * @param seedLength - Canonical event prefix length accepted by persistence.
   * @param agentPreset - Optional existing preset recorded in the new header.
   * @returns The control-generated owned child session identity.
   */
  async allocateForkSessionId(sessionId: SessionId, seedLength: number, agentPreset?: string): Promise<SessionId> {
    return (await this.allocateForkSessionHeader(sessionId, seedLength, agentPreset)).id
  }

  /**
   * Preserve the exact control-committed creation timestamp and immutable lineage.
   * @param sessionId - Existing parent in this fixed workspace.
   * @param seedLength - Canonical inherited event prefix.
   * @param agentPreset - Expected original composition preset.
   * @returns The closed control-issued header before Agent publication.
   */
  async allocateForkSessionHeader(sessionId: SessionId, seedLength: number, agentPreset?: string): Promise<SessionHeader> {
    const header = workerForkHeaderSchema.parse(await this.call({ operation: 'allocate-fork', sessionId, seedLength,
      ...(agentPreset === undefined ? {} : { agentPreset }) }))
    if (header.parentSession !== sessionId || header.seedLength !== seedLength
      || header.cwd !== this.config.volumePath || header.agentPreset !== agentPreset) {
      throw new Error('worker fork allocation header differs')
    }
    const { agentPreset: receivedPreset, ...meta } = header
    return receivedPreset === undefined ? meta : { ...meta, agentPreset: receivedPreset }
  }

  /**
   * Worker volumes contain no authoritative session artifact locations.
   * @param _meta - Owned header; control keeps its physical log location private.
   * @returns Undefined because this worker has no local history path.
   */
  locate(_meta: SessionHeader): SessionLocation | undefined { return undefined }
  /**
   * Cold control recovery completes before returning the first writer snapshot.
   * @param id - Owned session identity.
   * @param signal - Optional snapshot cancellation.
   * @returns A committed original prefix at the fixed worker mount, or undefined for a lazy log.
   */
  async loadStored(id: SessionId, signal?: AbortSignal): Promise<StoredPrefix | undefined> {
    const value = await this.call({ operation: 'snapshot', sessionId: id }, signal) as SnapshotReceipt | null
    if (value === null) return undefined
    return { meta: { ...value.meta, cwd: this.config.volumePath }, events: value.events,
      revision: SessionPersistenceRevision(value.revision) }
  }
  /**
   * Read the current control-owned artifact generation.
   * @param id - Owned session identity.
   * @param signal - Optional revision-read cancellation.
   * @returns The opaque generation, or undefined before log materialization.
   */
  override readRevision(id: SessionId, signal?: AbortSignal): Promise<SessionPersistenceRevision | undefined> {
    return this.readStoredRevision(id, signal)
  }
  /**
   * Read the current control-owned artifact generation over the closed broker.
   * @param id - Owned session identity.
   * @param signal - Optional revision-read cancellation.
   * @returns The opaque generation, or undefined before log materialization.
   */
  async readStoredRevision(id: SessionId, signal?: AbortSignal): Promise<SessionPersistenceRevision | undefined> {
    const revision = await this.call({ operation: 'revision', sessionId: id }, signal) as string | null
    return revision === null ? undefined : SessionPersistenceRevision(revision)
  }
  /**
   * Commit one coordinator batch through the current fixed workspace lease.
   * @param meta - Owned session header used to identify the control log.
   * @param events - Canonical events already validated by the coordinator.
   * @param _isMaterialized - Coordinator state; control determines actual materialization.
   * @returns Completion only after the durable append receipt.
   */
  async appendBatch(meta: SessionHeader, events: readonly SessionEvent[], _isMaterialized: boolean): Promise<void> {
    await this.call({ operation: 'append', sessionId: meta.id, events: [...events] })
  }
  /**
   * Control has already durably repaired a cold prefix; a live open-tail reload refuses.
   * @param _meta - Existing session header already authorized by control.
   * @param _marker - Existing coordinator marker; control owns durable repair.
   * @param closers - Proposed repair events; a live worker refuses nonempty repair.
   * @returns A completed promise only when no live repair is needed.
   */
  commitRepair(_meta: SessionHeader, _marker: unknown, closers: readonly SessionEvent[]): Promise<void> {
    return new Promise<void>((resolve) => {
      if (closers.length !== 0) throw new Error('open worker history requires a quiescent cold restart')
      resolve()
    })
  }
  /**
   * List materialized owned headers for this fixed workspace.
   * @param signal - Optional list cancellation.
   * @returns Original owned headers with the operator-assigned execution mount.
   */
  async list(signal?: AbortSignal): Promise<SessionHeader[]> {
    return (await this.listSnapshots(signal)).map(snapshot => snapshot.header)
  }
  /**
   * Pair materialized owned headers with their current control generations.
   * @param signal - Optional snapshot-list cancellation.
   * @returns Only headers whose artifacts remain present at the revision lookup.
   */
  async listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]> {
    const snapshots = await this.call({ operation: 'list-snapshots' }, signal) as SessionPersistenceSnapshot[]
    return snapshots.map(snapshot => ({ header: { ...snapshot.header, cwd: this.config.volumePath },
      revision: SessionPersistenceRevision(snapshot.revision) }))
  }
}
export default OwnedWorkerPersistence
