# @arx-ai/arx-llm-agent-cli

An `LlmAdapter` that drives a subscription-authenticated vendor CLI as an ordinary model route. The harness keeps its agent loop, its tools, its sandbox, and its session log; only the transport to the model changes. No API key is involved anywhere: the CLI reads the login the host already has.

The route is dormant until configured. A composition mounts the plugin; a deployment decides whether it serves anything — from the composition entry, or from the `llm-agent-cli:` settings section a configuration surface writes.

## How one CLI run becomes one model call

The vendor CLI is an agent with a tool loop of its own. Four settings reduce it to a single model call whose tool calls come back to the harness unexecuted:

| Setting | Why |
|---|---|
| `systemPrompt` ← the request's `system` | The harness prompt replaces the CLI's own, so what the model sees is what the session log holds. |
| `mcpServers` ← one in-process server | The only supported way for the model to see the harness tool schemas. |
| `disallowedTools` ← the CLI's built-ins, `canUseTool` ← deny | A tool the model asks for cannot run inside the CLI, where the harness would see neither the call nor its result. |
| translation ends at the assistant turn | Reading further would consume a turn this call never asked for. The CLI's own `maxTurns` cannot express this: reaching it makes the SDK throw an error result, so the cap would turn every ordinary tool-calling turn into a failure. |
| `_meta['anthropic/alwaysLoad']` on every tool | Without it the CLI defers MCP tools behind its own tool-search tool, and the model spends its turn searching for a tool the harness already put in the request. |
| `skills: []` | Omitting it is not "skills off": the SDK documents that the CLI's own defaults still apply, so the host's skill directories would reach the model through a tool the harness never registered. Skills reach a harness model through `ctx.skills` instead, where loading is a logged tool call. |

`settingSources` stays unset, so the SDK reads the host's normal Claude settings and native account state. That inheritance *is* the authentication.

## Tool names are namespaced, and that is model-visible

The CLI presents an in-process MCP server's tools as `mcp__arx__<name>`. The model therefore emits `mcp__arx__bash`, and this adapter maps it back to `bash` before the harness sees the call. The namespaced form is what the model reads in its own context, so a system prompt that names tools describes them by their harness names while the model sees the prefixed ones.

Tool schemas cross as JSON Schema, verbatim. The SDK's own `tool()` helper takes a Zod shape and would force a lossy translation of every tool the harness registers, so this package answers `tools/list` from the low-level MCP server instead.

## One vendor run per step

`LlmAdapter` is stateless: every `stream()` receives the whole history. A vendor run is not — it holds its own conversation. So each call opens its own run, delivers the transcript as its prompt, and releases the run when the turn ends.

A run cannot be carried across steps, because the harness and the CLI disagree about who closes a tool call. The harness executes tools itself, so the CLI is started with every tool refused. Refusal is final there: the CLI writes its own denial result and moves on. The harness's real result then arrives for a call that run already closed, and the turn never completes. Holding the CLI's `tools/call` open until the harness answers is not available either — `MCP_TOOL_TIMEOUT` is a hard wall-clock limit per call that progress notifications do not extend, so any tool awaiting human approval would fail on the clock.

The cost is that each step re-sends the transcript: roles flatten into labelled text, the vendor's prompt cache is lost, and subscription quota is spent re-reading what the previous run already knew. That cost grows with the conversation. It buys turns that terminate.

The vendor's own `resume` would not remove it: resuming requires `persistSession`, which writes a copy of every conversation to the host's Claude directory — outside this harness's control and lifetime, duplicating the session log it already keeps.

A run owns a CLI process tree, so it is released when its turn ends, fails, or is cancelled.

## The record notation is a leak surface, closed twice

The replayed transcript states past tool calls as `[requested NAME with ARGS]` records. That notation is the one place on this route where a tool call exists as text, and a model that continues the transcript in prose can end its turn by writing records instead of emitting a `tool_use` block: the user then reads the call's JSON interleaved with the answer, and no tool runs. Two mechanisms close it.

The replay opens with a guardrail naming the records archival — history the harness already executed — and naming tool use as the only way to call a tool now. A turn that still emits a trailing run of well-formed records is repaired by the stream translation: the records become real tool-call blocks over the names this request serves, the protected text before them is kept, the finish reason reports `tool-calls`, and the normal loop executes the tools. Anything malformed — a name outside the harness convention, non-JSON arguments, a tool the request does not serve, a record quoted mid-sentence — stays text.

Deltas already streamed for a repaired block are superseded by its authoritative close; the assembled message, the session log, and every replay therefore hold the corrected content.

## Config

Configuration arrives from two places at once. The composition entry is the section's base layer, so a route a deployment pins in `cordis.yml` keeps serving beside the routes a user adds from settings; emptying the user layer falls back to the entry, and detaching the settings provider does the same. A change to either takes effect without a restart: routes are re-registered in one atomic replace, so a section that names a route another adapter already owns is refused with the previous routes still serving.

`contextWindow` is required per model. Automatic compaction resolves capacity from the route serving the request and refuses to run against a route that advertises none, and the vendor CLI discloses no capacity of its own.

```yaml
- id: llm-agent-cli
  name: '@arx-ai/arx-llm-agent-cli'
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
            acceptsImages: true
            efforts: [low, medium, high]
            defaultEffort: high
```

`acceptsImages` is per model and defaults to false. The route states which models take image input; declaring it on a model that refuses images turns every attached image into a failed request instead of a refused attachment. Image bytes are read from `ctx.attachments` under the vendor's own documented limits, which are fixed rather than configurable: encoding past them produces a request the provider rejects, not a slower one.

`efforts` lists the reasoning levels a model serves, in the order a selector offers them; `defaultEffort` names the one requests carry when they name none, and must be among them — a default outside the list fails the plugin at load. A model that declares no efforts is reported with no reasoning capability at all, which leaves requests at the vendor's own level rather than offering a control that changes nothing. The vendor silently downgrades a level its model does not serve, so a request naming an undeclared one is refused with `UNSUPPORTED_REASONING_EFFORT` rather than run at a level the selector would then misreport.

`cwd` is a deployment fact, not a session one: one adapter serves every session in the process. Absent, the CLI runs where the harness process runs.

## What a configuration surface can offer

The package declares `claude-subscription` to the configurable-provider directory whether or not it is configured, because a page must be able to offer a route before one exists. A route named only in settings joins that directory under its own `displayName`, marked as declared by configuration rather than offered by the product. A profile that names no `displayName` keeps the name its route is offered under, and only a route the package does not offer falls back to its id, so configuring the offered route without renaming it does not rename it. No credential field accompanies any of them: this route authenticates through the host CLI's own login, and nothing in the settings document holds a key.

Model discovery is registered for the whole namespace rather than per route, since the route a page is adding has no adapter entry yet. It answers by starting one vendor run with an empty prompt, no tools and no skills, reading `supportedModels()`, and releasing it. It reports ids and display names only — the CLI discloses no capacity, which is why a configured model still states its own `contextWindow`. Nothing interrogates the CLI at mount or at save; a dormant route spawns no process.

## Attribution

The mandatory `attributionHeaders()` invariant is vacuous here. This adapter issues no provider HTTP request — the CLI makes the call and sends its own identity — so there is no request to merge headers into. The requirement is stated rather than silently skipped.

## Model Experience

### Vendor CLI request

#### What the model sees

The harness system prompt verbatim in place of the CLI's own, the harness tool schemas as JSON Schema under `mcp__arx__` names, and the conversation as either the delta into the live vendor run — new user messages and tool results carried as real `tool_result` blocks — or a labelled replay of the whole transcript when no run can continue it.

#### Token effect

The replay path re-sends the whole transcript as one user message and pays for it; a continuing turn sends only the delta. Which path a request takes is decided by whether its history still extends what the live run already consumed.

#### KV Cache effect

A live run keeps whatever prefix cache the vendor maintains across its own turns. Divergence disposes it, so the next request opens a cold one and pays the full prefix again.

### Vendor CLI response

#### What the model sees

Nothing further: the response is the model's own output. Reasoning, text, and tool calls are translated into harness chunks, with each tool name mapped back from `mcp__arx__<name>` before the loop logs it.

#### Token effect

Usage is reported as the vendor states it, with uncached input, cache reads, and cache writes kept in the separate buckets the harness prices them in.

#### KV Cache effect

None of its own; the response does not change the request prefix.

## Known Limitations and Deferred Work

- **One vendor today** — the package is named for the shape, not the roster: it drives the Claude Agent SDK and nothing else, so a Claude subscription is the only login it serves. A second vendor is a second SDK with its own protocol and its own process projection; whether that arrives as another package or as a seam inside this one is undecided, and the name should not be read as a promise either way.
- **Images need a model that declares them and a mounted attachment store** — a route serves images only where `acceptsImages` says so, and only a composition mounting `attachments` can read their bytes. Either missing fails the request with `UNSUPPORTED_CONTENT` rather than sending it stripped. Documents other than images have no representation here at all.
- **A live run does not survive the process** — the conversation lives in memory beside its CLI, so a restart replays once per session and opens a new run. Nothing durable could carry it: the state is a running process, not a record.
- **Discovery lists the roster but cannot complete it** — `supportedModels()` answers a configuration surface with the vendor's alias rows, and the adapter reports their ids and names. It discloses no `contextWindow`, which automatic compaction requires, and it covers aliases rather than the explicit ids a route usually pins, so a discovered row is a starting point a person still completes. The rows also carry effort levels the adapter does not read yet; doing so would retire the hand-declared `efforts`.
- **The SDK version is pinned exactly** — `0.3.220`, matching the projection in [`arx-claude-agent-sdk-process`](../../subagent/claude-agent-sdk-process/README.md).
