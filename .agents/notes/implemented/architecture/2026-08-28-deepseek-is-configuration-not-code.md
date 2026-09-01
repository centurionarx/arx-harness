# Agent Note: DeepSeek is configuration, not code

Status: implemented

## Problem

Two packages existed only to speak to one vendor: `arx-llm-deepseek`, a hand-written chat-completions adapter with its own SSE framing, files API, and upload index, and `arx-web-search-deepseek`, a search provider bound to the same account. Around them the repository had grown a default naming that vendor — a shipped adapter row, a shipped default model, a shipped search provider, an onboarding dialog with a vendor-specific card, and an SDK server that mounted the adapter for any caller whose provider it did not recognize.

[Shipping no default model](2026-08-27-no-shipped-default-model.md) and shipping no provider had already removed the composition defaults. What remained was the code: a second adapter to keep correct, and a vendor name in places a deployment cannot change.

`arx-llm-pi-ai` already reaches the same endpoint. Its profile map takes catalog routes and hand-declared OpenAI-compatible gateways alike, and pi-ai ships a `deepseek` catalog route carrying the same model ids the bespoke adapter served.

## Decision

Both packages are deleted. A deployment that wants this vendor writes a profile, exactly as it does for every other provider:

```yaml
- id: llm
  name: '@arx-ai/arx-llm-pi-ai'
  config:
    providers:
      deepseek:
        apiKeyEnv: DEEPSEEK_API_KEY
```

The vendor's name survives where it names a third-party fact — a route key, a model id, an environment variable — and nowhere else. Those are not branding, and renaming them would describe an endpoint that does not exist.

The SDK server mounts nothing on a caller's behalf. `initialize` used to mount the bespoke adapter whenever the composition served no route for the requested provider, so a caller naming that one vendor received an adapter it never configured. It now refuses, because a composition serving no route for the requested provider is a misconfigured deployment.

Scenarios that drove the bespoke adapter drive a declared pi-ai route instead. Where a scenario's endpoint is its own mock server, the route is declared outright — `api`, `baseURL`, `compat`, and the model ids that scenario names — rather than inherited from a catalog describing a real provider the test never dials.

## Alternatives considered

**Keeping the adapter and removing only the defaults.** Nothing would break, and the twin-adapter comparison test would keep its second implementation. Rejected: the second adapter is a second wire-protocol implementation to keep correct, and every fix to chunk translation or reasoning effort had to land twice.

**Renaming the routes and model ids away from the vendor.** It would leave no occurrence of the name anywhere. Rejected: `deepseek-v4-pro` is the id the endpoint answers to. A route named otherwise would be a lie the deployment has to translate back.

**Re-recording the replay fixtures against another vendor.** The keyless snapshots carry the vendor's model ids in their headers. Rejected for now: re-recording needs a key for whichever vendor replaces it, and the ids in a replay fixture name a recorded conversation, not a shipped default.

## Consequences

A cleanly truncated SSE stream now completes instead of failing. The bespoke adapter reported it as `STREAM_CLOSED`, which the default retryable set excludes, so the turn ended in error; pi-ai surfaces the same truncation as a transport failure, which is retryable, so the request is reissued and the turn completes. `transport-recovery.spec.ts` pins the new behavior and names the change.

The example compositions declare the route rather than inheriting one. pi-ai ships a `deepseek` catalog key, but every scenario and recorded fixture names the route `deepseek-official`, which pi-ai does not ship — so each example profile supplies the whole provider (`api`, `baseURL`, model ids, and the `reasoningEfforts` levels a hand-declared model must name). Renaming the route instead would have invalidated the provider id recorded in every replay fixture header.

SSE comment frames no longer reset the stream idle timer. A scenario whose mock server emits keep-alive comments between chunks retried until its `streamIdleTimeoutMs` was raised above the keep-alive cadence; the bespoke adapter had counted those frames as activity.

`packages/client/ui-settings-models` still carries a vendor-specific onboarding dialog and a curated card layout keyed on the deleted namespace. They are dead paths against a namespace no composition registers; removing them is remaining work this note does not cover.

The real-API e2e scenarios still resolve `DEEPSEEK_API_KEY` through their declared route, and the `e2e` CI job still requires that secret. Pointing them at another vendor is now a configuration edit in each scenario rather than a code change, which is the point.

## Related

[No shipped default model](2026-08-27-no-shipped-default-model.md) removed the composition default whose code this note removes. [The twin LLM adapters](2026-06-13-twin-llm-adapters.md) recorded why two adapters existed; this note retires the first.
