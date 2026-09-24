/** Browser-owned authorization attempts over the existing credential-flow service. */
import { randomUUID } from 'node:crypto'
import type { AuthorizationAttemptId, AuthorizationPromptId, AuthorizationFlowView, AuthorizationPromptView, AuthorizationAttemptView } from './api/authorization.ts'
import type { AuthorizationService } from '@arx-ai/arx-authorization'
import type { AuthorizationNotice, AuthorizationPrompt } from '@arx-ai/arx-authorization/types'
import type { CredentialKey, CredentialProvider } from '@arx-ai/arx-credentials'

/** Deployment limits for active and retained browser attempts. */
export interface AuthorizationSessionLimits {
  attemptTimeoutMs: number
  resultRetentionMs: number
  pollIntervalMs: number
  maxAttempts: number
  answerMaxLength: number
}
/** Narrow capabilities; this controller cannot read secrets or cancel another surface's flow. */
export interface AuthorizationSessionServices {
  authorization: Pick<AuthorizationService, 'list' | 'describe' | 'begin'>
  credentials: Pick<CredentialProvider, 'describeRecord'>
}
interface Attempt {
  view: AuthorizationAttemptView
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  done: Promise<void>
  answer?: (value: string) => void
}
/** Fixed public interaction failures, safe to return without provider diagnostics. */
export class AuthorizationSessionError extends Error {}
function failure(message: string): Error { return new AuthorizationSessionError(message) }
/** Default bounds used by the gateway's configurable authorization section. */
export const DEFAULT_AUTHORIZATION_LIMITS: AuthorizationSessionLimits = {
  attemptTimeoutMs: 600_000, resultRetentionMs: 60_000, pollIntervalMs: 1000, maxAttempts: 32, answerMaxLength: 8192,
}
function promptView(prompt: AuthorizationPrompt): AuthorizationPromptView {
  const id = randomUUID() as AuthorizationPromptId
  if (prompt.kind === 'select') return { id, kind: prompt.kind, message: prompt.message,
    options: prompt.options.map(option => ({ ...option })) }
  return { id, kind: prompt.kind, message: prompt.message,
    ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder } }
}
function safeNotice(notice: AuthorizationNotice): AuthorizationNotice {
  const view: AuthorizationNotice = { message: notice.message, ...notice.code === undefined ? {} : { code: notice.code } }
  if (notice.url !== undefined) {
    try {
      const url = new URL(notice.url)
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      if (!url.username && !url.password && (url.protocol === 'https:' || (local && url.protocol === 'http:'))) view.url = url.href
    } catch { /* An invalid provider URL is never offered as a browser navigation. */ }
  }
  return view
}
function snapshot(attempt: Attempt): AuthorizationAttemptView {
  return structuredClone(attempt.view)
}
/**
 * Owns interaction callbacks and caller cancellation independently of HTTP requests.
 * Disposal joins AuthorizationService.begin; that service may release an uncooperative
 * provider flow after abort without waiting for its private resources.
 */
export class AuthorizationSessions {
  private readonly attempts = new Map<AuthorizationAttemptId, Attempt>()
  private readonly active = new Map<CredentialKey, AuthorizationAttemptId>()
  private closing: Promise<void> | undefined
  private disposed = false
  constructor(private readonly services: AuthorizationSessionServices, private readonly limits: AuthorizationSessionLimits) {}

  /** Describe registered flows and stored presence without reading any credential.
   * @returns safe flow rows for account and future integration settings.
   */
  async describe(): Promise<AuthorizationFlowView[]> {
    this.assertLive()
    try {
      return await Promise.all(this.services.authorization.list().map(async entry => {
        const record = await this.services.credentials.describeRecord(entry.key)
        return { key: entry.key, label: entry.label, methods: entry.methods.map(method => ({ ...method })),
          inFlight: entry.inFlight || this.active.has(entry.key), configured: record.configured, writable: record.writable,
          ...record.kind === undefined ? {} : { kind: record.kind } }
      }))
    } catch { throw failure('Authorization status is unavailable.') }
  }

  /** Begin a flow using a private browser capability.
   * @param key - registered credential flow.
   * @param method - optional method offered by that flow.
   * @returns initial progress without blocking on user interaction.
   */
  begin(key: CredentialKey, method?: string): AuthorizationAttemptView {
    this.assertLive()
    const entry = this.services.authorization.describe(key)
    if (!entry || (method !== undefined && !entry.methods.some(item => item.id === method))) throw failure('This authorization method is unavailable.')
    if (entry.inFlight || this.active.has(key)) throw failure('An authorization is already running for this account.')
    if (this.attempts.size >= this.limits.maxAttempts) throw failure('Too many authorization attempts. Please retry later.')
    const controller = new AbortController()
    const id = randomUUID() as AuthorizationAttemptId
    const attempt: Attempt = {
      view: { id, key, state: 'starting', expiresAt: Date.now() + this.limits.attemptTimeoutMs, pollAfterMs: this.limits.pollIntervalMs },
      controller, done: Promise.resolve(),
      timer: setTimeout(() => { attempt.view.state = 'expired'; controller.abort() }, this.limits.attemptTimeoutMs),
    }
    this.attempts.set(id, attempt)
    this.active.set(key, id)
    attempt.done = Promise.resolve().then(async () => {
      try {
        const outcome = await this.services.authorization.begin({ key, ...method === undefined ? {} : { method }, signal: controller.signal,
          interaction: {
            notify: (notice) => { if (!controller.signal.aborted) { attempt.view.notice = safeNotice(notice); attempt.view.state = 'waiting' } },
            prompt: prompt => this.prompt(attempt, prompt),
          } })
        if (!controller.signal.aborted) attempt.view.state = outcome.status
      } catch {
        if (!controller.signal.aborted) { attempt.view.state = 'failed'; attempt.view.message = 'Authorization failed. Please retry.' }
      } finally {
        controller.abort()
        clearTimeout(attempt.timer)
        this.active.delete(key)
        delete attempt.view.notice
        delete attempt.view.prompt
        delete attempt.answer
        if (!this.disposed) attempt.timer = setTimeout(() => { this.attempts.delete(id) }, this.limits.resultRetentionMs)
      }
    })
    return snapshot(attempt)
  }

  /** Read an attempt owned by the initiating surface.
   * @param id - private capability returned by begin.
   * @returns latest progress without submitted answers.
   */
  poll(id: AuthorizationAttemptId): AuthorizationAttemptView { return snapshot(this.attempt(id)) }

  /** Answer exactly one outstanding prompt, without storing the submitted value.
   * @param id - initiating surface's private capability.
   * @param promptId - current prompt revision from poll.
   * @param answer - typed text, masked secret, or selected option id.
   * @returns progress after withdrawing the answered prompt.
   */
  submit(id: AuthorizationAttemptId, promptId: AuthorizationPromptId, answer: string): AuthorizationAttemptView {
    const attempt = this.attempt(id)
    const prompt = attempt.view.prompt
    if (!attempt.answer || !prompt || prompt.id !== promptId || attempt.controller.signal.aborted) throw failure('This authorization prompt is no longer available.')
    if (answer.length > this.limits.answerMaxLength) throw failure('The authorization answer is too long.')
    if (prompt.kind === 'select' && !prompt.options.some(option => option.id === answer)) throw failure('Choose one of the available options.')
    attempt.answer(answer)
    return snapshot(attempt)
  }

  /** Cancel only the attempt named by its private capability and join the service call.
   * @param id - initiating surface's private capability.
   * @returns terminal progress.
   */
  async cancel(id: AuthorizationAttemptId): Promise<AuthorizationAttemptView> {
    const attempt = this.attempt(id)
    if (this.active.get(attempt.view.key) === id) {
      if (!attempt.controller.signal.aborted) attempt.view.state = 'cancelled'
      attempt.controller.abort()
      await attempt.done
    }
    return snapshot(attempt)
  }

  /** Abort this controller's attempts, clear retention timers and join service calls. */
  dispose(): Promise<void> {
    return this.closing ??= this.close()
  }
  private async close(): Promise<void> {
    this.disposed = true
    for (const attempt of this.attempts.values()) {
      clearTimeout(attempt.timer)
      if (this.active.get(attempt.view.key) === attempt.view.id && !attempt.controller.signal.aborted) attempt.view.state = 'cancelled'
      attempt.controller.abort()
    }
    await Promise.all([...this.attempts.values()].map(attempt => attempt.done))
    this.attempts.clear(); this.active.clear()
  }
  private prompt(attempt: Attempt, prompt: AuthorizationPrompt): Promise<string> {
    if (attempt.controller.signal.aborted || prompt.signal?.aborted) return Promise.reject(failure('Authorization prompt withdrawn.'))
    if (attempt.answer) return Promise.reject(failure('Another authorization prompt is already pending.'))
    attempt.view.prompt = promptView(prompt)
    attempt.view.state = 'waiting'
    return new Promise<string>((resolve, reject) => {
      const clear = (): void => {
        attempt.controller.signal.removeEventListener('abort', abort)
        prompt.signal?.removeEventListener('abort', abort)
        delete attempt.answer; delete attempt.view.prompt
      }
      const abort = (): void => { clear(); reject(failure('Authorization prompt withdrawn.')) }
      attempt.controller.signal.addEventListener('abort', abort, { once: true })
      prompt.signal?.addEventListener('abort', abort, { once: true })
      attempt.answer = (answer) => { clear(); resolve(answer) }
    })
  }
  private assertLive(): void {
    if (this.disposed) throw failure('Authorization is unavailable.')
  }
  private attempt(id: AuthorizationAttemptId): Attempt {
    this.assertLive()
    const attempt = this.attempts.get(id)
    if (!attempt) throw failure('The authorization attempt is unknown or has expired.')
    return attempt
  }
}
