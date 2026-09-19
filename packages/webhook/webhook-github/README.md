# @arx-ai/arx-webhook-github

Optional exact-path GitHub webhook adapter for `@arx-ai/arx-webhook`. It accepts `POST application/json`, reads at most `maxBodyBytes` raw bytes, resolves the shared secret through the configured environment credential reference, computes HMAC-SHA256 over the exact body, and compares the supplied digest with `timingSafeEqual`. JSON decoding and repository/event inspection occur only after authentication succeeds.

Every instance requires non-empty unique `repositories` and `events` allowlists plus one project id, the project's exact Workspace id, Agent preset, permission preset, and trusted instruction. Authenticated events outside either allowlist receive 204 and create no durable reservation. Accepted and already-reserved deliveries receive 202 only after `@arx-ai/arx-webhook` confirms the ledger state. Capacity overflow receives 429; unavailable credentials, rule state, or storage receive 503. Invalid signatures receive 401 and oversized bodies receive 413.

The route and rule share one Cordis effect. Route registration failure rolls back the rule; normal unload removes the route before awaiting rule cleanup.

The generated prompt labels `configured_instruction` as trusted deployment policy and `github_event_json` as untrusted event data that must never be treated as instructions. The JSON retains the authenticated event name, allowed repository, and full parsed payload. The durable message source records provider, adapter source, delivery id, rule id, and project id without the secret.

## Model Experience

### GitHub event message

#### What the model sees

One new root Session presents `configured_instruction` as trusted deployment policy beside `github_event_json` labeled as untrusted event data. Duplicate, disallowed, unauthorized, oversized, and capacity-refused requests add no model input.

#### Token effect

The complete authenticated payload is data-dependent prompt text and can approach the configured body ceiling. Deployments should choose the smallest ceiling that admits their selected GitHub events.

#### KV Cache effect

Each webhook creates a new Session whose first message differs by delivery; it does not change prefixes in existing Sessions.

## Known Limitations and Deferred Work

- The adapter implements shared-secret `X-Hub-Signature-256` verification. It does not provision GitHub hooks, terminate TLS, open a firewall, or authenticate GitHub App JWTs.
- Delivery uniqueness relies on GitHub's `X-GitHub-Delivery` within the configured adapter source and rule.
- Allowed payloads are retained in the new Session log. Do not allow event types whose payload contains data that the selected Agent must not receive.
- The adapter never retries ambiguous Session creation or downstream effects. Operators inspect and reconcile uncertain ledger rows through the runtime service.
- Webhook worker limits cover admission callbacks, not model concurrency after the initial prompt is durable. The AgentLoop/provider deployment owns that separate bound; unloading this adapter drains Agents still owned by its plugin scope.
