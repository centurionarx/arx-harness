# Agent Note: Native worker metadata uses one authorized source scan

Status: proposed

## Problem

An isolated worker lists a source revision for every materialized session. Resolving each revision through the control provider's global metadata list makes bootstrap work grow with both the workspace size and total store size. A two-user fixture with one thousand logs each reaches the existing five-second dispatch deadline before publishing the native session. Cancellation also exposes a later flush attempt after the worker services have been disposed.

## Proposal

Expose `SessionPersistence.readRevision(id, signal?)` as a non-mutating source observation. Its concrete metadata-list fallback retains compatibility with third-party providers; first-party JSONL, SQLite and worker overrides delegate to the existing physical revision functions. Keep the complete snapshot read and source revision checks on both sides of it.

The private worker-history `list-snapshots` operation returns one control-provider metadata scan filtered through current workspace/session ownership and indexed membership. Each result carries the provider's actual source-qualified revision. The worker maps this receipt to the existing headers and snapshots. The index contributes membership candidates and original registered metadata; it cannot issue revisions or authorize a caller.

## Alternatives considered

Increasing the dispatch deadline conceals avoidable repeated work and changes an existing acceptance constraint. Caching revisions in the index loses physical source identity and freshness. Reading only an event prefix during resume weakens complete-log validation. These alternatives are excluded.

## Acceptance criteria

The real two-user, two-thousand-session bootstrap completes under the unchanged five-second dispatch limit with bounded metadata scan counts. Per-id source revisions match existing backend revisions and change after durable append. Foreign owners, deleted resources, malformed private RPCs and cancellation publish no authorized receipt. Existing JSONL/SQLite event, repair, fork, export, replay and durable-append assertions pass unchanged. The benchmark still records every required sample and reports regression or durability blockers independently.

## Risks

JSONL id lookup still traverses configured project directories. Whole-workspace metadata remains proportional to its materialized headers and performs current ownership checks for each candidate. A metadata observation does not replace full-log integrity checks or production worker isolation. The existing filesystem atomic-write directory-sync limitation remains an acceptance blocker.
