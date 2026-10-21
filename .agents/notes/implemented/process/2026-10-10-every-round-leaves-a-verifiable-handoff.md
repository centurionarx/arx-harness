# Agent Note: Every round leaves a verifiable handoff

Status: implemented

## Problem

A new developer cannot reliably recover unpublished work, evidence, remaining failures, and operating authority from a conversation or a product verdict alone. A failed round still creates information that the next round needs.

## Decision

The responsible agent updates project documentation and leaves a verifiable handoff at the end of every round, including FAIL and BLOCKED outcomes. [The round closure procedure](../../../../docs/cookbook/closing-a-round.md) owns the required actions and verification. The root agent instructions make this a standing obligation. Each phase also publishes its source and handoff with a shared system version advance through the authorized Git workflow. The [pre-push workflow](../../../skills/arx-pre-push-checks/SKILL.md) requires pertinent checks to pass before an ordinary push; a failing check leaves required publication blocked. Product acceptance also controls promotion to the default branch.

Product acceptance and documentation closure have separate results. Missing documentation prevents a round completion claim; completed documentation does not turn a failed product into a pass.

The [long-session handoff policy](2026-09-29-a-long-session-names-its-handoff-point.md) retains its session-length and chat-prompt obligations. Round documentation complements that policy rather than replacing it.

## Alternatives considered

**Only document passing rounds.** Rejected by the owner because another developer also needs the stopping point, evidence, and pending decisions from failed or blocked work.

**Only leave a chat summary.** Chat alone does not provide the project-documentation entry point required by the owner. A chat continuation prompt remains useful alongside the persistent handoff.

## Consequences

Each round records both results and preserves previous sealed evidence. The handoff identifies source versions, test limitations, remaining work, and authority without storing secrets. An interrupted transfer or required publication is recorded as incomplete. A versioned Git publication identifies the phase source independently of a private execution environment. This adds documentation work to every round while allowing another developer to resume without the previous conversation.
