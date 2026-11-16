# Agent Note: A restarted worker takes over a session writer after the old lease is quiescent

Status: implemented

## Problem

Control records one writer per session: the worker id and the lease under which that worker last hydrated or appended the session. A request that answers while its turn still runs is non-quiescent, so control retains its lease until a supervisor cancellation. When the supervisor restarts or evicts that worker, control is not told, the retained lease stays live, and the restarted worker, which has a new worker id, is refused with "Another worker owns the session writer" when it hydrates the session. The session's history stays unreadable until the user logs out. The native project browser gate reached this after a worker restart, and any supervisor restart or idle eviction opens the same gap.

## Decision

Decided by the owner on 2026-11-09. When a different worker id asks to hydrate a session whose writer lease is still live, control treats that worker as restarted. Before entering the per-session broker queue, control applies the same scope and owner checks as the operation, cancels the old lease by its operation id through the existing cancellation protocol, and waits for the quiescent receipt, whose request is bounded by the validated `cancellationTimeoutMs`. The queued hydration then finds no live writer and records the new worker. The takeover runs before the queue so that queued broker work of the old lease can settle while control waits for its receipt.

- The same worker id never triggers the cancellation, and neither does a different worker presenting the writer lease itself, because that lease is the current operation; the core still refuses it.
- Concurrent requests share the old lease's single memoized cancellation. A request that is itself aborted stops waiting for it; the cancellation continues for the others.
- Control reads the writer again after the scope and owner checks and cancels only the writer it read before them, while the same worker id and lease are still the writer and that lease is still live. Control compares the worker id and lease, not the map entry, because every append or snapshot records the writer again. A lease that ended with a quiescent receipt during the checks, or a writer that moved to a newer lease of the same worker, receives no cancellation; the queued hydration then applies the ordinary writer rule.
- A missing or late receipt refuses the hydration, does not move the writer and closes the adapter, as every missing receipt does.
- Appending still requires a prior hydration by the same worker.

No supervisor protocol, session event or GL4-04 baseline-arm file changes.

## Alternatives considered

**The supervisor reports stopped operations to control.** It adds protocol surface that every supervisor must implement, or a heuristic such as cancelling a workspace's leases when its event stream ends, which can stop a running turn on a transient stream break.

**The test fixture cancels operations through control before restarting workers.** It makes the browser gate pass while every real restart or idle eviction still leaves history unreadable.

**Let the new worker write without cancelling the old lease.** It allows two live writers for one session when the old worker is not actually stopped; the receipt is what proves the old operation can no longer write.

## Consequences

- A worker id that differs from the recorded writer stops the old lease's operation. With one worker per workspace a new id appears only after a restart, so no running operation of the current worker is stopped.
- The handoff relies on worker ids that are never reused: the supervisor must give every worker process it starts, including a restarted or replacement process, a new id, because control detects the restart and chooses a cold hydration by comparing ids. Control does not verify this.
- `cancellationTimeoutMs` must exceed, with margin, the supervisor's bounded worker stop including its forced kill. A restart is when the supervisor is most likely still stopping the old process tree, so a shorter value turns ordinary restarts into adapter closures. The fixtures' 5000 ms is a test value; no production supervisor in this repository states a stop bound to compare it with.
- The handoff relies on the existing receipt contract: a supervisor that confirms an operation id it does not know, for example after its own restart, must ensure that no process of an earlier worker for that operation can still run.
- The old lease's capability is refused by the broker as soon as the lease is cancelled, so a surviving old worker cannot write through it. A surviving worker that still holds another live lease could hydrate again and take the writer back by cancelling the new worker's lease; this is bounded by its live leases and excluded by the receipt contract above.
- A late receipt during a restart closes the adapter for every user, as any missing receipt does; before this decision the same situation refused one session with 409. Control logs the operation id with the trigger `writer-handoff` ([diagnostic](../bug-fix/2026-11-13-isolated-runtime-adapter-closure-diagnostic.md)).
- The worker id is self-reported in the broker request, so a worker holding a live capability can make control cancel a live writer lease of its own workspace and user; the scope and owner checks run first.
- Testing: `packages/host/isolated-project-runtime/tests/writer-handoff.spec.ts` covers the receipt-gated handoff, same-worker and same-lease refusals, one cancellation for concurrent requests, no cancellation for a writer lease that ended or moved during the checks, the takeover after an append by the old worker during the checks, a missing receipt with its diagnostic, an aborted takeover request and a foreign request; `native-worker.spec.ts` reproduces the restarted native worker hydrating a session whose writer was a retained prompt lease. A keyless snapshot of history after a worker restart remains pending with the other snapshot items.
