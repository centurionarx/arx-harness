/**
 * Native Loader/ApiProxy supervisor fixture. Files, accounts, ports and processes
 * are disposable; the fixture does not prove UID or mount isolation.
 */
import { Context } from '@arx-ai/cordis'
import Loader from '@arx-ai/cordis-plugin-loader'
import Include from '@arx-ai/cordis-plugin-include'
import JsonlPersistence from '@arx-ai/arx-session-persistence-jsonl'
import * as ToolFs from '@arx-ai/arx-tool-fs'
import { createApiProxy, toFetchHandler } from '@arx-ai/arx-host-apiproxy'
import * as AgentSpine from '@arx-ai/arx-agent-spine-demo'
import UserQuestions from '@arx-ai/arx-user-questions'
import Storage from '@arx-ai/arx-storage'
import FileSystemLocal from '@arx-ai/arx-fs-local'
import AttachmentLocal from '@arx-ai/arx-attachment-local'
import * as StorageJson from '@arx-ai/arx-storage-json'
import * as StorageDomain from '@arx-ai/arx-storage-domain'
import WorkspaceRegistry from '@arx-ai/arx-workspace'
import SessionQuery from '@arx-ai/arx-session-query'
import SubagentRuntime from '@arx-ai/arx-subagent'
import SessionProjections from '@arx-ai/arx-session-projection'
import * as Checkpoints from '@arx-ai/arx-session-checkpoint-policy'
import SessionTitles from '@arx-ai/arx-session-title'
import TypertRegistry from '@arx-ai/arx-typert-registry'
import * as TypertLoader from '@arx-ai/arx-typert-loader'
import TypertGateway from '@arx-ai/arx-api-gateway'
import * as Commands from '@arx-ai/arx-commands'
import Goals from '@arx-ai/arx-goal'
import MessageFeedback from '@arx-ai/arx-message-feedback'
import FilePreviews from '@arx-ai/arx-file-preview'
import FileReferences from '@arx-ai/arx-file-reference'
import SessionReferences from '@arx-ai/arx-session-reference'
import * as TurnOutlines from '@arx-ai/arx-session-turn-outline'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink, realpath } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { OwnerScope } from '@arx-ai/arx-web-identity'
import OwnedWorkerPersistence from '../src/worker-persistence.ts'
import type { WorkerPersistenceConfig } from '../src/worker-persistence.ts'
import { toOwnedWorkerFetch } from '../src/worker-boundary.ts'
import { WORKER_CAPABILITY_HEADER } from '../src/broker-contract.ts'

interface Assignment { controlOrigin: string; scope: OwnerScope; volumePath: string }
interface NativeWorker {
  assignment: Assignment
  workerId: string
  ctx?: Context
  carrier?: ReturnType<typeof toOwnedWorkerFetch>
  mounting?: Promise<void>
  awaitingMount: string[]
  stopping?: Promise<void>
  toolCalls: number
  modelCalls: number
  lastHeaders?: Headers
  lastStreamHeaders?: Headers
}
/**
 * Start the native supervisor fixture.
 * @param options - `stopTimeoutMs` bounds one worker stop. An in-process Context cannot be killed, so after the
 * deadline the fixture detaches the worker, counts a forced stop and issues the receipt while the abandoned
 * disposal continues until `close()`. This reproduces the timing of a supervisor kill, not its isolation;
 * without the option a stop waits for the disposal with no deadline.
 * @returns Fixture controls and the supervisor endpoint.
 */
export async function nativeSupervisorFixture(options: { workerConfig?: Partial<WorkerPersistenceConfig>
  stopTimeoutMs?: number
  fsTools?: boolean
  dispatchRemotes?: boolean
  baseline?: { logRoot: string
    compression: 'none' | 'zstd' } } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arx-native-worker-fixture-')))
  const workers = new Map<string, NativeWorker>()
  // A response that did not report x-arx-quiescent: true stays here until
  // cancelled, because control retains its lease.
  const operations = new Map<string, { controller: AbortController
    worker: NativeWorker
    done: Promise<void>
    stream: boolean }>()
  // First admitted request owns an id; a confirmed cancel tombstones it.
  const owners = new Map<string, string>()
  const tombstones = new Set<string>()
  const seen: string[] = []
  // Operations aborted by a worker stop stay here until that stop ends, so their receipts wait for it.
  const stoppingWith = new Map<string, NativeWorker>()
  const abandoned: Promise<void>[] = []
  let stopBarrier: Promise<void> | undefined
  let mountBarrier: Promise<void> | undefined
  let forcedStops = 0
  async function mount(worker: NativeWorker, capability: string) {
    await mountBarrier
    const assignment = worker.assignment
    const workerRoot = join(root, worker.workerId)
    await mkdir(workerRoot, { mode: 0o700 })
    await symlink(join(process.cwd(), 'node_modules'), join(workerRoot, 'node_modules'), 'dir')
    const config = { controlOrigin: assignment.controlOrigin, workerId: worker.workerId, ...assignment.scope,
      volumePath: assignment.volumePath, fixtureLoopback: true, requestTimeoutMs: 5000,
      maxResponseBytes: 16 * 1024 * 1024, rawPageBytes: 128 * 1024, ...(options.workerConfig ?? {}) }
    let source = (await readFile(fileURLToPath(new URL('./worker.cordis.yml', import.meta.url)), 'utf8'))
      .replace('__HISTORY_CONFIG__',
        JSON.stringify(options.baseline === undefined ? config : { root: options.baseline.logRoot,
          compression: options.baseline.compression })).replace('__STATE_ROOT__', JSON.stringify(join(workerRoot, 'state')))
      .replaceAll('__VOLUME_PATH__', JSON.stringify(assignment.volumePath))
    if (options.baseline !== undefined) source = source.replace("'@arx-ai/arx-isolated-project-runtime/worker'",
      "'@arx-ai/arx-session-persistence-jsonl'")
    if (options.fsTools === true) source += "\n- name: '@arx-ai/arx-tool-fs'\n"
    const path = join(workerRoot, 'cordis.yml')
    await writeFile(path, source, { mode: 0o600 })
    const ctx = new Context()
    ctx.baseUrl = pathToFileURL(workerRoot).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@arx-ai/arx-session-persistence-jsonl', JsonlPersistence], ['@arx-ai/arx-tool-fs', ToolFs],
      ['@arx-ai/arx-agent-spine-demo', AgentSpine], ['@arx-ai/arx-isolated-project-runtime/worker', OwnedWorkerPersistence],
      ['@arx-ai/arx-user-questions', UserQuestions], ['@arx-ai/arx-storage', Storage],
      ['@arx-ai/arx-fs-local', FileSystemLocal], ['@arx-ai/arx-attachment-local', AttachmentLocal],
      ['@arx-ai/arx-storage-json', StorageJson], ['@arx-ai/arx-storage-domain', StorageDomain],
      ['@arx-ai/arx-session-query', SessionQuery], ['@arx-ai/arx-subagent', SubagentRuntime], ['@arx-ai/arx-session-projection', SessionProjections],
      ['@arx-ai/arx-session-checkpoint-policy', Checkpoints],
      ['@arx-ai/arx-workspace', WorkspaceRegistry], ['@arx-ai/arx-session-title', SessionTitles],
      ['@arx-ai/arx-typert-registry', TypertRegistry], ['@arx-ai/arx-typert-loader', TypertLoader],
      ['@arx-ai/arx-api-gateway', TypertGateway], ['@arx-ai/arx-commands', Commands],
      ['@arx-ai/arx-goal', Goals], ['@arx-ai/arx-message-feedback', MessageFeedback],
      ['@arx-ai/arx-file-preview', FilePreviews], ['@arx-ai/arx-file-reference', FileReferences],
      ['@arx-ai/arx-session-reference', SessionReferences], ['@arx-ai/arx-session-turn-outline', TurnOutlines],
    ])
    ctx.loader.internal = { version: 'v2', async import(name: string) {
      if (!modules.has(name)) throw new Error('unregistered native worker module')
      return modules.get(name)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    try {
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
      await ctx.loader.await()
      if (options.baseline === undefined) ctx.ownedWorkerHistory.bind(capability, assignment.scope)
      await ctx.loader.create({ name: '@arx-ai/arx-workspace' }); await ctx.loader.await()
      ctx.on('llm/stream', (_options, next) => { worker.modelCalls++; return next() })
      ctx.on('tools/execute', async (_execution, next) => { worker.toolCalls++; return next() })
      worker.ctx = ctx
      const gateway = ctx.typertGateway
      if (!(gateway instanceof TypertGateway)) throw new Error('native worker requires the canonical Gateway provider')
      const defaults = { cwd: assignment.volumePath, defaultModelSelection: () => undefined }
      worker.carrier = options.baseline === undefined
        ? toOwnedWorkerFetch(ctx, defaults, options.dispatchRemotes === false ? undefined : gateway.dispatchRpc.bind(gateway))
        : toFetchHandler(createApiProxy(ctx, defaults))
    } catch (error) {
      const describe = (value: unknown, depth = 0): string => {
        if (depth > 8 || !(value instanceof Error)) return ''
        const nested: unknown[] = value instanceof AggregateError ? [...value.errors as unknown[]] : []
        if (value.cause !== undefined) nested.push(value.cause)
        return value.message + nested.map(child => '\n' + describe(child, depth + 1)).join('')
      }
      console.error('native Loader cause:', describe(error))
      await ctx.fiber.dispose(); throw error
    }
  }
  async function stop(worker: NativeWorker) {
    worker.stopping ??= (async () => {
      const aborted: string[] = []
      for (const [id, operation] of operations) if (operation.worker === worker) {
        operation.controller.abort(); operations.delete(id); stoppingWith.set(id, worker); aborted.push(id)
      }
      await worker.mounting?.catch(() => {})
      const ctx = worker.ctx
      delete worker.ctx; delete worker.carrier; delete worker.mounting; delete worker.lastHeaders; delete worker.lastStreamHeaders
      const disposal = (async () => { await stopBarrier; await ctx?.fiber.dispose() })()
      const deadline = new AbortController()
      try {
        if (options.stopTimeoutMs === undefined) await disposal
        else if (await Promise.race([disposal.then(() => false),
          delay(options.stopTimeoutMs, true, { signal: deadline.signal }).catch(() => false)])) {
          forcedStops++
          abandoned.push(disposal.catch(() => {}))
        }
      } finally {
        deadline.abort()
        worker.workerId = randomUUID()
        for (const id of aborted) stoppingWith.delete(id)
      }
    })()
    try { await worker.stopping } finally { delete worker.stopping }
  }
  async function handleFixtureRequest(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
    if (incoming.headers.authorization !== 'Bearer disposable-supervisor-fixture') { outgoing.writeHead(401); outgoing.end(); return }
    const userId = String(incoming.headers['x-arx-user-id'])
    const cancel = incoming.method === 'POST' ? /^\/_arx\/operations\/([^/]+)\/cancel$/.exec(incoming.url ?? '') : null
    if (cancel !== null) {
      // The path names the target; scope headers never select it.
      const id = cancel[1]!
      if ((owners.get(id) ?? userId) !== userId) { outgoing.writeHead(403); outgoing.end(); return }
      try {
        const operation = operations.get(id)
        owners.set(id, owners.get(id) ?? userId)
        tombstones.add(id)
        if (operation !== undefined) {
          operations.delete(id)
          operation.controller.abort()
          await operation.done
          // ponytail: the fixture cannot attribute in-worker work to an operation. Any
          // non-quiescent request other than an event stream may have started a turn, and a
          // worker left without tracked operations may hold pending interactions, so both stop
          // the whole worker and its other operations before the receipt. Per-turn
          // cancellation needs worker-side operation tracking.
          if (!operation.stream
            || ![...operations.values()].some(other => other.worker === operation.worker)) await stop(operation.worker)
        } else await stoppingWith.get(id)?.stopping
        outgoing.writeHead(200, { 'content-type': 'application/json' })
        outgoing.end(JSON.stringify({ operationId: id, quiescent: true }))
      } catch { outgoing.writeHead(503); outgoing.end() }
      return
    }
    const operationId = String(incoming.headers['x-arx-operation-id'])
    if (tombstones.has(operationId) || (owners.get(operationId) ?? userId) !== userId) {
      outgoing.writeHead(403); outgoing.end(); return
    }
    const assigned = [...workers.values()].filter(worker => worker.assignment.scope.userId === userId)
    const workspaceId = incoming.headers['x-arx-workspace-id']
    const worker = workspaceId === undefined ? (assigned.length === 1 ? assigned[0] : undefined)
      : workers.get(String(workspaceId))
    if (worker === undefined || worker.assignment.scope.userId !== userId
      || (incoming.headers['x-arx-project-id'] !== undefined
        && worker.assignment.scope.projectId !== incoming.headers['x-arx-project-id'])) {
      outgoing.writeHead(403); outgoing.end(); return
    }
    owners.set(operationId, userId)
    const controller = new AbortController()
    let finish!: () => void
    const done = new Promise<void>((resolve) => { finish = resolve })
    let quiescent = false
    operations.set(operationId, { controller, worker, done,
      stream: incoming.url?.startsWith('/api/events.') === true })
    outgoing.once('close', () => {
      controller.abort()
      if (quiescent) operations.delete(operationId)
    })
    try {
      if (worker.stopping !== undefined) await worker.stopping
      const capability = String(incoming.headers[WORKER_CAPABILITY_HEADER] ?? '')
      if (worker.carrier === undefined) {
        worker.mounting ??= mount(worker, capability)
        const path = String(incoming.url)
        worker.awaitingMount.push(path)
        try { await worker.mounting } finally { worker.awaitingMount.splice(worker.awaitingMount.indexOf(path), 1) }
      }
      const chunks: Buffer[] = []
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk as Uint8Array))
      // A cancelled operation never reaches the worker carrier.
      controller.signal.throwIfAborted()
      const headers = new Headers()
      for (const [key, value] of Object.entries(incoming.headers)) if (typeof value === 'string') headers.set(key, value)
      const body = Buffer.concat(chunks).toString()
      if (body !== '') {
        const value = JSON.parse(body) as { method?: string }
        if (value.method !== undefined) seen.push(value.method)
      }
      worker.lastHeaders = new Headers(headers)
      if (incoming.url?.startsWith('/api/events.') === true) worker.lastStreamHeaders = new Headers(headers)
      const result = await worker.carrier!.fetch(new Request('http://fixture' + String(incoming.url), {
        method: incoming.method ?? 'GET', headers, signal: controller.signal,
        ...(incoming.method === 'GET' || incoming.method === 'HEAD' ? {} : { body }),
      }))
      if (!result.ok) console.error('native carrier refusal:', result.status, (await result.clone().text()).slice(0, 1000))
      quiescent = result.headers.get('x-arx-quiescent') === 'true'
      outgoing.writeHead(result.status, { ...Object.fromEntries(result.headers), 'x-arx-operation-id': operationId })
      if (result.body !== null) {
        // Cancelling the reader ends a stream body that would otherwise wait for its next frame.
        const reader = result.body.getReader()
        const stopReading = () => { void reader.cancel() }
        controller.signal.addEventListener('abort', stopReading, { once: true })
        if (controller.signal.aborted) stopReading()
        try { for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) outgoing.write(chunk.value) }
        finally { controller.signal.removeEventListener('abort', stopReading) }
      }
      outgoing.end()
    } catch (error) {
      if (!outgoing.destroyed) { outgoing.writeHead(503, { 'x-arx-operation-id': operationId }); outgoing.end() }
      console.error('native supervisor fixture:', error instanceof Error ? error.message : 'unknown')
    } finally { finish() }
  }
  const server = createServer((incoming, outgoing) => { void handleFixtureRequest(incoming, outgoing) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture port unavailable')
  return {
    endpoint: 'http://127.0.0.1:' + String(address.port), seen,
    assign(assignment: Assignment) {
      if (workers.has(assignment.scope.workspaceId)) throw new Error('native worker assignment is immutable')
      workers.set(assignment.scope.workspaceId, { assignment, workerId: randomUUID(), awaitingMount: [], toolCalls: 0, modelCalls: 0 })
    },
    ctxOf(workspaceId: string) { return workers.get(workspaceId)?.ctx },
    carrierOf(workspaceId: string) { return workers.get(workspaceId)?.carrier },
    headersOf(workspaceId: string) {
      const headers = workers.get(workspaceId)?.lastHeaders
      return headers === undefined ? undefined : new Headers(headers)
    },
    /** Headers of the latest event stream forwarded to one worker; its lease stays live while the stream is open. */
    streamHeadersOf(workspaceId: string) {
      const headers = workers.get(workspaceId)?.lastStreamHeaders
      return headers === undefined ? undefined : new Headers(headers)
    },
    get counts() { return [...workers.values()].reduce((sum, worker) =>
      ({ toolCalls: sum.toolCalls + worker.toolCalls, modelCalls: sum.modelCalls + worker.modelCalls }), { toolCalls: 0, modelCalls: 0 }) },
    resetCounts() { for (const worker of workers.values()) { worker.modelCalls = 0; worker.toolCalls = 0 } },
    async restart() { await Promise.all([...workers.values()].map(stop)) },
    /** Every later worker stop waits for this barrier before disposing its Context; no argument removes it. */
    holdStop(barrier?: Promise<void>) { stopBarrier = barrier },
    /** Every later worker mount waits for this barrier before it starts; no argument removes it. */
    holdMount(barrier?: Promise<void>) { mountBarrier = barrier },
    /** Request paths admitted for one worker that wait for its mount to finish. */
    awaitingMount(workspaceId: string) { return [...workers.get(workspaceId)?.awaitingMount ?? []] },
    /** Number of worker stops that reached `stopTimeoutMs` before their disposal finished. */
    get forcedStops() { return forcedStops },
    async close() {
      await this.restart()
      await Promise.all(abandoned)
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) =>{  if (error === undefined) resolve(); else reject(error) }))
      await rm(root, { recursive: true, force: true })
    },
  }
}
