# Agent Note: Preset generations and hook lifecycle ownership

Status: implemented

## Problem

A shared preset can retain active plugin resources, including filesystem watchers, after its final agent leaves. Replacing its composition file introduces another generation, while agents and cold transcript readers may still need the previous registrations. Reclamation cannot treat a newer cache entry as proof that the old generation is unused. Separately, unconditional Stop hooks can force unlimited requests, and detached SessionStart context can arrive after the first request.

## Decision

[Agent presets](../../../../packages/preset/agent-presets/README.md) count ownership per generation. Pending acquisitions retain their generation before awaiting loading or file-stamp checks. Each agent scope releases its current membership on disposal; child composition retains the parent's exact generation independently, and recompose acquires the replacement before transferring ownership. Releasing the final owner removes only that generation's cache entry and awaits plugin teardown. Failed or superseded acquisitions cannot erase a newer entry.

A cold `standingKeyFor()` call retains its generation for the calling fiber's lifetime, deduplicated per generation and fiber. This preserves the returned key without inventing a release time that the bare-key API cannot observe. A long-lived reader that uses several generations retains each until it unloads.

The [Claude Code](../../../../packages/hooks/hooks-claude-code/README.md) and [Codex](../../../../packages/hooks/hooks-codex/README.md) bridges enforce `maxStopContinuations` immediately before steering. The counter belongs to one agent and turn; `stop_hook_active` reflects a preceding bridge-forced step. The default is eight, following Claude Code's documented guard; zero permits observation without forced steps. Hooks still execute and log at the limit. A Stop `continue: false` halt takes precedence over a simultaneous blocking decision.

Default `sessionStartMode: blocking` records the startup source at the emit event and runs the hook inside the first attempted pre-step, including resumed agents. Accepted context is part of the logged decision batch before request derivation. Rejection or cancellation discards that attempt's context without rerunning startup side effects. Explicit `detached` mode preserves eager best-effort injection. Bridge disposal cancels and drains every execution; detached startup also drains with its agent. Neither policy changes the core loop.

This partially supersedes the lifetime decision in [standing mounts](../architecture/2026-08-08-per-preset-standing-mounts.md) and closes the startup and Stop gaps in [hook bridges](../feature/2026-06-30-hook-bridges.md), using the existing [interception points](../feature/2026-06-30-interception-extension-points.md). Their independent composition, dialect, and dispatch decisions remain active.

### Shared bridge implementation

The dialect-neutral [hook protocol library](../../../../packages/hooks/hook-protocol/README.md) owns policy defaults and schema fields, owner-scoped startup and Stop state, and the serial point runner. Both bridges call the same cancellation, audit-pairing, restrictive merge, and steering-limit operations. The library accepts explicit sessions and opaque owner objects instead of depending on the agent driver. Dialects retain payload construction, environment, warnings, interception dispatch, and model-message creation. This keeps the policy uniform without moving protocol-specific inputs or typed decisions into the shared executor.

The [config catalog extractor](../../../../scripts/gen-config-catalog.ts) resolves shared schema fields through TypeScript symbols and source imports, without importing modules at runtime or executing factories. Object fields accept literal records, const aliases, and synchronous zero-parameter factories with a single return expression. Referenced field bindings must stay within static construction uses; mutation, reassignment, and escapes to arbitrary consumers are rejected. Spreads expand recursively before the last definition of each key contributes its nested paths. Unresolved, mutable, cyclic, computed-key, and control-flow-dependent field records fail extraction; the existing schema/config member check still covers every extracted path.

## Alternatives considered

**Dispose on replacement or on parent-agent exit.** Both invalidate registrations still owned by another agent, an inherited child, a cold reader, or an acquisition awaiting completion.

**Keep every generation until process exit.** This preserves references but retains active watchers and services after all consumers leave.

**Return an unretained cold key.** The API exposes no completion callback, so this permits disposal while a host is still presenting a transcript. A shorter retention interval requires explicit reader lifetime at its consumer.

**Require hooks to self-limit.** A hook can ignore its active flag; only the bridge's steering operation can enforce a finite request count.

**Add an awaited core startup event or reserve maintenance.** The existing pre-step decision already owns the first request and its durable inputs. Per-bridge maintenance reservations would conflict when both dialects start together; detached injection cannot guarantee request ordering.

## Consequences

Agent-only generations are reclaimed after their final member leaves, and cancellation cannot publish a late composition. Cold reads retain their documented calling-fiber lifetime rather than a process-wide cache lifetime. Startup latency contributes to the first attempted turn, while the configured hook timeout bounds each command. The continuation cap limits hook-driven request costs without adding a model-visible warning message.

## Verification

Preset tests load real composition rows and exercise shared children, generation refresh, failed replacement, cancelled acquisition, asynchronous disposal, repeated recompose, and cold-reader unload. Hook tests boot the Loader and agent driver while controlling only external command execution, and verify per-turn limits, concurrent agents, cancellation, bridge/agent disposal, and resumed startup. The authored ACP lifecycle scenarios use real PowerShell commands and replayed model responses to pin startup context before the first request and an unconditional Stop hook reaching its cap. POSIX executor checks remain explicit skips on Windows; the ACP scenarios run wherever PowerShell is available.
