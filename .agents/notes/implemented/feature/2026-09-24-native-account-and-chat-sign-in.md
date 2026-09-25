# Agent Note: subscription sign-in from the Models page

Status: implemented

## Problem

The Host carried subscription sign-ins that no person could reach. [`arx-llm-pi-ai`](../../../../packages/llm/llm-pi-ai/README.md) registers an authorization flow for each installed provider that ships a login, but no shipped composition mounted [`arx-authorization`](../../../../packages/credentials/authorization/README.md), no wire method carried an attempt to a browser, and no control started one; [the proposal](../../rejected/feature/2026-09-23-subscription-login-surface.md) records all three gaps.

The command-line route [made configurable from the Models page](2026-09-22-agent-cli-route-configurable-from-settings.md) had the opposite gap. It needs the vendor tool installed and signed in on the Host, and the page could only say so: it could not tell whether the tool was signed in, could not sign it in, and could not turn the account's own models into a route. Building the route by hand also meant typing a context window for every model, including canonical ids whose capacity the installed model catalog already records.

## Decision

The base bundle mounts `arx-authorization` and the new [`arx-native-accounts`](../../../../packages/credentials/native-accounts/README.md). Both are idle until a surface asks for something.

`ctx.nativeAccounts` drives the official Claude Code and Codex tools shipped as pinned package dependencies, never a binary found on `PATH`. A status read runs Claude's `auth status --json` and the Codex app-server's `account/read` and `model/list`, and returns only whether each tool is installed, its sign-in status and kind, and the models it reports; email addresses, account ids, tokens, and raw output never leave the process. A sign-in runs the tool's own login as a bounded attempt: one per tool, with a deadline and a result-retention period, identified by a private attempt id that only the starting caller holds. Cancellation, expiry, and disposal terminate the tool's process tree and wait for it. The Claude driver relays the sign-in address and the tool's `Paste code here if prompted >` prompt from its output; each driver names the exact HTTPS hosts its tool may send a person to, and the attempt manager refuses any other address. The tools remain the only writers of their credentials.

The gateway carries both conversations as the `authorization.*` and `nativeAccounts.*` wire domains, each `describe`, `begin`, `poll`, `submit`, and `cancel`. The gateway owns each attempt apart from the HTTP request that started it, returns the attempt id only to that caller, and advises the polling cadence in every progress reply. An authorization prompt carries a per-question id, so a delayed answer cannot satisfy a later question. Both domains belong to the loopback configuration plane and never reach an envelope tap. The gateway's `authorization` config section bounds attempt lifetime, retention, polling cadence, retained attempts, and answer length.

The Models page composes two child slots after its introduction. **OpenAI Codex chat models** runs the `llm-pi-ai/openai-codex` flow's `oauth` method and, once the grant is stored, sets an empty `openai-codex` profile, which keeps the adapter's catalog. **Native product accounts** shows both tools and starts their sign-in. For a Claude Code account signed in with a subscription, **Enable in chat** sets the `claude-subscription` route in `llm-agent-cli` to the account's models under their canonical ids, with the effort levels the route accepts and without a display name or capacities.

[`arx-llm-agent-cli`](../../../../packages/llm/llm-agent-cli/README.md) resolves those capacities. A model whose exact id the installed Anthropic catalog lists inherits its context window, output cap, and image input where it states none. Any other id must state its context window, and validation refuses a write that omits it, naming the route and model. The Models page editor requires no context window on a row; the adapter is the one place that decides.

## Alternatives considered

**Forwarded events per attempt, as proposed.** The proposal carried notices and prompts as forwarded Host events scoped to the attempt. Forwarded events reach every connected client, so keeping a prompt with the browser that started the attempt would need per-connection routing the event channel does not have. Polling a private capability keeps the conversation with its owner by construction. The Host-advised cadence (one second by default) is short against a device code's lifetime.

**A sign-in control on every provider row, as proposed.** The page shows one chat card, for the one flow whose route it also enables in the same step. The other registered flows keep no control on the page, which is a consequence below rather than a design choice about them.

**Driving the tools' login in a terminal handed to the browser.** The proposal deferred command-line sign-in to [`arx-terminal`](../../../../packages/terminal/terminal/README.md). A terminal shows the browser everything the tool prints. A bounded subprocess whose output the driver scans relays only the allowlisted address and the code prompt, and its lifetime belongs to the attempt.

**Reading the tools' stored credentials.** The harness would become a second store of a credential another product owns and refreshes. The account service reads status through each tool's own commands instead.

**Keeping the per-row context-window requirement in the editor.** The page would refuse routes the adapter accepts, including the route **Enable in chat** writes, and would state a rule only the adapter can apply because only the Host has the catalog.

**Discovery returning canonical ids.** Discovery still lists the tool's aliases, which follow the vendor's latest model. A person who adopts one states its context window; the account card, which enables a fixed set of models, uses canonical ids.

## Consequences

A person can now see whether each tool is signed in, sign it in from the browser, including a browser on another machine that pastes the tool's code, and turn a Claude subscription into a chat route without typing an id or a number. The OpenAI subscription reaches chat through the library route in two clicks.

Every base composition mounts two more services, and every `@arx-ai/arx` production install downloads the Claude Agent SDK and Codex wrapper that `arx-native-accounts` pins, with their platform payloads: [the provider Bundle exclusion](../simplification/2026-08-12-production-arx-excludes-product-subagent-providers.md) keeps the subagent provider Bundles out, not these runtimes. A status read starts both tools, bounded by the probe timeout; nothing starts them at mount or at save. The Claude driver depends on the pinned CLI's output: a release that changes the prompt text or the sign-in address format stops the code relay until the driver follows it. Attempts live in memory, so a restart abandons them. Native account failures reach the browser as one fixed message, and authorization refusals keep their fixed public messages.

Only the `openai-codex` flow has a card; the other flows `arx-llm-pi-ai` registers stay unreachable from the page. An alias row without a context window is refused at **Apply** by the Host's message, which names the model, instead of by the card pointing at the row. Listing a tool's models configures nothing until **Enable in chat** writes the route. Whether a subscription permits this use remains the operator's judgement, as the page and the guide say.
