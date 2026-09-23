# Agent Note: sign in to a subscription provider from the Models page

Status: proposed

## Problem

A subscription sign-in exists in the Host and no person can reach it. [`arx-llm-pi-ai`](../../../../packages/llm/llm-pi-ai/README.md) registers one authorization flow per installed provider that ships a login (`registerPiAiFlows` in `src/login.ts`); in pi-ai 0.82.1 seven of them offer a subscription login — `anthropic` ("Anthropic (Claude Pro/Max)"), `openai-codex`, `github-copilot`, `xai`, `openrouter`, `kimi-coding`, and `radius`. Three gaps stand between those flows and a user:

- **Nothing mounts the seam.** `registerPiAiFlows` runs inside `ctx.inject(['authorization'], …)`, and no shipped composition — base, headless, web-app — mounts [`arx-authorization`](../../../../packages/credentials/authorization/README.md). The flows are never registered outside tests.
- **Nothing carries the conversation.** An attempt talks to the human through `AuthorizationSession.notify` and `prompt`. No wire method starts an attempt, relays its notices and prompts to a browser, or returns the answers; [the credential-records note](../../implemented/architecture/2026-08-13-credential-records-and-authorization-flows.md) records this surface as not yet built.
- **Nothing starts it.** The Models page stores keys and configures routes; it has no control that begins a sign-in, and a provider whose only method is a subscription login, such as `openai-codex`, cannot be made usable from it at all.

The one subscription route a person can configure today is the command-line route [made configurable from the Models page](../../implemented/feature/2026-09-22-agent-cli-route-configurable-from-settings.md), and it needs the vendor tool installed and signed in on the host beforehand, which the page can only describe.

## Proposal

Three changes, landing in this order because each is useless without the one before it.

**1. Mount the seam.** Add `arx-authorization` to the base bundle, so every composition that mounts `llm-pi-ai` registers its flows. The seam holds no state until an attempt starts, so mounting it changes nothing for a user who never signs in.

**2. A wire contract for one attempt.** `host/apiproxy` gains an `authorization` domain, loopback-only like the credential writes it leads to:

- `authorization.flows` lists the registered flows: credential key, label, and methods.
- `authorization.start` begins an attempt for one key and method and returns an attempt id.
- Each notice and prompt travels as a forwarded Host event scoped to the attempt (`authorization/notice`, `authorization/prompt`), carrying the prompt kind and any URL or device code as fields, never as text to parse.
- `authorization.answer` resolves the attempt's pending prompt; `authorization.cancel` aborts it through the session's `AbortSignal`.
- The attempt settles with an event carrying success, or a failure code from a closed set: declined, cancelled, expired, failed.

The browser that started an attempt is the only one that receives its prompts, keeping the seam's rule that the interaction travels with the request. Reloading mid-attempt abandons it, as the seam's README already states.

**3. A sign-in control on the Models page.** A provider row whose flow offers a subscription method shows **Sign in** beside the key field, labelled with the method's own label (pi-ai supplies "Sign in with …"). The control opens a dialog that renders notices, links, device codes, and text prompts from the events above, and closes on settlement. A provider whose only method is a subscription login gets the control instead of a key field. Signing out stays `deleteRecord`.

The command-line route gains no sign-in of its own in this change. Driving the vendor tool's login from the Host needs a terminal the Host can hand to a browser, which is `arx-terminal`'s job, and a flow registered for the `llm-agent-cli` namespace could start that tool in a persistent terminal session. That is a separate proposal once the three changes above exist to carry it.

## Alternatives considered

**Show the flows only in the CLI.** The terminal already holds a person and can prompt them, but the Web GUI is where providers are configured, and a sign-in that exists only in a second surface repeats the problem this note describes.

**Poll for prompts instead of forwarding events.** Simpler to route, and it adds latency to a device-code grant, whose code expires, while every other live Host state already reaches the browser as a forwarded event.

**Run the login in the browser.** Some providers' OAuth pages could redirect to the Web GUI directly, but the credential must land in the Host's store, and pi-ai is the single writer of that record. Running the exchange in the browser would make the client a second writer and expose tokens to the page.

**Mount the seam only in the web-app bundle.** It would keep headless deployments unchanged, but the flows serve any surface that can carry a conversation, and the seam costs nothing while idle.

## Acceptance criteria

- A shipped composition registers every flow `llm-pi-ai` offers, proved by a real-composition test listing them through `authorization.flows`.
- A web e2e signs in to a provider whose login is scripted by a fixture flow, through notice, prompt, answer, and settlement, and the provider's row turns usable with no key typed. Its golden covers the dialog.
- Cancelling, a declined prompt, and an expired attempt each settle with their own code, and none leaves a credential record behind.
- A non-loopback browser can neither list flows nor start an attempt.

## Risks

- **Subscription terms.** Signing a harness in with a consumer subscription may fall outside that subscription's terms; the dialog carries the same warning the command-line route's card does, and the choice stays the operator's.
- **Library churn.** The flows come from pi-ai, whose login events have changed shape between releases; the translation in `login.ts` is the one place that absorbs that, and a release that drops a provider's login removes its control.
- **An abandoned attempt.** Because an attempt is not durable, a reload loses it, and a provider that consumed a one-time code mid-flow may need a fresh sign-in.
- **What this gives up.** Signing out never tells the issuer, so a revoked subscription session stays revoked only locally until the provider expires it.
