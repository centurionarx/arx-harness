/**
 * Shared bridge configuration and per-owner startup/Stop policy. Owners are
 * opaque objects; bridges retain agent dispatch, payloads and message creation.
 * @module @arx-ai/arx-hook-protocol/policy
 */

import z from '@arx-ai/schemastery'
import { DEFAULT_HOOK_TIMEOUT_MS } from './runner.ts'
import { DEFAULT_STDERR_SUMMARY_MAX_CHARS } from './events.ts'
import { createDetachedRuns, type DetachedRuns } from './detached.ts'
import type { MergedHookOutcome } from './merge.ts'
import type { HookDialect } from './types.ts'

/** Deployment policy accepted by both command-hook bridges. */
export interface HookPolicyConfig {
  /** Per-command fallback timeout in milliseconds. */
  defaultTimeoutMs?: number
  /** Character bound for persisted stderr summaries. */
  stderrSummaryMaxChars?: number
  /** Stop-forced steps permitted per owner and turn; zero observes only. */
  maxStopContinuations?: number
  /** First-attempt startup or eager best-effort injection. */
  sessionStartMode?: 'blocking' | 'detached'
}

/** Fully resolved deployment policy; execution never supplies implicit defaults. */
export type HookPolicy = Required<HookPolicyConfig>

/** Shared defaults; each bridge exposes all four values through its Config schema. */
export const HOOK_POLICY_DEFAULTS: Readonly<HookPolicy> = {
  defaultTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS,
  stderrSummaryMaxChars: DEFAULT_STDERR_SUMMARY_MAX_CHARS,
  maxStopContinuations: 8,
  sessionStartMode: 'blocking',
}

/**
 * Build fresh schema fields for the policy exposed by each bridge Config.
 * @returns Schemastery fields with the shared deployment defaults.
 */
export function hookPolicyFields(): { [Key in keyof HookPolicy]: z<HookPolicy[Key]> } {
  return {
    defaultTimeoutMs: z.number().default(HOOK_POLICY_DEFAULTS.defaultTimeoutMs),
    stderrSummaryMaxChars: z.number().default(HOOK_POLICY_DEFAULTS.stderrSummaryMaxChars),
    maxStopContinuations: z.number().default(HOOK_POLICY_DEFAULTS.maxStopContinuations),
    sessionStartMode: z.union(['blocking', 'detached']).default(HOOK_POLICY_DEFAULTS.sessionStartMode),
  }
}

/**
 * Resolve and validate policy before reading a hook configuration file.
 * @param config - the bridge's optional deployment values.
 * @param name - the bridge name prefixed to configuration diagnostics.
 * @returns explicit execution policy with unchanged bridge defaults.
 */
export function resolveHookPolicy(config: HookPolicyConfig, name: string): HookPolicy {
  const policy: HookPolicy = {
    defaultTimeoutMs: config.defaultTimeoutMs ?? HOOK_POLICY_DEFAULTS.defaultTimeoutMs,
    stderrSummaryMaxChars: config.stderrSummaryMaxChars ?? HOOK_POLICY_DEFAULTS.stderrSummaryMaxChars,
    maxStopContinuations: config.maxStopContinuations ?? HOOK_POLICY_DEFAULTS.maxStopContinuations,
    sessionStartMode: config.sessionStartMode ?? HOOK_POLICY_DEFAULTS.sessionStartMode,
  }
  if (!Number.isInteger(policy.stderrSummaryMaxChars) || policy.stderrSummaryMaxChars < 1) {
    throw new Error(`${name}: stderrSummaryMaxChars must be a positive integer`)
  }
  if (!Number.isSafeInteger(policy.maxStopContinuations) || policy.maxStopContinuations < 0) {
    throw new Error(`${name}: maxStopContinuations must be a non-negative safe integer`)
  }
  return policy
}

/**
 * Create a module-lifetime handler-id sequence for a dialect.
 * @param dialect - wire identity prefixed to each id.
 * @returns a point-to-id function; each call consumes the next sequence number.
 */
export function createHookHandlerIds(dialect: HookDialect): (point: string) => string {
  let counter = 0
  return point => `${dialect}:${point}:${++counter}`
}

/** Bridge-owned effects performed only after shared Stop policy permits them. */
export interface StopHookActions {
  /**
   * Cancel the active turn for a hard-halt outcome.
   * @param reason - hook or fallback halt reason.
   */
  halt(reason: string): void
  /**
   * Enqueue a sourced message in this turn.
   * @param reason - hook or fallback steering text.
   */
  steer(reason: string): void
  /** Report an exhausted continuation allowance without injecting context. */
  limit(): void
}

/** Shared policy state, isolated by owner identity and open turn number. */
export interface HookLifecycle<Owner extends object, Source> {
  /** Whole-bridge execution and continuation quiescence. */
  readonly runs: DetachedRuns
  /**
   * Remember startup for the first claim.
   * @param owner - owning agent.
   * @param source - startup source.
   */
  start(owner: Owner, source: Source): void
  /**
   * Consume startup exactly once.
   * @param owner - owning agent.
   * @returns its source, if unconsumed.
   */
  takeStart(owner: Owner): Source | undefined
  /**
   * Forget disposed-owner state.
   * @param owner - the disposed agent.
   */
  forget(owner: Owner): void
  /**
   * Inspect this turn's forced-step state.
   * @param owner - owning agent.
   * @param turn - open turn.
   * @returns whether this bridge has forced a step.
   */
  stopActive(owner: Owner, turn: number): boolean
  /**
   * Apply cancellation, hard-halt precedence, and the continuation limit before steering.
   * @param owner - owning agent.
   * @param turn - open turn that produced the outcome.
   * @param signal - turn cancellation signal.
   * @param outcome - merged Stop result.
   * @param actions - bridge effects; a throwing steer does not consume the allowance.
   */
  settleStop(owner: Owner, turn: number, signal: AbortSignal, outcome: MergedHookOutcome, actions: StopHookActions): void
}

/**
 * Create policy state for one bridge installation.
 * @param policy - the validated, explicit deployment policy.
 * @returns startup ownership, Stop enforcement and the bridge's quiescence tracker.
 */
export function createHookLifecycle<Owner extends object, Source>(policy: HookPolicy): HookLifecycle<Owner, Source> {
  const runs = createDetachedRuns()
  const starts = new WeakMap<Owner, Source>()
  const stops = new WeakMap<Owner, { turn: number; forced: number }>()
  const stateFor = (owner: Owner, turn: number) => {
    let state = stops.get(owner)
    if (state?.turn !== turn) {
      state = { turn, forced: 0 }
      stops.set(owner, state)
    }
    return state
  }
  return {
    runs,
    start(owner, source) { starts.set(owner, source) },
    takeStart(owner) {
      const source = starts.get(owner)
      starts.delete(owner)
      return source
    },
    forget(owner) { starts.delete(owner); stops.delete(owner) },
    stopActive(owner, turn) { return stateFor(owner, turn).forced > 0 },
    settleStop(owner, turn, signal, outcome, actions) {
      if (signal.aborted || runs.signal.aborted) return
      if (outcome.stop) {
        actions.halt(outcome.stopReason ?? 'halted by Stop hook')
        return
      }
      if (outcome.decision !== 'deny') return
      const state = stateFor(owner, turn)
      if (state.forced >= policy.maxStopContinuations) {
        actions.limit()
        return
      }
      actions.steer(outcome.reason ?? 'continue: blocked by Stop hook')
      state.forced++
    },
  }
}
