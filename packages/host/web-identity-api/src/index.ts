/**
 * Native identity HTTP consumer. It mounts auth/admin routes and denies the
 * USER namespace on administration deployments without mounting sessions,
 * project tools, generic RPC, WebSockets or host.describe.
 * @module @arx-ai/arx-host-web-identity-api
 */
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import { assertTrustedAuthority, isTrustedApiRequest } from '@arx-ai/arx-client-connection'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER, WebIdentityError, identityFailure } from '@arx-ai/arx-web-identity'
import type { AuthAudience, AuthInvalidation, AuthInvalidationReason, LoginResult, RequestAuthority, WebUserId } from '@arx-ai/arx-web-identity'
import type {} from '@arx-ai/arx-host-webserver'
/**
 * Fixed deployment audience/origin and bounded HTTP body, recovery, rate and invalidation policies.
 */
export interface Config {
  /**
   * Fixed deployment audience used for role admission and the separate USER or administration cookie.
   */
  audience: AuthAudience
  /**
   * Canonical deployment origin including scheme and authority; normal deployments require HTTPS and an exact Origin
   * match.
   */
  origin: string
  /**
   * Permit HTTP only for an explicit disposable loopback fixture; this does not enable a public deployment.
   */
  allowInsecureLoopbackFixture?: boolean
  /**
   * Accept explicitly configured non-browser Authorization bearer clients in addition to browser cookies.
   */
  allowBearer?: boolean
  /**
   * Maximum bytes consumed for one JSON auth/admin request before a typed capacity refusal.
   */
  maxBodyBytes?: number
  /**
   * Maximum duration of an auth-only long poll before current authority is checked and a bounded response is
   * returned.
   */
  invalidationTimeoutMs?: number
  /**
   * Maximum simultaneous auth-only long polls for one authentication session.
   */
  maxInvalidationRequestsPerSession?: number
  /**
   * Attempt allowance per socket-peer and normalized-identifier bucket during the configured public-request window.
   */
  publicRateLimitAttempts?: number
  /**
   * Lifetime of public auth attempt buckets; forwarded client address headers do not supply their identity.
   */
  publicRateLimitWindowMs?: number
  /**
   * Minimum elapsed time for a valid public recovery submission before its generic response, independent of account
   * lookup.
   */
  minimumRecoveryResponseMs?: number
}
/**
 * Map known identity failures to typed status and safe text, with a fixed fallback.
 * @param error - Caught native or unexpected failure.
 * @returns Status and safe identity problem body.
 */
export function identityProblem(error: unknown): {
  status: number
  body: {
    error: {
      code: string
      message: string
    }
  }
} {
  return error instanceof WebIdentityError
    ? { status: error.status, body: { error: { code: error.code, message: error.message } } }
    : { status: 500, body: { error: { code: 'AUTH_INTERNAL', message: 'Identity request unavailable' } } }
}
function header(request: Request | IncomingMessage, name: string): string | undefined {
  if (request instanceof Request)
    return request.headers.get(name) ?? undefined
  const value = request.headers[name.toLowerCase()]
  if (Array.isArray(value))
    identityFailure('AUTH_REQUEST', 400, 'Ambiguous request header')
  return value
}
function bodyString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string')
    identityFailure('AUTH_REQUEST', 400, 'Invalid identity request')
  return value
}
async function jsonBody(request: IncomingMessage, max: number): Promise<Record<string, unknown>> {
  if (header(request, 'content-type')?.split(';')[0]?.trim() !== 'application/json')
    identityFailure('AUTH_REQUEST', 415, 'JSON request required')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer | string>) {
    const bytes = Buffer.isBuffer(chunk) ? (chunk) : Buffer.from(chunk)
    size += bytes.length
    if (size > max)
      identityFailure('AUTH_BODY_LIMIT', 413, 'Identity request capacity exceeded')
    chunks.push(bytes)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new Error('invalid body')
    return value as Record<string, unknown>
  }
  catch {
    identityFailure('AUTH_REQUEST', 400, 'Invalid identity request')
  }
}
interface PendingInvalidation {
  userId: WebUserId
  revision: number
  resolve: (reason?: AuthInvalidationReason) => void
}
/**
 * Native auth/admin HTTP adapter and shared carrier admission with fixed audience, Host/Origin and CSRF fences.
 */
export class WebIdentityApi extends Service {
  static inject = ['webIdentity', 'webServer']
  static Config: z<Config> = z.object({
    audience: z.union(['user', 'admin'] as const).required(), origin: z.string().required(),
    allowInsecureLoopbackFixture: z.boolean().default(false), allowBearer: z.boolean().default(false),
    maxBodyBytes: z.natural().min(1024).max(65536).default(16384),
    invalidationTimeoutMs: z.natural().min(1).max(30000).default(25000),
    maxInvalidationRequestsPerSession: z.natural().min(1).max(4).default(2),
    publicRateLimitAttempts: z.natural().min(1).default(10), publicRateLimitWindowMs: z.natural().min(1000).default(60000),
    minimumRecoveryResponseMs: z.natural().min(0).max(1000).default(250),
  })
  /**
       * Fixed deployment audience used for cookie and role admission.
       */
  readonly audience: AuthAudience
  /**
       * Canonical deployment origin, including scheme, used by native request bridges.
       */
  readonly canonicalOrigin: string
  private readonly origin: URL
  private closing = false
  private readonly ownerCtx: Context
  private readonly pending = new Map<string, Set<PendingInvalidation>>()
  private readonly identifierRates = new Map<string, {
    count: number
    expiresAt: number
  }>()
  private readonly rates = new Map<string, {
    count: number
    expiresAt: number
  }>()
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'webIdentityApi')
    this.ownerCtx = ctx
    this.audience = config.audience
    this.origin = new URL(config.origin)
    this.canonicalOrigin = this.origin.origin
    const fixture = config.allowInsecureLoopbackFixture === true && this.origin.protocol === 'http:'
            && ['127.0.0.1', '[::1]', 'localhost'].includes(this.origin.hostname)
    if (this.origin.origin !== config.origin || (!fixture && this.origin.protocol !== 'https:'))
      identityFailure('AUTH_CONFIGURATION', 503, 'Canonical identity origin required')
    assertTrustedAuthority(this.origin.host)
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/auth', handler: (req, res) => this.handle(req, res) }), 'web-identity-api: auth routes')
    if (this.audience === 'admin') {
      ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/admin', handler: (req, res) => this.handle(req, res) }), 'web-identity-api: administration routes')
      ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/user', handler: (req, res) => this.handle(req, res, true) }), 'web-identity-api: deny owner resources on administration deployments')
    }
    ctx.on('web-identity/invalidated', (userId, reason) => {
      for (const entries of this.pending.values())
        for (const pending of entries)
          if (pending.userId === userId)
            pending.resolve(reason)
    })
    ctx.on('web-identity/session-expired', (_userId, authSessionId) => {
      for (const pending of this.pending.get(authSessionId) ?? [])
        pending.resolve('expired')
    })
    ctx.effect(() => () => { this.closing = true; for (const entries of this.pending.values())
      for (const pending of entries)
        pending.resolve('disposed'); this.pending.clear(); this.rates.clear(); this.identifierRates.clear() }, 'web-identity-api: bounded invalidation lifecycle')
  }
  private assertOpen(): void {
    if (this.closing) identityFailure('AUTH_UNAVAILABLE', 503, 'Identity request unavailable')
  }
  private async completedActivity(authority: RequestAuthority, signal: AbortSignal): Promise<void> {
    this.assertOpen()
    signal.throwIfAborted()
    await this.ownerCtx.webIdentity.revalidate(authority, { activity: true })
    this.assertOpen()
    signal.throwIfAborted()
    await this.ownerCtx.webIdentity.revalidate(authority)
    this.assertOpen()
    signal.throwIfAborted()
  }
  private check(request: Request | IncomingMessage, mutating: boolean, bearer = false): void {
    const authority = request instanceof Request ? new URL(request.url).host : header(request, 'host')
    const originalHost = header(request, 'host')
    let trustRequest: Request | IncomingMessage | {
      headers: Headers
    } = request
    if (request instanceof Request && originalHost === undefined) {
      const headers = new Headers(request.headers)
      headers.set('host', (authority as string))
      trustRequest = { headers }
    }
    if (authority !== this.origin.host || (originalHost !== undefined && originalHost !== this.origin.host)
      || !isTrustedApiRequest(trustRequest, [this.origin.host]))
      identityFailure('AUTH_ORIGIN', 403, 'Request origin denied')
    const origin = header(request, 'origin')
    if (origin !== undefined && origin !== this.origin.origin)
      identityFailure('AUTH_ORIGIN', 403, 'Request origin denied')
    if (mutating && ((!bearer && origin !== this.origin.origin) || header(request, AUTH_HEADER) !== '1'))
      identityFailure('AUTH_CSRF', 403, 'Request verification failed')
    if (header(request, 'upgrade')?.toLowerCase() === 'websocket' && !bearer && origin !== this.origin.origin)
      identityFailure('AUTH_ORIGIN', 403, 'Request origin denied')
  }
  private credential(request: Request | IncomingMessage): {
    token: string
    bearer: boolean
  } {
    const authorization = header(request, 'authorization')
    const name = AUTH_COOKIE_NAMES[this.audience]
    const cookies = (header(request, 'cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(name + '='))
    if (cookies.length > 1 || (cookies.length > 0 && authorization !== undefined))
      identityFailure('AUTH_REQUEST', 400, 'Ambiguous authentication')
    if (authorization !== undefined) {
      if (this.config.allowBearer !== true || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization))
        identityFailure('AUTH_INVALID', 401, 'Authentication required')
      return { token: authorization.slice(7), bearer: true }
    }
    if (cookies.length !== 1)
      identityFailure('AUTH_INVALID', 401, 'Authentication required')
    return { token: (cookies[0] as string).slice(name.length + 1), bearer: false }
  }
  /**
       * Authenticate a carrier through the shared cookie/bearer, Host/Origin and CSRF policy without renewing idle.
       * @param request - Web Request or original Node request headers.
       * @param options - Whether this carrier mutation additionally requires browser CSRF.
       * @returns Current provider-issued authority for the fixed deployment audience.
       */
  async authenticateRequest(request: Request | IncomingMessage, options: {
    mutating?: boolean
  } = {}): Promise<RequestAuthority> {
    this.assertOpen()
    const credential = this.credential(request)
    this.check(request, options.mutating === true, credential.bearer)
    const authority = await this.ownerCtx.webIdentity.authenticate(credential.token, this.audience)
    if (options.mutating === true && !credential.bearer)
      await this.ownerCtx.webIdentity.assertCsrf(authority, header(request, CSRF_HEADER) ?? '')
    this.assertOpen()
    return authority
  }
  private headers(response: ServerResponse): void {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
  }
  private answer(response: ServerResponse, status: number, value?: unknown): void {
    response.statusCode = status
    response.end(value === undefined ? undefined : JSON.stringify(value))
  }
  private cookie(response: ServerResponse, result?: LoginResult): void {
    response.setHeader('Set-Cookie', AUTH_COOKIE_NAMES[this.audience] + '=' + (result?.token ?? '')
            + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + (result === undefined ? '0' : String(Math.max(0, Math.floor((result.state.expiresAt - Date.now()) / 1000)))))
  }
  private rate(request: IncomingMessage, path: string): void {
    const key = (request.socket.remoteAddress ?? 'unknown') + ':' + path
    const now = Date.now()
    for (const [id, entry] of this.rates)
      if (entry.expiresAt <= now)
        this.rates.delete(id)
    const entry = this.rates.get(key) ?? { count: 0, expiresAt: now + (this.config.publicRateLimitWindowMs ?? 60000) }
    if (this.rates.size >= 1000 && !this.rates.has(key))
      identityFailure('AUTH_RATE_LIMITED', 429, 'Try again later')
    if (++entry.count > (this.config.publicRateLimitAttempts ?? 10))
      identityFailure('AUTH_RATE_LIMITED', 429, 'Try again later')
    this.rates.set(key, entry)
  }
  private rateIdentifier(identifier: string): void {
    const now = Date.now(), key = createHash('sha256').update(identifier.trim().toLowerCase()).digest('hex')
    for (const [id, entry] of this.identifierRates)
      if (entry.expiresAt <= now)
        this.identifierRates.delete(id)
    const entry = this.identifierRates.get(key) ?? { count: 0, expiresAt: now + (this.config.publicRateLimitWindowMs ?? 60000) }
    if ((this.identifierRates.size >= 1000 && !this.identifierRates.has(key))
      || ++entry.count > (this.config.publicRateLimitAttempts ?? 10))
      identityFailure('AUTH_RATE_LIMITED', 429, 'Try again later')
    this.identifierRates.set(key, entry)
  }
  private async invalidation(response: ServerResponse, authority: RequestAuthority, generation: number): Promise<AuthInvalidation> {
    if (generation !== authority.revision)
      return { invalidated: true, generation: authority.revision, reason: 'credentials-changed' }
    const id = authority.authSessionId
    const entries = this.pending.get(id) ?? new Set<PendingInvalidation>()
    if (entries.size >= (this.config.maxInvalidationRequestsPerSession ?? 2))
      identityFailure('AUTH_RATE_LIMITED', 429, 'Too many pending identity checks')
    return new Promise<AuthInvalidation>((resolve) => {
      let settled = false
      const finish = (reason?: AuthInvalidationReason) => {
        if (settled)
          return
        settled = true
        clearTimeout(timer)
        response.off('close', onClose)
        entries.delete(pending)
        if (entries.size === 0)
          this.pending.delete(id)
        resolve({ invalidated: reason !== undefined, generation: authority.revision, ...(reason === undefined ? {} : { reason }) })
      }
      const pending: PendingInvalidation = { userId: authority.principal.userId, revision: authority.revision, resolve: finish }
      const onClose = () => { finish('disposed') }
      const timer = setTimeout(() => { void this.ownerCtx.webIdentity.revalidate(authority).then(() => { finish() }, () => { finish('expired') }) }, this.config.invalidationTimeoutMs ?? 25000)
      entries.add(pending)
      this.pending.set(id, entries)
      response.on('close', onClose)
    })
  }
  private async handle(request: IncomingMessage, response: ServerResponse, denyOwnerResources = false): Promise<void> {
    this.headers(response)
    const abort = new AbortController()
    const onClose = () => { if (!response.writableEnded)
      abort.abort() }
    response.on('close', onClose)
    try {
      const url = new URL(request.url ?? '/', this.origin)
      const path = url.pathname, method = request.method ?? 'GET'
      this.check(request, false)
      if (method === 'GET' && path === '/auth/session') {
        try {
          this.answer(response, 200, await this.ownerCtx.webIdentity.state(await this.authenticateRequest(request)))
        }
        catch (error) {
          if (error instanceof WebIdentityError && error.status === 401)
            this.answer(response, 200, { authenticated: false, audience: this.audience })
          else
            throw error
        }
        return
      }
      if (method === 'GET' && path === '/auth/invalidation') {
        const authority = await this.authenticateRequest(request), generation = Number(url.searchParams.get('generation'))
        if (!url.searchParams.has('generation') || !Number.isSafeInteger(generation) || generation < 0)
          identityFailure('AUTH_REQUEST', 400, 'Invalid identity generation')
        this.answer(response, 200, await this.invalidation(response, authority, generation))
        return
      }
      const publicPaths = ['/auth/login', '/auth/password/forgot', '/auth/password/reset', '/auth/invitation/accept']
      if (method === 'POST' && publicPaths.includes(path)) {
        this.check(request, true)
        this.rate(request, path)
        const body = await jsonBody(request, this.config.maxBodyBytes ?? 16384)
        if (path === '/auth/login') {
          this.rateIdentifier(bodyString(body, 'identifier'))
          const result = await this.ownerCtx.webIdentity.login(bodyString(body, 'identifier'), bodyString(body, 'password'), this.audience, abort.signal)
          this.cookie(response, result)
          this.answer(response, 200, result.state)
          return
        }
        const start = Date.now()
        if (path === '/auth/password/forgot') {
          this.rateIdentifier(bodyString(body, 'identifier'))
          await this.ownerCtx.webIdentity.forgotPassword(bodyString(body, 'identifier'))
          const wait = (this.config.minimumRecoveryResponseMs ?? 250) - (Date.now() - start)
          if (wait > 0)
            await new Promise<void>(resolve => setTimeout(resolve, wait))
          this.answer(response, 202, { accepted: true })
          return
        }
        if (path === '/auth/password/reset')
          await this.ownerCtx.webIdentity.resetPassword(bodyString(body, 'token'), bodyString(body, 'newPassword'), abort.signal)
        else
          await this.ownerCtx.webIdentity.acceptInvitation(bodyString(body, 'token'), bodyString(body, 'newPassword'), abort.signal)
        this.answer(response, 200, { accepted: true })
        return
      }
      const authority = await this.authenticateRequest(request, { mutating: method !== 'GET' && method !== 'HEAD' })
      if (denyOwnerResources)
        identityFailure('PROJECT_ACCESS_DENIED', 403, 'Owner resources unavailable on administration origin')
      if (method === 'POST' && path === '/auth/logout') {
        await this.ownerCtx.webIdentity.logout(authority)
        this.cookie(response)
        this.answer(response, 204)
        return
      }
      if (method === 'POST' && path === '/auth/password/change') {
        const body = await jsonBody(request, this.config.maxBodyBytes ?? 16384)
        const result = await this.ownerCtx.webIdentity.changePassword(authority, bodyString(body, 'currentPassword'), bodyString(body, 'newPassword'), abort.signal)
        this.cookie(response, result)
        this.answer(response, 200, result.state)
        return
      }
      if (authority.principal.mustChangePassword)
        identityFailure('PASSWORD_CHANGE_REQUIRED', 403, 'Change password before continuing')
      if (this.audience !== 'admin' || authority.principal.role !== 'MASTER_ADMIN') {
        this.answer(response, 404)
        return
      }
      if (method === 'GET' && path === '/admin/modules') {
        this.answer(response, 200, await this.ownerCtx.webIdentity.moduleCatalog(authority))
        return
      }
      if (method === 'GET' && path === '/admin/users') {
        const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 50
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
          identityFailure('AUTH_REQUEST', 400, 'Invalid page size')
        this.answer(response, 200, await this.ownerCtx.webIdentity.listUsers(authority, { limit, ...(url.searchParams.has('cursor') ? { cursor: (url.searchParams.get('cursor') as string) } : {}) }))
        return
      }
      const body = await jsonBody(request, this.config.maxBodyBytes ?? 16384)
      if (method === 'POST' && path === '/admin/users') {
        const user = await this.ownerCtx.webIdentity.createUser(authority, { username: bodyString(body, 'username'), email: bodyString(body, 'email') })
        await this.completedActivity(authority, abort.signal)
        this.answer(response, 201, { user })
        return
      }
      const match = /^\/admin\/users\/([0-9a-f-]{36})\/(status|modules|invitation|invitation-email)$/.exec(path)
      if (match !== null) {
        const id = match[1] as WebUserId
        if (method === 'PATCH' && match[2] === 'status') {
          const status = bodyString(body, 'status')
          if (!['ACTIVE', 'BLOCKED', 'DELETED'].includes(status))
            identityFailure('INVALID_STATUS', 400, 'Invalid account status')
          const user = await this.ownerCtx.webIdentity.setStatus(authority, id, status as 'ACTIVE' | 'BLOCKED' | 'DELETED')
          await this.completedActivity(authority, abort.signal)
          this.answer(response, 200, { user })
          return
        }
        if (method === 'PUT' && match[2] === 'modules') {
          if (!Array.isArray(body.grants) || body.grants.some(id => typeof id !== 'string'))
            identityFailure('INVALID_MODULE', 400, 'Invalid module grant')
          const user = await this.ownerCtx.webIdentity.setModules(authority, id, body.grants as string[])
          await this.completedActivity(authority, abort.signal)
          this.answer(response, 200, { user })
          return
        }
        if (method === 'POST' && match[2] === 'invitation') {
          await this.ownerCtx.webIdentity.resendInvitation(authority, id)
          await this.completedActivity(authority, abort.signal)
          this.answer(response, 202, { accepted: true })
          return
        }
        if (method === 'PATCH' && match[2] === 'invitation-email') {
          const user = await this.ownerCtx.webIdentity.correctInvitationEmail(authority, id, bodyString(body, 'email'))
          await this.completedActivity(authority, abort.signal)
          this.answer(response, 200, { user })
          return
        }
      }
      this.answer(response, 404)
    }
    catch (error) {
      const problem = identityProblem(error)
      if (problem.status === 413) {
        response.setHeader('Connection', 'close')
        request.resume()
      }
      this.answer(response, problem.status, problem.body)
    }
    finally {
      response.off('close', onClose)
    }
  }
}
export default WebIdentityApi
