import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@arx-ai/arx-session'
import type { ShellExecutor, ShellExecRequest, ShellExecSpec, ShellRunResult } from '@arx-ai/arx-shell'
import {
  createDetachedRuns, createHookHandlerIds, createHookPointRunner, resolveHookPolicy,
  type HookPointRunnerOptions,
} from '@arx-ai/arx-hook-protocol'

function output(stdout = '', exitCode = 0, stderr = ''): ShellRunResult {
  return { exitCode, signal: null, timedOut: false, aborted: false, timeoutMs: 1000,
    stdout: { text: stdout, truncated: false }, stderr: { text: stderr, truncated: false } }
}

/** Only the external shell is substituted; matching, decoding, auditing and cancellation are real. */
function fixture(overrides: Partial<HookPointRunnerOptions> = {}) {
  const specs: ShellExecSpec[] = []
  const execute = vi.fn<(spec: ShellExecSpec) => Promise<ShellRunResult>>(async () => output())
  const shell = {
    resolve(request: ShellExecRequest): ShellExecSpec {
      return { ...request, workdir: request.workdir ?? '/stub', timeoutMs: request.timeoutMs ?? 1000,
        stdoutMaxBytes: 64000, sandboxPolicy: request.sandboxPolicy }
    },
    run(spec: ShellExecSpec) { specs.push(spec); return execute(spec) },
  } as unknown as ShellExecutor
  let time = 0
  const observeOutput = vi.fn()
  const options: HookPointRunnerOptions = {
    dialect: 'claude-code', policy: resolveHookPolicy({ stderrSummaryMaxChars: 3 }, 'test'),
    groups: { Stop: [{ hooks: [{ command: 'first' }, { command: 'second' }] }] },
    runs: createDetachedRuns(), trailingNewline: true, nextHandlerId: createHookHandlerIds('claude-code'),
    observeOutput, now: () => ++time, ...overrides,
  }
  return { specs, execute, options, observeOutput, run: createHookPointRunner(shell, options) }
}

const signal = new AbortController().signal
const request = { point: 'Stop', matchQuery: '', payload: { hook_event_name: 'Stop' }, signal }

describe('shared point execution', () => {
  it('matches groups, preserves invocation/result order and merges the strictest outcome', async () => {
    const session = Session.create(SessionId('point-audit'))
    const f = fixture({ groups: { Stop: [
      { matcher: 'wrong', hooks: [{ command: 'skip' }] },
      { matcher: '*', hooks: [{ command: 'first' }, { command: 'second' }] },
    ] } })
    f.execute.mockResolvedValueOnce(output('', 2, 'abcdef')).mockResolvedValueOnce(output('{"decision":"allow"}'))
    const result = await f.run({ ...request, session, turn: 1, env: { HOOK_TEST: 'present' } })
    expect(result.decision).toBe('deny')
    expect(f.specs.map(spec => [spec.command, spec.stdin, spec.env]))
      .toEqual(['first', 'second'].map(command => [command, JSON.stringify(request.payload) + '\n', { HOOK_TEST: 'present' }]))
    expect(session.events.map(event => event.type)).toEqual(['hook/invoked', 'hook/result', 'hook/invoked', 'hook/result'])
    expect(session.events[0]).toMatchObject({ data: { matcher: '*', handlerId: 'claude-code:Stop:1' } })
    expect(session.events[1]).toMatchObject({ data: { stderrSummary: 'abc…', durationMs: 1 } })
    expect(f.observeOutput).toHaveBeenCalledTimes(2)
  })

  it('does not log detached or unowned executions and accepts an unconfigured point', async () => {
    const f = fixture({ trailingNewline: false })
    const session = Session.create(SessionId('point-detached'))
    await f.run({ ...request, session })
    expect(session.events).toEqual([])
    expect(f.specs[0]!.stdin).toBe(JSON.stringify(request.payload))
    await f.run({ ...request, turn: 1 })
    expect((await f.run({ ...request, point: 'absent' })).decision).toBe('none')
    expect(f.specs).toHaveLength(4)
  })

  it.each([
    ['plain', 0, true, ['plain']],
    ['plain', 0, false, []],
    ['plain', 2, true, []],
    ['{malformed', 0, true, []],
    ['', 0, true, []],
    ['{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"structured"}}', 0, true, ['structured']],
  ] as const)('applies explicit plain-stdout policy to %s / %s / %s', async (stdout, exitCode, enabled, expected) => {
    const f = fixture({ groups: { Stop: [{ hooks: [{ command: 'context' }] }] } })
    f.execute.mockResolvedValue(output(stdout, exitCode))
    expect((await f.run({ ...request, plainStdoutAsContext: enabled })).additionalContext).toEqual(expected)
  })

  it('rejects an already cancelled request before dispatch or audit', async () => {
    const f = fixture(), session = Session.create(SessionId('pre-abort'))
    await expect(f.run({ ...request, session, turn: 1, signal: AbortSignal.abort(new Error('cancel')) })).rejects.toThrow('cancel')
    expect(f.specs).toEqual([])
    expect(session.events).toEqual([])
  })

  it.each(['turn', 'bridge'])('drains an in-flight %s cancellation, records its result and starts no later command', async (owner) => {
    const f = fixture(), session = Session.create(SessionId('cancel-point'))
    const controller = new AbortController()
    const started = Promise.withResolvers<ShellExecSpec>()
    const release = Promise.withResolvers<ShellRunResult>()
    f.execute.mockImplementationOnce((spec) => { started.resolve(spec); return release.promise })
    const run = f.run({ ...request, session, turn: 1, signal: controller.signal })
    const rejected = expect(run).rejects.toThrow()
    const spec = await started.promise
    let drained = false
    if (owner === 'turn') controller.abort(new Error('turn cancelled'))
    const draining = f.options.runs.drain().then(() => { drained = true })
    expect(spec.signal!.aborted).toBe(true)
    expect(drained).toBe(false)
    release.resolve(output())
    await rejected
    await draining
    expect(f.specs).toHaveLength(1)
    expect(session.events.map(event => event.type)).toEqual(['hook/invoked', 'hook/result'])
  })
})
