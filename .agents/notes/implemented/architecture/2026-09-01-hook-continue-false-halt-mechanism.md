# Agent Note: hook continue false halt mechanism

Status: implemented

## Problem

When hook handlers in Claude Code and OpenAI Codex protocols returned `{"continue": false}`, `mergeHookOutputs` folded the outcome into `stop: true`, but the bridges recorded the stop decision in the session log without aborting the active turn. The tool execution or prompt processing continued to run, leaving deferred halts un-enforced.

## Decision

The bridges (`packages/hooks/hooks-claude-code` and `packages/hooks/hooks-codex`) now enforce run-level halts when `merged.stop` is `true`:

- In `agent/pre-step`: when `UserPromptSubmit` hooks request a halt (`merged.stop === true`), the agent is cancelled via `agent.cancel({ kind: 'hook', reason: merged.stopReason ?? 'halted by UserPromptSubmit hook' })` and the step is rejected (`{ kind: 'reject' }`).
- In `tools/pre-execute`: when `PreToolUse` hooks request a halt, the executing agent is cancelled and the tool execution is denied (`{ kind: 'deny', reason: ... }`).
- In `tools/post-execute`: when `PostToolUse` hooks request a halt, the executing agent is cancelled and the tool output is blocked.
- In `agent/session-start`: when `SessionStart` hooks request a halt, the agent is cancelled immediately.

## Consequences

- Turns interrupted by a hook halt now terminate with `turn/end` reason `{ kind: 'aborted', reason: { kind: 'hook', reason: ... } }`.
- Tool execution is prevented when `PreToolUse` halts, rather than executing to completion.
- Both Claude Code and OpenAI Codex hook bridges maintain symmetric halt behavior across extension points.
- The `TODO(hook-continue-false)` markers and associated known-limitation statements are retired.

## Alternatives considered

- **Recording only without cancelling the agent.** Rejected: this violated caller intent when external hooks explicitly returned `{"continue": false}` to halt processing.
- **Handling halt only in `agent/turn-stopping`.** Rejected: stopping only at turn boundary allowed mutating tools to execute during `PreToolUse` even after a hook requested a halt.
