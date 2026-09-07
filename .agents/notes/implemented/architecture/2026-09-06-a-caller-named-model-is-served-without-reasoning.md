# Agent Note: a caller's own model is served without reasoning

Status: implemented

## Problem

The bundled Python runtime lists the models its one route serves, and pi-ai serves only what a route lists. A caller pointing the SDK at their own gateway therefore got `UNKNOWN_MODEL` for a name the shipped configuration could not know, so the route began reading `ARX_MODEL` — the id the SDK passes through from the caller — and listing it beside the shipped ids.

Listing an id is not enough to serve it. The route declares `reasoning: high`, and pi-ai resolves a listed model's reasoning from the entry's own `reasoningEfforts` or, when the entry omits it, from the installed catalog entry of the same id. A private gateway's id is in no catalog, so it resolved to a non-reasoning model, and the route's `high` was then rejected with `UNSUPPORTED_REASONING_EFFORT` before any request left the process. The keyless runtime smoke reproduces it on every run: its `smoke-model` reaches `turn/end` with `finish_reason: 'error'`, an empty final response, and zero requests at the mock endpoint.

Nothing in the failure said so. Every `final_response` assertion in the smoke quoted only that field, which an errored turn leaves empty, so the reported `AssertionError` carried no message at all — and the previous attempt at this route was aimed without the one signal that names the cause.

## Decision

The route's requested effort and its model list answer the same question and move together. Serving a caller's own id — any `ARX_MODEL` that is not one of the shipped ids — drops the route to `reasoning: off` and lists that id with `reasoningEfforts: false`. Serving a shipped id keeps `reasoning: high` and the explicit dispatch those entries carried before.

Both halves are required. pi-ai answers `getSupportedThinkingLevels` with exactly `["off"]` for a non-reasoning model and rejects any other requested effort, so listing the caller's model as non-reasoning while the route still asks for `high` fails the turn just as listing it with no reasoning declaration did. What the route asks for is the half that has to change; the model entry states the same fact where the adapter reads it.

Serving the caller's model as non-reasoning is a floor, not a judgment about it. No listing endpoint reports a model's reasoning protocol, and the runtime cannot ask the gateway, so declaring `high` on its behalf would move the failure from this process to the caller's server. What the caller loses is thinking on a model that may well support it, silently — [asking the caller to declare it](../../proposed/architecture/2026-09-06-the-sdk-declares-its-model-reasoning.md) is the standing proposal to remove that loss.

`describe_run` in the smoke reports the finish reason and every failure the turn's events carry, and all seven `final_response` assertions use it.

## Alternatives considered

- **Declare `reasoningEfforts: {off: null, high: 'high'}` for the caller's id.** Keeps thinking where the gateway supports it, and asserts a wire protocol the runtime has no way to check; where the gateway rejects `reasoning_effort`, the caller gets a remote error instead of a working session.
- **Drop `reasoning: high` from the route.** Ends the mismatch by removing the capability from the shipped models too, which no caller asked for.
- **Refuse to list an id the catalog does not know.** Restores `UNKNOWN_MODEL` — the failure the route reads `ARX_MODEL` to prevent.
- **Have pi-ai fall back to non-reasoning when a route's effort exceeds a model's declaration.** Moves the decision into the adapter for every deployment, where a silent downgrade would hide a real misconfiguration; the runtime that cannot characterize its model is the one place the floor belongs.

## Consequences

A caller naming their own model gets a session that runs and never gets thinking, whatever their gateway supports. The two shipped ids are unaffected. A caller who names a shipped id explicitly is matched by id and keeps its declaration, so passing `deepseek-v4-pro` behaves exactly as the default does.

The smoke now reports the cause of a failed turn in the assertion message, so the next failure on this route names itself instead of arriving as a bare `AssertionError`.

The advanced packaged-runtime expected output was recorded before the vendor adapter was retired and no current configuration reproduces it, so this change re-records it. The drift is the adapter's alone: the request header drops `maxTokens`, `reasoningEffort`, and `adapterDefaults`, which the retired adapter advertised as its own defaults and pi-ai does not report; every model-emitted `arguments` string is re-serialized without spaces, which the streamed deltas still carry verbatim; and each finish chunk and assistant message gains pi-ai's `replayState`. The minimal expected output gains `strict: false` on each advertised tool for the same reason. The compositions the advanced, custom, filesystem-search, and MCP scenarios drive name their own rows and so inherit no route; each now declares the mock directly, which is what makes them reproducible at all. The minimal scenario drives the checked-in example instead, whose endpoint `verify-config-source-ownership` keeps a literal, so the smoke rewrites that one line into a copy and fails if the shipped route stops declaring exactly one.

The runtime's `cordis.yml` now computes both its requested effort and its model list, so reading the shipped configuration means reading two expressions rather than a table and a literal. Each names the shipped ids, so the two lists must be edited together; the comment above them says so, and nothing enforces it.

Editing that file is enough to change the runtime's behavior: the client injects its path through `$ARX_CORDIS_CONFIG` and the runtime reads it from disk, so `scripts/build-exe-for-python-sdk.ts` need not run again for a configuration change. Running it on a development checkout installs with `--prod`, which prunes the devDependencies the repository's own gates need; recovering takes `pnpm install --frozen-lockfile --config.confirmModulesPurge=false`.
