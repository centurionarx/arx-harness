// @vitest-environment jsdom
/** Execute the genuine inline bytes; this is behavior coverage, not a TS map for the string's JavaScript. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { NATIVE_RECOVERY_SCRIPT } from '../src/client/recovery-script.ts'
interface Transfer { take(): string | undefined; clear(): void }
function transfer(): Transfer {
  const value: unknown = (globalThis as { __ARX_RECOVERY_FRAGMENT__?: unknown }).__ARX_RECOVERY_FRAGMENT__
  if (typeof value !== 'object' || value === null || !('take' in value) || typeof value.take !== 'function'
    || !('clear' in value) || typeof value.clear !== 'function') throw new Error('actual inline transfer unavailable')
  return value as Transfer
}
const remove: Array<() => void> = []
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  for (const release of remove.splice(0)) release()
  history.replaceState(null, '', '/'); vi.restoreAllMocks()
})
function listen(name: string, fn: EventListener): void {
  window.addEventListener(name, fn, { capture: true })
  remove.push(() => { window.removeEventListener(name, fn, { capture: true }) })
}
describe('first native inline recovery publisher', () => {
  it.each(['/reset', '/invite'])('strips %s before callbacks, exposes only one-use methods and clears by identity', (pathname) => {
    history.replaceState({ stale: 'selection' }, '', pathname + '#reset=fixture-initial')
    window.eval(NATIVE_RECOVERY_SCRIPT)
    const first = transfer()
    expect(location.hash).toBe(''); expect(history.state).toBeNull()
    expect(Object.keys(first).sort()).toEqual(['clear', 'take'])
    expect(Object.isFrozen(first)).toBe(true)
    expect(first.take()).toBe('#reset=fixture-initial'); expect(first.take()).toBeUndefined()
    history.replaceState(null, '', pathname + '#invite=fixture-new')
    const tap = vi.fn(); listen('hashchange', tap)
    window.dispatchEvent(new HashChangeEvent('hashchange', { newURL: location.href }))
    const second = transfer(); first.clear()
    expect(transfer()).toBe(second); expect(location.hash).toBe(''); expect(tap).not.toHaveBeenCalled()
    expect(second.take()).toBe('#invite=fixture-new')
    expect(() => transfer()).toThrow('actual inline transfer unavailable')
  })
  it('reads the current hash for two queued native events, suppresses URL-bearing taps, and captures Back again', async () => {
    history.replaceState(null, '', '/reset'); window.eval(NATIVE_RECOVERY_SCRIPT); transfer().take()
    const tap = vi.fn(), published = vi.fn(), popstates: boolean[] = []
    listen('hashchange', tap); listen('arx-recovery-required', published)
    listen('popstate', () => { popstates.push(location.hash !== '') })
    location.hash = 'reset=fixture-first'; location.hash = 'invite=fixture-second'
    await waitFor(() => { expect(published).toHaveBeenCalledOnce() })
    expect(location.hash).toBe(''); expect(transfer().take()).toBe('#invite=fixture-second')
    window.dispatchEvent(new HashChangeEvent('hashchange', { newURL: location.origin + '/reset#reset=fixture-first' }))
    expect(published).toHaveBeenCalledOnce(); expect(tap).not.toHaveBeenCalled()
    history.back()
    await waitFor(() => { expect(published).toHaveBeenCalledTimes(2) })
    expect(location.hash).toBe(''); expect(transfer().take()).toBe('#reset=fixture-first')
    expect(tap).not.toHaveBeenCalled()
    // An older entry is stripped when traversal makes it current, before either tap.
    // This does not claim removal of entries that have not become current.
    expect(popstates.some(Boolean)).toBe(false)
  })
  it.each(['#reset=', '#invite=%invalid'])('captures recognized current %s without parsing secret payload or event state', (fragment) => {
    history.replaceState(null, '', '/invite'); window.eval(NATIVE_RECOVERY_SCRIPT); transfer().take()
    const tap = vi.fn(); listen('popstate', tap)
    history.replaceState(null, '', '/invite' + fragment)
    window.dispatchEvent(new PopStateEvent('popstate', { state: { unrelated: true } }))
    expect(location.hash).toBe(''); expect(tap).not.toHaveBeenCalled(); expect(transfer().take()).toBe(fragment)
    for (const unrelated of ['', '#ordinary', '#reset']) {
      history.replaceState(null, '', '/invite' + unrelated)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
    expect(tap).toHaveBeenCalledTimes(3)
  })
  it('releases the single publisher on pagehide and leaves other documents hash semantics intact', () => {
    history.replaceState(null, '', '/reset#reset=fixture-private'); window.eval(NATIVE_RECOVERY_SCRIPT)
    const handle = transfer(); window.dispatchEvent(new Event('pagehide')); handle.clear()
    expect(handle.take()).toBeUndefined()
    const tap = vi.fn(); listen('hashchange', tap)
    history.replaceState(null, '', '/reset#reset=fixture-after-hide')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(tap).toHaveBeenCalledOnce(); expect(location.hash).toBe('#reset=fixture-after-hide')
    history.replaceState(null, '', '/'); window.eval(NATIVE_RECOVERY_SCRIPT); transfer().take()
    history.replaceState(null, '', '/#local-route')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(tap).toHaveBeenCalledTimes(2); expect(location.hash).toBe('#local-route')
  })
})
