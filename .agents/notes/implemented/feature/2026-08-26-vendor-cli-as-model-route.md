# Agent Note: a subscription-authenticated vendor CLI as a model route

Status: implemented

English | [中文](2026-08-26-vendor-cli-as-model-route.zh.md)

## Problem

Every shipped model route reaches a provider over HTTP with an API key. A user already paying for a product subscription could not use this harness without buying API access separately.

The obvious readings of "without an API key" do not survive contact with the code. A web chat UI exposes no function calling, so an adapter driving one would need prompt-level tool-call emulation that exists nowhere in this repository — and without tool calls the harness executes nothing, which is the whole product. A local OpenAI-compatible server needs no *paid* key but still needs a credential reference, which [the provider guide](../../../../docs/user/guide/providers.md) now documents.

What does authenticate by subscription, expose native tool calling, and speak an official interface is the vendor's own CLI. [`cxh-subagent-claude-code`](../../../../packages/subagent/subagent-claude-code/README.md) already drives it — but as a *delegation* provider that returns one final answer, not as a model route the agent loop can step.

## Decision

[`cxh-llm-agent-cli`](../../../../packages/llm/llm-agent-cli/README.md) registers vendor-CLI routes on the shared `llm` service. The harness keeps its loop, tools, sandbox, and session log; only the transport to the model changes.

The CLI is an agent with a tool loop of its own, so four settings reduce one run to one model call: the harness system prompt replaces the CLI's, the harness tool schemas arrive over an in-process MCP server while the CLI's own tools are refused by name, every permission request is denied so no tool can execute where the harness would not see it, and a one-turn cap ends the run exactly where `stream()` ends.

`settingSources` stays unset. The SDK then reads the host's normal settings and native account state, and that inheritance is the authentication — no credential passes through this harness at all, and [`scrubbedParentEnv`](../../../../packages/subprocess/subprocess/README.md) removes credential-shaped names from the child, so an ambient API key cannot be picked up by accident.

Nothing in the core moved. `stream()` is the only method an adapter must implement, `sessionId`, `reasoningEffort`, and `ReplayEnvelope` already existed, the loop already logs `request/header` and stamps `source: { provider, model }`, and `SESSION_FORMAT_VERSION` is unchanged, so neither SDK projection is touched.

## What verification changed

Three of the design's premises were wrong, and each was found by testing rather than by reading:

The SDK's `tool()` helper takes a **Zod shape**, so presenting the harness tool schemas through it would translate every registered tool lossily. The adapter answers `tools/list` from the low-level MCP server instead, and the JSON Schema crosses verbatim.

The CLI presents an in-process server's tools as `mcp__<server>__<tool>`. The model therefore emits `mcp__cxh__bash`, which the adapter maps back before the harness sees the call. This is model-visible: a system prompt naming tools describes them by their harness names while the model reads the prefixed ones.

A turn that requests a tool reports the turn cap it hit, not the request it made, so the finish reason is derived from the emitted content — any `tool_use` block means `tool-calls` — rather than from the SDK's own result subtype.

## Session affinity

`LlmAdapter` is stateless and receives the whole history each call; a vendor CLI session is not, and holds its own. Replaying the transcript every step would flatten roles, lose the vendor's prefix cache, and spend subscription quota re-reading what the session already knows.

Each harness session is therefore paired with the vendor session serving it, remembered as a per-message digest list. A request whose history still extends what that session consumed resumes it and delivers only the delta, carried as real `tool_result` blocks. Anything else — a compaction that rewrote history, a plan-mode edit, a branch — makes the session an invalid continuation, and the transcript is replayed into a fresh one as labelled text.

The pairing lives in memory. Divergence detection is the part that earns its tests, because a false match would feed a vendor session a history it never saw.

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
