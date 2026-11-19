/**
 * Browser-only auth transport. Cookies stay HttpOnly; CSRF lives in this
 * object's memory. DTOs and parsers have one authority in web-identity/contract.
 */
import {
  AUTH_HEADER, CSRF_HEADER, parseAuthState, parseAuthProblem, parseAuthInvalidation, deriveAuthPresentation,
  parseAdminUserList, parseModuleCatalog,
  type AuthState, type AdminUserList, type ModuleCatalog,
  type ModuleId, type WebPrincipal, type WebUserId, type WebUserStatus,
} from '@arx-ai/arx-web-identity/contract'
import type { ClientComposition, HostObservable } from '@arx-ai/arx-client-ui-slots'

/**
 * Neutral reasons for retracting a client tree; no identity or content travels in the signal.
 */
export type AuthBoundary = 'transition' | 'logout' | 'logout-pending' | 'logout-blocked' | 'revoked' | 'pagehide' | 'restore' | 'unavailable'
/** The only auth snapshot handed to components: no CSRF, credentials, or reset tokens. */
export interface AuthView {
  readonly authenticated: boolean
  readonly principal?: WebPrincipal
  readonly phase: 'login' | 'change-password' | 'pending' | 'ready' | 'ended'
  /** Same-document form revision; it contains no recovery capability. */
  readonly recovery?: Readonly<{ revision: number; phase: 'checking' | 'ready'; route?: PublicAuthRoute }>
}
/** The public UI may use recovery links, but tokens never enter the URL query. */
export type PublicAuthRoute = 'login' | 'forgot' | 'reset' | 'invitation'

/** An auth failure remains distinguishable from a transport outage. */
export class AuthHttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code)
    this.name = 'AuthHttpError'
  }
}

/**
 * Select presentation from a validated server session and canonical recovery route.
 * @param state - Fresh parsed auth response from the deployment's own audience.
 * @param pathname - Canonical entry, reset, or invitation pathname.
 * @returns Readonly tree metadata, never server authority or ownership.
 */
export function authComposition(state: AuthState, pathname?: string): ClientComposition {
  const composition = deriveAuthPresentation(state, pathname)
  if (composition === undefined) throw new AuthHttpError(403, 'AUDIENCE_MISMATCH')
  return composition
}

/**
 * Fetch the real session before client factories and protected prefetch.
 * @param signal - Optional cancellation of this boot's HTTP request.
 * @returns The browser-safe session parsed by the shared identity contract.
 */
export async function readAuthSession(signal?: AbortSignal): Promise<AuthState> {
  const response = await fetch('/auth/session', {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { Accept: 'application/json' }, ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw await authError(response)
  return parseAuthState(await response.json())
}

async function authError(response: Response): Promise<AuthHttpError> {
  let code = 'HTTP_ERROR'
  try { code = parseAuthProblem(await response.json()).error.code } catch { /* Closed, sanitized fallback. */ }
  return new AuthHttpError(response.status, code)
}

function view(state: AuthState): AuthView {
  if (!state.authenticated) return Object.freeze({ authenticated: false, phase: 'login' })
  return Object.freeze({
    authenticated: true, principal: state.principal,
    phase: state.principal.mustChangePassword ? 'change-password'
      : state.principal.status !== 'ACTIVE' ? 'pending' : 'ready',
  })
}

/** Kernel transfer contains callbacks only; a recovery token is never a global value. */
interface RecoveryFragmentHandle { take(): string | undefined; clear(): void }
function recoveryHandle(): RecoveryFragmentHandle | undefined {
  const value: unknown = (globalThis as { __ARX_RECOVERY_FRAGMENT__?: unknown }).__ARX_RECOVERY_FRAGMENT__
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || typeof (value as RecoveryFragmentHandle).take !== 'function'
    || typeof (value as RecoveryFragmentHandle).clear !== 'function') throw new AuthHttpError(400, 'RECOVERY_TRANSFER_INVALID')
  return value as RecoveryFragmentHandle
}
function takeRecoveryFragment(handle: RecoveryFragmentHandle | undefined): string | undefined {
  if (handle === undefined) return undefined
  try {
    const value = handle.take()
    if (value !== undefined && typeof value !== 'string') throw new AuthHttpError(400, 'RECOVERY_TRANSFER_INVALID')
    return value
  } finally {
    const carrier = globalThis as { __ARX_RECOVERY_FRAGMENT__?: unknown }
    if (carrier.__ARX_RECOVERY_FRAGMENT__ === handle) delete carrier.__ARX_RECOVERY_FRAGMENT__
    handle.clear()
  }
}

/** A neutral logout completion transferred to the document kernel after private state is disposed. */
export interface AuthRevocationHandoff {
  /** The negative guard was durably recorded; this flag grants no authority. */
  readonly persistent: boolean
  /** True only after the matching logout acknowledgement; false when released first. */
  readonly confirmed: Promise<boolean>
  /** Release the channel and settle pending observers without authorizing navigation. */
  dispose(): void
}

type LogoutSignal = { readonly type: 'logout-begin' | 'logout-ack'; readonly operationId: string }
function logoutSignal(value: unknown): LogoutSignal | undefined {
  if (typeof value !== 'object' || value === null || !('type' in value)
    || (value.type !== 'logout-begin' && value.type !== 'logout-ack')
    || !('operationId' in value) || typeof value.operationId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.operationId)) return undefined
  return { type: value.type, operationId: value.operationId }
}

const LOGOUT_GUARD_KEY = 'arx.web.logout-denial'
const LOGOUT_PROBE_KEY = 'arx.web.logout-probe'
interface LogoutGuard {
  readonly origin: string
  readonly audience: AuthState['audience']
  readonly generation: number
  readonly operationId: string
}
function guardStorage(): Storage {
  if (typeof localStorage === 'undefined') throw new AuthHttpError(503, 'REVOCATION_STORAGE_UNAVAILABLE')
  return localStorage
}
function readLogoutGuard(): LogoutGuard | undefined {
  const raw = guardStorage().getItem(LOGOUT_GUARD_KEY)
  if (raw === null) return undefined
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null || !('origin' in value) || value.origin !== location.origin
    || !('audience' in value) || (value.audience !== 'user' && value.audience !== 'admin')
    || !('generation' in value) || typeof value.generation !== 'number' || !Number.isSafeInteger(value.generation)
    || value.generation < 0 || !('operationId' in value) || typeof value.operationId !== 'string'
    || logoutSignal({ type: 'logout-begin', operationId: value.operationId }) === undefined
    || Object.keys(value).sort().join(',') !== 'audience,generation,operationId,origin') {
    throw new AuthHttpError(503, 'REVOCATION_STORAGE_INVALID')
  }
  return { origin: value.origin, audience: value.audience, generation: value.generation, operationId: value.operationId }
}
function probeGuardStorage(): void {
  const storage = guardStorage()
  storage.setItem(LOGOUT_PROBE_KEY, 'closed')
  if (storage.getItem(LOGOUT_PROBE_KEY) !== 'closed') throw new AuthHttpError(503, 'REVOCATION_STORAGE_UNAVAILABLE')
  storage.removeItem(LOGOUT_PROBE_KEY)
}
function persistLogoutGuard(state: AuthState, operationId: string, initiator: boolean): boolean {
  if (!state.authenticated) return true
  try {
    const previous = readLogoutGuard()
    // A delayed peer begin cannot replace a later operation's negative guard.
    if (!initiator && previous !== undefined) return true
    const guard: LogoutGuard = { origin: location.origin, audience: state.audience, generation: state.generation, operationId }
    guardStorage().setItem(LOGOUT_GUARD_KEY, JSON.stringify(guard))
    return readLogoutGuard()?.operationId === operationId
  } catch { return false }
}
function acknowledgeLogoutGuard(operationId: string): boolean {
  try {
    const guard = readLogoutGuard()
    if (guard !== undefined && guard.operationId !== operationId) return false
    if (guard !== undefined) guardStorage().removeItem(LOGOUT_GUARD_KEY)
    return true
  } catch { return false }
}
function clearLoginGuard(operationId: string | undefined): void {
  const guard = readLogoutGuard()
  if (guard?.operationId !== operationId) throw new AuthHttpError(503, 'REVOCATION_GUARD_CHANGED')
  probeGuardStorage()
  if (guard !== undefined) guardStorage().removeItem(LOGOUT_GUARD_KEY)
}
class LogoutConfirmation implements AuthRevocationHandoff {
  readonly confirmed: Promise<boolean>
  private settle!: (confirmed: boolean) => void
  private closed = false
  constructor(private channel: BroadcastChannel | undefined, private readonly operationId: string, readonly persistent: boolean) {
    // Promise executors initialize the resolver synchronously before any channel callback can run.
    this.confirmed = new Promise((resolve) => { this.settle = resolve })
    if (channel !== undefined) channel.onmessage = (event: MessageEvent<unknown>) => {
      const signal = logoutSignal(event.data)
      if (signal?.type === 'logout-ack' && signal.operationId === this.operationId) {
        this.finish(this.persistent && acknowledgeLogoutGuard(this.operationId))
      }
    }
  }
  begin(): void { this.channel?.postMessage({ type: 'logout-begin', operationId: this.operationId }) }
  acknowledge(): boolean {
    if (this.closed) return false
    this.channel?.postMessage({ type: 'logout-ack', operationId: this.operationId })
    const confirmed = this.persistent && acknowledgeLogoutGuard(this.operationId)
    this.finish(confirmed)
    return confirmed
  }
  dispose(): void { this.finish(false) }
  private finish(confirmed: boolean): void {
    if (this.closed) return
    this.closed = true
    if (this.channel !== undefined) { this.channel.onmessage = null; this.channel.close(); this.channel = undefined }
    this.settle(confirmed)
  }
}

/**
 * One client instance belongs to one tree. Disposal aborts requests, invalidation
 * polling, event listeners, and stale callbacks before another principal mounts.
 */
export class BrowserAuthClient implements HostObservable<AuthView> {
  private state: AuthState
  private snapshot: AuthView
  private readonly listeners = new Set<() => void>()
  private readonly requests = new Set<AbortController>()
  private readonly bodies = new WeakMap<Response, AbortController>()
  private readonly cleanup: Array<() => void> = []
  private expiration: ReturnType<typeof setTimeout> | undefined
  private epoch = 0
  private disposed = false
  private channel: BroadcastChannel | undefined
  private resetToken: string | undefined
  private invitationToken: string | undefined
  private route: PublicAuthRoute = 'login'
  private started = false
  private pollEpoch: number | undefined
  private observedHandle: RecoveryFragmentHandle | undefined
  private recoveryAdmission: ((state: AuthState, pathname: string) => void) | undefined
  private pendingRecovery: { fragment: string; pathname: string; revision: number } | undefined
  /**
   * Expose the public form route while its capability stays in private memory.
   * @returns Login or recovery form route without a token.
   */
  get initialRoute(): PublicAuthRoute { return this.route }

  constructor(state: AuthState, private readonly boundary: (reason: AuthBoundary, confirmation?: AuthRevocationHandoff) => void,
    private readonly reload: () => void = () => { location.reload() }) {
    authComposition(state)
    this.state = state
    this.snapshot = view(state)
  }

  /**
   * Take the one-use recovery handle and read the real session before constructing a client.
   * @param boundary - Synchronous callback that retracts the old tree on a principal boundary.
   * @param signal - Optional cancellation before any protected factory is admitted.
   * @param reload - Optional navigation callback shared with the constructor; production reloads the document.
   * @returns Fresh parsed session and its memory-only auth transport.
   */
  static bootstrap(boundary: (reason: AuthBoundary, confirmation?: AuthRevocationHandoff) => void,
    signal?: AbortSignal, reload?: () => void):
  Promise<{ readonly state: AuthState; readonly auth: BrowserAuthClient }> {
    return new Promise((resolve, reject) => {
      let auth: BrowserAuthClient | undefined
      let reader: AbortController | undefined
      let handle: RecoveryFragmentHandle | undefined
      let revision = -1
      let bootCapture: { fragment: string | undefined } | undefined
      let ended = false
      const release = (): void => {
        window.removeEventListener('arx-recovery-required', changed)
        window.removeEventListener('pagehide', stop)
        signal?.removeEventListener('abort', stop)
      }
      const stop = (): void => {
        if (ended) return
        ended = true
        revision += 1
        reader?.abort()
        if (bootCapture !== undefined) bootCapture.fragment = undefined
        if (handle !== undefined) BrowserAuthClient.clearRecoveryTransfer(handle)
        release()
        if (auth !== undefined) auth.end('pagehide', false)
        else reject(new AuthHttpError(401, 'AUTH_BOOT_ENDED'))
      }
      const read = (fragment: string | undefined, currentHandle: RecoveryFragmentHandle | undefined): void => {
        const current = ++revision
        if (bootCapture !== undefined) bootCapture.fragment = undefined
        const owned = { fragment }
        bootCapture = owned
        reader?.abort()
        const controller = new AbortController()
        reader = controller
        void (async () => {
          try {
            const state = await readAuthSession(controller.signal)
            if (ended || current !== revision) return
            const client = new BrowserAuthClient(state, boundary, reload)
            client.epoch = current
            client.observedHandle = currentHandle
            client.route = client.captureRecoveryRoute(owned.fragment ?? '')
            if (owned.fragment !== undefined) client.snapshot = Object.freeze({ ...view(state),
              recovery: Object.freeze({ revision: current, phase: 'ready', route: client.route }) })
            auth = client
            client.cleanup.push(() => { ended = true; reader?.abort(); release() })
            resolve({ state, auth: client })
          } catch (error) {
            if (ended || current !== revision) return
            ended = true
            release()
            reject(error instanceof Error ? error : new AuthHttpError(503, 'AUTH_BOOT_UNAVAILABLE'))
          } finally {
            owned.fragment = undefined
            if (currentHandle !== undefined) BrowserAuthClient.clearRecoveryTransfer(currentHandle)
          }
        })()
      }
      const changed = (): void => {
        if (ended) return
        let fragment: string | undefined
        try {
          const current = recoveryHandle()
          if (current === undefined || current === handle) return
          handle = current
          fragment = takeRecoveryFragment(current)
        } catch (error) {
          if (auth !== undefined) auth.end('unavailable', false)
          else {
            ended = true
            reader?.abort()
            if (bootCapture !== undefined) bootCapture.fragment = undefined
            release()
            reject(error instanceof Error ? error : new AuthHttpError(503, 'AUTH_BOOT_UNAVAILABLE'))
          }
          return
        }
        if (fragment === undefined) return
        if (auth === undefined) read(fragment, handle)
        else auth.receiveRecovery(fragment, location.pathname, handle)
      }
      window.addEventListener('arx-recovery-required', changed)
      window.addEventListener('pagehide', stop, { once: true })
      signal?.addEventListener('abort', stop, { once: true })
      if (signal?.aborted) { stop(); return }
      try {
        handle = recoveryHandle()
        const fragment = takeRecoveryFragment(handle)
        read(fragment, handle)
      } catch (error) {
        ended = true
        release()
        reject(error instanceof Error ? error : new AuthHttpError(503, 'AUTH_BOOT_UNAVAILABLE'))
      }
    })
  }

  /**
   * Clear only the expected one-use transfer; an old owner cannot remove a newer capture.
   * @param expected - Captured handle identity, or the current handle for whole-document teardown.
   */
  static clearRecoveryTransfer(expected?: RecoveryFragmentHandle): void {
    const carrier = globalThis as { __ARX_RECOVERY_FRAGMENT__?: unknown }
    const value = carrier.__ARX_RECOVERY_FRAGMENT__
    if (expected !== undefined && value !== expected) return
    delete carrier.__ARX_RECOVERY_FRAGMENT__
    if (typeof value === 'object' && value !== null && typeof (value as { clear?: unknown }).clear === 'function') {
      try { (value as RecoveryFragmentHandle).clear() } catch { /* A malformed transfer cannot prevent teardown. */ }
    }
  }

  getSnapshot(): AuthView { return this.snapshot }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /**
   * Provide the ephemeral config consumed only by an admitted Connection tree.
   * @returns Authenticated carrier configuration; CSRF is never persisted or logged.
   */
  transportConfig(): { readonly accessMode: 'authenticated'; readonly csrfToken?: string } {
    return Object.freeze({
      accessMode: 'authenticated',
      ...(this.state.authenticated ? { csrfToken: this.state.csrfToken } : {}),
    })
  }

  /**
   * Apply only a negative logout guard after real session, marker, and manifest verification.
   * @param composition - Verified presentation metadata selected by the kernel.
   * @returns Admission to presentation, a matching denial, or unavailable durable storage; never server authority.
   */
  checkLogoutGuard(composition: ClientComposition): 'admitted' | 'blocked' | 'storage-unavailable' {
    try {
      const guard = readLogoutGuard()
      if (guard !== undefined) {
        if (guard.audience !== this.state.audience) throw new AuthHttpError(503, 'REVOCATION_STORAGE_INVALID')
        if (!this.state.authenticated || guard.generation !== this.state.generation) {
          guardStorage().removeItem(LOGOUT_GUARD_KEY)
        } else if (composition.kind !== 'public') return 'blocked'
      }
      if (composition.kind !== 'public') probeGuardStorage()
      return 'admitted'
    } catch {
      // Recovery/login stays public; an unavailable negative store cannot admit a private tree.
      return composition.kind === 'public' ? 'admitted' : 'storage-unavailable'
    }
  }

  /**
   * Start one auth-only channel and admit recovery only through the kernel's existing public document.
   * @param admitRecovery - Private validator for the sealed marker, manifest and canonical pathname.
   */
  start(admitRecovery?: (state: AuthState, pathname: string) => void): void {
    if (this.isDisposed()) throw new Error('auth client is disposed')
    if (this.started) return
    this.started = true
    this.recoveryAdmission = admitRecovery
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('arx.web.identity')
      this.channel.onmessage = (event: MessageEvent<unknown>) => {
        if (this.isDisposed()) return
        const signal = logoutSignal(event.data)
        if (signal?.type === 'logout-begin') {
          const persistent = persistLogoutGuard(this.state, signal.operationId, false)
          const confirmation = new LogoutConfirmation(this.channel, signal.operationId, persistent)
          this.channel = undefined
          this.end('logout-pending', false, confirmation)
        } else if (typeof event.data === 'object' && event.data !== null
          && (event.data as { type?: unknown }).type === 'invalidate') this.end('revoked', false)
      }
      this.cleanup.push(() => { this.channel?.close(); this.channel = undefined })
    }
    const listen = (name: 'pagehide' | 'pageshow', fn: (event: PageTransitionEvent) => void): void => {
      window.addEventListener(name, fn)
      this.cleanup.push(() => { window.removeEventListener(name, fn) })
    }
    listen('pagehide', () => { this.end('pagehide', false) })
    listen('pageshow', (event) => { if (event.persisted) this.end('restore', false) })
    const onAuthRequired = (): void => { this.end('revoked', false) }
    window.addEventListener('arx-auth-required', onAuthRequired)
    this.cleanup.push(() => { window.removeEventListener('arx-auth-required', onAuthRequired) })
    if (this.pendingRecovery !== undefined) void this.validateRecovery(this.pendingRecovery)
    else this.resumeValidation()
  }

  private receiveRecovery(fragment: string, pathname: string, handle: RecoveryFragmentHandle | undefined): void {
    if (this.isDisposed()) return
    const revision = ++this.epoch
    for (const request of this.requests) request.abort()
    this.requests.clear()
    if (this.expiration !== undefined) clearTimeout(this.expiration)
    this.resetToken = undefined
    this.invitationToken = undefined
    this.observedHandle = handle
    if (this.pendingRecovery !== undefined) this.pendingRecovery.fragment = ''
    const pending = { fragment, pathname, revision }
    this.pendingRecovery = pending
    this.snapshot = Object.freeze({ authenticated: false, phase: 'login',
      recovery: Object.freeze({ revision, phase: 'checking' }) })
    if (!this.notifyRecovery()) return
    if (this.started) void this.validateRecovery(pending)
  }

  private async validateRecovery(pending: { fragment: string; pathname: string; revision: number }): Promise<void> {
    const revision = pending.revision
    let next: AuthState
    try {
      if (this.recoveryAdmission === undefined) throw new AuthHttpError(403, 'RECOVERY_NOT_ADMITTED')
      this.recoveryAdmission(this.state, pending.pathname)
      next = parseAuthState(await this.request('GET', '/auth/session'))
      if (this.isDisposed() || revision !== this.epoch || this.pendingRecovery !== pending) return
      const previous = this.state
      if (next.authenticated !== previous.authenticated || next.audience !== previous.audience
        || (next.authenticated && previous.authenticated && (next.principal.userId !== previous.principal.userId
          || next.generation !== previous.generation || next.csrfToken !== previous.csrfToken))) {
        this.end('revoked')
        return
      }
      this.recoveryAdmission(next, pending.pathname)
    } catch (error) {
      if (this.isDisposed() || revision !== this.epoch || this.pendingRecovery !== pending) return
      this.end(error instanceof AuthHttpError && error.status === 401 ? 'revoked' : 'unavailable')
      return
    }
    if (this.isDisposed() || revision !== this.epoch || this.pendingRecovery !== pending) return
    this.pendingRecovery = undefined
    this.state = next
    this.route = this.captureRecoveryRoute(pending.fragment)
    pending.fragment = ''
    this.snapshot = Object.freeze({ ...view(next), recovery: Object.freeze({ revision, phase: 'ready', route: this.route }) })
    if (!this.notifyRecovery()) return
    this.resumeValidation()
  }

  /** A failed view consumer prevents further recovery admission until the tree closes. */
  private notifyRecovery(): boolean {
    let failed = false
    for (const listener of [...this.listeners]) {
      try { listener() } catch { failed = true }
    }
    if (failed) this.end('unavailable')
    return !failed && !this.isDisposed()
  }

  private resumeValidation(): void {
    if (!this.started || this.isDisposed() || !this.state.authenticated) return
    if (this.expiration !== undefined) clearTimeout(this.expiration)
    const epoch = this.epoch
    const delay = Math.max(0, Math.min(2_147_483_647, this.state.expiresAt - Date.now()))
    this.expiration = setTimeout(() => { if (!this.isDisposed() && epoch === this.epoch) this.end('revoked') }, delay)
    /* v8 ignore next -- each epoch resumes validation once: start() runs once, and a successful
       validateRecovery always follows an epoch increment. */
    if (this.pollEpoch === epoch) return
    this.pollEpoch = epoch
    void this.pollInvalidation(this.state.generation, epoch).finally(() => {
      if (this.pollEpoch === epoch) this.pollEpoch = undefined
    })
  }

  /** No token payload is ever sent to another tab. */
  private end(reason: AuthBoundary, broadcast = true, confirmation?: AuthRevocationHandoff): void {
    if (this.isDisposed()) return
    const listeners = [...this.listeners]
    try {
      if (broadcast) this.channel?.postMessage({ type: 'invalidate' })
      if (typeof localStorage !== 'undefined') {
        try {
          for (const key of Object.keys(localStorage)) {
            if (key.startsWith('arx.') && key !== LOGOUT_GUARD_KEY) localStorage.removeItem(key)
          }
          if (typeof sessionStorage !== 'undefined') for (const key of Object.keys(sessionStorage)) if (key.startsWith('arx.')) sessionStorage.removeItem(key)
        } catch { /* Private cache purge is best effort; the separate negative guard fails closed. */ }
      }
      if (typeof history !== 'undefined' && typeof location !== 'undefined') {
        history.replaceState(null, '', location.pathname)
      }
    } finally {
      try {
        // Remove bootstrap abort/recovery listeners before the kernel aborts its tree.
        this.dispose()
      } finally {
        for (const listener of listeners) {
          try { listener() } catch { /* A consumer cannot prevent another subscriber or the tree boundary. */ }
        }
        if (confirmation === undefined) this.boundary(reason)
        else this.boundary(reason, confirmation)
      }
    }
  }

  /**
   * Abort pending work and clear private auth state, listeners, and recovery capabilities.
   */
  dispose(): void {
    if (this.observedHandle !== undefined) BrowserAuthClient.clearRecoveryTransfer(this.observedHandle)
    if (this.isDisposed()) return
    this.disposed = true
    this.epoch += 1
    for (const request of this.requests) request.abort()
    this.requests.clear()
    if (this.expiration !== undefined) clearTimeout(this.expiration)
    try {
      for (const cleanup of this.cleanup.splice(0)) cleanup()
    } finally {
      this.resetToken = undefined
      this.invitationToken = undefined
      if (this.pendingRecovery !== undefined) this.pendingRecovery.fragment = ''
      this.pendingRecovery = undefined
      this.recoveryAdmission = undefined
      this.listeners.clear()
      // Replace the private CSRF/principal state as well as all public views.
      this.state = { authenticated: false, audience: this.state.audience }
      this.snapshot = Object.freeze({ authenticated: false, phase: 'ended' })
    }
  }

  /**
   * Exit recovery through a fresh boot on this audience's same-origin entry path.
   * @param revision - Optional form revision; a stale callback cannot navigate the document.
   */
  returnToEntry(revision?: number): void {
    if (this.isDisposed() || (revision !== undefined && revision !== this.epoch)) return
    this.resetToken = undefined
    this.invitationToken = undefined
    if (typeof history !== 'undefined') history.replaceState(null, '', '/')
    this.end('transition')
    this.reload()
  }

  /**
   * Authenticate by username or email and start a fresh canonical entry boot.
   * @param identifier - Username or email entered by the user.
   * @param password - Transient password sent only in the explicit POST body.
   * @param revision - Optional form revision; stale callbacks cannot issue a mutation.
   * @returns Completion after the server validates login and the old tree is retracted.
   */
  async login(identifier: string, password: string, revision?: number): Promise<void> {
    this.assertRevision(revision)
    const epoch = this.epoch
    const operationId = readLogoutGuard()?.operationId
    const next = parseAuthState(await this.request('POST', '/auth/login', { identifier, password }, false))
    this.assertRevision(epoch)
    if (next.audience !== this.state.audience || !next.authenticated) throw new AuthHttpError(403, 'AUDIENCE_MISMATCH')
    authComposition(next)
    clearLoginGuard(operationId)
    this.transition(next)
  }

  /**
   * Change a password and rotate the tree using the server's refreshed session.
   * @param currentPassword - Transient current password.
   * @param newPassword - Transient replacement password.
   * @param revision - Optional form revision; stale callbacks cannot issue a mutation.
   * @returns Completion after the server commits the change and the old tree is retracted.
   */
  async changePassword(currentPassword: string, newPassword: string, revision?: number): Promise<void> {
    this.assertRevision(revision)
    const epoch = this.epoch
    const next = parseAuthState(await this.request('POST', '/auth/password/change', { currentPassword, newPassword }))
    this.assertRevision(epoch)
    this.transition(next)
  }

  /**
   * Request recovery without exposing whether an identifier belongs to a user.
   * @param identifier - Username or email entered in the public recovery form.
   * @param revision - Optional form revision; stale callbacks cannot issue a mutation.
   * @returns Generic server acknowledgement; no recovery token is returned.
   */
  async forgotPassword(identifier: string, revision?: number): Promise<void> {
    this.assertRevision(revision)
    await this.accepted('/auth/password/forgot', { identifier }, false)
  }

  /**
   * Explicitly consume the private reset capability without automatically logging in.
   * @param newPassword - Transient replacement password entered in the recovery form.
   * @param revision - Optional form revision; stale callbacks cannot issue a mutation.
   * @returns Server acknowledgement; the next login starts a fresh tree.
   */
  async resetPassword(newPassword: string, revision?: number): Promise<void> {
    this.assertRevision(revision)
    const token = this.resetToken
    if (token === undefined) throw new AuthHttpError(400, 'RESET_TOKEN_INVALID')
    this.resetToken = undefined
    await this.accepted('/auth/password/reset', { token, newPassword }, false)
  }

  /**
   * Explicitly consume the private invitation capability and establish a password.
   * @param newPassword - Transient initial password entered in the invitation form.
   * @param revision - Optional form revision; stale callbacks cannot issue a mutation.
   * @returns Server acknowledgement without auto-login or changing administrative approval.
   */
  async acceptInvitation(newPassword: string, revision?: number): Promise<void> {
    this.assertRevision(revision)
    const token = this.invitationToken
    if (token === undefined) throw new AuthHttpError(400, 'INVITATION_INVALID')
    this.invitationToken = undefined
    await this.accepted('/auth/invitation/accept', { token, newPassword }, false)
  }

  /**
   * Hide/dispose the tree immediately; the logout request keeps its captured headers alive.
   * @param revision - Optional form revision; stale callbacks cannot begin logout.
   * @returns Completion after the matching server acknowledgement and neutral handoff.
   */
  async logout(revision?: number): Promise<void> {
    this.assertRevision(revision)
    const operationId = crypto.randomUUID()
    const persistent = persistLogoutGuard(this.state, operationId, true)
    const confirmation = new LogoutConfirmation(this.channel, operationId, persistent)
    this.channel = undefined
    confirmation.begin()
    const operation = this.request('POST', '/auth/logout', {}, true, false)
    try {
      this.end('logout', false, confirmation)
      await operation
      if (confirmation.acknowledge()) this.reload()
    } catch (cause) {
      confirmation.dispose()
      // A synchronous consumer failure can precede awaiting the noncancellable request.
      void operation.catch(() => {})
      throw cause
    }
  }

  /**
   * Read administrative identity metadata, excluding projects and content.
   * @param cursor - Optional server pagination cursor.
   * @returns Validated user metadata page from the shared contract.
   */
  async listUsers(cursor?: string): Promise<AdminUserList> {
    this.assertAdmin()
    return parseAdminUserList(await this.request('GET', '/admin/users'
      + (cursor === undefined ? '' : '?cursor=' + encodeURIComponent(cursor))))
  }
  /**
   * Read the deployment's administrative module catalog.
   * @returns Validated catalog containing module labels and operations.
   */
  async listModules(): Promise<ModuleCatalog> {
    this.assertAdmin()
    return parseModuleCatalog(await this.request('GET', '/admin/modules'))
  }
  /**
   * Create a pending USER through the administrative audience.
   * @param username - New user name.
   * @param email - Invitation and recovery recipient address.
   * @returns Completion after the pending identity is committed by the server.
   */
  async createUser(username: string, email: string): Promise<void> {
    this.assertAdmin()
    await this.request('POST', '/admin/users', { username, email })
  }
  /**
   * Commit an administrative access change through the real authority.
   * @param userId - Identity selected from the admin metadata list.
   * @param status - ACTIVE, BLOCKED, or DELETED status approved by the administrator.
   * @returns Completion after the server commits the access change.
   */
  async setUserStatus(userId: WebUserId, status: Exclude<WebUserStatus, 'PENDING'>): Promise<void> {
    this.assertAdmin()
    await this.request('PATCH', '/admin/users/' + encodeURIComponent(userId) + '/status', { status })
  }
  /**
   * Commit module grants drawn from the deployment catalog.
   * @param userId - Identity selected from the admin metadata list.
   * @param grants - Explicit catalog module ids approved by the administrator.
   * @returns Completion after the server commits the grants.
   */
  async setUserModules(userId: WebUserId, grants: readonly ModuleId[]): Promise<void> {
    this.assertAdmin()
    await this.request('PUT', '/admin/users/' + encodeURIComponent(userId) + '/modules', { grants })
  }
  /**
   * Queue an invitation for an administratively created identity.
   * @param userId - Pending user selected from the administrative list.
   * @returns Generic delivery acknowledgement without exposing a token.
   */
  async inviteUser(userId: WebUserId): Promise<void> {
    this.assertAdmin()
    await this.accepted('/admin/users/' + encodeURIComponent(userId) + '/invitation', {}, true)
  }
  /**
   * Change an eligible pending recipient while the server invalidates the previous invitation.
   * @param userId - Eligible pending identity selected by the administrator.
   * @param email - Replacement invitation recipient.
   * @returns Completion after the server commits the recipient change.
   */
  async changeInvitationEmail(userId: WebUserId, email: string): Promise<void> {
    this.assertAdmin()
    await this.request('PATCH', '/admin/users/' + encodeURIComponent(userId) + '/invitation-email', { email })
  }

  /**
   * Use the same cookie, CSRF, and stale-response policy for private owner HTTP routes.
   * @param method - Owner endpoint's supported HTTP operation.
   * @param path - Same-origin route within the /user/ namespace.
   * @param body - Optional detached request data validated by the server.
   * @returns Detached response data for the canonical storage parsers.
   */
  async userRequest(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    this.assertUser()
    if (!path.startsWith('/user/')) throw new Error('invalid user route')
    return this.request(method, path, body)
  }

  /**
   * Download unchanged own-history bytes, including technical SDK headers.
   * @param sessionId - Own session id selected from the private history index.
   * @returns Owner-authorized JSONL blob that is revoked from the UI on teardown.
   */
  async exportHistory(sessionId: string): Promise<Blob> {
    this.assertUser()
    const epoch = this.epoch
    const response = await this.response('GET', '/user/sessions/' + encodeURIComponent(sessionId) + '/export')
    if (!response.headers.get('Content-Type')?.startsWith('application/x-ndjson')) {
      this.releaseBody(response)
      throw new AuthHttpError(502, 'INVALID_RESPONSE')
    }
    try {
      const blob = await response.blob()
      if (this.isDisposed() || epoch !== this.epoch) throw new AuthHttpError(401, 'SESSION_ENDED')
      return blob
    } finally { this.releaseBody(response) }
  }

  /** Read mutable lifecycle state again after awaits; a former false value is not a guarantee. */
  private isDisposed(): boolean { return this.disposed }

  private assertRevision(revision: number | undefined): void {
    if (this.isDisposed() || (revision !== undefined && revision !== this.epoch)) throw new AuthHttpError(401, 'SESSION_ENDED')
  }

  private assertAdmin(): void {
    if (!this.state.authenticated || this.state.audience !== 'admin'
      || this.state.principal.role !== 'MASTER_ADMIN' || this.state.principal.status !== 'ACTIVE'
      || this.state.principal.mustChangePassword) throw new AuthHttpError(403, 'FORBIDDEN')
  }
  private assertUser(): void {
    if (!this.state.authenticated || this.state.audience !== 'user'
      || this.state.principal.role !== 'USER' || this.state.principal.status !== 'ACTIVE'
      || this.state.principal.mustChangePassword) throw new AuthHttpError(403, 'FORBIDDEN')
  }

  private transition(next: AuthState): void {
    if (next.audience !== this.state.audience || !next.authenticated) throw new AuthHttpError(403, 'AUDIENCE_MISMATCH')
    authComposition(next)
    this.state = next
    this.returnToEntry()
  }

  private async accepted(path: string, body: unknown, authenticated: boolean): Promise<void> {
    const epoch = this.epoch
    const result = await this.request('POST', path, body, authenticated)
    this.assertRevision(epoch)
    if (typeof result !== 'object' || result === null || (result as { accepted?: unknown }).accepted !== true) {
      throw new AuthHttpError(502, 'INVALID_RESPONSE')
    }
  }

  private async request(method: string, path: string, body?: unknown, authenticated = true,
    cancellable = true): Promise<unknown> {
    const epoch = this.epoch
    const response = await this.response(method, path, body, authenticated, cancellable)
    try {
      const result: unknown = response.status === 204 ? undefined : await response.json()
      if (cancellable && (this.isDisposed() || epoch !== this.epoch)) throw new AuthHttpError(401, 'SESSION_ENDED')
      return result
    } finally { this.releaseBody(response) }
  }

  private async response(method: string, path: string, body?: unknown, authenticated = true,
    cancellable = true): Promise<Response> {
    if (this.isDisposed()) throw new AuthHttpError(401, 'SESSION_ENDED')
    const epoch = this.epoch
    const controller = new AbortController()
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (method !== 'GET') {
      headers[AUTH_HEADER] = '1'
      headers['Content-Type'] = 'application/json'
      if (authenticated) {
        if (!this.state.authenticated) throw new AuthHttpError(401, 'AUTH_REQUIRED')
        headers[CSRF_HEADER] = this.state.csrfToken
      }
    }
    if (cancellable) this.requests.add(controller)
    let handedOff = false
    try {
      const response = await fetch(path, {
        method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers, signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (cancellable && (this.isDisposed() || epoch !== this.epoch)) throw new AuthHttpError(401, 'SESSION_ENDED')
      if (!response.ok) {
        const error = await authError(response)
        if (cancellable && (this.isDisposed() || epoch !== this.epoch)) throw new AuthHttpError(401, 'SESSION_ENDED')
        if (error.status === 401 && authenticated) this.end('revoked')
        if (error.status === 403 && error.code === 'PASSWORD_CHANGE_REQUIRED') this.end('revoked')
        throw error
      }
      if (cancellable) { this.bodies.set(response, controller); handedOff = true }
      return response
    } finally {
      if (!handedOff) this.requests.delete(controller)
    }
  }

  private releaseBody(response: Response): void {
    const controller = this.bodies.get(response)
    if (controller !== undefined) { this.requests.delete(controller); this.bodies.delete(response) }
  }

  private async pollInvalidation(generation: number, epoch: number): Promise<void> {
    while (!this.isDisposed() && epoch === this.epoch) {
      try {
        const result = parseAuthInvalidation(await this.request('GET', '/auth/invalidation?generation=' + String(generation)))
        if (this.isDisposed() || epoch !== this.epoch) return
        if (result.invalidated || result.generation !== generation) {
          this.end('revoked')
          return
        }
      } catch (error) {
        if (this.isDisposed() || epoch !== this.epoch) return
        // An auth-channel outage cannot leave protected content mounted.
        /* v8 ignore next -- the 'revoked' arm needs a live 401 AuthHttpError, but response() ends the
           session on a server 401 and SESSION_ENDED implies a changed epoch; both return above. */
        this.end(error instanceof AuthHttpError && error.status === 401 ? 'revoked' : 'unavailable')
      }
    }
  }

  private captureRecoveryRoute(fragment: string): PublicAuthRoute {
    if (typeof location === 'undefined') return 'login'
    let route: PublicAuthRoute = 'login'
    if (fragment.startsWith('#reset=')) {
      this.resetToken = fragment.slice('#reset='.length)
      route = 'reset'
    } else if (fragment.startsWith('#invite=')) {
      this.invitationToken = fragment.slice('#invite='.length)
      route = 'invitation'
    } else if (fragment === '#forgot') route = 'forgot'
    if (fragment !== '') history.replaceState(null, '', location.pathname)
    return route
  }
}
