# Agent Note: Navigate the complete session by turn

Status: implemented

English | [Português](2026-09-12-whole-session-turn-outline.pt-BR.md)

## Problem

Paged conversation history does not expose an index of early requests, and sending the complete index on every update would grow browser messages and rendering without a bound.

## Decision

The optional [turn outline projection](../../../../packages/session/session-turn-outline/README.md) indexes durable turn boundaries and the first nonempty direct user text. Its host fold is independent of the browser's paged history and the model's compacted context. Immutable chunks of at most 256 entries bound each update's copy work; previously published states and pages retain their identities and contents. Forks retain inherited entries and append their own turns. The projection registry validates and distributes the index without creating new model input.

The optional [outline view](../../../../packages/client/ui-turn-outline/README.md) consumes the standard projection hook. The conversation view owner supplies bounded reveal and cancellation callbacks; the outline does not import Chat components or inspect another plugin's DOM. The owner resolves an exact turn boundary and a visible row through the existing location index, paging serially with a 20-page ceiling and refusing non-progress. Its session-scoped viewing store carries the one-shot row target. Chat owns scrolling and acknowledgement.

## Consequences

Users can locate an early request without manually loading every history page first. Navigation cancellation invalidates the pending reveal; it does not abort a history request already owned by the runtime. Missing history, changed sessions, and text-free turns without visible rows produce a refusal rather than opening a neighboring turn.

Loader composition and replay/fork tests pin complete-log coordinates and no log mutation. Component tests pin full-index search, navigation failure, unmount cancellation, exact row scrolling, target clearing, and remount position. The host index retains one entry per turn and a 120-code-point excerpt. Projection updates and authenticated search responses carry at most 100 turns; the UI replaces pages rather than appending an unbounded list.

## Alternatives considered

A truncated host index would lose access to early turns. An unbounded browser projection or virtualized list would still carry the complete index over the wire. Bounded pages preserve complete history while limiting each response and rendered list.
