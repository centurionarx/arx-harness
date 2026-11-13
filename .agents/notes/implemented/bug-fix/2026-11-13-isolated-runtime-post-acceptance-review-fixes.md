# Agent Note: Isolated runtime fixes after the multi-worker acceptance reviews

Status: implemented

## Problem

The independent code and design reviews of the multi-worker routing and the writer handoff left four runtime defects in the isolated project runtime and project storage, and two defects in the native test supervisor.

- The adapter closes permanently when a cancellation receipt is missing, and nothing recorded which operation or which cancellation closed it.
- A hydration request waiting for the old writer's cancellation kept waiting after its own request was aborted.
- A sub-stream pump that was filtering an archive union while its downlink closed queued the frame on a queue that no consumer reads again, and never finished.
- `workspaceOrder` read the stored order with `JSON.parse(...) as string[]`. A non-array value failed with an unrelated `TypeError`, and non-string entries were ignored without an error.
- The native test supervisor stopped a worker with no deadline, and it confirmed an operation of a worker that was still stopping when another cancellation had started that stop.

## Decision

The owner authorized these fixes on 2026-11-13. They keep the missing-receipt rule: a missing receipt still closes the adapter for every user.

- `cancel()` receives the trigger of the cancellation. When the receipt is missing and the adapter was still open, control logs one error through `ctx.logger` with the operation id, the trigger and the cause. The first cancellation of a lease decides its trigger, because later callers share the memoized cancellation. The triggers are `authority-invalidated`, `ownership-deleted`, `session-expired`, `disposal`, `quiesce-call`, `writer-handoff`, `request-ended` and `downlink-closed`.
- `releaseStaleWriter` races the shared cancellation against the requester's signal.
- The pump checks the downlink signal again immediately before it queues a frame.
- `workspaceOrder` accepts only a JSON array of strings and otherwise throws `corrupt project storage workspace order`; `moveWorkspace` fails the same way because it reads the current order first.
- The native test supervisor accepts `stopTimeoutMs`. At the deadline it detaches the worker, counts a forced stop and issues the receipt, and the abandoned disposal continues until the fixture closes. The option is off unless a test sets it. A cancellation for an operation that a running worker stop already aborted waits for that stop.

## Alternatives considered

**A session event for the adapter closure.** The closure is not tied to one session and is not model-visible, and a session log is not where an operator looks for a closed adapter.

**Log every missing receipt instead of the first.** Later missing receipts do not change the adapter state, and one downlink end can produce one per attached workspace.

**Bound the waits for the cancelled lease's handler and broker work.** A deadline needs a rule for what happens when it passes: closing the adapter extends the missing-receipt rule to local work, and releasing the lease reports quiescence while local work may still run. Neither is decided, so those waits stay unbounded and the runtime README lists the limitation.

**Validate the stored order with the configuration schema library.** Its array schema accepts `null` as an empty array and keeps `null` entries, so it would accept corrupt values.

**Enable the stop deadline for every native fixture.** A forced stop in this fixture cannot kill the in-process worker, so enabling it for the browser gates would let a worker that did not stop pass as quiescent.

## Consequences

- An operator can tell from one log line which operation and which cancellation closed the adapter. The line is not durable beyond the configured log exporters.
- A corrupt `workspace_order` row now fails unscoped listings and workspace moves for that user until an operator repairs the row; before, the stored order was partly or wholly ignored.
- An aborted takeover request returns at once; it no longer holds its broker task for up to `cancellationTimeoutMs`.
- The receipt deadline and the supervisor stop bound remain an operator obligation that control does not check.
- Testing: `writer-handoff.spec.ts`, `runtime.spec.ts` and `multi-workspace-routing.spec.ts` assert the diagnostic for three triggers, the aborted takeover and the closed-downlink frame; `workspace-order.spec.ts` covers five corrupt stored values; `native-supervisor-stop.host.spec.ts` covers the receipt after a sibling's worker stop, the forced stop at the deadline and a receipt later than `cancellationTimeoutMs`. Five fixture-heavy specs and the new native spec create the identity fixture once per file and copy it for each test.
