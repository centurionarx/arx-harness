# Agent Note: a subscription-authenticated vendor CLI as a model route

Status: implemented

English | [中文](2026-08-26-vendor-cli-as-model-route.zh.md)

## Problem

Every shipped model route reaches a provider over HTTP with an API key. A user already paying for a product subscription could not use this harness without buying API access separately.

The obvious readings of "without an API key" do not survive contact with the code. A web chat UI exposes no function calling, so an adapter driving one would need prompt-level tool-call emulation that exists nowhere in this repository — and without tool calls the harness executes nothing, which is the whole product. A local OpenAI-compatible server needs no *paid* key but still needs a credential reference, which [the provider guide](../../../../docs/user/guide/providers.md) now documents.

What does authenticate by subscription, expose native tool calling, and speak an official interface is the vendor's own CLI. [`cxh-subagent-claude-code`](../../../../packages/subagent/subagent-claude-code/README.md) already drives it — but as a *delegation* provider that returns one final answer, not as a model route the agent loop can step.

## Decision

[`cxh-llm-agent-cli`](../../../../packages/llm/llm-agent-cli/README.md) registers vendor-CLI routes on the shared `llm` service. The harness keeps its loop, tools, sandbox, and session log; only the transport to the model changes.

The CLI is an agent with a tool loop of its own, so four settings reduce one run to one model call: the harness system prompt replaces the CLI's, the harness tool schemas arrive over an in-process MCP server while the CLI's own tools are refused by name, every permission request is denied so no tool can execute where the harness would not see it, and translation ends at the assistant turn, which is exactly where `stream()` ends.

`settingSources` stays unset. The SDK then reads the host's normal settings and native account state, and that inheritance is the authentication — no credential passes through this harness at all, and [`scrubbedParentEnv`](../../../../packages/subprocess/subprocess/README.md) removes credential-shaped names from the child, so an ambient API key cannot be picked up by accident.

Nothing in the core moved. `stream()` is the only method an adapter must implement, `sessionId`, `reasoningEffort`, and `ReplayEnvelope` already existed, the loop already logs `request/header` and stamps `source: { provider, model }`, and `SESSION_FORMAT_VERSION` is unchanged, so neither SDK projection is touched.

## What verification changed

Three of the design's premises were wrong, and each was found by testing rather than by reading:

The SDK's `tool()` helper takes a **Zod shape**, so presenting the harness tool schemas through it would translate every registered tool lossily. The adapter answers `tools/list` from the low-level MCP server instead, and the JSON Schema crosses verbatim.

The CLI presents an in-process server's tools as `mcp__<server>__<tool>`. The model therefore emits `mcp__cxh__bash`, which the adapter maps back before the harness sees the call. This is model-visible: a system prompt naming tools describes them by their harness names while the model reads the prefixed ones.

The vendor's own turn cap cannot bound one model call: reaching it makes the SDK throw an error result, so `maxTurns: 1` turned every ordinary tool-calling turn into a failure. The finish reason is derived from the emitted content — any `tool_use` block means `tool-calls` — and translation ends at the assistant turn rather than waiting for a result the vendor reports about a run this call already finished with.

## One live conversation per session

`LlmAdapter` is stateless and receives the whole history each call; a vendor run is not, and holds its own. Replaying the transcript every step would flatten roles, lose the vendor's prefix cache, and spend subscription quota re-reading what the run already knows.

Each harness session therefore keeps one vendor run alive across turns. The run's input is a channel the adapter pushes into: the opening turn delivers the history the run must know, and every later turn delivers only what it adds, carried as real `tool_result` blocks. Continuing is valid only while history still extends what that run consumed, which a per-message digest list decides; anything else disposes the run and opens a fresh one with a labelled replay.

The vendor's own `resume` cannot serve this. Resuming requires `persistSession`, which writes a copy of every conversation to the host's Claude directory — outside this harness's control and lifetime, duplicating the log it already keeps. The first implementation asked for both at once and neither worked: `persistSession: false` with a `resume` id produced `No conversation found with session ID` on the second turn of the first real run.

Keeping the iterator open is what makes this work, and it constrains the translation: leaving a `for await` calls `return()` on the vendor run, ending the conversation the next turn continues. The translator pulls with `next()` instead.

A run owns a CLI process tree, so it is released on divergence, on a cancelled or failed turn, and when the plugin unloads.

## Alternatives considered

**A browser-extension bridge to a logged-in web session.** It authenticates by subscription and uses a real session, and it was the original preference. Rejected on a mechanism, not a taste: no web chat product exposes function calling, so the bridge could only drive the loop through prompt-level tool-call emulation — the most fragile component in the system, and one this repository has never had.

**Headless browser automation.** Same defect, plus it drives an interface the vendor does not offer for automation.

**Reusing `cxh-subagent-claude-code` instead of a new adapter.** Its contract is a finished answer, not a stream of tool calls the harness executes. Sharing it would have meant two contracts in one provider.

**Copying the SDK process projection into this package.** Rejected: process-tree ownership decides who proves the tree exited, and that contract must not fork. It moved to [`cxh-claude-agent-sdk-process`](../../../../packages/subagent/claude-agent-sdk-process/README.md), which stays under `packages/subagent/` because a new top-level group would be a larger structural change than the extraction it serves.

## Consequences

The attribution invariant is vacuous here: this adapter issues no provider HTTP request, so there are no headers to merge. No gate enforces `attributionHeaders()` mechanically, which is exactly why the emptiness is stated in the package README rather than left to look like an oversight.

Using a subscription CLI as another harness's model backend may exceed the subscription's licence. This repository already shipped that decision once at the delegation layer; promoting it to a primary model route is a step further, and it is the operator's to take.

Images cannot cross: a request carrying one fails with `UNSUPPORTED_CONTENT` rather than being sent without it.

No keyless snapshot covers this route, and that is deliberate. Recording a fixture means running the real agent once and harvesting its session log, which for this route spends a real product subscription rather than an API key. The gap costs less than it looks: [`cxh-llm-replay`](../../../../packages/test-support/llm-replay/README.md) intercepts at the `llm` seam, so a snapshot would substitute for this adapter entirely — proving the composition rather than the tool bridge, the session affinity, or the stream translation, each of which the package's own tests cover. A runnable composition ships instead, at [`examples/headless-agent/agent-cli.cordis.yml`](../../../../examples/headless-agent/agent-cli.cordis.yml). Recording the fixture stays available to an operator willing to spend the quota.

The route is mounted dormant in the base bundle. No configured provider means no route, so a host that never logged the CLI in offers nothing to select and no request can reach it.
