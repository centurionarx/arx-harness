# Agent Note: Wait for durable settlement turns in ACP snapshots

Status: implemented

English | [Português](2026-09-19-acp-durable-settlement-wait.pt-BR.md)

## Problem

A background child's settlement can open and close the parent's second turn between persistence polls. Waiting for that turn to remain open misses completed work and times out even though its transcript is durable.

## Decision

The [snapshot harness](../../../../packages/test-support/acp-snapshot/src/harness.ts) accepts `minimumTurn` on `waitForTurnEnd`. It requires both a closed latest turn and a persisted closing record for the requested turn. The [continuable inheritance fixture](../../../../examples/acp-agent/tests/snapshots/subagent-continuable-inheritance/input.json) waits for closed turn 2 directly. `waitForTurnStart` keeps its open-turn semantics for cancellation synchronization.

## Alternatives considered

**Increase the timeout.** A completed turn never becomes open again, so waiting longer cannot repair the missed observation.

**Accept any closed turn.** The parent's first turn can close before the background result arrives, allowing harvest before the asserted settlement.

## Consequences

The fixture accepts already completed settlement while rejecting an earlier closed turn. Transcript comparisons, the 30-second default timeout, cancellation readiness, and runtime disposal behavior remain unchanged.
