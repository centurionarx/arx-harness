# Agent Note: Worker history calls carry the capability of their own request

Status: implemented

## Problem

The isolated project worker held one history capability, rebound it on every workspace-scoped request, and sent every broker call with the latest bound capability. Control refuses a capability whose lease is gone, and it deletes a lease when its request answers with a quiescent receipt. Each worker request flushes every session before it answers, and opening a session sends several workspace-scoped requests at once (blank session creation, history, command list, model list). A flush or deferred append of one request could therefore carry the capability of another request that had already answered: control refused it with 403 and the worker request answered 502. In the native identity fixture the resumed session was then unusable in its worker in about a quarter of cold opens: the seeded history did not render, or the session agent or the worker's LLM service was gone.

## Decision

Decided by the owner on 2026-11-17, in the AUTH-GL4 round.

- `OwnedWorkerPersistence.runBound(capability, scope, work)` validates and binds the capability and runs `work` in an `AsyncLocalStorage` scope. `call()` uses the scope's capability and falls back to the latest bound capability outside any bound request, such as at worker mount or for an unscoped request.
- The [worker boundary](../../../../packages/host/isolated-project-runtime/src/worker-boundary.ts) runs every workspace-scoped request through `runBound`. The request's own flush, the writes it defers, the SSE loop of a stream request (it runs in the stream's `start`) and a turn that a prompt starts continue in that scope. Control keeps those leases valid while the request runs and, after a non-quiescent answer, until it cancels the operation.
- [worker-boundary.host.spec.ts](../../../../packages/host/isolated-project-runtime/tests/worker-boundary.host.spec.ts) pauses an export's broker call while a later control request binds its capability and answers quiescent; the export answered 500 before the change and answers 200 after it.

## Alternatives considered

**Track live capabilities in the worker and use the most recent one.** The worker cannot observe when control releases a retained lease: the native test supervisor aborts a request's signal whenever its HTTP exchange closes, quiescent or not. The most recent live capability can also be released between the choice and the call.

**Hold the page's concurrent reads until the session opens.** In the native scenario the held reads then landed between the hydration and the deferred flush, and the first open failed more often.

**Let control accept a released capability from the same worker.** It weakens the lease rule that makes cancellation and revocation final.

## Consequences

- A broker call outside any bound request still carries the latest bound capability, and control refuses it when that request already answered quiescent; a refused deferred write stays queued for the next flush.
- The session writer is the lease of the request whose write went last. After a completed turn this is often a request lease that ended before a restart, so the [restarted-worker writer handoff](../architecture/2026-11-09-restarted-worker-writer-handoff.md) is needed only when a retained lease, such as a turn still running, made the last write. Native browser scenarios that restart after a completed turn do not exercise the handoff; writer-handoff.spec.ts covers it.
