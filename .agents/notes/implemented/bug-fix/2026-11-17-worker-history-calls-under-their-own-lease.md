# Agent Note: Worker history calls carry the capability of their own request

Status: implemented

## Problem

The isolated project worker held one history capability, rebound it on every workspace-scoped request, and sent every broker call with the latest bound capability. Control refuses a capability whose lease is gone, and it deletes a lease when its request answers with a quiescent receipt. Each worker request flushes every session before it answers, and opening a session sends several workspace-scoped requests at once (blank session creation, history, command list, model list). A flush or deferred append of one request could therefore carry the capability of another request that had already answered: control refused it with 403, the worker request failed and the page's request answered 502. In the native identity fixture the resumed session was then unusable in its worker in about a quarter of cold opens: the seeded history did not render, or the session agent or the worker's LLM service was gone.

## Decision

Decided by the owner on 2026-11-17.

- `OwnedWorkerPersistence.runBound(capability, scope, work)` validates and binds the capability and runs `work` in an `AsyncLocalStorage` scope. `call()` uses the scope's capability and falls back to the latest bound capability outside any bound request, such as at worker mount or for an unscoped request.
- The [worker boundary](../../../../packages/host/isolated-project-runtime/src/worker-boundary.ts) runs every workspace-scoped request through `runBound`. Broker calls the request makes, the SSE loop of a stream request (it runs in the stream's `start`) and a turn that a prompt starts continue in that scope. Control keeps those leases valid while the request runs and, after a non-quiescent answer, until it cancels the operation.
- The session write-behind lets a request join a flush barrier that another request opened, and the barrier's writes carry the opener's capability. When control refuses that barrier's capability (403, a `WorkerHistoryRefusal`), for instance because it cancelled the opener's stream lease on a page reload, a caller whose own operation is still live flushes the session once more under its own capability; the failed batch is still queued, so the second flush writes it. Any other failure, such as a failed durable append, still fails the request and withholds its receipt. A caller whose operation was cancelled, which the supervisor signals by aborting the operation's request, propagates the failure instead, so it never opens a barrier under its released lease.
- [worker-boundary.host.spec.ts](../../../../packages/host/isolated-project-runtime/tests/worker-boundary.host.spec.ts) pauses an export's broker call while a later control request binds its capability and answers quiescent; the export answered 500 before the change and answers 200 after it. Two more cases fail the first append of a flush: a live request answers 200 and the event is stored; a request whose operation is cancelled meanwhile rejects, and the next live request stores the event.

## Alternatives considered

**Track live capabilities in the worker and use the most recent one.** The worker cannot observe when control releases a retained lease: the native test supervisor aborts a request's signal whenever its HTTP exchange closes, quiescent or not. The most recent live capability can also be released between the choice and the call.

**Hold the page's concurrent reads until the session opens.** In the native scenario the held reads then landed between the hydration and the deferred flush, and the first open failed more often.

**Let control accept a released capability from the same worker.** It weakens the lease rule that makes cancellation and revocation final.

**Give each request its own flush barrier.** The session write-behind owns the barrier and is shared persistence code outside this package.

**Flush again after any failure.** A failed durable append must withhold the request's receipt (native-worker.spec.ts); a retry would hide it.

## Consequences

- A broker call outside any bound request, or a write in a batch or loop that another request started, carries a capability other than the caller's own, and control refuses it when that lease has ended; a refused write stays queued for the next flush. A lazily started shared loop, such as a goal round driver, keeps the capability of the request that started it.
- The session writer is the lease of the session's last hydration or append. After a completed turn this can be a request lease that ended before a restart, and then the [restarted-worker writer handoff](../architecture/2026-11-09-restarted-worker-writer-handoff.md) is not needed; it is needed when a retained lease, such as a prompt's, made the last write. A native browser scenario that restarts after a completed turn does not prove the handoff; writer-handoff.spec.ts covers it.
