/**
 * Server side of the fetch carrier: maps an ApiProxy onto a pure
 * WHATWG Request->Response function. Two-level parse: full form (type/rpcId/method +
 * path==method) -> payload dispatched per method. HTTP status expresses only the carrier
 * (404 unknown path / 415 non-JSON media type / 400 non-JSON body / 500 handler crash);
 * business errors are always 200 + ServerResponse.
 */

import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import type { ApiProxy, MuxFrame, HostFrame } from '../api/index.ts'
import { sessionLogQuerySchema } from '../api/downloads.schema.ts'
import type { RequestPayload, ResponseValue, RpcMethodMap } from '../api/rpc-map.ts'
import type { ClientRequest, RpcError, RpcRequest, RpcResponse, ServerRequest, ServerResponse } from '../api/rpc.ts'
import { RpcId } from '../api/rpc.ts'
import type { Wire } from '../api/rpc.schema.ts'
import { clientRequestSchema, clientResponseSchema } from '../api/rpc.schema.ts'
import { API_METHOD_PAYLOAD_SCHEMAS } from '../api/method-payloads.ts'

/**
 * Unary dispatch table, keyed by (and compiler-locked to) RpcMethodMap: a map row without a
 * route row fails to compile, and each row's schema/invoke pair is checked against that row's
 * payload type — a schema pasted onto the wrong row is a type error, not a runtime surprise.
 * Schemas anchor to the Wire<> widening (the repo-wide exactOptionalPropertyTypes accommodation
 * documented on Wire); the dispatch point carries the one Wire→exact cast.
 * Every invoke receives the carrier Request's signal; routes whose contract
 * declares a signal parameter forward it, and the rest ignore it.
 */
type UnaryRoutes = {
  [K in keyof RpcMethodMap]: {
    schema: z.ZodType<Wire<RequestPayload<K>>>
    invoke(api: ApiProxy, request: RpcRequest<RequestPayload<K>>, signal: AbortSignal): Promise<RpcResponse<ResponseValue<K>>>
  }
}

const UNARY_ROUTES: UnaryRoutes = {
  'session.list': { schema: API_METHOD_PAYLOAD_SCHEMAS['session.list'], invoke: (api, r) => api.sessions.list(r) },
  'session.search': { schema: API_METHOD_PAYLOAD_SCHEMAS['session.search'], invoke: (api, r, signal) => api.sessions.search(r, signal) },
  'session.create': { schema: API_METHOD_PAYLOAD_SCHEMAS['session.create'], invoke: (api, r) => api.sessions.create(r) },
  'session.history': { schema: API_METHOD_PAYLOAD_SCHEMAS['session.history'], invoke: (api, r) => api.sessions.history(r) },
  'session.models': { schema: API_METHOD_PAYLOAD_SCHEMAS['session.models'], invoke: (api, r) => api.sessions.models(r) },
  'session.selectModel': { schema: API_METHOD_PAYLOAD_SCHEMAS['session.selectModel'], invoke: (api, r) => api.sessions.selectModel(r) },
  'session.rename': { schema: API_METHOD_PAYLOAD_SCHEMAS['session.rename'], invoke: (api, r) => api.sessions.rename(r) },
  'session.fork': { schema: API_METHOD_PAYLOAD_SCHEMAS['session.fork'], invoke: (api, r) => api.sessions.fork(r) },
  'session.prompt': { schema: API_METHOD_PAYLOAD_SCHEMAS['session.prompt'], invoke: (api, r) => api.sessions.prompt(r) },
  'session.attachment': { schema: API_METHOD_PAYLOAD_SCHEMAS['session.attachment'], invoke: (api, r) => api.sessions.attachment(r) },
  'session.updateQueue': { schema: API_METHOD_PAYLOAD_SCHEMAS['session.updateQueue'], invoke: (api, r) => api.sessions.updateQueue(r) },
  'session.cancel': { schema: API_METHOD_PAYLOAD_SCHEMAS['session.cancel'], invoke: (api, r) => api.sessions.cancel(r) },
  'subagent.list': { schema: API_METHOD_PAYLOAD_SCHEMAS['subagent.list'], invoke: (api, r, signal) => api.subagents.list(r, signal) },
  'subagent.history': { schema: API_METHOD_PAYLOAD_SCHEMAS['subagent.history'], invoke: (api, r, signal) => api.subagents.history(r, signal) },
  'subagent.prompt': { schema: API_METHOD_PAYLOAD_SCHEMAS['subagent.prompt'], invoke: (api, r, signal) => api.subagents.prompt(r, signal) },
  'subagent.interrupt': { schema: API_METHOD_PAYLOAD_SCHEMAS['subagent.interrupt'], invoke: (api, r) => api.subagents.interrupt(r) },
  'host.describe': { schema: API_METHOD_PAYLOAD_SCHEMAS['host.describe'], invoke: (api, r) => api.host.describe(r) },
  'host.pickDirectory': { schema: API_METHOD_PAYLOAD_SCHEMAS['host.pickDirectory'], invoke: (api, r, signal) => api.host.pickDirectory(r, signal) },
  'host.listDirectory': { schema: API_METHOD_PAYLOAD_SCHEMAS['host.listDirectory'], invoke: (api, r, signal) => api.host.listDirectory(r, signal) },
  'host.createDirectory': { schema: API_METHOD_PAYLOAD_SCHEMAS['host.createDirectory'], invoke: (api, r) => api.host.createDirectory(r) },
  'host.openPath': { schema: API_METHOD_PAYLOAD_SCHEMAS['host.openPath'], invoke: (api, r, signal) => api.host.openPath(r, signal) },
  'host.exit': { schema: API_METHOD_PAYLOAD_SCHEMAS['host.exit'], invoke: (api, r) => api.host.exit(r) },
  'workspace.list': { schema: API_METHOD_PAYLOAD_SCHEMAS['workspace.list'], invoke: (api, r) => api.workspace.list(r) },
  'workspace.create': { schema: API_METHOD_PAYLOAD_SCHEMAS['workspace.create'], invoke: (api, r) => api.workspace.create(r) },
  'workspace.rename': { schema: API_METHOD_PAYLOAD_SCHEMAS['workspace.rename'], invoke: (api, r) => api.workspace.rename(r) },
  'workspace.delete': { schema: API_METHOD_PAYLOAD_SCHEMAS['workspace.delete'], invoke: (api, r) => api.workspace.delete(r) },
  'workspace.insertBefore': { schema: API_METHOD_PAYLOAD_SCHEMAS['workspace.insertBefore'], invoke: (api, r) => api.workspace.insertBefore(r) },
  'workspace.insertSessionBefore': { schema: API_METHOD_PAYLOAD_SCHEMAS['workspace.insertSessionBefore'], invoke: (api, r) => api.workspace.insertSessionBefore(r) },
  'workspace.archiveSession': { schema: API_METHOD_PAYLOAD_SCHEMAS['workspace.archiveSession'], invoke: (api, r) => api.workspace.archiveSession(r) },
  'skill.list': { schema: API_METHOD_PAYLOAD_SCHEMAS['skill.list'], invoke: (api, r) => api.skills.list(r) },
  'agentPreset.list': { schema: API_METHOD_PAYLOAD_SCHEMAS['agentPreset.list'], invoke: (api, r) => api.agentPresets.list(r) },
  'agentPreset.select': { schema: API_METHOD_PAYLOAD_SCHEMAS['agentPreset.select'], invoke: (api, r) => api.agentPresets.select(r) },
  'agentPreset.read': { schema: API_METHOD_PAYLOAD_SCHEMAS['agentPreset.read'], invoke: (api, r) => api.agentPresets.read(r) },
  'agentPreset.copy': { schema: API_METHOD_PAYLOAD_SCHEMAS['agentPreset.copy'], invoke: (api, r) => api.agentPresets.copy(r) },
  'agentPreset.openDocument': { schema: API_METHOD_PAYLOAD_SCHEMAS['agentPreset.openDocument'], invoke: (api, r, signal) => api.agentPresets.openDocument(r, signal) },
  'agentPreset.remove': { schema: API_METHOD_PAYLOAD_SCHEMAS['agentPreset.remove'], invoke: (api, r) => api.agentPresets.remove(r) },
  'goal.create': { schema: API_METHOD_PAYLOAD_SCHEMAS['goal.create'], invoke: (api, r) => api.goals.create(r) },
  'goal.edit': { schema: API_METHOD_PAYLOAD_SCHEMAS['goal.edit'], invoke: (api, r) => api.goals.edit(r) },
  'goal.pause': { schema: API_METHOD_PAYLOAD_SCHEMAS['goal.pause'], invoke: (api, r) => api.goals.pause(r) },
  'goal.resume': { schema: API_METHOD_PAYLOAD_SCHEMAS['goal.resume'], invoke: (api, r) => api.goals.resume(r) },
  'goal.complete': { schema: API_METHOD_PAYLOAD_SCHEMAS['goal.complete'], invoke: (api, r) => api.goals.complete(r) },
  'goal.clear': { schema: API_METHOD_PAYLOAD_SCHEMAS['goal.clear'], invoke: (api, r) => api.goals.clear(r) },
  'settings.describe': { schema: API_METHOD_PAYLOAD_SCHEMAS['settings.describe'], invoke: (api, r) => api.settings.describe(r) },
  'settings.openDocument': { schema: API_METHOD_PAYLOAD_SCHEMAS['settings.openDocument'], invoke: (api, r, signal) => api.settings.openDocument(r, signal) },
  'settings.update': { schema: API_METHOD_PAYLOAD_SCHEMAS['settings.update'], invoke: (api, r) => api.settings.update(r) },
  'settings.replace': { schema: API_METHOD_PAYLOAD_SCHEMAS['settings.replace'], invoke: (api, r) => api.settings.replace(r) },
  'settings.mutate': { schema: API_METHOD_PAYLOAD_SCHEMAS['settings.mutate'], invoke: (api, r) => api.settings.mutate(r) },
  'authorization.describe': { schema: API_METHOD_PAYLOAD_SCHEMAS['authorization.describe'], invoke: (api, r) => api.authorization.describe(r) },
  'authorization.begin': { schema: API_METHOD_PAYLOAD_SCHEMAS['authorization.begin'], invoke: (api, r) => api.authorization.begin(r) },
  'authorization.poll': { schema: API_METHOD_PAYLOAD_SCHEMAS['authorization.poll'], invoke: (api, r) => api.authorization.poll(r) },
  'authorization.submit': { schema: API_METHOD_PAYLOAD_SCHEMAS['authorization.submit'], invoke: (api, r) => api.authorization.submit(r) },
  'authorization.cancel': { schema: API_METHOD_PAYLOAD_SCHEMAS['authorization.cancel'], invoke: (api, r) => api.authorization.cancel(r) },
  'nativeAccounts.describe': { schema: API_METHOD_PAYLOAD_SCHEMAS['nativeAccounts.describe'], invoke: (api, r) => api.nativeAccounts.describe(r) },
  'nativeAccounts.begin': { schema: API_METHOD_PAYLOAD_SCHEMAS['nativeAccounts.begin'], invoke: (api, r) => api.nativeAccounts.begin(r) },
  'nativeAccounts.poll': { schema: API_METHOD_PAYLOAD_SCHEMAS['nativeAccounts.poll'], invoke: (api, r) => api.nativeAccounts.poll(r) },
  'nativeAccounts.submit': { schema: API_METHOD_PAYLOAD_SCHEMAS['nativeAccounts.submit'], invoke: (api, r) => api.nativeAccounts.submit(r) },
  'nativeAccounts.cancel': { schema: API_METHOD_PAYLOAD_SCHEMAS['nativeAccounts.cancel'], invoke: (api, r) => api.nativeAccounts.cancel(r) },
  'credentials.describe': { schema: API_METHOD_PAYLOAD_SCHEMAS['credentials.describe'], invoke: (api, r) => api.credentials.describe(r) },
  'credentials.set': { schema: API_METHOD_PAYLOAD_SCHEMAS['credentials.set'], invoke: (api, r) => api.credentials.set(r) },
  'credentials.unset': { schema: API_METHOD_PAYLOAD_SCHEMAS['credentials.unset'], invoke: (api, r) => api.credentials.unset(r) },
  'llm.providers': { schema: API_METHOD_PAYLOAD_SCHEMAS['llm.providers'], invoke: (api, r) => api.llm.providers(r) },
  'llm.models': { schema: API_METHOD_PAYLOAD_SCHEMAS['llm.models'], invoke: (api, r) => api.llm.models(r) },
  'llm.discoverModels': { schema: API_METHOD_PAYLOAD_SCHEMAS['llm.discoverModels'], invoke: (api, r, signal) => api.llm.discoverModels(r, signal) },
  'web.providers': { schema: API_METHOD_PAYLOAD_SCHEMAS['web.providers'], invoke: (api, r) => api.web.providers(r) },
}

/** Route lookup that narrows an arbitrary path segment to a map key (single cast point for the string→key refinement). */
function methodFor(path: string): keyof RpcMethodMap | undefined {
  return Object.hasOwn(UNARY_ROUTES, path) ? path as keyof RpcMethodMap : undefined
}

/**
 * Sentinel rpcId for error responses to envelopes whose own rpcId is unreadable: the response
 * must still be a valid ServerResponse (a self-violating shape would turn the server's explicit
 * bad-request report into a client-side parse failure). Fixed value, documented here as wire contract.
 */
const INVALID_REQUEST_RPC_ID = RpcId('invalid-request')

/** Wrap a business error as a ServerResponse full form (rpcId backfilled; an unreadable rpcId uses the invalid-request sentinel). */
function errorResponse(rpcId: RpcId, error: RpcError): Response {
  const body: ServerResponse = { type: 'server-response', rpcId, result: { ok: false, error } }
  return Response.json(body)
}

/** Complete the impl's narrow form into a ServerResponse full form. */
function fullResponse(narrow: RpcResponse<unknown>): Response {
  const body: ServerResponse = { type: 'server-response', rpcId: narrow.rpcId, result: narrow.result }
  return Response.json(body)
}

/**
 * Parse the payload and invoke one unary route. Generic over the map key so
 * the row's schema/invoke pairing typechecks; the only cast collapses the
 * Wire<> widening back to the exact payload (undefined-valued properties and
 * absent ones are indistinguishable after JSON transport).
 */
// K appears once in the signature but ties the UNARY_ROUTES[K] row lookup to its own
// schema/invoke pairing; a union parameter degrades the row to an uninvokable intersection.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
async function handleUnary<K extends keyof RpcMethodMap>(
  api: ApiProxy, method: K, message: ClientRequest, signal: AbortSignal,
): Promise<Response> {
  const route = UNARY_ROUTES[method]
  const payload = route.schema.safeParse(message.payload)
  if (!payload.success) {
    return errorResponse(message.rpcId, { code: 'bad-request', message: `invalid payload for ${method}`, details: { issues: payload.error.issues } })
  }
  try {
    return fullResponse(await route.invoke(api, { rpcId: message.rpcId, payload: payload.data }, signal))
  } catch (error: unknown) {
    // The impl never throws business errors; reaching here means the implementation itself crashed — 500, carrier layer.
    return new Response(`handler failure: ${String(error)}`, { status: 500 })
  }
}

/** SSE frame: complete the narrow RpcRequest<frame> into a ServerRequest full form (method = frame type). */
function fullFrame(narrow: RpcRequest<MuxFrame | HostFrame>): ServerRequest {
  return { type: 'server-request', rpcId: narrow.rpcId, method: narrow.payload.type, payload: narrow.payload }
}

/**
 * Wrap a frame stream as an SSE Response; stops when req.signal aborts. An
 * impl throw mid-stream emits one stream/error frame and then closes.
 */
function sseResponse(frames: AsyncIterable<RpcRequest<MuxFrame | HostFrame>>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Send an SSE comment line on open so clients/proxies see a live channel (the host
        // stream has no baseline frames and would otherwise emit zero bytes while idle;
        // a comment line is not a frame, so client frame parsing skips it naturally).
        controller.enqueue(encoder.encode(': connected\n\n'))
        for await (const narrow of frames) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(fullFrame(narrow))}\n\n`))
        }
      } catch (error: unknown) {
        // Mid-stream impl failure → one stream/error frame, then close: the client must see
        // the failure instead of a silent end (which reads as a normal disconnect). A fresh
        // rpcId is minted — this is a server-initiated push like any other frame.
        const failure: MuxFrame | HostFrame = { type: 'stream/error', error: { code: 'internal', message: String(error), details: {} } }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(fullFrame({ rpcId: RpcId(randomUUID()), payload: failure }))}\n\n`))
        } catch {
          // Consumer already cancelled the stream: enqueue-after-cancel is the
          // only reachable error, and there is no one left to tell.
        }
      } finally {
        try {
          controller.close()
        } catch { /* already cancelled by the consumer: a double close is the only reachable error */ }
      }
    },
  })
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  })
}

/**
 * Wraps an ApiProxy into a pure fetch function (isomorphic point: feed the returned fetch straight to InProcessApiClient).
 * @param api - the host-side ApiProxy implementation.
 * @returns an object holding `fetch(Request)`; paths outside /api/ return 404.
 */
export function toFetchHandler(api: ApiProxy): { fetch: typeof fetch } {
  return {
    // Signature matches global fetch: the isomorphic point hands this function to InProcessApiClient as its transport aspect,
    // Clients call in (url, init) form — normalize to Request before handling.
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const req = input instanceof Request ? input : new Request(input, init)
      const url = new URL(req.url)
      const path = url.pathname

      // No-envelope read channels (SSE GET streams + host-only download):
      // physical routes that answer directly, without a wire envelope.
      if (path === '/api/events.mux' && req.method === 'GET') {
        return sseResponse(api.events.mux({ rpcId: RpcId(randomUUID()), payload: {} }, req.signal))
      }
      if (path === '/api/events.host' && req.method === 'GET') {
        return sseResponse(api.events.host({ rpcId: RpcId(randomUUID()), payload: {} }, req.signal))
      }
      if (path === '/api/session.export' && (req.method === 'GET' || req.method === 'HEAD')) {
        // Query params are a different boundary from the POST envelope, but
        // the request still casts its brands only through the domain schema.
        const parsed = sessionLogQuerySchema.safeParse(Object.fromEntries(url.searchParams))
        if (!parsed.success) {
          return new Response('missing or invalid sessionId query parameter', { status: 400 })
        }
        const response = await api.downloads.sessionLog(parsed.data, req.signal)
        if (req.method === 'GET') return response
        await response.body?.cancel()
        return new Response(null, { status: response.status, headers: response.headers })
      }

      if (req.method !== 'POST' || !path.startsWith('/api/')) {
        return new Response('not found', { status: 404 })
      }

      // Cross-site write fence: browsers send "simple" POSTs (text/plain,
      // form encodings) without a CORS preflight, so a malicious page could
      // otherwise execute side-effectful RPCs blind — the response stays
      // unreadable cross-origin, but session.prompt would still run. Only the
      // JSON media type is accepted; anything else is forced into a preflight
      // this server never answers. 415 = carrier layer, like the 400 below.
      const mediaType = req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }

      let body: unknown
      try {
        body = await req.json()
      } catch {
        // 400 = carrier layer (body is not even JSON); valid JSON with a bad shape goes 200 + bad-request.
        return new Response('body is not JSON', { status: 400 })
      }

      if (path === '/api/respond') {
        const parsed = clientResponseSchema.safeParse(body)
        if (!parsed.success) return Response.json({ accepted: false, reason: 'bad-response' })
        return Response.json(await api.respond(parsed.data))
      }

      const method = methodFor(path.slice('/api/'.length))
      if (method === undefined) return new Response('not found', { status: 404 })

      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success) {
        // Best effort at correlation: salvage a string rpcId from the raw body;
        // otherwise the fixed sentinel keeps the response a valid ServerResponse.
        const rawId = (body as { rpcId?: unknown } | null)?.rpcId
        const rpcId = typeof rawId === 'string' ? RpcId(rawId) : INVALID_REQUEST_RPC_ID
        return errorResponse(rpcId, { code: 'bad-request', message: 'invalid client-request message', details: { issues: envelope.error.issues } })
      }
      const message: ClientRequest = envelope.data
      if (message.method !== method) {
        return errorResponse(message.rpcId, { code: 'bad-request', message: `method "${message.method}" does not match path "${method}"`, details: { issues: [] } })
      }
      return handleUnary(api, method, message, req.signal)
    },
  }
}
