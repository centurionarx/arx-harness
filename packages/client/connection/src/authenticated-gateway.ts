/** Authenticated control transport. It never falls through to the operator host. */
import type { Context } from '@arx-ai/cordis'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { allowsProjectAccess, WebIdentityError } from '@arx-ai/arx-web-identity'
import type { RequestAuthority } from '@arx-ai/arx-web-identity'
import type {} from '@arx-ai/arx-isolated-project-runtime'
import { HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'
import { WebSocketDownlinks, rejectWebSocketUpgrade } from './websocket-downlink.ts'

/** A native-auth carrier binds a sealed principal to each operation and stream. */
export class AuthenticatedGateway {
  private readonly downlinks = new Set<WebSocketDownlinks>()
  private readonly closedDownlinks = new WeakMap<WebSocketDownlinks, Promise<void>>()
  private disposalFailed = false
  private closing = false

  /** @param ctx - The control composition, with real identity and isolated runtime providers. */
  constructor(private readonly ctx: Context) {}

  private assertOpen(): void {
    if (this.closing) throw new WebIdentityError('AUTH_UNAVAILABLE', 503, 'Service unavailable')
  }

  private async authority(request: Request | IncomingMessage, mutating: boolean): Promise<RequestAuthority> {
    this.assertOpen()
    const identity = this.ctx.get('webIdentity')
    const authenticator = this.ctx.get('webIdentityApi')
    if (identity === undefined || authenticator === undefined) {
      throw new WebIdentityError('AUTH_UNAVAILABLE', 503, 'Service unavailable')
    }
    const authority = await authenticator.authenticateRequest(request, { mutating })
    await identity.revalidate(authority)
    this.assertOpen()
    if (!allowsProjectAccess(authority.principal, authority.audience)) {
      throw new WebIdentityError('AUTH_FORBIDDEN', 403, 'Project access forbidden')
    }
    return authority
  }

  /**
   * Verify original headers before the bridge buffers any unauthenticated body.
   * @param request - Original Node request, before conversion to Fetch.
   * @returns Safe refusal, or undefined when the request may enter the bounded bridge.
   */
  async acceptRequest(request: IncomingMessage): Promise<Response | undefined> {
    try {
      await this.authority(request, request.method !== 'GET' && request.method !== 'HEAD')
      return undefined
    } catch (error) { return authenticationProblem(error) }
  }

  /**
   * Dispatch to an owner worker after authentication, never a shared-host interceptor.
   * @param request - Browser request, still carrying its original cookie and origin.
   * @returns A bounded isolated-runtime response or a safe authentication problem.
   */
  async fetch(request: Request): Promise<Response> {
    try {
      const authority = await this.authority(request, request.method !== 'GET' && request.method !== 'HEAD')
      const path = new URL(request.url).pathname
      if (!path.startsWith('/api/')) {
        throw new WebIdentityError('AUTH_FORBIDDEN', 403, 'Control channel forbidden')
      }
      if (request.method === 'GET' && (path === MUX_EVENTS_PATH || path === HOST_EVENTS_PATH)) {
        return new Response('upgrade required', { status: 426, headers: { connection: 'Upgrade', upgrade: 'websocket' } })
      }
      const runtime = this.ctx.get('isolatedProjectRuntime')
      if (runtime === undefined) throw new WebIdentityError('AUTH_UNAVAILABLE', 503, 'Service unavailable')
      return await runtime.fetch(authority, request)
    } catch (error) {
      return authenticationProblem(error)
    }
  }

  /**
   * Bind one downlink to one principal; the runtime filters and revalidates each frame.
   * @param kind - Existing API stream, not an arbitrary supervisor route.
   * @param request - Original WebSocket handshake.
   * @param socket - Socket owned by the webserver until accepted or refused.
   * @param head - Already received upgrade bytes.
   */
  async upgrade(kind: 'mux' | 'host', request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    try {
      const authority = await this.authority(request, false)
      this.assertOpen()
      const runtime = this.ctx.get('isolatedProjectRuntime')
      if (runtime === undefined) throw new WebIdentityError('AUTH_UNAVAILABLE', 503, 'Service unavailable')
      const downlinks = new WebSocketDownlinks({ events: {
        mux: (_request, signal) => runtime.streamMux(authority, signal),
        host: (_request, signal) => runtime.streamHost(authority, signal),
      } })
      this.downlinks.add(downlinks)
      socket.once('close', () => {
        void this.closeDownlink(downlinks).finally(() => { this.downlinks.delete(downlinks) }).catch(() => { this.disposalFailed = true })
      })
      if (kind === 'mux') downlinks.handleMux(request, socket, head)
      else downlinks.handleHost(request, socket, head)
    } catch (error) {
      rejectWebSocketUpgrade(socket, error instanceof WebIdentityError ? error.status : 503)
    }
  }

  private closeDownlink(downlinks: WebSocketDownlinks): Promise<void> {
    const previous = this.closedDownlinks.get(downlinks)
    if (previous !== undefined) return previous
    const closing = downlinks.close()
    this.closedDownlinks.set(downlinks, closing)
    return closing
  }

  /** Close every authenticated carrier and await its frame pumps before disposal. */
  async close(): Promise<void> {
    this.closing = true
    const results = await Promise.allSettled([...this.downlinks].map(downlinks => this.closeDownlink(downlinks)))
    this.downlinks.clear()
    if (this.disposalFailed || results.some(result => result.status === 'rejected')) throw new Error('Authenticated downlink disposal failed')
  }
}

/**
 * Never reflect submitted credentials, identifiers or arbitrary exception text.
 * @param error - A provider failure at the authenticated boundary.
 * @returns A no-store problem with a stable status and fixed message.
 */
export function authenticationProblem(error: unknown): Response {
  const status = error instanceof WebIdentityError && [400, 401, 403, 404, 409, 413, 415, 429, 502, 503, 504].includes(error.status)
    ? error.status : 503
  const code = error instanceof WebIdentityError ? error.code : 'AUTH_UNAVAILABLE'
  const message = status === 401 ? 'Authentication required' : status === 403 ? 'Access forbidden' : 'Request unavailable'
  return Response.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
}
