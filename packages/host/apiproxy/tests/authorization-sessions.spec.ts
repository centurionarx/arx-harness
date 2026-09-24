/** Caller ownership, prompt lifecycle, and safe output of the browser authorization bridge. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { credentialKey } from '@arx-ai/arx-credentials'
import type { AuthorizationRequest } from '@arx-ai/arx-authorization'
import type { AuthorizationOutcome } from '@arx-ai/arx-authorization/types'
import { AuthorizationSessions, type AuthorizationSessionLimits } from '../src/authorization-sessions.ts'
import type { AuthorizationAttemptId, AuthorizationPromptId } from '../src/api/authorization.ts'

const KEY = credentialKey('llm-pi-ai', 'openai-codex')
const OTHER = credentialKey('llm-pi-ai', 'anthropic')
const limits: AuthorizationSessionLimits = {
  attemptTimeoutMs: 1000, resultRetentionMs: 100, pollIntervalMs: 20, maxAttempts: 4, answerMaxLength: 32,
}
const owners: AuthorizationSessions[] = []
afterEach(async () => { await Promise.all(owners.splice(0).map(owner => owner.dispose())); vi.useRealTimers() })

function bench(run?: (request: AuthorizationRequest) => Promise<AuthorizationOutcome>, override: Partial<AuthorizationSessionLimits> = {}) {
  const entries = [KEY, OTHER].map(key => ({ key, label: key, methods: [{ id: 'oauth', label: 'Sign in' }], inFlight: false }))
  let request!: AuthorizationRequest
  const services = {
    authorization: {
      list: () => entries,
      describe: (key: typeof KEY) => entries.find(entry => entry.key === key),
      begin: vi.fn((next: AuthorizationRequest) => {
        request = next
        if (run) return run(next)
        return new Promise<AuthorizationOutcome>((resolve) => {
          if (next.signal?.aborted) resolve({ status: 'cancelled' })
          else next.signal?.addEventListener('abort', () =>{  resolve({ status: 'cancelled' }) }, { once: true })
        })
      }),
    },
    credentials: { describeRecord: vi.fn(async (_key: typeof KEY) => ({ configured: true, writable: true, kind: 'grant' as const })) },
  }
  const owner = new AuthorizationSessions(services, { ...limits, ...override })
  owners.push(owner)
  return { owner, services, request: () => request }
}

async function opened(b: ReturnType<typeof bench>) {
  const attempt = b.owner.begin(KEY, 'oauth')
  await Promise.resolve()
  return attempt
}

describe('browser authorization sessions', () => {
  it('lists only registered credential presence and keeps private attempt ids out of the directory', async () => {
    const b = bench()
    const attempt = await opened(b)
    const rows = await b.owner.describe()
    expect(rows[0]).toEqual({ key: KEY, label: KEY, methods: [{ id: 'oauth', label: 'Sign in' }], inFlight: true, configured: true, writable: true, kind: 'grant' })
    expect(b.services.credentials.describeRecord.mock.calls.map(call => call[0])).toEqual([KEY, OTHER])
    expect(JSON.stringify(rows)).not.toContain(attempt.id)
    b.services.credentials.describeRecord.mockRejectedValueOnce(new Error('access_token=private'))
    await expect(b.owner.describe()).rejects.toThrow('Authorization status is unavailable.')
  })

  it('refuses unknown flows, methods, concurrent keys, and excess retained capabilities', async () => {
    const b = bench(undefined, { maxAttempts: 1 })
    expect(() => b.owner.begin(credentialKey('unknown', 'provider'))).toThrow('unavailable')
    expect(() => b.owner.begin(KEY, 'unknown')).toThrow('unavailable')
    await opened(b)
    expect(() => b.owner.begin(KEY)).toThrow('already running')
    expect(() => b.owner.begin(OTHER)).toThrow('Too many')
    expect(b.services.authorization.begin).toHaveBeenCalledOnce()
  })

  it('publishes safe notices, rejects executable URLs and isolates returned snapshots', async () => {
    const b = bench()
    const attempt = await opened(b)
    b.request().interaction.notify({ message: 'Open sign-in', url: 'https://auth.openai.com/authorize', code: 'ABCD' })
    const view = b.owner.poll(attempt.id)
    expect(view.notice).toEqual({ message: 'Open sign-in', url: 'https://auth.openai.com/authorize', code: 'ABCD' })
    view.notice!.message = 'mutated'
    expect(b.owner.poll(attempt.id).notice?.message).toBe('Open sign-in')
    for (const url of ['javascript:alert(1)', 'not a url', 'https://user:secret@example.com/', 'http://example.com/']) {
      b.request().interaction.notify({ message: 'Continue', url })
      expect(b.owner.poll(attempt.id).notice).toEqual({ message: 'Continue' })
    }
    b.request().interaction.notify({ message: 'Local', url: 'http://127.0.0.1:9000/' })
    expect(b.owner.poll(attempt.id).notice?.url).toBe('http://127.0.0.1:9000/')
    b.request().interaction.notify({ message: 'Approve on your other device' })
    expect(b.owner.poll(attempt.id).notice).toEqual({ message: 'Approve on your other device' })
  })

  it.each(['text', 'secret'] as const)('answers %s prompts without retaining submitted values', async (kind) => {
    const b = bench()
    const attempt = await opened(b)
    const answer = b.request().interaction.prompt({ kind, message: 'Enter code', placeholder: 'Code' })
    const prompt = b.owner.poll(attempt.id).prompt!
    expect(prompt.kind).toBe(kind)
    expect(() => b.owner.submit(attempt.id, 'stale' as AuthorizationPromptId, 'secret-code')).toThrow('no longer')
    expect(() => b.owner.submit(attempt.id, prompt.id, 'x'.repeat(33))).toThrow('too long')
    const progress = b.owner.submit(attempt.id, prompt.id, 'secret-code')
    await expect(answer).resolves.toBe('secret-code')
    expect(progress.prompt).toBeUndefined()
    expect(JSON.stringify(progress)).not.toContain('secret-code')
    expect(() => b.owner.submit(attempt.id, prompt.id, 'again')).toThrow('no longer')
  })

  it('validates select values and rejects concurrent prompts', async () => {
    const b = bench()
    const attempt = await opened(b)
    const answer = b.request().interaction.prompt({ kind: 'select', message: 'Choose', options: [{ id: 'yes', label: 'Continue' }] })
    await expect(b.request().interaction.prompt({ kind: 'text', message: 'Overlapping' })).rejects.toThrow('already pending')
    const prompt = b.owner.poll(attempt.id).prompt!
    expect(() => b.owner.submit(attempt.id, prompt.id, 'no')).toThrow('available options')
    b.owner.submit(attempt.id, prompt.id, 'yes')
    await expect(answer).resolves.toBe('yes')
  })

  it('withdraws a prompt independently and refuses its stale answer when the flow asks again', async () => {
    const b = bench()
    const attempt = await opened(b)
    const signal = new AbortController()
    const answer = b.request().interaction.prompt({ kind: 'text', message: 'Old', signal: signal.signal })
    const old = b.owner.poll(attempt.id).prompt!
    signal.abort()
    await expect(answer).rejects.toThrow('withdrawn')
    expect(b.request().signal?.aborted).toBe(false)
    await expect(b.request().interaction.prompt({ kind: 'text', message: 'Already withdrawn', signal: signal.signal })).rejects.toThrow('withdrawn')
    const next = b.request().interaction.prompt({ kind: 'text', message: 'New' })
    expect(() => b.owner.submit(attempt.id, old.id, 'stale')).toThrow('no longer')
    b.owner.submit(attempt.id, b.owner.poll(attempt.id).prompt!.id, 'new')
    await expect(next).resolves.toBe('new')
  })

  it('cancels only its owned attempt and erases notices and pending prompts', async () => {
    const b = bench()
    const attempt = await opened(b)
    const other = b.owner.begin(OTHER)
    await Promise.resolve()
    const otherRequest = b.request()
    expect(() => b.owner.poll('unknown' as AuthorizationAttemptId)).toThrow('unknown')
    await expect(b.owner.cancel('unknown' as AuthorizationAttemptId)).rejects.toThrow('unknown')
    const prompt = otherRequest.interaction.prompt({ kind: 'secret', message: 'Code' })
    const rejection = expect(prompt).rejects.toThrow('withdrawn')
    expect((await b.owner.cancel(other.id)).state).toBe('cancelled')
    await rejection
    expect(b.owner.poll(other.id).prompt).toBeUndefined()
    expect(b.owner.poll(attempt.id).state).toBe('starting')
    await expect(otherRequest.interaction.prompt({ kind: 'text', message: 'Late' })).rejects.toThrow('withdrawn')
    otherRequest.interaction.notify({ message: 'Late' })
    expect(b.owner.poll(other.id).notice).toBeUndefined()
  })

  it('does not let an old completed capability cancel a new attempt for the same key', async () => {
    const b = bench(async () => ({ status: 'authorized' }))
    const first = await opened(b)
    await vi.waitFor(() => { expect(b.owner.poll(first.id).state).toBe('authorized') })
    const second = b.owner.begin(KEY)
    expect((await b.owner.cancel(first.id)).state).toBe('authorized')
    expect(second.id).not.toBe(first.id)
  })

  it('expires running attempts and evicts terminal capabilities after retention', async () => {
    vi.useFakeTimers()
    const b = bench()
    const attempt = await opened(b)
    await vi.advanceTimersByTimeAsync(limits.attemptTimeoutMs)
    expect(b.owner.poll(attempt.id).state).toBe('expired')
    expect(b.request().signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(limits.resultRetentionMs)
    expect(() => b.owner.poll(attempt.id)).toThrow('expired')
  })

  it('keeps an expired attempt expired through cancellation and a late provider outcome', async () => {
    vi.useFakeTimers()
    let settle!: (outcome: AuthorizationOutcome) => void
    const b = bench(() => new Promise<AuthorizationOutcome>((resolve) => { settle = resolve }))
    const attempt = await opened(b)
    await vi.advanceTimersByTimeAsync(limits.attemptTimeoutMs)
    expect(b.owner.poll(attempt.id).state).toBe('expired')
    const cancelling = b.owner.cancel(attempt.id)
    settle({ status: 'authorized' })
    expect((await cancelling).state).toBe('expired')
  })

  it('keeps a cancelled attempt cancelled when its provider rejects on abort', async () => {
    const b = bench(request => new Promise<AuthorizationOutcome>((_resolve, reject) => {
      request.signal?.addEventListener('abort', () => { reject(new Error('refresh_token=private')) }, { once: true })
    }))
    const attempt = await opened(b)
    const view = await b.owner.cancel(attempt.id)
    expect(view.state).toBe('cancelled')
    expect(view.message).toBeUndefined()
  })

  it('sanitizes raw provider failures and disposes all owned attempts', async () => {
    const failed = bench(async () => { throw new Error('refresh_token=private') })
    const attempt = await opened(failed)
    await vi.waitFor(() => { expect(failed.owner.poll(attempt.id).state).toBe('failed') })
    expect(failed.owner.poll(attempt.id).message).toBe('Authorization failed. Please retry.')
    const b = bench()
    await opened(b)
    const first = b.owner.dispose()
    expect(b.owner.dispose()).toBe(first)
    await first
    expect(b.request().signal?.aborted).toBe(true)
    expect(() => b.owner.begin(KEY)).toThrow('unavailable')
    await expect(b.owner.describe()).rejects.toThrow('unavailable')
  })
})
