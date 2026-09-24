import { describe, expect, it, vi } from 'vitest'
import z from '@arx-ai/schemastery'
import {
  createHookHandlerIds, createHookLifecycle, HOOK_POLICY_DEFAULTS, hookPolicyFields,
  mergeHookOutputs, resolveHookPolicy,
} from '@arx-ai/arx-hook-protocol'

const blocked = mergeHookOutputs([{ stdout: '', stderr: '', exitCode: 0, decision: 'block' }])
const allowed = mergeHookOutputs([])
const signal = new AbortController().signal
const actions = () => ({ halt: vi.fn(), steer: vi.fn(), limit: vi.fn() })

it('resolves the same defaults in schemas and direct bridge application', () => {
  const schema = z.object(hookPolicyFields())
  expect(schema({})).toEqual(HOOK_POLICY_DEFAULTS)
  expect(resolveHookPolicy({}, 'bridge')).toEqual(HOOK_POLICY_DEFAULTS)
  const overrides = { maxStopContinuations: 0, sessionStartMode: 'detached' as const, defaultTimeoutMs: 25, stderrSummaryMaxChars: 1 }
  expect(resolveHookPolicy(overrides, 'bridge')).toEqual(overrides)
  expect(schema(overrides)).toEqual(overrides)
})

it.each([0, -1, 0.1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid persisted-summary bounds: %s', (value) => {
  expect(() => resolveHookPolicy({ stderrSummaryMaxChars: value }, 'bridge')).toThrow('bridge: stderrSummaryMaxChars must be a positive integer')
})

it.each([-1, 0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects invalid continuation caps: %s', (value) => {
  expect(() => resolveHookPolicy({ maxStopContinuations: value }, 'bridge')).toThrow('bridge: maxStopContinuations must be a non-negative safe integer')
})

it('allocates dialect-prefixed ids across different points', () => {
  const next = createHookHandlerIds('codex')
  expect([next('SessionStart'), next('Stop')]).toEqual(['codex:SessionStart:1', 'codex:Stop:2'])
})

describe('owner-scoped lifecycle policy', () => {
  it('consumes startup once and forgets disposed owners', () => {
    const lifecycle = createHookLifecycle<object, string>(resolveHookPolicy({}, 'test'))
    const a = {}, b = {}
    lifecycle.start(a, 'startup'); lifecycle.start(b, 'resume')
    expect(lifecycle.takeStart(a)).toBe('startup')
    expect(lifecycle.takeStart(a)).toBeUndefined()
    lifecycle.forget(b)
    expect(lifecycle.takeStart(b)).toBeUndefined()
  })

  it.each([0, 1, 8])('enforces cap %s in the operation that invokes steering', (cap) => {
    const lifecycle = createHookLifecycle(resolveHookPolicy({ maxStopContinuations: cap }, 'test'))
    const owner = {}, effects = actions()
    expect(lifecycle.stopActive(owner, 1)).toBe(false)
    for (let index = 0; index < cap + 2; index++) lifecycle.settleStop(owner, 1, signal, blocked, effects)
    expect(effects.steer).toHaveBeenCalledTimes(cap)
    expect(effects.limit).toHaveBeenCalledTimes(2)
    expect(lifecycle.stopActive(owner, 1)).toBe(cap > 0)
    expect(lifecycle.stopActive(owner, 2)).toBe(false)
    lifecycle.settleStop(owner, 2, signal, blocked, effects)
    expect(effects.steer).toHaveBeenCalledTimes(cap + (cap > 0 ? 1 : 0))
  })

  it('isolates owners and clears their Stop state on disposal', () => {
    const lifecycle = createHookLifecycle(resolveHookPolicy({ maxStopContinuations: 1 }, 'test'))
    const a = {}, b = {}, effects = actions()
    lifecycle.settleStop(a, 1, signal, blocked, effects)
    expect(lifecycle.stopActive(b, 1)).toBe(false)
    lifecycle.settleStop(b, 1, signal, blocked, effects)
    expect(effects.steer).toHaveBeenCalledTimes(2)
    lifecycle.forget(a)
    expect(lifecycle.stopActive(a, 1)).toBe(false)
  })

  it('honors hard halt at an exhausted cap and leaves pass outcomes untouched', () => {
    const lifecycle = createHookLifecycle(resolveHookPolicy({ maxStopContinuations: 0 }, 'test'))
    const effects = actions(), owner = {}
    lifecycle.settleStop(owner, 1, signal, allowed, effects)
    lifecycle.settleStop(owner, 1, signal, { ...blocked, stop: true }, effects)
    expect(effects.halt).toHaveBeenCalledWith('halted by Stop hook')
    lifecycle.settleStop(owner, 1, signal, { ...blocked, stop: true, stopReason: 'custom halt' }, effects)
    expect(effects.halt).toHaveBeenLastCalledWith('custom halt')
    expect(effects.limit).not.toHaveBeenCalled()
    expect(effects.steer).not.toHaveBeenCalled()
  })

  it('does not consume a failed steering effect', () => {
    const lifecycle = createHookLifecycle(resolveHookPolicy({ maxStopContinuations: 1 }, 'test'))
    const effects = actions(), owner = {}
    effects.steer.mockImplementationOnce(() => { throw new Error('inbox closed') })
    expect(() => { lifecycle.settleStop(owner, 1, signal, blocked, effects) }).toThrow('inbox closed')
    expect(lifecycle.stopActive(owner, 1)).toBe(false)
    lifecycle.settleStop(owner, 1, signal, { ...blocked, reason: 'specific feedback' }, effects)
    expect(effects.steer).toHaveBeenLastCalledWith('specific feedback')
  })

  it('rejects late actions after turn cancellation or bridge disposal', async () => {
    const lifecycle = createHookLifecycle(resolveHookPolicy({}, 'test'))
    const effects = actions(), owner = {}
    lifecycle.settleStop(owner, 1, AbortSignal.abort(), blocked, effects)
    await lifecycle.runs.drain()
    lifecycle.settleStop(owner, 1, signal, { ...blocked, stop: true }, effects)
    expect(effects.steer).not.toHaveBeenCalled()
    expect(effects.halt).not.toHaveBeenCalled()
  })
})
