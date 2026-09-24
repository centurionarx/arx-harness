/**
 * Shared, non-plugin hook protocol library: matching, command execution and
 * decoding, restrictive outcome merging, durable event helpers, shared bridge
 * policy and execution quiescence. Claude Code and Codex bridges own their distinct payloads,
 * environment rules, matcher mode, and typed extension-point mappings.
 * @module @arx-ai/arx-hook-protocol
 */

export type {
  CommandHook,
  HookDialect,
  HookOutput,
  MatcherGroup,
  MatcherMode,
} from './types.ts'
export { matcherDiagnostic, matchesMatcher } from './matcher.ts'
export { parseHookOutput } from './codec.ts'
export { DEFAULT_HOOK_TIMEOUT_MS, runHook } from './runner.ts'
export type { RunHookOptions, RunHookResult } from './runner.ts'
export { mergeHookOutputs, preToolDenial } from './merge.ts'
export type { MergedDecision, MergedHookOutcome, PreToolDenial } from './merge.ts'
export { appendHookInvoked, appendHookResult, DEFAULT_STDERR_SUMMARY_MAX_CHARS, summarizeStderr } from './events.ts'
export type { HookInvocation, HookResultRecord } from './events.ts'
export { createDetachedRuns } from './detached.ts'
export type { DetachedRuns } from './detached.ts'
export { createHookHandlerIds, createHookLifecycle, HOOK_POLICY_DEFAULTS, hookPolicyFields, resolveHookPolicy } from './policy.ts'
export type { HookLifecycle, HookPolicy, HookPolicyConfig, StopHookActions } from './policy.ts'
export { createHookPointRunner } from './point.ts'
export type { HookPointRequest, HookPointRunnerOptions } from './point.ts'
