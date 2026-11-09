# Agent Note: Multi-worker routing of user-level operations is an activation blocker

Status: proposed

## Problem

The isolated project runtime sends some operations without a project or workspace scope: the mux and host event streams, `host.describe`, `workspace.list` and `session.list`. The supervisor protocol assigns one worker to each owned workspace, so a user with several workspaces has several workers. The protocol defines no worker for an unscoped user-level operation in that case. The disposable native supervisor fixture routes an unscoped request only when the user has exactly one worker and refuses it otherwise. That heuristic is a fixture limit, not the product answer, and it must not be extended to hide the case. Until the routing is defined, a user with several workers cannot reliably open event streams or list sessions, so this gap blocks activation.

The native project browser gate reaches this case: after a worker restart and page reload, a user with two workspaces gets 403 from the fixture on every reconnect of the mux stream and `host.describe`, so the step "cold restart preserves raw history and does not execute a model" stays blocked until the routing is defined.

### Findings that constrain any option

- **An unscoped lease reaches every project the user owns.** Streams are dispatched without a resource, so their lease has no scope, and the broker skips its workspace check for an unscoped lease. That lease's worker capability is accepted for `list`, `list-snapshots`, `snapshot`, `raw-page`, `append` and `allocate-fork` in any workspace of the user, and the worker rebinds its history capability on every request, streams included. The one-worker fixture heuristic hides this today. Any design that hands one unscoped capability to several project workers, or to a cross-project worker, turns it into a path between projects.
- **Stream frames are checked per user, not per project.** Control re-checks frame references against the user only, so a worker can emit frames that name another project of the same user, and pending replies are learned from those frames.
- **`host.describe` is the client's readiness handshake and is specific to one worker.** It carries the worker's `cwd`, `attachedSessions` and host `home` path; N answers have no meaningful merge, and a user with no worker cannot complete the handshake.
- **Workspace order is per-user state** (`workspace.list`, `workspace.insertBefore`, `host/workspace-order-changed`) and has no correct home in any single project worker.

Cancellation does not depend on this routing: `/_arx/operations/{id}/cancel` selects the target by the operation id in its path, as the package [README](../../../../packages/host/isolated-project-runtime/README.md) states.

### Related gap: aborted requests reach the worker API

The product worker boundary, `toOwnedWorkerFetch` in `packages/host/isolated-project-runtime/src/worker-boundary.ts`, does not check `request.signal.aborted` before dispatching to the native API. A supervisor that forwards a request after its operation was cancelled can therefore start worker work after the quiescent receipt; the native supervisor fixture refuses such requests itself. This note records the gap and does not fix it; the supervisor contract or the boundary must close it before activation.

## Proposal

No option is chosen. The owner decides before activation between the options below; an independent architect review recommends Option 3.

### Option 1: the supervisor fans in all of the user's workers

The supervisor forwards an unscoped operation to every worker assigned to the user and merges the results: it concatenates list items and multiplexes event frames into one response. Effect on isolation between projects: each worker still holds only its own workspace volume, process tree and credentials, so no worker reads another project's data. The supervisor becomes the component that combines data from several projects in one response, so its merge code joins the trusted base, and a fault there can mix frames or rows across projects before control re-checks ownership. One unscoped operation also wakes and loads every worker of the user, so one project's failure or slow start delays the merged response for all of them.

### Option 2: a dedicated per-user control worker

The supervisor assigns each user one additional worker that serves only unscoped user-level operations and holds no workspace volume. It reads metadata and events through control-brokered operations instead of mounting project data. Effect on isolation between projects: project workers stay single-project and never receive another project's requests. The control worker sees metadata for all of the user's projects by design, so it must have no workspace mount, no project tool execution and no model access, and the broker must expose only owner-filtered metadata to it. Event delivery for project activity then needs a path from each project worker to the control worker, which is new protocol surface.

### Option 3: control fans in scoped per-workspace operations

Control, which already owns leases, scopes, capabilities, cancellation receipts and tombstones, keeps one merged downlink per user stream and opens one workspace-scoped sub-stream per workspace with a live lease; `dispatch()` attaches a sub-stream for a workspace before forwarding its first request. Every lease becomes scoped, so the unscoped broker branch can be removed and each frame is checked against its sub-lease's workspace. Control answers `host.describe` itself without a worker, which also serves users with no worker and stops exposing a worker's host `home`. Unscoped listings and workspace order move to control's project index in a second step. The supervisor contract shrinks to "every worker request is workspace-scoped; unscoped requests are refused", no real supervisor implements a merge, and the GL4-08 one-operation, one-handler, one-receipt rules stay one to one. A sub-stream failure ends the whole merged downlink in the first cut, so one broken worker forces client reconnects for that user. The architect proposal receipt `GL4-PHASE8-20261109/multi-worker-routing-architect-proposal-20261109-first.md` (private state branch `auth-gl4/state-20261109`) recommends this option, details file-level changes, tests and the GL4-04 impact (none of the 16 frozen benchmark files changes), and lists open questions: workspace order storage, the version source for control's `host.describe`, and whether strict per-workspace frame checks reject legitimate cross-workspace frames.

## Alternatives considered

**Keep the fixture's one-worker heuristic in the product.** It refuses every unscoped operation for a user with two workers, so streams and listings fail exactly when users organize work into several projects. It hides the gap in tests instead of closing it.

**Require the browser to choose a workspace for every user-level operation.** Listings and the host event stream describe the user, not one workspace; forcing a scope either drops other projects from the view or turns into client-side fan-in over per-workspace calls, which moves Option 1 into the browser without a defined merge or ownership boundary.

## Acceptance criteria

The owner records the chosen option in this note before activation. The chosen routing has a native supervisor fixture that serves a user with at least two workers for event streams, `host.describe`, `workspace.list` and `session.list`, and tests prove that no frame or row of one user's project reaches another user, and that each project worker still receives only its own project's requests. Until then, acceptance text states that the multi-worker scenario for unscoped user-level operations is not covered.

## Risks

Option 1 enlarges the supervisor's trusted code and couples the latency of all of a user's projects. Option 2 adds a long-lived worker per user and a worker-to-worker event path that must itself be isolated. Option 3 enlarges the per-downlink blast radius of a missing quiescence receipt and adds one stream round trip to each workspace's first request. Every option changes the supervisor protocol, so existing supervisor deployments need an update before activation.
