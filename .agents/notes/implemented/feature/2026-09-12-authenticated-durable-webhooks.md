# Agent Note: Authenticated webhook admission with durable deduplication

Status: implemented

## Problem

An external webhook can arrive more than once, exceed local work capacity, contain attacker-controlled instructions, or reach a process that crashes after starting an Agent. Returning success before recording delivery identity loses deduplication, while replaying an interrupted launch can duplicate unknown repository or network effects.

## Decision

`@arx-ai/arx-webhook` owns a provider-neutral rule registry, a storage-domain delivery ledger, and a bounded process-local worker queue. Admission is serialized. One SHA-256 key covers the configured source, provider delivery id, and rule id. A new delivery writes `processing` durably before entering the queue; an existing row is a duplicate, and a full worker-plus-queue budget refuses the delivery without a write. Successful no-op rules and Session prompt persistence change the row to `completed`. The webhook worker is then released; a model turn that continues after prompt persistence is governed by AgentLoop and provider concurrency, outside the webhook worker count.

Worker failure, rule disposal, and shutdown change an admitted row to `uncertain`. Rule disposal joins in-flight reservation writes and concurrent disposal calls; an interrupted reservation returns `no-rule` without starting its callback. Runtime drain and domain closure share one async effect because distinct Cordis effects may unload concurrently. Startup changes every remaining `processing` row to `uncertain` before accepting work. The runtime never retries those rows. Trusted code explicitly reconciles a verified effect as completed or releases the reservation so a later authenticated provider redelivery can reserve it again.

A Session request names one existing project and its exact Workspace, preset, permission preset, title, prompt, and optional model. Creation verifies the project-to-Workspace relationship, composes the preset before Agent publication, attaches the Session, writes its permission and title events, queues a webhook-provenance user message, and flushes that message before completion is recorded.

`@arx-ai/arx-webhook-github` owns one exact HTTP route. A generator effect yields the rule disposer before registering the route, so route registration failure rolls back and drains the rule; normal disposal removes the route before draining the rule. It caps raw bytes, resolves an environment credential for each request, computes HMAC-SHA256 over the raw body, uses `timingSafeEqual`, and parses JSON only after authentication. Non-empty repository and event allowlists are mandatory. The rule prompt labels the configured instruction as trusted policy and the authenticated payload as untrusted data.

The implementation adapts the provider-neutral registration, bounded-body, and Workspace-backed Session seams from `deepseek-ai/deepseek-harness` snapshot `c291e7961a515f6d7af9304e7fd1d257929aef26`. This version adds durable reservation, capacity refusal, project identity, conservative restart recovery, and explicit reconciliation required by the arx orchestration plan.

## Alternatives considered

- In-memory delivery ids would forget duplicates at restart.
- A 202 response before storage commit would tell GitHub the delivery was retained when it was not.
- Automatic retry of `processing` work after restart could duplicate a Session or later side effect whose outcome was not recorded.
- Parsing before signature verification would spend parser work and inspect attacker-controlled data before authentication.
- Putting the shared secret directly in plugin config would expose it to Loader and configuration surfaces.

## Consequences

- HTTP 202 means the exact rule delivery already has a durable reservation. It does not mean the Agent or downstream work completed.
- Duplicate requests never add workers or Sessions. Capacity overflow returns 429 and leaves no reservation, allowing GitHub or an operator to retry later.
- The queue is deliberately not durable. Its durable `processing` reservation becomes `uncertain` after interruption and waits for reconciliation.
- Worker and queue ceilings bound rule callbacks through initial-prompt persistence. They do not bound model turns after admission. The adapter's Cordis scope owns the Agents it creates, so adapter unload aborts and drains its still-running Agents while their Session logs remain durable.
- The complete allowed payload enters the new Session prompt and consumes tokens up to the configured raw-body ceiling.
- No default Web composition exposes the route. The example is an explicit patch and leaves TLS, firewall, GitHub hook provisioning, and external reachability to deployment infrastructure.

## Verification

Focused tests boot the real Node WebServer and JSON storage backend. They send signed HTTP requests and prove one bound Session launch across duplicate delivery, 401 before malformed JSON parsing, 413 before reservation, 429 with no overflow row, and 503 when reservation persistence fails. Failure-injection tests hold a reservation write across rule and runtime unload and prove cleanup cannot settle early, no callback launches, and the row becomes `uncertain`. A route-conflict regression proves asynchronous rule rollback stays owned until it drains. Storage tests prove the ledger is already `processing` while a worker is blocked, capacity accounting, one callback for a duplicate, startup conversion to `uncertain`, and explicit completion reconciliation. A composition integration test mounts the real Loader, AgentLoop with a deterministic local adapter, JSONL persistence, Workspace registry, project service, Agent preset, permission preset, session title, local credential provider, webhook runtime, and Node WebServer. It proves signed HTTP creates one preset-composed persisted Session, restart preserves the ledger and JSONL log without a second Agent or model request, and unloading the GitHub adapter drains a still-running model stream.
