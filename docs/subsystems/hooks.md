# Hook protocol and bridge lifecycle

The [hook protocol library](../../packages/hooks/hook-protocol/README.md) supplies dialect-neutral execution and ownership primitives. The [Claude Code](../../packages/hooks/hooks-claude-code/README.md) and [Codex](../../packages/hooks/hooks-codex/README.md) bridges construct their own stdin payloads and environment, then map outcomes to typed interception decisions. None of these helpers changes the agent loop or registers a plugin by itself.

## Shared deployment policy

`HookPolicyConfig` contains optional `defaultTimeoutMs`, `stderrSummaryMaxChars`, `maxStopContinuations` and `sessionStartMode` fields. `HookPolicy` requires all four. `HOOK_POLICY_DEFAULTS` supplies the common values; `hookPolicyFields()` creates fresh Schemastery fields for each bridge Config. `resolveHookPolicy(config, name)` resolves omitted values and rejects non-positive summary bounds or continuation limits that are not non-negative safe integers before hook-file loading can hide a configuration error.

## Owner state and Stop enforcement

`createHookLifecycle<Owner, Source>(policy)` returns `HookLifecycle<Owner, Source>`. The owner is an opaque object, not an agent service dependency. `start` retains a startup source, `takeStart` consumes it once, and `forget` releases disposed-owner state. Its `runs` tracker is drained by the bridge's disposal effect.

`stopActive(owner, turn)` reports whether a bridge forced a step in that owner's current turn. `settleStop(owner, turn, signal, outcome, actions)` checks turn and bridge cancellation, gives hard halt precedence, and enforces the continuation limit before calling the `StopHookActions.steer` callback. An exhausted limit calls `limit` without steering. The counter advances only when steering succeeds; a new turn gets an independent allowance. Bridges create the sourced model message and provide their own warning text.

## Serial point execution

`createHookPointRunner(shell, options)` accepts `HookPointRunnerOptions`: parsed matcher groups, dialect, explicit policy, quiescence tracker, newline framing, handler-id allocation, output observation and a monotonic clock. `createHookHandlerIds(dialect)` creates the module-lifetime sequence the bridges use to correlate audit events.

Each call receives `HookPointRequest` with a point, matcher subject, JSON payload and cancellation signal. An optional session supplies the command working directory and audit destination; a supplied open turn enables `hook/invoked` / `hook/result` records. Trusted environment overrides and clean-stdout context conversion are explicit request options. Without a turn, execution remains unlogged even when a session exists.

The runner combines operation and bridge cancellation, tracks the full point execution, selects groups, and awaits matching commands serially. Clean unstructured stdout becomes context only when requested and structured context is absent. Unsupported-field observation occurs before recording the result. After a settled command's result is recorded, cancellation rejects the point without starting another command. Otherwise the runner returns the most restrictive merged outcome. Payload construction, agent dispatch, startup injection, tool decisions and model-message creation stay in the bridges.

The [lifecycle decision](../../.agents/notes/implemented/bug-fix/2026-09-21-preset-and-hook-lifecycle.md) records ownership trade-offs; the [session reference](session.md) owns durable event relationships.
