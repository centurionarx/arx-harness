/** Owns bounded native login attempts independently of browser request lifetimes. */
import { randomUUID } from 'node:crypto'
import type {
  NativeAccountAttempt, NativeAccountAttemptId, NativeAccountProvider, NativeAccountView, NativeLoginInput, NativeLoginMode,
} from './types.ts'

/** Provider-owned protocol; the manager never handles native token storage. */
export interface NativeAccountDriver {
  provider: NativeAccountProvider
  label: string
  loginModes: NativeLoginMode[]
  /** Exact HTTPS hosts the product may send a person to; any other address fails the attempt. */
  authorizationHosts: readonly string[]
  describe(signal: AbortSignal): Promise<Omit<NativeAccountView, 'provider' | 'label' | 'loginModes' | 'loginInFlight'>>
  /**
   * Run one sign-in. `prompt` asks the person for one pasted line of the given
   * kind and rejects when the attempt ends; one prompt is pending at a time.
   * Passing `rejected` says the previous answer to the same prompt was not accepted.
   */
  login(
    mode: NativeLoginMode, signal: AbortSignal,
    notice: (url: string, code?: string) => void, prompt: (input: NativeLoginInput, rejected?: boolean) => Promise<string>,
  ): Promise<void>
}
/** Deployment-owned limits for attempts and read-only probes. */
export interface NativeAccountLimits {
  loginTimeoutMs: number
  probeTimeoutMs: number
  resultRetentionMs: number
  pollIntervalMs: number
  maxAttempts: number
}
interface Attempt {
  view: NativeAccountAttempt
  controller: AbortController
  done: Promise<void>
  timer: ReturnType<typeof setTimeout>
  answer?: (code: string) => void
}
/** Fixed safe operational refusal; raw product output never forms an error message. */
export class NativeAccountError extends Error {
  constructor(message: string) { super(message); this.name = 'NativeAccountError' }
}
/** Lifecycle owner; private capabilities are not discoverable from the account directory. */
export class NativeAccountManager {
  private readonly attempts = new Map<NativeAccountAttemptId, Attempt>()
  private readonly active = new Map<NativeAccountProvider, NativeAccountAttemptId>()
  private readonly probes = new Set<{ controller: AbortController; done: Promise<NativeAccountView[]> }>()
  private pendingDescribe: Promise<NativeAccountView[]> | undefined
  private disposed = false
  constructor(private readonly drivers: readonly NativeAccountDriver[], private readonly limits: NativeAccountLimits) {}
  /** Probe installed accounts with a bounded lifetime and sanitized output.
   * @returns the public directory, never attempt ids or token material.
   */
  async describe(): Promise<NativeAccountView[]> {
    this.assertLive()
    if (this.pendingDescribe !== undefined) return this.pendingDescribe
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, this.limits.probeTimeoutMs)
    const done = Promise.all(this.drivers.map(async (driver) => {
      const base = { provider: driver.provider, label: driver.label, loginModes: driver.loginModes,
        loginInFlight: this.active.has(driver.provider) }
      try { return { ...base, ...await driver.describe(controller.signal) } }
      catch { return { ...base, availability: 'available' as const, status: 'unknown' as const } }
    }))
    const probe = { controller, done }
    this.probes.add(probe)
    this.pendingDescribe = done
    try { return await done } finally { clearTimeout(timer); this.probes.delete(probe); this.pendingDescribe = undefined }
  }
  /** Start one private attempt without blocking the initiating HTTP request.
   * @param provider - registered native product.
   * @param mode - mechanism exposed by that product.
   * @returns a private capability and initial progress.
   */
  begin(provider: NativeAccountProvider, mode: NativeLoginMode = 'browser'): NativeAccountAttempt {
    this.assertLive()
    const driver = this.drivers.find(item => item.provider === provider)
    if (!driver || !driver.loginModes.includes(mode)) throw new NativeAccountError('This login method is unavailable.')
    if (this.active.has(provider)) throw new NativeAccountError('A sign-in is already running for this product.')
    if (this.attempts.size >= this.limits.maxAttempts) throw new NativeAccountError('Too many retained sign-in attempts. Please wait and retry.')
    const id = randomUUID() as NativeAccountAttemptId
    const view: NativeAccountAttempt = { id, provider, state: 'starting', expiresAt: Date.now() + this.limits.loginTimeoutMs, pollAfterMs: this.limits.pollIntervalMs }
    const controller = new AbortController()
    const attempt: Attempt = { view, controller, done: Promise.resolve(), timer: setTimeout(() => {
      view.state = 'expired'; controller.abort()
    }, this.limits.loginTimeoutMs) }
    this.attempts.set(id, attempt)
    this.active.set(provider, id)
    attempt.done = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted()
        await driver.login(mode, controller.signal, (url, code) => {
          if (controller.signal.aborted) return
          const parsed = new URL(url)
          if (parsed.protocol !== 'https:' || !driver.authorizationHosts.includes(parsed.hostname) || parsed.username || parsed.password) {
            throw new NativeAccountError('The product returned an unsupported authorization address.')
          }
          view.state = 'waiting'; view.url = url
          if (code !== undefined) view.code = code
        }, (input, rejected = false) => new Promise<string>((resolve, reject) => {
          controller.signal.throwIfAborted()
          if (attempt.answer !== undefined) throw new NativeAccountError('A sign-in prompt is already pending.')
          view.input = input; view.state = 'waiting'
          if (rejected) view.rejected = true
          const abort = (): void => {
            delete attempt.answer; delete view.input; delete view.rejected; reject(new NativeAccountError('Sign-in cancelled.'))
          }
          controller.signal.addEventListener('abort', abort, { once: true })
          attempt.answer = (code) => {
            controller.signal.removeEventListener('abort', abort)
            delete attempt.answer; delete view.input; delete view.rejected; resolve(code)
          }
        }))
        if (!controller.signal.aborted) view.state = 'connected'
      } catch {
        if (!controller.signal.aborted) { view.state = 'failed'; view.message = 'Sign-in failed. Please retry.' }
      } finally {
        controller.abort()
        clearTimeout(attempt.timer)
        this.active.delete(provider)
        delete view.url; delete view.code; delete view.input; delete view.rejected
        if (!this.disposed) attempt.timer = setTimeout(() => { this.attempts.delete(id) }, this.limits.resultRetentionMs)
      }
    })
    return { ...view }
  }
  /** Read progress using the initiating caller's capability.
   * @param id - private attempt id.
   * @returns the latest safe progress.
   */
  poll(id: NativeAccountAttemptId): NativeAccountAttempt { return { ...this.attempt(id).view } }
  /** Answer the attempt's current prompt; the answer is never retained in progress.
   * @param id - initiating caller's private capability.
   * @param code - single line supplied by the human: an authorization code or the browser's return address.
   * @returns updated progress without the submitted value.
   */
  submit(id: NativeAccountAttemptId, code: string): NativeAccountAttempt {
    const attempt = this.attempt(id)
    if (!attempt.answer || attempt.controller.signal.aborted) throw new NativeAccountError('No sign-in answer is requested.')
    if (!code || /[\r\n]/.test(code) || code.length > 8192) throw new NativeAccountError('Enter a single line.')
    attempt.answer(code)
    return { ...attempt.view }
  }
  /** Cancel an attempt and await all provider resources.
   * @param id - private attempt id.
   * @returns the terminal progress.
   */
  async cancel(id: NativeAccountAttemptId): Promise<NativeAccountAttempt> {
    const attempt = this.attempt(id)
    if (this.active.get(attempt.view.provider) === id) {
      attempt.view.state = 'cancelled'; attempt.controller.abort()
      await attempt.done
    }
    return { ...attempt.view }
  }
  /** Withdraw all probes and login attempts and wait for provider cleanup. */
  async dispose(): Promise<void> {
    this.disposed = true
    for (const probe of this.probes) probe.controller.abort()
    for (const attempt of this.attempts.values()) {
      clearTimeout(attempt.timer); attempt.controller.abort()
    }
    await Promise.all([...this.attempts.values()].map(attempt => attempt.done))
    await Promise.all([...this.probes].map(probe => probe.done))
    this.attempts.clear(); this.active.clear()
  }
  private assertLive(): void {
    if (this.disposed) throw new NativeAccountError('Native account service is unavailable.')
  }
  private attempt(id: NativeAccountAttemptId): Attempt {
    this.assertLive()
    const attempt = this.attempts.get(id)
    if (!attempt) throw new NativeAccountError('The sign-in attempt is unknown or has expired.')
    return attempt
  }
}
