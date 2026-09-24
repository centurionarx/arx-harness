# Agent Note: Saved project step driver

Status: implemented

## Problem

The project ledger persisted workflow steps without an owner that could execute and resume pending work.

## Decision

ProjectRunner drives exact prompt revisions through the existing subagent seam. Claims commit before launch; the child session is attached before settlement. The parent and approved plan revision are pinned. Child attribution checks [direct parent lineage and canonical workspace identity](../bug-fix/2026-09-21-project-workflow-session-lineage.md), not top-level workspace membership for the child. Only local CAS writes are retried.

A driver may interrupt only work it successfully claimed. A losing concurrent invocation preserves the active owner and its recorded result.

## Consequences

Confirmed steps are skipped on restart; ambiguous effects require operator reconciliation. Deadline and launch limits are enforced, and unload aborts and awaits owned work. JSON storage tests cover restart, cancellation, duplicate drivers and parent ownership. Usage remains unknown when unmeasured.

## Alternatives considered

A new workflow language or unbounded background worker would duplicate the existing subagent runtime. Blind replay was rejected because external effects may already have occurred.
