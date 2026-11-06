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
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises'
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
  stopping?: Promise<void>
  toolCalls: number
  modelCalls: number
  lastHeaders?: Headers
}
export async function nativeSupervisorFixture(options: { workerConfig?: Partial<WorkerPersistenceConfig>
  fsTools?: boolean
  dispatchRemotes?: boolean
  baseline?: { logRoot: string
    compression: 'none' | 'zstd' } } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arx-native-worker-fixture-'))
  const workers = new Map<string, NativeWorker>()
  // A finished response that reported x-arx-quiescent other than 'true' stays
  // here until cancelled, because control retains its lease.
  const operations = new Map<string, { controller: AbortController
    worker: NativeWorker
    closed: Promise<void>
    background?: boolean }>()
  // First admitted request owns an id; a confirmed cancel tombstones it.
  const owners = new Map<string, string>()
  const tombstones = new Set<string>()
  const seen: string[] = []
  async function mount(worker: NativeWorker, capability: string) {
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
      for (const [id, operation] of operations) if (operation.worker === worker) {
        operation.controller.abort(); operations.delete(id)
      }
      await worker.mounting?.catch(() => {})
      const ctx = worker.ctx
      delete worker.ctx; delete worker.carrier; delete worker.mounting; delete worker.lastHeaders
      try { await ctx?.fiber.dispose() } finally { worker.workerId = randomUUID() }
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
          await operation.closed
          // ponytail: the fixture cannot attribute in-worker work to an operation. A finished
          // non-quiescent response left a background turn, and a worker left without tracked
          // operations may hold pending interactions, so both stop the whole worker and its
          // other operations. Per-turn cancellation needs worker-side operation tracking.
          if (operation.background === true
            || ![...operations.values()].some(other => other.worker === operation.worker)) await stop(operation.worker)
        }
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
    const closed = new Promise<void>((resolve) => { outgoing.once('close', resolve) })
    let quiescent = false, stream = false
    const operation: { controller: AbortController; worker: NativeWorker; closed: Promise<void>; background?: boolean } =
      { controller, worker, closed }
    operations.set(operationId, operation)
    void closed.then(() => {
      controller.abort()
      if (quiescent) operations.delete(operationId)
      else operation.background = outgoing.writableFinished && !stream
    })
    try {
      if (worker.stopping !== undefined) await worker.stopping
      const capability = String(incoming.headers[WORKER_CAPABILITY_HEADER] ?? '')
      if (worker.carrier === undefined) { worker.mounting ??= mount(worker, capability); await worker.mounting }
      const chunks: Buffer[] = []
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk as Uint8Array))
      const headers = new Headers()
      for (const [key, value] of Object.entries(incoming.headers)) if (typeof value === 'string') headers.set(key, value)
      const body = Buffer.concat(chunks).toString()
      if (body !== '') {
        const value = JSON.parse(body) as { method?: string }
        if (value.method !== undefined) seen.push(value.method)
      }
      worker.lastHeaders = new Headers(headers)
      const result = await worker.carrier!.fetch(new Request('http://fixture' + String(incoming.url), {
        method: incoming.method ?? 'GET', headers, signal: controller.signal,
        ...(incoming.method === 'GET' || incoming.method === 'HEAD' ? {} : { body }),
      }))
      if (!result.ok) console.error('native carrier refusal:', result.status, (await result.clone().text()).slice(0, 1000))
      quiescent = result.headers.get('x-arx-quiescent') === 'true'
      stream = result.headers.get('content-type')?.startsWith('text/event-stream') === true
      outgoing.writeHead(result.status, { ...Object.fromEntries(result.headers), 'x-arx-operation-id': operationId })
      if (result.body !== null) for await (const chunk of result.body) outgoing.write(chunk)
      outgoing.end()
    } catch (error) {
      if (!outgoing.destroyed) { outgoing.writeHead(503, { 'x-arx-operation-id': operationId }); outgoing.end() }
      console.error('native supervisor fixture:', error instanceof Error ? error.message : 'unknown')
    }
  }
  const server = createServer((incoming, outgoing) => { void handleFixtureRequest(incoming, outgoing) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture port unavailable')
  return {
    endpoint: 'http://127.0.0.1:' + String(address.port), seen,
    assign(assignment: Assignment) {
      if (workers.has(assignment.scope.workspaceId)) throw new Error('native worker assignment is immutable')
      workers.set(assignment.scope.workspaceId, { assignment, workerId: randomUUID(), toolCalls: 0, modelCalls: 0 })
    },
    ctxOf(workspaceId: string) { return workers.get(workspaceId)?.ctx },
    carrierOf(workspaceId: string) { return workers.get(workspaceId)?.carrier },
    headersOf(workspaceId: string) {
      const headers = workers.get(workspaceId)?.lastHeaders
      return headers === undefined ? undefined : new Headers(headers)
    },
    get counts() { return [...workers.values()].reduce((sum, worker) =>
      ({ toolCalls: sum.toolCalls + worker.toolCalls, modelCalls: sum.modelCalls + worker.modelCalls }), { toolCalls: 0, modelCalls: 0 }) },
    resetCounts() { for (const worker of workers.values()) { worker.modelCalls = 0; worker.toolCalls = 0 } },
    async restart() { await Promise.all([...workers.values()].map(stop)) },
    async close() {
      await this.restart()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) =>{  if (error === undefined) resolve(); else reject(error) }))
      await rm(root, { recursive: true, force: true })
    },
  }
}
