# @arx-ai/arx-claude-agent-sdk-process

English | [中文](README.zh.md)

The official Claude Agent SDK spawns a Claude Code CLI of its own. This package makes the harness own that process tree instead. It is **NOT a cordis plugin** — it registers nothing and injects nothing. It is a library that the SDK's `spawnClaudeCodeProcess` hook uses to route a spawn request through [`arx-subprocess`](../../subprocess/subprocess/README.md), so termination escalation and whole-tree exit proof stay with the service that owns them.

It exists as a package because more than one seam drives the same SDK: [`arx-subagent-claude-code`](../subagent-claude-code/README.md) delegates a whole task to it, and an LLM adapter can drive the same CLI as an ordinary model route. Copying this projection into a second consumer would fork the process-ownership contract.

## Primitives

- **`sdkEnvironmentOverlay(env)`** — encode the SDK's composed child environment as a subprocess overlay. Names the SDK removed become explicit tombstones rather than silent absences, so the overlay states the whole environment instead of a diff against ambient state.
- **`claudeSpawnSpec(options, graceMs)`** — translate one SDK spawn request into a fully explicit `SubprocessSpawnSpec`: argv, workspace, `stdin`/`stdout` pipes with inherited `stderr`, the termination grace, and the SDK's forwarded signal. A request without a workspace throws rather than defaulting to the server process's own directory.
- **`ManagedClaudeCodeProcess`** — the SDK-facing `SpawnedProcess` view of one managed child. Protocol transport stays in the SDK; this projects streams and exit events only.

## Ownership

The subprocess handle remains the authority for process quiescence. A consumer that asks the SDK to close its query expresses protocol intent, not process death, and still awaits the handle's whole-tree exit.

## Model Experience

None, as this package registers no prompt, message, schema, tool, or model call; whichever seam drives the SDK owns every model-visible effect.

#### KV Cache effect

No invalidation; the consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **The SDK version is pinned exactly, not by range** — `0.3.220`. The custom-spawn interface this package projects is not covered by a stability promise, so a consumer must pin the same version the projection was written against.
