# Agent Note: the SDK runtime's endpoint follows its launch

Status: implemented

## Problem

`verify-config-source-ownership` rejects `baseURL: !!js process.env.X` in shipped configuration, and the bundled Python runtime's composition has carried exactly that line since it began [serving the model the caller names](2026-09-06-a-caller-named-model-is-served-without-reasoning.md): `doc-sync` was red on the branch for two days with nobody looking at that gate. The gate's diagnostic said the adapter resolves the endpoint through the environment snapshot, so removing the inline looked free. It is not: `@arx-ai/arx-llm-pi-ai` takes a route's endpoint from its `baseURL` or the installed catalog and reads no environment at all, so a literal there would pin every SDK session to the public API and drop the `base_url` the client passes.

The gate also reached build output. The executable build copies the whole package under `runtime/node/`, gitignored, and the Python glob matched the copy, so a developer who had run the build saw the same line reported twice.

## Decision

The gate exempts the runtime composition, for `baseURL` only, in a named set with the reason beside it. The SDK client sets `DEEPSEEK_BASE_URL` per session from the caller's own `base_url`, and the file lives inside the wheel where no deployment edits it; a present value there names the caller, which is what the rule wants a present endpoint to do. The runtime bin loads a `.env` from its working directory through `process.loadEnvFile`, which sets only names still absent, so a client-passed endpoint is never displaced and a caller who passes none takes the project's, the trusted-project stance the ordering already states.

A credential inline in the same file still fails, another Python composition's endpoint inline still fails, and the copy under `runtime/node/` is skipped as build output; the spec proves each. The diagnostic now says what pi-ai does — the endpoint comes from the route or the installed catalog — instead of promising a ladder that retired with the vendor adapter. The exemption is a hole with a name; [giving the route a `baseURLEnv`](../../proposed/architecture/2026-09-06-the-adapter-resolves-its-endpoint-from-the-launch-environment.md) is the standing proposal to close it.

## Alternatives considered

- **Pin the endpoint to a literal.** Passes the gate and breaks the SDK's `base_url` for every caller with a gateway, plus the keyless smoke that drives it.
- **Drop the Python glob from the gate.** Would also stop catching a credential inline in the one shipped composition callers cannot edit.
- **Add `baseURLEnv` to the adapter now.** The right end state and a capability-package change with its own release; the gate should not stay red while that lands.

## Consequences

`doc-sync` reports the corpus gaps only. Any new `baseURL: !!js` in shipped configuration still fails, including in a second Python composition. The exemption set is the one place where the rule is not the whole truth, and the proposal above is what empties it.
