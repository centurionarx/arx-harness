# @centurionarx/cxh-llm-agent-cli

English | [中文](README.zh.md)

An `LlmAdapter` that drives a subscription-authenticated vendor CLI as an ordinary model route. The harness keeps its agent loop, its tools, its sandbox, and its session log; only the transport to the model changes. No API key is involved anywhere: the CLI reads the login the host already has.

The route is dormant until configured. A composition mounts the plugin; a deployment decides whether it serves anything.

## How one CLI run becomes one model call

The vendor CLI is an agent with a tool loop of its own. Four settings reduce it to a single model call whose tool calls come back to the harness unexecuted:

| Setting | Why |
|---|---|
| `systemPrompt` ← the request's `system` | The harness prompt replaces the CLI's own, so what the model sees is what the session log holds. |
| `mcpServers` ← one in-process server | The only supported way for the model to see the harness tool schemas. |
| `disallowedTools` ← the CLI's built-ins, `canUseTool` ← deny | A tool the model asks for cannot run inside the CLI, where the harness would see neither the call nor its result. |
| `maxTurns: 1` | One assistant turn and stop — exactly `stream()`'s contract. |
| `skills: []` | Omitting it is not "skills off": the SDK documents that the CLI's own defaults still apply, so the host's skill directories would reach the model through a tool the harness never registered. Skills reach a harness model through `ctx.skills` instead, where loading is a logged tool call. |

`settingSources` stays unset, so the SDK reads the host's normal Claude settings and native account state. That inheritance *is* the authentication.

## Tool names are namespaced, and that is model-visible

The CLI presents an in-process MCP server's tools as `mcp__cxh__<name>`. The model therefore emits `mcp__cxh__bash`, and this adapter maps it back to `bash` before the harness sees the call. The namespaced form is what the model reads in its own context, so a system prompt that names tools describes them by their harness names while the model sees the prefixed ones.

Tool schemas cross as JSON Schema, verbatim. The SDK's own `tool()` helper takes a Zod shape and would force a lossy translation of every tool the harness registers, so this package answers `tools/list` from the low-level MCP server instead.

## Session affinity

`LlmAdapter` is stateless: every `stream()` receives the whole history. A vendor CLI session is not — it holds its own conversation. Replaying the transcript on each step would flatten roles, lose the vendor's prompt cache, and spend subscription quota re-reading what the session already knows.

So each harness session is paired with the vendor session serving it, keyed by `GenerateOptions.sessionId` and remembered as a per-message digest list. A request whose history still *extends* what that vendor session consumed resumes it and delivers only the delta — a new user message or a tool result, carried as real `tool_result` blocks. Anything else — a compaction that rewrote history, a plan-mode edit, a branch — makes the vendor session an invalid continuation, and the transcript is replayed into a fresh one as labelled text. That replay is the lossy path, and avoiding it is the whole point of the pairing.

The pairing lives in memory. A restart replays once per session and pairs again.

## Config

`contextWindow` is required per model. Automatic compaction resolves capacity from the route serving the request and refuses to run against a route that advertises none, and the vendor CLI discloses no capacity of its own.

```yaml
- id: llm-agent-cli
  name: '@centurionarx/cxh-llm-agent-cli'
  config:
    cwd: /srv/workspace
    providers:
      claude-subscription:
        displayName: Claude (subscription)
        disposeGraceMs: 3000
        models:
          - id: claude-sonnet-4-5
            contextWindow: 200000
            maxTokens: 8192
```

`cwd` is a deployment fact, not a session one: one adapter serves every session in the process. Absent, the CLI runs where the harness process runs.

## Attribution

The mandatory `attributionHeaders()` invariant is vacuous here. This adapter issues no provider HTTP request — the CLI makes the call and sends its own identity — so there is no request to merge headers into. The requirement is stated rather than silently skipped.

## Model Experience

### Vendor CLI request

#### What the model sees

The harness system prompt verbatim in place of the CLI's own, the harness tool schemas as JSON Schema under `mcp__cxh__` names, and the conversation as either the delta into a resumed vendor session — new user messages and tool results carried as real `tool_result` blocks — or a labelled replay of the whole transcript when no vendor session can continue it.

#### Token effect

The replay path re-sends the whole transcript as one user message and pays for it; the resumed path sends only the delta. Which path a request takes is decided by whether its history still extends what the vendor session already consumed.

#### KV Cache effect

A resumed vendor session keeps whatever prefix cache the vendor maintains across its own turns. Divergence drops that session, so the next request starts a cold one and pays the full prefix again.

### Vendor CLI response

#### What the model sees

Nothing further: the response is the model's own output. Reasoning, text, and tool calls are translated into harness chunks, with each tool name mapped back from `mcp__cxh__<name>` before the loop logs it.

#### Token effect

Usage is reported as the vendor states it, with uncached input, cache reads, and cache writes kept in the separate buckets the harness prices them in.

#### KV Cache effect

None of its own; the response does not change the request prefix.

## Known Limitations and Deferred Work

- **Images cannot reach the vendor CLI** — a request carrying an image block fails with `UNSUPPORTED_CONTENT` rather than being sent without it.
- **Affinity is in-memory** — the pairing is not written to the session log, so it does not survive a restart. A durable variant could carry it in the `finish` chunk's `ReplayEnvelope`.
- **The SDK version is pinned exactly** — `0.3.220`, matching the projection in [`cxh-claude-agent-sdk-process`](../../subagent/claude-agent-sdk-process/README.md).
