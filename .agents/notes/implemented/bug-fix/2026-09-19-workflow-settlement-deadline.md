# Agent Note: Enforce workflow deadlines at settlement

Status: implemented

English | [Português](2026-09-19-workflow-settlement-deadline.pt-BR.md)

## Problem

A workflow can finish external work after its duration budget expires. Checking only step admission or a runner timer allows a direct domain caller to report successful run completion outside that budget.

## Decision

The project service checks the persisted deadline inside the serialized settlement mutation, after aggregate-version and child-session ownership validation. A successful step reported at or after that deadline leaves the run failed with its existing deadline error. The step retains its actual result and completion time; a reported step failure retains its own error.

This extends the enforcement described by [durable project orchestration](../feature/2026-09-12-durable-project-orchestration.md), whose aggregate, provenance, and recovery decisions remain applicable.

## Alternatives considered

- Relying on runner cancellation leaves direct and manual consumers able to bypass the duration budget.
- Rejecting settlement without persisting it leaves the run reservation active and loses a known external outcome.
- Failing or resetting a successfully completed step invites duplicate external effects after an explicit duration increase.

## Consequences

Terminal settlement releases the active reservation. An operator may increase the duration and continue pending dependencies without repeating completed steps. Domain enforcement records policy failure; it cannot undo external effects already completed by a caller.

## Verification

Real JSON-backend regressions cover successful settlement before, at, and beyond the deadline; stale-version rejection; persistence across reload; reservation release; and explicit continuation preserving completed work and dependency inputs.
