import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeAccountManager, type NativeAccountDriver } from '../src/manager.ts'
import type { NativeAccountAttemptId } from '../src/types.ts'

const limits = { loginTimeoutMs: 1000, probeTimeoutMs: 100, resultRetentionMs: 500, pollIntervalMs: 20, maxAttempts: 2 }
const managers: NativeAccountManager[] = []
function setup(login: NativeAccountDriver['login'], describe: NativeAccountDriver['describe'] = async () => ({ availability: 'available', status: 'disconnected' })) {
  const manager = new NativeAccountManager([{ provider: 'claude-code', label: 'Claude', loginModes: ['browser'], describe, login }], limits)
  managers.push(manager)
  return manager
}
function untilAbort(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) resolve()
    else signal.addEventListener('abort', () => resolve(), { once: true })
  })
}
afterEach(async () => { await Promise.all(managers.splice(0).map(manager => manager.dispose())); vi.useRealTimers() })

describe('private native account attempts', () => {
  it('does not reveal attempt capabilities in the directory and refuses another surface without one', async () => {
    const manager = setup(async (_mode, signal) => untilAbort(signal))
    const attempt = manager.begin('claude-code')
    expect(JSON.stringify(await manager.describe())).not.toContain(attempt.id)
    expect(() => manager.poll('not-the-capability' as NativeAccountAttemptId)).toThrow('unknown')
    expect(() => manager.begin('claude-code')).toThrow('already running')
    await manager.cancel(attempt.id)
  })
  it('relays a native manual-code prompt and never returns the submitted answer', async () => {
    let answer = ''
    const manager = setup(async (_mode, _signal, notice, prompt) => {
      notice('https://claude.com/oauth/authorize?state=example')
      answer = await prompt()
    })
    const attempt = manager.begin('claude-code')
    await vi.waitFor(() => expect(manager.poll(attempt.id).input).toBe('code'))
    expect(() => manager.submit(attempt.id, 'first\nsecond')).toThrow('one authorization code')
    expect(manager.submit(attempt.id, 'authorization-secret').input).toBeUndefined()
    await vi.waitFor(() => expect(manager.poll(attempt.id).state).toBe('connected'))
    expect(answer).toBe('authorization-secret')
    expect(JSON.stringify(manager.poll(attempt.id))).not.toContain('authorization-secret')
    expect(manager.poll(attempt.id).url).toBeUndefined()
    expect(() => manager.submit(attempt.id, 'again')).toThrow('No sign-in code')
  })
  it.each(['http://claude.com/oauth', 'https://evil.test/oauth', 'https://claude.com.evil.test/oauth', 'https://user:pass@claude.com/oauth'])('refuses an unsafe authorization address %s', async url => {
    const manager = setup(async (_mode, _signal, notice) => { notice(url) })
    const attempt = manager.begin('claude-code')
    await vi.waitFor(() => expect(manager.poll(attempt.id).state).toBe('failed'))
    expect(manager.poll(attempt.id).url).toBeUndefined()
  })
  it('waits for native cleanup on cancel before freeing the provider', async () => {
    let finish!: () => void
    const manager = setup(async (_mode, signal) => { await untilAbort(signal); await new Promise<void>(resolve => { finish = resolve }) })
    const attempt = manager.begin('claude-code')
    await Promise.resolve()
    const cancelling = manager.cancel(attempt.id)
    await Promise.resolve()
    expect(() => manager.begin('claude-code')).toThrow('already running')
    finish()
    expect((await cancelling).state).toBe('cancelled')
    expect(manager.begin('claude-code').state).toBe('starting')
    await Promise.resolve()
    const next = managers.pop()!
    const disposing = next.dispose()
    await Promise.resolve()
    finish()
    await disposing
  })
  it('expires attempts, aborts their native owner, and forgets retained results', async () => {
    vi.useFakeTimers()
    let cancelled = false
    const manager = setup(async (_mode, signal) => { await untilAbort(signal); cancelled = true })
    const attempt = manager.begin('claude-code')
    await vi.advanceTimersByTimeAsync(1000)
    expect(cancelled).toBe(true)
    expect(manager.poll(attempt.id).state).toBe('expired')
    await vi.advanceTimersByTimeAsync(500)
    expect(() => manager.poll(attempt.id)).toThrow('expired')
  })
  it('bounds status probes and returns unknown without exposing raw errors', async () => {
    vi.useFakeTimers()
    const manager = setup(async () => {}, async signal => { await untilAbort(signal); throw new Error('sensitive product output') })
    const describing = manager.describe()
    await vi.advanceTimersByTimeAsync(100)
    expect(await describing).toEqual([{ provider: 'claude-code', label: 'Claude', loginModes: ['browser'], loginInFlight: false, availability: 'available', status: 'unknown' }])
  })
  it('withdraws pending manual prompts on disposal and rejects future operations', async () => {
    const manager = setup(async (_mode, _signal, _notice, prompt) => { await prompt() })
    const attempt = manager.begin('claude-code')
    await vi.waitFor(() => expect(manager.poll(attempt.id).input).toBe('code'))
    await manager.dispose()
    expect(() => manager.begin('claude-code')).toThrow('unavailable')
  })
  it('caps retained attempts until their configured retention expires', async () => {
    vi.useFakeTimers()
    const manager = setup(async () => {})
    manager.begin('claude-code')
    await vi.advanceTimersByTimeAsync(0)
    manager.begin('claude-code')
    await vi.advanceTimersByTimeAsync(0)
    expect(() => manager.begin('claude-code')).toThrow('Too many retained')
    await vi.advanceTimersByTimeAsync(500)
    expect(manager.begin('claude-code').state).toBe('starting')
  })
  it('coalesces concurrent status requests into one set of native probes', async () => {
    let complete!: () => void
    const probe = vi.fn(async () => { await new Promise<void>(resolve => { complete = resolve }); return { availability: 'available' as const, status: 'disconnected' as const } })
    const manager = setup(async () => {}, probe)
    const first = manager.describe(); const second = manager.describe()
    expect(probe).toHaveBeenCalledOnce()
    complete()
    expect(await first).toEqual(await second)
  })
  it('does not start a native login cancelled before its runner starts', async () => {
    const login = vi.fn(async () => {})
    const manager = setup(login)
    const attempt = manager.begin('claude-code')
    await manager.cancel(attempt.id)
    expect(login).not.toHaveBeenCalled()
  })
  it('does not advertise an unsupported flow' , () => {
    const manager = setup(async () => {})
    expect(() => manager.begin('claude-code', 'device-code')).toThrow('unavailable')
  })
})
