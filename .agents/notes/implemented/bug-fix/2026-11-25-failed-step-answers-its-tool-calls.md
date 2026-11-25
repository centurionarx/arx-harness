# Agent Note: A failed step answers every tool call it requested

Status: implemented

## Problem

The tool-call scheduler turns every expected tool failure into a result, but an internal failure, such as a rejected scheduler stage or a refused `session.append`, stops new dispatches, drains started ones, and rethrows. The step then wrote `step/end` and the turn wrote `turn/end { kind: 'error' }` while the assistant message still held calls without a `tool/result`. Load-time [crash repair](2026-07-21-semantic-session-checkpoints.md) closes only an open trailing turn, so the unanswered calls stayed in the log for good, and every later request replayed an assistant message with calls that had no result.

Providers that require each call to be answered reject such a request. The `llm-pi-ai` transport hides that: its message transform inserts an unlogged `No result provided` error result for each unanswered call. The model was therefore told that a call failed when its body may have run and changed external state, which invites a blind retry of a side-effecting operation, and the request content was no longer reconstructable from the session log. The session invariant cleared its pending calls at `step/end` without reporting them.

## Decision

- When a step body throws, `ReactLoopAgent` in [agent.ts](../../../../packages/core/agent-loop/src/agent.ts) appends a recovery `tool/result` for each model call of the step that has no result, then writes `step/end`. It takes those results from `interruptedTurnClosers(session.events)`, which the session package already exports, and appends only its `tool/result` events; the live turn writes its own `step/end` and `turn/end`. A call with a recorded `tool/call` receives `TOOL_OUTCOME_UNKNOWN` and cites that event; a call never recorded receives `TOOL_NOT_STARTED`. Both texts are the crash-repair texts in the [session README](../../../../packages/core/session/README.md#crash-repair-result).
- A dispatch that settled but was not committed also receives `TOOL_OUTCOME_UNKNOWN`: its post-execute policy and content finalization never ran, so its raw result is not safe to show.
- When appending a recovery result fails, the agent logs a warning that names both failures and rethrows the step's own failure; the step then closes without the results. A composition that mounts the session invariant refuses that `step/end`, and the invariant failure becomes the turn outcome.
- The scheduler in [tool-calls.ts](../../../../packages/core/agent-loop/src/tool-calls.ts) still commits no result after an internal failure; the step boundary owns recovery, so a failure anywhere in the step body is covered, including one outside the scheduler.
- The [session invariant](../../../../packages/core/session/src/invariant.ts) tracks each call of the open step from its assistant message through `tool/call` to `tool/result` and fails an appended `step/end` while any call is unanswered. Seeded history, including a session that existed before the companion loaded, is exempt from that check. A `tool/result` still requires a recorded `tool/call` unless it carries `TOOL_NOT_STARTED`.
- No event type or payload changes. [tool-calls.spec.ts](../../../../packages/core/agent-loop/tests/tool-calls.spec.ts) covers recorded and unrecorded calls, the next request pairing every call, and a refused recovery append; [invariant.spec.ts](../../../../packages/core/session/tests/invariant.spec.ts) covers the stricter `step/end` and seeded history. The keyless `failed-step-recovery` scenarios in [headless-agent](../../../../examples/headless-agent/tests/headless.snapshot.ts) and the [TypeScript SDK suite](../../../../examples/jsonrpc-agent/tests/sdk.snapshot.ts) fail the first scheduler dispatch through a real Loader composition; the headless one also checks that the next request carries both recovery results.

## Alternatives considered

**Commit recovery results inside the scheduler.** The scheduler knows which calls it started, but calls of a later exclusive group belong to `executeToolCalls`, and a failure outside the scheduler would still close the step unanswered. The step boundary sees every call the assistant message requested.

**Export a separate recovery-result builder from the session package.** It would add a public session export whose only caller is AgentLoop, while `interruptedTurnClosers` already derives the exact results for an open turn.

**Reclassify the failure as `ABORTED`.** The [parallel scheduler note](../feature/2026-07-10-parallel-tool-call-execution.md) rejects it because the loop cannot know whether a rejected dispatch ran the tool body. `TOOL_OUTCOME_UNKNOWN` claims neither outcome and tells the model to verify external state before retrying side-effecting work.

**Commit the settled raw result of a drained dispatch.** It would skip post-execute policy and definition-owned content finalization, which can redact or deny output.

**Validate seeded history with the same check.** Compositions that mount invariants, such as `agent-spine-demo` in the examples and the Python SDK runtime, would refuse to resume, fork, or replay a session written by an earlier release, and no repair exists for a closed turn.

**Repair closed turns at load.** The log is append-only, so a result appended after `turn/end` cannot precede the next user message in the derived history; repairing it would need a surface rewrite in the persistence coordinator.

## Consequences

- A failed step leaves a valid model history: each later request carries a logged result for every call, on every transport.
- The session invariant rejects an appended `step/end` with an unanswered call, so a regression in the loop fails wherever invariants are mounted. Seeded history is not checked for this, so a session written by an earlier release still opens, resumes, and forks there; [invariant.spec.ts](../../../../packages/core/session/tests/invariant.spec.ts) seeds such a log.
- Logs written before this change keep their unanswered calls; the `llm-pi-ai` transport still sends its unlogged `No result provided` result for them ([Known Limitations](../../../../packages/core/agent-loop/README.md#known-limitations-and-deferred-work)).
- The recovery reads the whole session log once, only when a step fails.
