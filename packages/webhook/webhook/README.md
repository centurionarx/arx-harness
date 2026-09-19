# @arx-ai/arx-webhook

Provider-neutral webhook runtime with durable delivery reservation, bounded process-local workers, and project Workspace-backed Session creation. Provider adapters register trusted rules by exact provider kind and configured source. `accept()` snapshots one verified delivery, serializes admission, checks the durable `(source, deliveryId, ruleId)` reservation, and writes `processing` before a callback can run. It returns `accepted`, `duplicate`, `overflow`, or `no-rule`; a persistence failure rejects and therefore cannot be acknowledged by an HTTP adapter.

`maxActiveWorkers` bounds rule callbacks through Session creation and durable initial-prompt admission. `maxQueuedDeliveries` bounds admitted in-memory callbacks waiting behind them. Once that prompt is durable and the ledger row is `completed`, the callback releases its worker even when the ordinary AgentLoop model turn is still running. Model concurrency therefore belongs to the AgentLoop/provider deployment and must be sized separately. A duplicate bypasses webhook capacity because its durable reservation already prevents another launch. A new delivery that would exceed the combined callback limit receives `overflow` and leaves no ledger row.

A rule may return `null`, which settles the reservation without an external action, or one `WebhookSessionRequest`. Session requests name an existing project and its exact Workspace, Agent preset, permission preset, title, and prompt, with an optional model route. The runtime verifies that the project owns the Workspace, mounts the preset before Agent publication, attaches the new Session to that Workspace, records permission and title state, queues the initial `webhook` source message, and flushes it before changing the reservation to `completed`.

Rule disposal stops new admission, waits for pending reservation writes, and settles interrupted reservations as `uncertain` before completing. A reservation whose rule unloads during its write returns `no-rule` without starting the callback. Concurrent disposal calls join the same drain; runtime unload also waits for serialized ledger operations before closing its storage domain.

The runtime does not infer that a failed or interrupted launch is safe to retry. It changes the reservation to `uncertain`; startup does the same for every row left `processing`. Signed redelivery remains a duplicate until trusted code calls `reconcile(source, deliveryId, ruleId, 'completed')` after verifying the effect, or `'release'` to permit one later authenticated delivery to reserve again. Reconciliation itself launches nothing.

## Model Experience

### Webhook-created initial message

#### What the model sees

One `user` message carries durable `webhook` provenance and the exact prompt returned by trusted rule code. Provider adapters must separate trusted instruction from untrusted event data in that prompt.

#### Token effect

One admitted Session adds its data-dependent initial prompt to that Session only. The ledger, queue, duplicates, and reconciliations add no model input.

#### KV Cache effect

The webhook prompt is the first data-dependent message in a new Session. It creates no cache invalidation in existing Sessions.

## Known Limitations and Deferred Work

- Deduplication is durable per configured storage backend, but worker coordination is process-local. Multiple processes sharing a backend are unsupported unless that backend also serializes reservation writes across processes.
- The ledger stores identity, state, project id, and resulting Session id, not the provider payload. Releasing an uncertain row therefore requires a later authenticated redelivery.
- A `completed` reservation means the initial prompt reached Session persistence. It does not mean the model completed, a pull request changed, or any other downstream effect succeeded.
- A webhook-created Agent is owned by the adapter rule's Cordis scope. Unloading that adapter aborts and drains its still-running Agents; completed Session logs remain available through persistence.
- Ledger retention is operator-managed; this release provides no automatic expiry.
