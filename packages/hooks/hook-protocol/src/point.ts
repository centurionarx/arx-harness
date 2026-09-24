/**
 * Serial matcher-group execution, cancellation, audit pairing and outcome merge
 * shared by command-hook bridges. Payload construction and decisions stay local.
 * @module @arx-ai/arx-hook-protocol/point
 */

import type { Session } from '@arx-ai/arx-session'
import type { ShellExecutor } from '@arx-ai/arx-shell'
import type { HookDialect, HookOutput, MatcherGroup } from './types.ts'
import type { HookPolicy } from './policy.ts'
import type { DetachedRuns } from './detached.ts'
import { appendHookInvoked, appendHookResult } from './events.ts'
import { matchesMatcher } from './matcher.ts'
import { mergeHookOutputs, type MergedHookOutcome } from './merge.ts'
import { runHook } from './runner.ts'

/** Complete invocation data supplied by a dialect bridge. */
export interface HookPointRequest {
  /** Hook event name. */
  point: string
  /** Dialect-owned matcher subject. */
  matchQuery: string
  /** JSON stdin payload. */
  payload: unknown
  /** Owning session supplies both audit destination and command working directory. */
  session?: Session | undefined
  /** Open turn; absent for detached lifecycle invocations. */
  turn?: number | undefined
  /** Cancellation of the owning turn or detached startup. */
  signal: AbortSignal
  /** Dialect-owned trusted environment overrides. */
  env?: Record<string, string>
  /** Admit clean, unstructured stdout as context when structured context is absent. */
  plainStdoutAsContext?: boolean
}

/** Installation-scoped execution policy; no agent or loop dependency. */
export interface HookPointRunnerOptions {
  /** Parsed matcher groups indexed by hook point. */
  groups: Record<string, MatcherGroup[] | undefined>
  /** Matcher and audit dialect. */
  dialect: HookDialect
  /** Explicit timeout and summary limits from the owning bridge. */
  policy: HookPolicy
  /** Whole-bridge cancellation and quiescence. */
  runs: DetachedRuns
  /** Whether stdin JSON ends with a newline. */
  trailingNewline: boolean
  /**
   * Allocate an audit identity.
   * @param point - hook event name.
   * @returns unique handler id.
   */
  nextHandlerId(point: string): string
  /**
   * Report unsupported dialect fields before recording the outcome.
   * @param point - hook event.
   * @param output - decoded outcome.
   */
  observeOutput(point: string, output: HookOutput): void
  /**
   * Monotonic millisecond clock.
   * @returns current time.
   */
  now(): number
}

/**
 * Create a serial, audited hook runner tracked through bridge disposal.
 * @param shell - the real command execution capability.
 * @param options - parsed hooks, validated limits, dialect framing and callbacks.
 * @returns a runner that rejects cancellation before each matching command and after
 * recording a settled command result. A point with no matching command resolves with
 * an empty outcome, even after cancellation.
 */
export function createHookPointRunner(
  shell: ShellExecutor,
  options: HookPointRunnerOptions,
): (request: HookPointRequest) => Promise<MergedHookOutcome> {
  const execute = async (request: HookPointRequest): Promise<MergedHookOutcome> => {
    const { point, session, turn, signal } = request
    // Cancellation is checked per command: a point with no matching command stays
    // a no-op, so a denied tool's post-execution pass keeps the denial it carries.
    const outputs: HookOutput[] = []
    for (const group of options.groups[point] ?? []) {
      if (!matchesMatcher(group.matcher, request.matchQuery, options.dialect)) continue
      for (const hook of group.hooks) {
        signal.throwIfAborted()
        const handlerId = options.nextHandlerId(point)
        if (session && turn !== undefined) {
          appendHookInvoked(session, {
            turn, point, dialect: options.dialect, handlerId,
            ...group.matcher !== undefined ? { matcher: group.matcher } : {},
          })
        }
        const { output, durationMs } = await runHook(shell, hook, {
          payload: request.payload,
          signal,
          defaultTimeoutMs: options.policy.defaultTimeoutMs,
          trailingNewline: options.trailingNewline,
          expectedEventName: point,
          ...session?.header.cwd !== undefined ? { cwd: session.header.cwd } : {},
          ...request.env !== undefined ? { env: request.env } : {},
        }, () => options.now())
        if (request.plainStdoutAsContext === true && output.exitCode === 0
          && output.additionalContext === undefined
          && output.stdout.length > 0 && !output.stdout.startsWith('{')) {
          output.additionalContext = output.stdout
        }
        outputs.push(output)
        options.observeOutput(point, output)
        if (session && turn !== undefined) {
          appendHookResult(session, {
            turn, point, handlerId, output,
            stderrSummaryMaxChars: options.policy.stderrSummaryMaxChars, durationMs,
          })
        }
        signal.throwIfAborted()
      }
    }
    return mergeHookOutputs(outputs)
  }
  return (request) => {
    const run = execute({ ...request, signal: AbortSignal.any([request.signal, options.runs.signal]) })
    options.runs.track(run)
    return run
  }
}
