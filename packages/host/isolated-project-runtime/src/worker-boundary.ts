/**
 * Genuine ApiProxy worker boundary with durable RPC/SSE publication.
 * @module arx-isolated-project-runtime/worker-boundary
 */
import type { Context } from '@arx-ai/cordis'
import { createApiProxy, toFetchHandler } from '@arx-ai/arx-host-apiproxy'
import type { ApiProxyDefaults } from '@arx-ai/arx-host-apiproxy'
import { clientRequestSchema, serverResponseSchema } from '@arx-ai/arx-host-apiproxy/api'
import type { ApiProxy, MuxFrame, HostFrame, RpcRequest, ServerResponse } from '@arx-ai/arx-host-apiproxy/api'
import { WorkspaceId } from '@arx-ai/arx-workspace'
import type { OwnerScope } from '@arx-ai/arx-web-identity'
import type { SessionLineageNode } from '@arx-ai/arx-session-query'
import type { SessionId } from '@arx-ai/arx-session'
import { WORKER_CAPABILITY_HEADER } from './broker-contract.ts'
import { WorkerHistoryRefusal } from './worker-persistence.ts'
import { ownerRemoteAdmission } from './allowed-remotes.ts'

/**
 * Wrap the native API over one operator-mounted workspace. This function does
 * not provide services: Loader must compose the real registries and providers.
 * @param ctx - The worker's native Cordis composition.
 * @param defaults - Existing API model/composition defaults.
 * @param dispatchRemote - Optional operator-bound canonical named-argument dispatcher; absent Remote calls fail closed.
 * @returns Existing fetch carrier with durable publication and opaque ids.
 */
export function toOwnedWorkerFetch(ctx: Context, defaults: ApiProxyDefaults,
  dispatchRemote?: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ServerResponse['result']>,
): { fetch(request: Request): Promise<Response> } {
  const history = ctx.ownedWorkerHistory
  const config = history.config
  const scope = { userId: config.userId, projectId: config.projectId, workspaceId: config.workspaceId } as OwnerScope
  const api = createApiProxy(ctx, { ...defaults,
    resolveSessionCreationHeader: sessionId => history.readCreationHeader(sessionId),
    allocateForkSessionHeader: (sourceId, seedLength, agentPreset) => history.allocateForkSessionHeader(sourceId, seedLength, agentPreset),
  })
  // A flush joins the session's open write barrier, whose writes carry the capability of the request that opened it.
  // When control refuses that capability (403: the opener's lease is gone or was cancelled), the events stay queued,
  // and a request whose own operation is still live flushes once more, opening a barrier under its own capability. A
  // request whose operation was cancelled, and every other failure, such as a failed durable append, propagate.
  const flush = async (signal: AbortSignal) => {
    for (const session of ctx.sessions.list()) {
      try { await ctx.sessions.flush(session) } catch (error) {
        if (signal.aborted || !(error instanceof WorkerHistoryRefusal) || error.status !== 403) throw error
        await ctx.sessions.flush(session)
      }
    }
  }
  const events = async function* <Frame extends MuxFrame | HostFrame>(
    source: AsyncIterable<RpcRequest<Frame>>, signal: AbortSignal,
  ): AsyncIterable<RpcRequest<Frame>> {
    for await (const frame of source) {
      await flush(signal)
      yield rewrite(frame) as RpcRequest<Frame>
    }
  }
  const durable: ApiProxy = { ...api, events: {
    mux: (request, signal) => events(api.events.mux(request, signal), signal),
    host: (request, signal) => events(api.events.host(request, signal), signal),
  } }
  const carrier = toFetchHandler(durable)
  let localWorkspaceId: ReturnType<typeof WorkspaceId> | undefined
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite)
    if (value === null || typeof value !== 'object') return value
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (key === 'workspaceId' && child === localWorkspaceId) result[key] = config.workspaceId
      else if (key === 'workspaceIds'
        && Array.isArray(child)) result[key] = (child as unknown[]).map(id => id === localWorkspaceId ? config.workspaceId : id)
      else if (['path', 'cwd'].includes(key) && child === config.volumePath) result[key] = 'workspace://' + config.workspaceId
      else result[key] = ['event', 'data', 'message', 'args', 'view'].includes(key) ? child : rewrite(child)
    }
    return result
  }
  const handle = async (request: Request): Promise<Response> => {
    if (localWorkspaceId === undefined) localWorkspaceId = (await ctx.workspaceRegistry.create(config.volumePath)).id
    const path = new URL(request.url).pathname
    let input = request
    if (request.method === 'POST' && path !== '/api/respond') {
      const envelope = clientRequestSchema.parse(await request.json())
      const remote = ownerRemoteAdmission(envelope.method, envelope.payload)
      if (remote !== undefined) {
        if (dispatchRemote === undefined) return new Response('Worker Remote unavailable', { status: 503 })
        const result = await dispatchRemote(envelope.method, envelope.payload, request.signal)
        await flush(request.signal)
        const busy = ctx.agents.list().some(agent => agent.status !== 'idle')
        return Response.json(rewrite({ type: 'server-response', rpcId: envelope.rpcId, result }),
          { headers: { 'cache-control': 'no-store', 'x-arx-quiescent': busy ? 'false' : 'true' } })
      }
      if (envelope.method === 'session.create') {
        const payload = envelope.payload as { workspaceId?: string }
        if (payload.workspaceId !== config.workspaceId) return new Response('Worker workspace refused', { status: 403 })
        envelope.payload = { ...payload, workspaceId: localWorkspaceId }
      }
      input = new Request(request.url, { method: request.method, headers: request.headers,
        body: JSON.stringify(envelope), signal: request.signal })
    }
    const result = await carrier.fetch(input)
    if (result.headers.get('content-type')?.startsWith('text/event-stream') === true) return result
    if (path === '/api/session.export') {
      await flush(request.signal)
      const url = new URL(request.url)
      const requested = url.searchParams.get('sessionId')
      const ids = new Set<SessionId>(requested === null ? [] : [requested as SessionId])
      if (result.ok && requested !== null && url.searchParams.get('includeDescendants') === 'true') {
        const query = ctx.get('sessionQuery')
        if (query === undefined) throw new Error('worker export lineage unavailable')
        const lineage = await query.traceSession(requested as SessionId, request.signal)
        const pending: SessionLineageNode[] = [...lineage.descendants]
        while (pending.length > 0) {
          const node = (pending.pop() as SessionLineageNode)
          ids.add(node.session.header.id)
          pending.push(...node.descendants)
        }
      }
      const headers = new Headers(result.headers)
      // Receipt uses the same canonical lineage selection as native ZIP export.
      // Control validates every included owner before publishing any bytes.
      headers.set('x-arx-export-sessions', JSON.stringify([...ids]))
      headers.set('x-arx-quiescent', ctx.agents.list().some(agent => agent.status !== 'idle') ? 'false' : 'true')
      return new Response(result.body, { status: result.status, headers })
    }
    const raw = await result.text()
    await flush(request.signal)
    let body = raw
    if (result.headers.get('content-type')?.startsWith('application/json') === true) {
      const parsed: unknown = JSON.parse(raw)
      const validated = path === '/api/respond' ? parsed : serverResponseSchema.parse(parsed)
      body = JSON.stringify(rewrite(validated))
    }
    const headers = new Headers(result.headers)
    const busy = ctx.agents.list().some(agent => agent.status !== 'idle')
    headers.set('x-arx-quiescent', busy ? 'false' : 'true')
    return new Response(body, { status: result.status, headers })
  }
  return {
    async fetch(request) {
      // A request whose operation was already cancelled starts no worker work.
      if (request.signal.aborted) return new Response('Worker request aborted', { status: 409 })
      if (request.headers.get('x-arx-user-id') !== config.userId) return new Response('Worker owner refused', { status: 403 })
      const projectId = request.headers.get('x-arx-project-id'), workspaceId = request.headers.get('x-arx-workspace-id')
      if ((projectId !== null && projectId !== config.projectId) || (workspaceId !== null && workspaceId !== config.workspaceId)) {
        return new Response('Worker scope refused', { status: 403 })
      }
      // Only a workspace-scoped lease may back worker history, and its history calls carry that lease's capability;
      // an unscoped request keeps the latest bound capability.
      if (workspaceId === null) return handle(request)
      return history.runBound(request.headers.get(WORKER_CAPABILITY_HEADER) ?? '', scope, () => handle(request))
    },
  }
}
