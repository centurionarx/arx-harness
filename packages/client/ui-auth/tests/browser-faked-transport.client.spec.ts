// @vitest-environment jsdom
/** Browser auth transport behavior against an injected fetch, storage, channel and timer; no network. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_HEADER, CSRF_HEADER, parseAuthState } from '@arx-ai/arx-web-identity/contract'
import { AuthHttpError, BrowserAuthClient, authComposition, readAuthSession, type AuthBoundary, type AuthRevocationHandoff } from '../src/browser.ts'

const OP = '11111111-2222-3333-4444-555555555555'
const OP2 = '66666666-7777-8888-9999-aaaaaaaaaaaa'
const GUARD_KEY = 'arx.web.logout-denial'
const carrier = globalThis as { __ARX_RECOVERY_FRAGMENT__?: unknown }

const principal = (over: Record<string, unknown> = {}) => ({
  userId: 'u1', username: 'ann', email: 'ann@example.test', role: 'USER', status: 'ACTIVE',
  mustChangePassword: false, grants: [], ...over,
})
const wire = (over: Record<string, unknown> = {}) => ({
  audience: 'user', authenticated: true, principal: principal(), csrfToken: 'csrf-1',
  expiresAt: 4_000_000_000_000, generation: 1, ...over,
})
const adminWire = (over: Record<string, unknown> = {}) => wire({
  audience: 'admin', principal: principal({ role: 'MASTER_ADMIN', username: 'root' }), ...over,
})
const anonymous = { audience: 'user', authenticated: false }
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})
const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve() }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

type Handler = (init: RequestInit) => Response | Promise<Response> | Record<string, unknown>
const routes = new Map<string, Handler>()
const ignoreAbort = new Set<string>()
const calls: Array<{ key: string; init: RequestInit }> = []
const fetchFake = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  const path = (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).split('?')[0]!
  const key = `${init.method ?? 'GET'} ${path}`
  calls.push({ key, init })
  const signal = init.signal
  return new Promise<Response>((resolve, reject) => {
    const abort = (): void => { reject(new DOMException('aborted', 'AbortError')) }
    if (signal?.aborted) { abort(); return }
    if (!ignoreAbort.has(key)) signal?.addEventListener('abort', abort, { once: true })
    const handler = routes.get(key)
    if (handler === undefined) {
      if (path === '/auth/invalidation') return
      reject(new Error('unrouted ' + key)); return
    }
    Promise.resolve(handler(init)).then((out) => { resolve(out instanceof Response ? out : (out as unknown as Response)) }, reject)
  })
}
const route = (key: string, handler: Handler): void => { routes.set(key, handler) }

class FakeChannel {
  static all: FakeChannel[] = []
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  sent: unknown[] = []
  closed = false
  constructor(readonly name: string) { FakeChannel.all.push(this) }
  postMessage(message: unknown): void { this.sent.push(message) }
  close(): void { this.closed = true }
  deliver(data: unknown): void { this.onmessage?.({ data } as MessageEvent<unknown>) }
}

const cleanup: Array<() => void> = []
function make(over: Record<string, unknown> = {}, reload: () => void = vi.fn()) {
  const boundary = vi.fn<(reason: AuthBoundary, confirmation?: AuthRevocationHandoff) => void>()
  const auth = new BrowserAuthClient(parseAuthState(wire(over)), boundary, reload)
  cleanup.push(() => { auth.dispose() })
  return { auth, boundary, reload }
}
const bodyOf = (key: string): unknown => JSON.parse(calls.find(call => call.key === key)!.init.body as string)
const handleOf = (take: () => string | undefined, onClear: () => void = () => {}) => ({ take, clear: onClear })

async function booted(fragment?: string, signal?: AbortSignal, state: Record<string, unknown> = wire()) {
  route('GET /auth/session', () => json(state))
  carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => fragment)
  const boundary = vi.fn<(reason: AuthBoundary, confirmation?: AuthRevocationHandoff) => void>()
  const result = await BrowserAuthClient.bootstrap(boundary, signal)
  cleanup.push(() => { result.auth.dispose() })
  return { ...result, boundary }
}

beforeEach(() => {
  routes.clear(); ignoreAbort.clear(); calls.length = 0; FakeChannel.all.length = 0
  vi.stubGlobal('fetch', fetchFake)
  vi.stubGlobal('BroadcastChannel', FakeChannel)
})
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
  BrowserAuthClient.clearRecoveryTransfer()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
  localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/')
})

describe('presentation selection', () => {
  it('refuses an authenticated principal whose role does not match its audience', () => {
    const state = parseAuthState(wire({ principal: principal({ role: 'MASTER_ADMIN' }) }))
    expect(() => authComposition(state)).toThrow(expect.objectContaining({ status: 403, code: 'AUDIENCE_MISMATCH' }))
    expect(() => new BrowserAuthClient(state, () => {})).toThrow(AuthHttpError)
  })

  it('selects the form phase from the principal status and password requirement', () => {
    expect(make({ principal: principal({ mustChangePassword: true }) }).auth.getSnapshot().phase).toBe('change-password')
    expect(make({ principal: principal({ status: 'PENDING' }) }).auth.getSnapshot().phase).toBe('pending')
    expect(make().auth.getSnapshot().phase).toBe('ready')
    expect(make({ authenticated: false }).auth.getSnapshot()).toEqual({ authenticated: false, phase: 'login' })
  })

  it('maps an unreadable session failure body to a sanitized HTTP_ERROR', async () => {
    route('GET /auth/session', () => new Response('not json', { status: 500 }))
    await expect(readAuthSession(new AbortController().signal)).rejects.toMatchObject({ status: 500, code: 'HTTP_ERROR' })
  })
})

describe('transport configuration', () => {
  it('exposes the CSRF token only for an authenticated session', () => {
    expect(make().auth.transportConfig()).toEqual({ accessMode: 'authenticated', csrfToken: 'csrf-1' })
  })
})

describe('negative logout guard storage', () => {
  it('fails login closed when durable storage does not exist', async () => {
    const { auth } = make({ authenticated: false })
    vi.stubGlobal('localStorage', undefined)
    await expect(auth.login('ann', 'pw')).rejects.toMatchObject({ status: 503, code: 'REVOCATION_STORAGE_UNAVAILABLE' })
    expect(calls).toHaveLength(0)
  })

  it('fails login closed when storage does not persist the closed probe', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    route('POST /auth/login', () => json(wire()))
    const { auth, boundary } = make({ authenticated: false })
    await expect(auth.login('ann', 'pw')).rejects.toMatchObject({ code: 'REVOCATION_STORAGE_UNAVAILABLE' })
    expect(boundary).not.toHaveBeenCalled()
  })

  it('fails login when the guard changes while the request is in flight', async () => {
    localStorage.setItem(GUARD_KEY, JSON.stringify({ origin: location.origin, audience: 'user', generation: 1, operationId: OP }))
    route('POST /auth/login', () => { localStorage.removeItem(GUARD_KEY); return json(wire()) })
    const { auth, boundary } = make({ authenticated: false })
    await expect(auth.login('ann', 'pw')).rejects.toMatchObject({ code: 'REVOCATION_GUARD_CHANGED' })
    expect(boundary).not.toHaveBeenCalled()
  })

  it('removes the matching guard, rotates the tree and reloads on a successful login', async () => {
    localStorage.setItem(GUARD_KEY, JSON.stringify({ origin: location.origin, audience: 'user', generation: 1, operationId: OP }))
    route('POST /auth/login', () => json(wire()))
    const { auth, boundary, reload } = make({ authenticated: false })
    await auth.login('ann', 'pw')
    expect(bodyOf('POST /auth/login')).toEqual({ identifier: 'ann', password: 'pw' })
    expect(new Headers(calls[0]!.init.headers).get(CSRF_HEADER)).toBeNull()
    expect(localStorage.getItem(GUARD_KEY)).toBeNull()
    expect(boundary).toHaveBeenCalledWith('transition')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('rejects a login response that is anonymous or for another audience', async () => {
    route('POST /auth/login', () => json(anonymous))
    await expect(make({ authenticated: false }).auth.login('ann', 'pw')).rejects.toMatchObject({ code: 'AUDIENCE_MISMATCH' })
    route('POST /auth/login', () => json(adminWire()))
    await expect(make({ authenticated: false }).auth.login('ann', 'pw')).rejects.toMatchObject({ code: 'AUDIENCE_MISMATCH' })
  })

  it('reports guard admission for private compositions according to the stored guard', () => {
    const priv = authComposition(parseAuthState(wire()), '/')
    const pub = authComposition(parseAuthState(wire()), '/reset')
    const guard = (over: Record<string, unknown>) => { localStorage.setItem(GUARD_KEY, JSON.stringify({ origin: location.origin, audience: 'user', generation: 1, operationId: OP, ...over })) }
    const { auth } = make()
    expect(auth.checkLogoutGuard(priv)).toBe('admitted')
    guard({})
    expect(auth.checkLogoutGuard(priv)).toBe('blocked')
    expect(auth.checkLogoutGuard(pub)).toBe('admitted')
    guard({ generation: 7 })
    expect(auth.checkLogoutGuard(priv)).toBe('admitted')
    expect(localStorage.getItem(GUARD_KEY)).toBeNull()
    guard({ audience: 'admin' })
    expect(auth.checkLogoutGuard(priv)).toBe('storage-unavailable')
    expect(auth.checkLogoutGuard(pub)).toBe('admitted')
    guard({ extra: 1 })
    expect(auth.checkLogoutGuard(priv)).toBe('storage-unavailable')
    guard({ generation: 7 })
    expect(make({ authenticated: false }).auth.checkLogoutGuard(pub)).toBe('admitted')
    expect(localStorage.getItem(GUARD_KEY)).toBeNull()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    expect(auth.checkLogoutGuard(priv)).toBe('storage-unavailable')
  })
})

describe('document reload default and missing browser globals', () => {
  it('reloads the document by default when returning to entry', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { origin: 'http://localhost', pathname: '/', reload })
    const auth = new BrowserAuthClient(parseAuthState(wire()), () => {})
    auth.returnToEntry()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('ends and returns to entry without history, local or session storage', () => {
    const localStorageBefore = localStorage, historyBefore = history
    vi.stubGlobal('localStorage', undefined)
    vi.stubGlobal('history', undefined)
    const { auth, boundary, reload } = make()
    auth.returnToEntry()
    expect(boundary).toHaveBeenCalledWith('transition')
    expect(reload).toHaveBeenCalledTimes(1)
    vi.stubGlobal('localStorage', localStorageBefore); vi.stubGlobal('history', historyBefore)
    vi.stubGlobal('sessionStorage', undefined)
    const second = make()
    second.auth.returnToEntry()
    expect(second.boundary).toHaveBeenCalledWith('transition')
  })

  it('purges private arx.* browser state but keeps the negative guard and foreign keys', () => {
    localStorage.setItem('arx.cache', '1'); localStorage.setItem('other', '1'); localStorage.setItem(GUARD_KEY, 'x')
    sessionStorage.setItem('arx.tab', '1'); sessionStorage.setItem('keep', '1')
    make().auth.returnToEntry()
    expect(localStorage.getItem('arx.cache')).toBeNull()
    expect(localStorage.getItem('other')).toBe('1')
    expect(localStorage.getItem(GUARD_KEY)).toBe('x')
    expect(sessionStorage.getItem('arx.tab')).toBeNull()
    expect(sessionStorage.getItem('keep')).toBe('1')
  })

  it('resolves the login route when no document location exists', async () => {
    vi.stubGlobal('location', undefined)
    const { auth } = await booted()
    expect(auth.initialRoute).toBe('login')
  })
})

describe('bootstrap and recovery capture', () => {
  it('captures a reset capability privately and consumes it once', async () => {
    route('POST /auth/password/reset', () => json({ accepted: true }))
    const { auth } = await booted('#reset=tok-1', undefined, anonymous)
    expect(auth.initialRoute).toBe('reset')
    expect(auth.getSnapshot().recovery).toMatchObject({ phase: 'ready', route: 'reset' })
    expect(carrier.__ARX_RECOVERY_FRAGMENT__).toBeUndefined()
    await auth.resetPassword('new-pw')
    expect(bodyOf('POST /auth/password/reset')).toEqual({ token: 'tok-1', newPassword: 'new-pw' })
    expect(new Headers(calls.at(-1)!.init.headers as HeadersInit).get(AUTH_HEADER)).toBe('1')
    await expect(auth.resetPassword('again')).rejects.toMatchObject({ code: 'RESET_TOKEN_INVALID' })
  })

  it('captures an invitation capability and consumes it once', async () => {
    route('POST /auth/invitation/accept', () => json({ accepted: true }))
    const { auth } = await booted('#invite=inv-1', undefined, anonymous)
    expect(auth.initialRoute).toBe('invitation')
    await auth.acceptInvitation('first-pw')
    expect(bodyOf('POST /auth/invitation/accept')).toEqual({ token: 'inv-1', newPassword: 'first-pw' })
    await expect(auth.acceptInvitation('again')).rejects.toMatchObject({ code: 'INVITATION_INVALID' })
  })

  it('selects the forgot route and ignores unknown fragments', async () => {
    expect((await booted('#forgot', undefined, anonymous)).auth.initialRoute).toBe('forgot')
    expect((await booted('#unknown', undefined, anonymous)).auth.initialRoute).toBe('login')
  })

  it('rejects boot with an Error as is and wraps a non-Error failure', async () => {
    route('GET /auth/session', () => { throw new Error('offline') })
    await expect(BrowserAuthClient.bootstrap(() => {})).rejects.toThrow('offline')
    route('GET /auth/session', () => { throw 'plain-string' })
    await expect(BrowserAuthClient.bootstrap(() => {})).rejects.toMatchObject({ status: 503, code: 'AUTH_BOOT_UNAVAILABLE' })
  })

  it('wraps a non-Error thrown by the recovery handle while taking it', async () => {
    carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => { throw 'bad-take' })
    await expect(BrowserAuthClient.bootstrap(() => {})).rejects.toMatchObject({ status: 503, code: 'AUTH_BOOT_UNAVAILABLE' })
  })

  it('ends boot immediately when the signal is already aborted', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(BrowserAuthClient.bootstrap(() => {}, controller.signal)).rejects.toMatchObject({ code: 'AUTH_BOOT_ENDED' })
    expect(calls).toHaveLength(0)
  })

  it('ignores the late failure of a read ended by abort and re-entrant events during teardown', async () => {
    const session = deferred<Response>()
    route('GET /auth/session', () => session.promise)
    const controller = new AbortController()
    let armed = false
    const handle = handleOf(() => undefined, () => {
      if (armed) { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('arx-recovery-required')) }
    })
    carrier.__ARX_RECOVERY_FRAGMENT__ = handle
    const result = BrowserAuthClient.bootstrap(() => {}, controller.signal)
    const settled = result.then(() => 'resolved', (error: unknown) => (error as AuthHttpError).code)
    carrier.__ARX_RECOVERY_FRAGMENT__ = handle; armed = true
    controller.abort()
    expect(await settled).toBe('AUTH_BOOT_ENDED')
    await flush()
    expect(carrier.__ARX_RECOVERY_FRAGMENT__).toBeUndefined()
  })

  it('replaces an in-flight boot read when a newer recovery handle is published', async () => {
    const first = deferred<Response>(), second = deferred<Response>()
    const queue = [first, second]
    route('GET /auth/session', () => queue.shift()!.promise)
    carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => undefined)
    const boundary = vi.fn()
    const result = BrowserAuthClient.bootstrap(boundary)
    await flush()
    carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => '#reset=late')
    window.dispatchEvent(new Event('arx-recovery-required'))
    first.resolve(json(anonymous))
    second.resolve(json(anonymous))
    const { auth } = await result
    cleanup.push(() => { auth.dispose() })
    expect(auth.initialRoute).toBe('reset')
    expect(calls.filter(call => call.key === 'GET /auth/session')).toHaveLength(2)
  })

  it('drops the failure of a superseded boot read', async () => {
    const first = deferred<Response>(), second = deferred<Response>()
    const queue = [first, second]
    route('GET /auth/session', () => queue.shift()!.promise)
    carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => undefined)
    const result = BrowserAuthClient.bootstrap(() => {})
    await flush()
    carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => '#forgot')
    window.dispatchEvent(new Event('arx-recovery-required'))
    first.reject(new Error('stale-failure'))
    second.resolve(json(anonymous))
    const { auth } = await result
    cleanup.push(() => { auth.dispose() })
    expect(auth.initialRoute).toBe('forgot')
  })

  it('rejects boot when a read fails after the document ended it', async () => {
    const session = deferred<Response>()
    route('GET /auth/session', () => session.promise)
    carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => undefined)
    const result = BrowserAuthClient.bootstrap(() => {})
    const settled = result.then(() => 'resolved', (error: unknown) => (error as AuthHttpError).code)
    await flush()
    window.dispatchEvent(new Event('pagehide'))
    expect(await settled).toBe('AUTH_BOOT_ENDED')
    session.reject(new Error('after-end'))
    await flush()
  })

  it('does nothing for a recovery event without a new handle or fragment', async () => {
    const { auth } = await booted()
    const before = auth.getSnapshot()
    window.dispatchEvent(new Event('arx-recovery-required'))
    const empty = handleOf(() => undefined)
    carrier.__ARX_RECOVERY_FRAGMENT__ = empty
    window.dispatchEvent(new Event('arx-recovery-required'))
    carrier.__ARX_RECOVERY_FRAGMENT__ = empty
    window.dispatchEvent(new Event('arx-recovery-required'))
    expect(auth.getSnapshot().recovery).toBeUndefined()
    expect(auth.getSnapshot()).toBe(before)
  })

  it('fails boot closed when a malformed handle is published while the first read is pending', async () => {
    const session = deferred<Response>()
    route('GET /auth/session', () => session.promise)
    carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => undefined)
    const result = BrowserAuthClient.bootstrap(() => {})
    const settled = result.then(() => 'resolved', (error: unknown) => (error as AuthHttpError).code)
    await flush()
    carrier.__ARX_RECOVERY_FRAGMENT__ = { take: 1 }
    window.dispatchEvent(new Event('arx-recovery-required'))
    expect(await settled).toBe('RECOVERY_TRANSFER_INVALID')
  })

  it('fails boot closed with a wrapped error when a published handle throws a non-Error', async () => {
    const session = deferred<Response>()
    route('GET /auth/session', () => session.promise)
    carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => undefined)
    const result = BrowserAuthClient.bootstrap(() => {})
    const settled = result.then(() => 'resolved', (error: unknown) => (error as AuthHttpError).code)
    await flush()
    carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => { throw 'late-bad' })
    window.dispatchEvent(new Event('arx-recovery-required'))
    expect(await settled).toBe('AUTH_BOOT_UNAVAILABLE')
  })

  it('fails boot closed when a malformed handle is published during the first take', async () => {
    route('GET /auth/session', () => json(anonymous))
    carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => undefined, () => {
      carrier.__ARX_RECOVERY_FRAGMENT__ = { take: 1 }
      window.dispatchEvent(new Event('arx-recovery-required'))
    })
    await expect(BrowserAuthClient.bootstrap(() => {})).rejects.toMatchObject({ code: 'RECOVERY_TRANSFER_INVALID' })
  })

  it('wraps a non-Error handle failure published during the first take', async () => {
    route('GET /auth/session', () => json(anonymous))
    carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => undefined, () => {
      carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => { throw 'inner' })
      window.dispatchEvent(new Event('arx-recovery-required'))
    })
    await expect(BrowserAuthClient.bootstrap(() => {})).rejects.toMatchObject({ code: 'AUTH_BOOT_UNAVAILABLE' })
  })

  it('ends a booted tree as unavailable when a malformed handle is published later', async () => {
    const { auth, boundary } = await booted()
    carrier.__ARX_RECOVERY_FRAGMENT__ = { clear: 1 }
    window.dispatchEvent(new Event('arx-recovery-required'))
    expect(boundary).toHaveBeenCalledWith('unavailable')
    expect(auth.getSnapshot().phase).toBe('ended')
  })

  it('clears a current transfer handle and survives a throwing clear', () => {
    let cleared = 0
    carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => undefined, () => { cleared += 1 })
    BrowserAuthClient.clearRecoveryTransfer()
    expect(cleared).toBe(1)
    expect(carrier.__ARX_RECOVERY_FRAGMENT__).toBeUndefined()
    carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => undefined, () => { throw new Error('clear') })
    expect(() => { BrowserAuthClient.clearRecoveryTransfer() }).not.toThrow()
    carrier.__ARX_RECOVERY_FRAGMENT__ = 'not-a-handle'
    BrowserAuthClient.clearRecoveryTransfer()
    expect(carrier.__ARX_RECOVERY_FRAGMENT__).toBeUndefined()
  })
})

describe('recovery admission after boot', () => {
  const publish = (fragment: string): void => {
    carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => fragment)
    window.dispatchEvent(new Event('arx-recovery-required'))
  }

  it('holds a checking form until start, then admits and exposes the route', async () => {
    const { auth } = await booted()
    const admit = vi.fn()
    const views: string[] = []
    auth.subscribe(() => { views.push(auth.getSnapshot().recovery?.phase ?? 'none') })
    publish('#reset=first'); publish('#reset=second')
    expect(auth.getSnapshot()).toMatchObject({ authenticated: false, phase: 'login', recovery: { phase: 'checking' } })
    expect(calls.filter(call => call.key === 'GET /auth/session')).toHaveLength(1)
    route('GET /auth/session', () => json(wire()))
    auth.start(admit)
    await flush()
    expect(admit).toHaveBeenCalledTimes(2)
    expect(admit.mock.calls[0]![1]).toBe('/')
    expect(auth.getSnapshot().recovery).toMatchObject({ phase: 'ready', route: 'reset' })
    expect(views).toEqual(['checking', 'checking', 'ready'])
    route('POST /auth/password/reset', () => json({ accepted: true }))
    await auth.resetPassword('pw')
    expect(bodyOf('POST /auth/password/reset')).toMatchObject({ token: 'second' })
  })

  it('validates immediately when the client is already started', async () => {
    const { auth } = await booted()
    const admit = vi.fn()
    auth.start(admit)
    publish('#forgot')
    await flush()
    expect(admit).toHaveBeenCalledTimes(2)
    expect(auth.getSnapshot().recovery).toMatchObject({ phase: 'ready', route: 'forgot' })
    expect(auth.getSnapshot().authenticated).toBe(true)
  })

  it('treats a tree without an admission callback as unavailable', async () => {
    const { auth, boundary } = await booted()
    auth.start()
    publish('#reset=x')
    await flush()
    expect(boundary).toHaveBeenCalledWith('unavailable')
    expect(auth.getSnapshot().phase).toBe('ended')
  })

  it('ends as revoked when admission rejects with 401 and as unavailable for other failures', async () => {
    const first = await booted()
    first.auth.start(() => { throw new AuthHttpError(401, 'AUTH_REQUIRED') })
    publish('#reset=x'); await flush()
    expect(first.boundary).toHaveBeenCalledWith('revoked')
    const second = await booted()
    second.auth.start(() => { throw new Error('refused') })
    publish('#reset=y'); await flush()
    expect(second.boundary).toHaveBeenCalledWith('unavailable')
    const third = await booted()
    third.auth.start(() => { throw new AuthHttpError(500, 'X') })
    publish('#reset=z'); await flush()
    expect(third.boundary).toHaveBeenCalledWith('unavailable')
  })

  it.each([
    ['anonymous session', anonymous],
    ['other audience', adminWire()],
    ['other user', wire({ principal: principal({ userId: 'u2' }) })],
    ['other generation', wire({ generation: 2 })],
    ['other CSRF token', wire({ csrfToken: 'csrf-2' })],
  ])('revokes the tree when the recovery session is an %s', async (_name, next) => {
    const { auth, boundary } = await booted()
    auth.start(vi.fn())
    route('GET /auth/session', () => json(next))
    publish('#reset=x'); await flush()
    expect(boundary).toHaveBeenCalledWith('revoked')
  })

  it('abandons validation superseded by a newer recovery fragment', async () => {
    const { auth } = await booted()
    const admit = vi.fn()
    auth.start(admit)
    const session = deferred<Response>()
    route('GET /auth/session', () => session.promise)
    publish('#reset=old'); await flush()
    route('GET /auth/session', () => json(wire()))
    publish('#forgot')
    session.resolve(json(wire())); await flush()
    expect(auth.getSnapshot().recovery).toMatchObject({ phase: 'ready', route: 'forgot' })
  })

  it('stops after admission when the callback disposes the client', async () => {
    const { auth, boundary } = await booted()
    let count = 0
    auth.start(() => { count += 1; if (count === 2) auth.dispose() })
    publish('#reset=x'); await flush()
    expect(count).toBe(2)
    expect(auth.getSnapshot().phase).toBe('ended')
    expect(boundary).not.toHaveBeenCalled()
  })

  it('ends the tree when the admission callback disposes it before the session request', async () => {
    const { auth, boundary } = await booted()
    auth.start(() => { auth.dispose() })
    publish('#reset=x'); await flush()
    expect(auth.getSnapshot().phase).toBe('ended')
    expect(boundary).not.toHaveBeenCalled()
  })

  it('applies nothing when the handle disposes the client while its fragment is being taken', async () => {
    const { auth, boundary } = await booted()
    auth.start()
    const sessionReads = calls.filter(call => call.key === 'GET /auth/session').length
    carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => { auth.dispose(); return '#forgot' })
    window.dispatchEvent(new Event('arx-recovery-required'))
    await flush()
    expect(auth.getSnapshot()).toEqual({ authenticated: false, phase: 'ended' })
    expect(calls.filter(call => call.key === 'GET /auth/session')).toHaveLength(sessionReads)
    expect(boundary).not.toHaveBeenCalled()
  })

  it('concurrent teardown: drops a session validation result that lands after disposal', async () => {
    const { auth, boundary } = await booted()
    const admit = vi.fn()
    auth.start(admit)
    route('GET /auth/session', () => ({
      ok: true, status: 200,
      json: () => { queueMicrotask(() => { queueMicrotask(() => { auth.dispose() }) }); return wire() },
    }))
    publish('#reset=x')
    await flush()
    expect(admit).toHaveBeenCalledTimes(1)
    expect(auth.getSnapshot()).toEqual({ authenticated: false, phase: 'ended' })
    expect(boundary).not.toHaveBeenCalled()
  })

  it('ends as unavailable when a view subscriber fails while recovery is checking', async () => {
    const { auth, boundary } = await booted()
    auth.start(vi.fn())
    auth.subscribe(() => { throw new Error('view') })
    publish('#reset=x'); await flush()
    expect(boundary).toHaveBeenCalledWith('unavailable')
  })

  it('ends as unavailable when a view subscriber fails after recovery is ready', async () => {
    const { auth, boundary } = await booted()
    auth.start(vi.fn())
    let calls2 = 0
    auth.subscribe(() => { calls2 += 1; if (calls2 === 2) throw new Error('view') })
    publish('#reset=x'); await flush()
    expect(boundary).toHaveBeenCalledWith('unavailable')
  })

  it('aborts in-flight requests and the expiry timer when recovery arrives', async () => {
    const { auth } = await booted()
    auth.start(vi.fn())
    await flush()
    const poll = calls.filter(call => call.key === 'GET /auth/invalidation')
    expect(poll).toHaveLength(1)
    publish('#forgot'); await flush()
    expect(poll[0]!.init.signal!.aborted).toBe(true)
    expect(calls.filter(call => call.key === 'GET /auth/invalidation')).toHaveLength(2)
  })
})

describe('lifetime and channel events', () => {
  it('starts once and starts a channel unless BroadcastChannel is unavailable', () => {
    const { auth } = make()
    auth.start(); auth.start()
    expect(FakeChannel.all).toHaveLength(1)
    vi.stubGlobal('BroadcastChannel', undefined)
    const second = make()
    second.auth.start()
    expect(FakeChannel.all).toHaveLength(1)
  })

  it('revokes on an invalidate message and ignores other or late messages', () => {
    const { auth, boundary } = make()
    auth.start()
    const channel = FakeChannel.all[0]!
    const handler = channel.onmessage!
    channel.deliver(null); channel.deliver('x'); channel.deliver({ type: 'other' })
    expect(boundary).not.toHaveBeenCalled()
    channel.deliver({ type: 'invalidate' })
    expect(boundary).toHaveBeenCalledWith('revoked')
    expect(channel.closed).toBe(true)
    handler({ data: { type: 'invalidate' } } as MessageEvent<unknown>)
    expect(boundary).toHaveBeenCalledTimes(1)
  })

  it('retracts on pagehide, persisted pageshow and an auth-required event', () => {
    const a = make(); a.auth.start()
    window.dispatchEvent(new Event('pageshow'))
    expect(a.boundary).not.toHaveBeenCalled()
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    expect(a.boundary).toHaveBeenCalledWith('restore')
    const b = make(); b.auth.start()
    window.dispatchEvent(new Event('pagehide'))
    expect(b.boundary).toHaveBeenCalledWith('pagehide')
    const c = make(); c.auth.start()
    window.dispatchEvent(new Event('arx-auth-required'))
    expect(c.boundary).toHaveBeenCalledWith('revoked')
  })

  it('hands a peer logout to a confirmation that settles on the matching acknowledgement', async () => {
    const { auth, boundary } = make()
    auth.start()
    const channel = FakeChannel.all[0]!
    channel.deliver({ type: 'logout-begin', operationId: OP })
    expect(boundary).toHaveBeenCalledWith('logout-pending', expect.anything())
    const handoff = boundary.mock.calls[0]![1]!
    expect(handoff.persistent).toBe(true)
    expect(JSON.parse(localStorage.getItem(GUARD_KEY)!)).toMatchObject({ operationId: OP, generation: 1 })
    channel.deliver({ type: 'logout-ack', operationId: OP2 })
    channel.deliver({ type: 'logout-begin', operationId: OP })
    channel.deliver({ type: 'logout-ack', operationId: OP })
    expect(await handoff.confirmed).toBe(true)
    expect(localStorage.getItem(GUARD_KEY)).toBeNull()
    expect(channel.closed).toBe(true)
  })

  it('keeps a newer negative guard when a delayed peer begin arrives and ignores an anonymous peer', () => {
    localStorage.setItem(GUARD_KEY, JSON.stringify({ origin: location.origin, audience: 'user', generation: 1, operationId: OP2 }))
    const { auth, boundary } = make()
    auth.start()
    FakeChannel.all[0]!.deliver({ type: 'logout-begin', operationId: OP })
    expect((JSON.parse(localStorage.getItem(GUARD_KEY)!) as { operationId: string }).operationId).toBe(OP2)
    expect(boundary.mock.calls[0]![1]!.persistent).toBe(true)
    localStorage.clear()
    const anon = make({ authenticated: false })
    anon.auth.start()
    FakeChannel.all[1]!.deliver({ type: 'logout-begin', operationId: OP })
    expect(localStorage.getItem(GUARD_KEY)).toBeNull()
    expect(anon.boundary.mock.calls[0]![1]!.persistent).toBe(true)
  })

  it('does not persist a peer guard when storage is unavailable and settles false on dispose', async () => {
    vi.stubGlobal('localStorage', undefined)
    const { auth, boundary } = make()
    auth.start()
    FakeChannel.all[0]!.deliver({ type: 'logout-begin', operationId: OP })
    const handoff = boundary.mock.calls[0]![1]!
    expect(handoff.persistent).toBe(false)
    FakeChannel.all[0]!.deliver({ type: 'logout-ack', operationId: OP })
    expect(await handoff.confirmed).toBe(false)
    handoff.dispose()
  })

  it('revokes once when the expiry timer fires', () => {
    vi.useFakeTimers()
    const { auth, boundary } = make({ expiresAt: Date.now() + 1_000 })
    auth.start()
    vi.advanceTimersByTime(999)
    expect(boundary).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(boundary).toHaveBeenCalledWith('revoked')
    expect(auth.getSnapshot().phase).toBe('ended')
  })

  it('does not act on an expiry callback that runs after disposal or a recovery replacement', async () => {
    const callbacks: Array<() => void> = []
    const real = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: unknown, delay?: number) => {
      callbacks.push(fn as () => void); return real(() => {}, delay)
    })
    const a = make({ expiresAt: 0 }); a.auth.start()
    a.auth.dispose()
    callbacks[0]!()
    expect(a.boundary).not.toHaveBeenCalled()
    const b = await booted(undefined, undefined, wire({ expiresAt: 0 }))
    b.auth.start(vi.fn())
    const stale = callbacks.at(-1)!
    route('GET /auth/session', () => new Promise<Response>(() => {}))
    carrier.__ARX_RECOVERY_FRAGMENT__ = handleOf(() => '#forgot')
    window.dispatchEvent(new Event('arx-recovery-required'))
    stale()
    expect(b.boundary).not.toHaveBeenCalled()
  })

  it('ignores an auth-required event delivered to a listener captured before disposal', () => {
    const listeners: Array<() => void> = []
    const real = window.addEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation(((name: string, fn: EventListener, options?: unknown) => {
      if (name === 'arx-auth-required') listeners.push(() => { fn(new Event(name)) })
      real(name, fn, options as AddEventListenerOptions)
    }) as typeof window.addEventListener)
    const { auth, boundary } = make()
    auth.start()
    auth.dispose()
    listeners[0]!()
    expect(boundary).not.toHaveBeenCalled()
  })

  it('revokes on invalidation polling by flag or generation change', async () => {
    const a = make(); route('GET /auth/invalidation', () => json({ invalidated: true, generation: 1 }))
    a.auth.start(); await flush()
    expect(a.boundary).toHaveBeenCalledWith('revoked')
    const b = make(); route('GET /auth/invalidation', () => json({ invalidated: false, generation: 2 }))
    b.auth.start(); await flush()
    expect(b.boundary).toHaveBeenCalledWith('revoked')
  })

  it('concurrent teardown: drops an invalidation result that lands after disposal', async () => {
    const { auth, boundary } = make()
    route('GET /auth/invalidation', () => ({
      ok: true, status: 200,
      json: () => { queueMicrotask(() => { queueMicrotask(() => { auth.dispose() }) }); return { invalidated: true, generation: 1 } },
    }))
    auth.start(); await flush()
    expect(boundary).not.toHaveBeenCalled()
  })

  it('ends as unavailable when polling fails and revoked when the server answers 401', async () => {
    const a = make(); route('GET /auth/invalidation', () => json({ error: { code: 'X', message: 'm' } }, 500))
    a.auth.start(); await flush()
    expect(a.boundary).toHaveBeenCalledWith('unavailable')
    const b = make(); route('GET /auth/invalidation', () => json({ error: { code: 'AUTH_REQUIRED', message: 'm' } }, 401))
    b.auth.start(); await flush()
    expect(b.boundary).toHaveBeenCalledWith('revoked')
    const c = make(); route('GET /auth/invalidation', () => json({ invalidated: 'x', generation: 'bad' }))
    c.auth.start(); await flush()
    expect(c.boundary).toHaveBeenCalledWith('unavailable')
  })

  it('broadcasts an invalidation to peers only for locally initiated revocation', async () => {
    const { auth } = make()
    auth.start()
    route('GET /user/x', () => json({ error: { code: 'AUTH_REQUIRED', message: 'm' } }, 401))
    await expect(auth.userRequest('GET', '/user/x')).rejects.toMatchObject({ status: 401 })
    expect(FakeChannel.all[0]!.sent).toEqual([{ type: 'invalidate' }])
  })
})

describe('HTTP request lifecycle', () => {
  it('maps 401 and password-change responses to revocation and keeps other failures local', async () => {
    const a = make()
    route('GET /user/a', () => json({ error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'm' } }, 403))
    await expect(a.auth.userRequest('GET', '/user/a')).rejects.toMatchObject({ status: 403, code: 'PASSWORD_CHANGE_REQUIRED' })
    expect(a.boundary).toHaveBeenCalledWith('revoked')
    const b = make()
    route('GET /user/b', () => json({ error: { code: 'OTHER', message: 'm' } }, 403))
    await expect(b.auth.userRequest('GET', '/user/b')).rejects.toMatchObject({ code: 'OTHER' })
    expect(b.boundary).not.toHaveBeenCalled()
    route('GET /user/c', () => json({ error: { code: 'NOPE', message: 'm' } }, 404))
    await expect(b.auth.userRequest('GET', '/user/c')).rejects.toMatchObject({ status: 404 })
    expect(b.boundary).not.toHaveBeenCalled()
  })

  it('sends CSRF and auth headers on authenticated mutations and rejects a non-user route', async () => {
    const { auth } = make()
    route('POST /user/projects', () => json({ ok: true }))
    expect(await auth.userRequest('POST', '/user/projects', { name: 'p' })).toEqual({ ok: true })
    const headers = new Headers(calls[0]!.init.headers)
    expect(headers.get(CSRF_HEADER)).toBe('csrf-1')
    expect(headers.get(AUTH_HEADER)).toBe('1')
    await expect(auth.userRequest('GET', '/admin/users')).rejects.toThrow('invalid user route')
  })

  it('returns undefined for a 204 response', async () => {
    route('DELETE /user/projects/1', () => new Response(null, { status: 204 }))
    expect(await make().auth.userRequest('DELETE', '/user/projects/1')).toBeUndefined()
  })

  it('rejects a response that arrives after disposal and a body that finishes after disposal', async () => {
    const { auth } = make()
    const pending = deferred<Response>()
    route('GET /user/slow', () => pending.promise); ignoreAbort.add('GET /user/slow')
    const slow = auth.userRequest('GET', '/user/slow')
    await flush(); auth.dispose(); pending.resolve(json({}))
    await expect(slow).rejects.toMatchObject({ code: 'SESSION_ENDED' })
    const second = make()
    const body = deferred<unknown>()
    route('GET /user/body', () => ({ ok: true, status: 200, json: () => body.promise }))
    const reading = second.auth.userRequest('GET', '/user/body')
    await flush(); second.auth.dispose(); body.resolve({})
    await expect(reading).rejects.toMatchObject({ code: 'SESSION_ENDED' })
  })

  it('rejects an error response whose body arrives after disposal without ending twice', async () => {
    const { auth, boundary } = make()
    const body = deferred<unknown>()
    route('GET /user/err', () => ({ ok: false, status: 401, json: () => body.promise }))
    const request = auth.userRequest('GET', '/user/err')
    await flush(); auth.dispose(); body.resolve({ error: { code: 'AUTH_REQUIRED', message: 'm' } })
    await expect(request).rejects.toMatchObject({ code: 'SESSION_ENDED' })
    expect(boundary).not.toHaveBeenCalled()
  })

  it('refuses stale revisions and unfinished sessions before any request', async () => {
    const { auth } = make({ authenticated: false })
    await expect(auth.login('a', 'b', 99)).rejects.toMatchObject({ code: 'SESSION_ENDED' })
    await expect(auth.forgotPassword('a', 99)).rejects.toMatchObject({ code: 'SESSION_ENDED' })
    expect(calls).toHaveLength(0)
  })

  it('rejects a login whose client is disposed during the request', async () => {
    const { auth } = make({ authenticated: false })
    const pending = deferred<Response>()
    route('POST /auth/login', () => pending.promise); ignoreAbort.add('POST /auth/login')
    const login = auth.login('a', 'b')
    await flush(); auth.dispose(); pending.resolve(json(wire()))
    await expect(login).rejects.toMatchObject({ code: 'SESSION_ENDED' })
  })
})

describe('credential and recovery mutations', () => {
  it('rotates the tree after a password change and rejects an anonymous or foreign response', async () => {
    const a = make()
    route('POST /auth/password/change', () => json(wire({ csrfToken: 'csrf-2' })))
    await a.auth.changePassword('old', 'new')
    expect(bodyOf('POST /auth/password/change')).toEqual({ currentPassword: 'old', newPassword: 'new' })
    expect(a.boundary).toHaveBeenCalledWith('transition')
    expect(a.reload).toHaveBeenCalledTimes(1)
    const b = make()
    route('POST /auth/password/change', () => json(anonymous))
    await expect(b.auth.changePassword('old', 'new')).rejects.toMatchObject({ code: 'AUDIENCE_MISMATCH' })
    const c = make()
    route('POST /auth/password/change', () => json(adminWire()))
    await expect(c.auth.changePassword('old', 'new')).rejects.toMatchObject({ code: 'AUDIENCE_MISMATCH' })
    const d = make()
    route('POST /auth/password/change', () => json(wire({ principal: principal({ role: 'MASTER_ADMIN' }) })))
    await expect(d.auth.changePassword('old', 'new')).rejects.toMatchObject({ code: 'AUDIENCE_MISMATCH' })
  })

  it('accepts a generic forgot acknowledgement and rejects other responses', async () => {
    const { auth } = make({ authenticated: false })
    route('POST /auth/password/forgot', () => json({ accepted: true }))
    await auth.forgotPassword('ann')
    expect(bodyOf('POST /auth/password/forgot')).toEqual({ identifier: 'ann' })
    for (const body of [{ accepted: false }, null, 'ok', {}]) {
      route('POST /auth/password/forgot', () => json(body))
      await expect(auth.forgotPassword('ann')).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' })
    }
  })
})

describe('logout', () => {
  it('begins on the channel, acknowledges after the server and reloads when confirmed', async () => {
    const { auth, boundary, reload } = make()
    auth.start()
    route('POST /auth/logout', () => json({}))
    await auth.logout()
    const channel = FakeChannel.all[0]!
    expect(channel.sent).toMatchObject([{ type: 'logout-begin' }, { type: 'logout-ack' }])
    expect(boundary).toHaveBeenCalledWith('logout', expect.anything())
    expect(await boundary.mock.calls[0]![1]!.confirmed).toBe(true)
    expect(localStorage.getItem(GUARD_KEY)).toBeNull()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('logs out without a channel and without durable storage and does not reload', async () => {
    vi.stubGlobal('localStorage', undefined)
    const { auth, boundary, reload } = make()
    route('POST /auth/logout', () => json({}))
    await auth.logout()
    expect(boundary.mock.calls[0]![1]!.persistent).toBe(false)
    expect(await boundary.mock.calls[0]![1]!.confirmed).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('settles on a matching channel acknowledgement before the server answers', async () => {
    const { auth, boundary, reload } = make()
    auth.start()
    const answer = deferred<Response>()
    route('POST /auth/logout', () => answer.promise)
    const logout = auth.logout()
    const channel = FakeChannel.all[0]!
    const operationId = (channel.sent[0] as { operationId: string }).operationId
    channel.deliver({ type: 'logout-ack', operationId: OP })
    channel.deliver({ type: 'logout-begin', operationId })
    channel.deliver({ type: 'logout-ack', operationId })
    expect(await boundary.mock.calls[0]![1]!.confirmed).toBe(true)
    answer.resolve(json({}))
    await logout
    expect(reload).not.toHaveBeenCalled()
    expect(channel.sent).toHaveLength(1)
  })

  it('does not confirm when the guard was replaced or became unreadable before acknowledgement', async () => {
    const a = make(); route('POST /auth/logout', () => {
      localStorage.setItem(GUARD_KEY, JSON.stringify({ origin: location.origin, audience: 'user', generation: 1, operationId: OP }))
      return json({})
    })
    await a.auth.logout()
    expect(await a.boundary.mock.calls[0]![1]!.confirmed).toBe(false)
    expect(a.reload).not.toHaveBeenCalled()
    localStorage.clear()
    const b = make(); route('POST /auth/logout', () => { localStorage.setItem(GUARD_KEY, '{broken'); return json({}) })
    await b.auth.logout()
    expect(await b.boundary.mock.calls[0]![1]!.confirmed).toBe(false)
    expect(b.reload).not.toHaveBeenCalled()
  })

  it('disposes the confirmation and rethrows when the server fails', async () => {
    const { auth, boundary } = make()
    route('POST /auth/logout', () => json({ error: { code: 'DOWN', message: 'm' } }, 500))
    await expect(auth.logout()).rejects.toMatchObject({ status: 500, code: 'DOWN' })
    expect(await boundary.mock.calls[0]![1]!.confirmed).toBe(false)
  })

  it('rethrows a consumer failure and still lets the pending request settle', async () => {
    const { auth, boundary } = make()
    boundary.mockImplementation(() => { throw new Error('consumer') })
    const answer = deferred<Response>()
    route('POST /auth/logout', () => answer.promise)
    await expect(auth.logout()).rejects.toThrow('consumer')
    answer.reject(new Error('late'))
    await flush()
  })
})

describe('administrative and owner operations', () => {
  const admin = (over: Record<string, unknown> = {}) => make({ ...adminWire(), ...over })

  it('lists users with and without a cursor and lists modules', async () => {
    const { auth } = admin()
    route('GET /admin/users', () => json({ users: [{ ...principal(), passwordEstablished: true }], nextCursor: 'n' }))
    expect((await auth.listUsers()).nextCursor).toBe('n')
    await auth.listUsers('a b')
    expect(calls.map(call => call.key)).toEqual(['GET /admin/users', 'GET /admin/users'])
    route('GET /admin/modules', () => json({ modules: [{ id: 'runtime', label: 'Runtime', operations: ['run'] }] }))
    expect((await auth.listModules()).modules[0]!.id).toBe('runtime')
  })

  it('commits administrative changes with encoded ids and acknowledges invitations', async () => {
    const { auth } = admin()
    const id = 'u/1' as never
    route('POST /admin/users', () => json({}))
    route('PATCH /admin/users/u%2F1/status', () => json({}))
    route('PUT /admin/users/u%2F1/modules', () => json({}))
    route('POST /admin/users/u%2F1/invitation', () => json({ accepted: true }))
    route('PATCH /admin/users/u%2F1/invitation-email', () => json({}))
    await auth.createUser('bob', 'b@example.test')
    await auth.setUserStatus(id, 'BLOCKED')
    await auth.setUserModules(id, ['runtime' as never])
    await auth.inviteUser(id)
    await auth.changeInvitationEmail(id, 'c@example.test')
    expect(calls).toHaveLength(5)
    expect(bodyOf('PUT /admin/users/u%2F1/modules')).toEqual({ grants: ['runtime'] })
    expect(new Headers(calls[3]!.init.headers as HeadersInit).get(CSRF_HEADER)).toBe('csrf-1')
  })

  it('refuses administrative calls from users, pending admins and anonymous clients', async () => {
    for (const { auth } of [make(), admin({ principal: principal({ role: 'MASTER_ADMIN', status: 'PENDING' }) }),
      admin({ principal: principal({ role: 'MASTER_ADMIN', mustChangePassword: true }) }), make({ authenticated: false })]) {
      await expect(auth.listUsers()).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
    }
    expect(calls).toHaveLength(0)
  })

  it('refuses owner calls from admins, pending users and password-change users', async () => {
    for (const { auth } of [admin(), make({ principal: principal({ status: 'PENDING' }) }),
      make({ principal: principal({ mustChangePassword: true }) }), make({ authenticated: false })]) {
      await expect(auth.userRequest('GET', '/user/x')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
  })

  it('downloads own history as ndjson and rejects other content types', async () => {
    const { auth } = make()
    route('GET /user/sessions/a%2Fb/export', () => new Response('{"a":1}\n', { headers: { 'Content-Type': 'application/x-ndjson' } }))
    expect(await (await auth.exportHistory('a/b')).text()).toBe('{"a":1}\n')
    route('GET /user/sessions/a%2Fb/export', () => new Response('x', { headers: { 'Content-Type': 'text/html' } }))
    await expect(auth.exportHistory('a/b')).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' })
    route('GET /user/sessions/a%2Fb/export', () => ({ ok: true, status: 200, headers: new Headers(), blob: () => Promise.resolve(new Blob()) }))
    await expect(auth.exportHistory('a/b')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('discards an exported history that finishes after disposal', async () => {
    const { auth } = make()
    const blob = deferred<Blob>()
    route('GET /user/sessions/s/export', () => ({ ok: true, status: 200, headers: new Headers({ 'Content-Type': 'application/x-ndjson' }), blob: () => blob.promise }))
    const download = auth.exportHistory('s')
    await flush(); auth.dispose(); blob.resolve(new Blob(['x']))
    await expect(download).rejects.toMatchObject({ status: 401, code: 'SESSION_ENDED' })
  })
})
