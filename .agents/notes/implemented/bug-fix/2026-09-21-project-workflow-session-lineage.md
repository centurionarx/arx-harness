# Agent Note: saved workflow children use their pinned parent lineage

Status: implemented

## Problem

A saved workflow launches a child through the ordinary in-process subagent provider. These children are not top-level workspace sessions, so requiring the child itself in the workspace session list rejects a legitimate launch after the child has already started. The model-facing manual ledger also needs a way to attribute its child before settlement can enforce provenance.

## Decision

The project service requires the run's pinned parent to remain a workspace member. The child header must name that exact parent, and both session working directories must resolve to the project's canonical directory. Attaching the child does not modify the workspace's top-level session list. Claims and settlements retain their existing version, ownership, budget, and state checks.

The project tool exposes `attach_workflow_step_session` between manual claim and settlement. Manual ledger mutations require the actual calling agent to be the original parent; a model cannot select another parent by supplying an identifier. The automatic driver follows the same child-attribution rule. These details refine the [saved-step driver](../architecture/2026-09-12-saved-project-step-driver.md) without changing its claim-before-launch or explicit-reconciliation decisions.

## Alternatives considered

**Attach every subagent as a top-level workspace session.** This changes workspace listing and ownership merely to satisfy a project-specific check. Parent lineage already supplies the relationship the workflow owns.

**Accept any session in the same directory.** A directory match alone allows an unrelated parent to provide the result. Exact parent identity is required in addition to canonical directory equality.

**Allow manual settlement without a child session.** This removes the durable evidence required of saved driver runs. An explicit attachment action completes the manual sequence while preserving the service validation.

## Consequences

An unrelated child, a different working directory, or a detached parent is rejected before attribution commits. A launch that already produced effects still needs explicit reconciliation if later attribution fails; no exactly-once guarantee is added. Version conflicts remain visible to callers.

The [application snapshots](../../../../examples/headless-agent/tests/project-workflow.snapshot.ts) exercise automatic and manual tool calls through the Loader, real project/workspace/storage services, and real in-process spawn. They assert child lineage, completion, top-level membership, and both durable transcripts after application teardown. The external model and wall clock are deterministic inputs. Package regressions separately reject foreign callers, foreign parentage, mismatched directories, duplicate attachments, and missing parent membership.
