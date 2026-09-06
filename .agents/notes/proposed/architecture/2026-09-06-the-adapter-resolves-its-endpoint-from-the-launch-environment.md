# Agent Note: the adapter resolves its endpoint from the launch environment

Status: proposed

## Problem

`verify-config-source-ownership` forbids `baseURL: !!js process.env.X` in shipped configuration so that a present endpoint names who set it, and its diagnostic promised the adapter resolves the endpoint through the environment snapshot. The retired vendor adapter did; `@arx-ai/arx-llm-pi-ai` does not. A pi-ai route takes its endpoint from the route's own `baseURL`, else the installed catalog, and never asks the launch environment, so the only way a composition can follow `DEEPSEEK_BASE_URL` is the inline the gate forbids.

The bundled Python runtime needs exactly that: the SDK client sets `DEEPSEEK_BASE_URL` per session from the caller's `base_url`, and the composition lives inside the wheel where no deployment edits it. Today it carries [an exemption](../../implemented/architecture/2026-09-06-the-sdk-runtime-endpoint-follows-its-launch.md) in the gate, which is a hole named in a list rather than a mechanism.

## Proposal

Give a pi-ai route `baseURLEnv`, the endpoint counterpart of `apiKeyEnv`: the name of a variable resolved through `launchEnvironmentOf(ctx)` in the [non-secret ordering](../../implemented/architecture/2026-08-04-configuration-source-ownership.md) — a literal `baseURL` on the same route wins, the launching shell next, then the discovered files, then the catalog. The runtime composition then declares `baseURLEnv: DEEPSEEK_BASE_URL` beside `apiKeyEnv: DEEPSEEK_API_KEY`, the inline goes, the gate's exemption set empties, and its diagnostic is true again.

The field is a reference, so `!!js` has nothing left to express; the gate keeps rejecting the inline everywhere, with no list.

## Alternatives considered

- **Keep the exemption.** The smallest change and a standing hole: every reader of the gate learns that one file may do what the rule forbids, and the reason lives in a comment rather than in the adapter.
- **Read `DEEPSEEK_BASE_URL` inside the adapter without a field.** Restores the retired adapter's hidden ladder — the value reachable twice, once through config and once through the environment, with the winner decided by layer order rather than by what the composition says.
- **Have the SDK write a composition per session instead of setting the environment.** Moves the endpoint into a generated file the caller cannot read before it runs, and leaves every other SDK-set variable on the environment path anyway.

## Acceptance criteria

- A route declaring `baseURLEnv` reaches the endpoint the launching shell names, proved by a pi-ai unit case and by `smoke_sdk_default` running with no inline in the runtime composition.
- A route declaring both `baseURL` and `baseURLEnv` uses the literal, and the config validation says which won.
- `ENDPOINT_FOLLOWS_LAUNCH` in `scripts/verify-config-source-ownership.ts` is deleted with the exemption case in its spec.

## Risks

- **Two references on one route invite the wrong precedence**: a composition that sets both fields must get the literal, or a stale shell variable rewrites a configured endpoint — the failure the configuration ordering exists to prevent.
- **Scope**: this is a config-schema change on a capability package with its own README, version bump, and coverage, not a change to fold into a gate fix.
