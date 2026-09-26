# Agent Note: a Team send that meets an in-flight dispatch reports that dispatch's outcome

Status: implemented

## Problem

`TeamMailbox.tryDispatch` runs at most one dispatch per durable message in a process, and a second caller for the same message received a constant `false`. `sendMessage()` appends and flushes `team/message/queued` before it attempts delivery, and the Lead's startup recovery retries every pending message it folds from the Lead log. When that recovery ran between a send's append and the send's own dispatch attempt, recovery claimed the message and delivered it while the send reported `status: 'queued'`. The Team tool returns that receipt to the model, and the package README defines `queued` as deferred immediate delivery, so the receipt was wrong whenever recovery won. A slow flush on the native Windows CI lane produced that order in `persistence.spec.ts` ("reconciles a persisted child to active and a missing child to durable failed").

## Decision

`inFlightMessages` in [`packages/experimental/agent-team/src/mailbox.ts`](../../../../packages/experimental/agent-team/src/mailbox.ts) maps each message id to its dispatch promise, and `tryDispatch` returns that promise to a concurrent caller. A send that meets recovery's dispatch waits for it and reports `accepted` or `queued` from that delivery attempt. Recovery that meets another dispatch of the same message waits for it the same way instead of skipping the message. Delivery still runs once per message per process.

[`persistence.spec.ts`](../../../../packages/experimental/agent-team/tests/persistence.spec.ts) ("reports a message that Lead recovery dispatches before its sender as accepted") holds the Lead's active-edge commit, the send's queued-edge flush, and the recovered delivery, so recovery claims the message first on every run. The receipt must stay pending until that delivery finishes and then read `accepted`, on both persistence backends.

## Alternatives considered

**Wait in the test for Lead recovery to finish before sending.** The product publishes no event for the end of mailbox recovery, and the wrong receipt is product behavior that any caller can meet, not a test artifact.

**Let the send start a second dispatch.** Per-message exclusivity prevents concurrent delivery attempts of one message in a process; a second dispatch would race inbox acceptance against the first.

**Keep `queued` and document it.** A `queued` receipt for a message that is being delivered contradicts the documented meaning and tells the model that a delivery in progress was deferred.

## Consequences

A send that joins another dispatch waits for it under that dispatch's signals, so the sender's request signal, documented as pre-queue cancellation, does not cut that wait short. Lead recovery waits for a joined dispatch before it retries the next pending message instead of skipping it, which can delay later recoveries by one delivery. The receipt keeps its documented meaning under concurrent recovery.
