# Agent Note: Control aggregates user-level operations across workspace workers

Status: implemented

## Problem

The supervisor protocol assigns one worker to each owned workspace, so a user with several workspaces has several workers. Some browser operations name no workspace: the mux and host event streams, `host.describe`, `session.list`, `session.search` and `workspace.list`. The disposable native supervisor fixture routes such a request only when the user has exactly one worker, so after a worker restart and reload the native project browser gate saw every mux reconnect and `host.describe` of a two-workspace user refused.

The analysis found four constraints. A lease without a scope reached the broker for every project of the user, including `append` and `allocate-fork`, and the worker rebound its history capability on every request. Stream frames were checked per user, not per workspace. `host.describe` is the client's readiness handshake and carried one worker's `cwd`, attached count and host `home`, which have no merge across workers. Workspace order is per-user state that no single project worker holds.

## Decision

Decided by the owner on 2026-11-09: control, the isolated runtime adapter, aggregates; no supervisor, fixture or benchmark merges anything.

- Control answers `host.describe` without a worker: control version, empty `cwd` and `home`, no attached sessions, `canOpenPath: false`. Users with no worker can connect, and no worker home path leaves a worker.
- Each mux or host downlink merges one workspace-scoped sub-stream per attached workspace. At open, control attaches the workspaces with a live lease of the user. Before forwarding a workspace-scoped request, `dispatch()` attaches that workspace to every open downlink of the user, within the request's own deadline and caller signal. Every frame is authorized against its sub-lease's workspace, and exposure is checked again when the frame leaves the queue, so nothing queued before quiescence or closure is published. Any sub-stream end or failure ends the whole downlink and cancels every sub-lease, each with its own receipt. Quiescence and session expiry close idle downlinks directly; attached downlinks end through their cancelled sub-leases, so a revocation error still reaches the consumer.
- The broker refuses a capability whose lease has no scope. The worker boundary binds its history capability only from workspace-scoped requests and refuses a request whose signal is already aborted.
- Unscoped `session.list`, `session.search` and `workspace.list` are answered by control: it reads the user's grouped workspaces in display order from the project index and sends one workspace-scoped request per workspace. Titles, projections, `running`, session order, search ranking and archived sessions still come from the workers; control concatenates items in workspace order, keeps search within its wire limit, and refuses the whole answer when one request fails.
- Workspace display order lives in the additive `workspace_order` table of the control project index. Control answers `workspace.insertBefore` after checking ownership of both workspaces, applies one move per user at a time and sends `host/workspace-order-changed` on the user's host downlinks; worker order frames are dropped. Archived sessions are published as the union of every workspace control has seen for the user, because each worker reports only its own.
- No session event was added, and the GL4-04 baseline-arm files are unchanged.

## Alternatives considered

**The supervisor fans in all of the user's workers.** It needs one scoped capability per target workspace, which only control can mint, so the merge adds trusted supervisor code without adding information; one operation id would cover several handlers, and one missing receipt would close the adapter for every user.

**A dedicated per-user control worker.** It needs a new metadata-only broker lease, a worker-to-worker event path that must itself be isolated, and a long-lived process per user, and it still has no better `host.describe` answer than control.

**Keep the fixture's one-worker heuristic in the product.** It refuses every unscoped operation for a user with two workers and hides the gap instead of closing it.

**Answer listings only from the project index.** The index holds no titles, projections, `running`, session order or archived sessions, so the sidebar would lose them.

## Consequences

- Every unscoped listing or search sends one request to each workspace worker of the user and wakes it, and the attached sub-streams keep those workers busy while a downlink is open. The upgrade path is control-held per-workspace summaries kept current from the downlinks.
- One broken worker ends the user's downlink and forces client reconnects. The upgrade path is to drop only that sub-stream and resynchronize.
- The first request for a workspace adds one stream round trip, and that attach shares the request's single `requestTimeoutMs` with the unary exchange.
- A downlink over N workspaces holds N sub-leases, so its end needs N cancellation receipts, sent in parallel with one `cancellationTimeoutMs` each. Any missing receipt closes the adapter for every user, so the routing multiplies the receipts that can close it.
- `skill.list`, `agentPreset.list`, `llm.providers`, `llm.models` without a session and `web.providers` remain unscoped worker requests: a supervisor routes them only for a user with one worker, and they use the worker's current scoped history capability.
- Control keeps the last known archive per workspace for each user for the process lifetime.
- Applying the `workspace_order` table to a deployed index is an operator step.
- Testing: `packages/host/isolated-project-runtime/tests/multi-workspace-routing.spec.ts` covers control answers, lazy attach, merged and dropped frames, downlink failure and closure, broker refusal, listings, search, order and archives; `idle-native-worker.host.spec.ts` covers a user with two native workers after restart; the native project browser gate asserts no refusal after the cold-restart reload; the owned-project-storage keyless snapshot records the control `host.describe` and a two-workspace downlink.
