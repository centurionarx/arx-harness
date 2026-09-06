# Agent Note: the SDK declares what its model's reasoning supports

Status: proposed

## Problem

The bundled Python runtime serves a caller's own model [without reasoning](../../implemented/architecture/2026-09-06-a-caller-named-model-is-served-without-reasoning.md), because nothing available to it can say whether that model reasons or how its gateway spells a thinking level. The floor is correct and it is a loss: a caller pointing at a reasoning-capable gateway gets no thinking, silently, and the SDK offers no way to say otherwise.

The one party that knows is the caller. `ArxHarnessConfig` already carries the provider, model, endpoint, and credential; reasoning is the field it lacks.

## Proposal

Add an optional reasoning declaration to `ArxHarnessConfig` — absent means the current non-reasoning floor, so no existing caller changes. The SDK carries it to the runtime the same way it carries the model, and the route builds the caller's entry from it instead of pinning `reasoningEfforts: false`.

Two shapes are worth weighing before building either. A boolean plus a level says "this model reasons, ask for high" and leaves the wire spelling to pi-ai's defaults, which is the smaller surface and covers a gateway that follows the OpenAI convention. A full effort-to-wire mapping mirrors `reasoningEfforts` itself, covers a gateway that spells levels its own way, and asks the caller to know a pi-ai concept the SDK otherwise hides.

Whichever lands, the runtime keeps the floor for a caller who declares nothing, and the smoke gains a scenario that drives a declared reasoning model end to end.

## Alternatives considered

- **Probe the gateway at startup.** Removes the caller's burden and adds a network round trip to every session start, against an endpoint that may answer nothing useful; no listing endpoint reports a model's reasoning protocol today.
- **Infer from the model id.** Guesses a capability from a string a private gateway chose, and fails exactly where the caller is least like the shipped catalog.
- **Leave the floor permanently.** The lowest cost, and it keeps a silent loss for every caller whose model reasons.

## Acceptance criteria

- A caller declaring reasoning gets thinking against their own gateway, proved by a smoke scenario asserting the request carries the thinking parameter.
- A caller declaring nothing keeps today's behavior, proved by the existing `sdk-default` scenario passing unchanged.
- The chosen shape is recorded with the reason the other was refused.

## Risks

- **The declaration becomes a second place to be wrong**: a caller who declares reasoning a gateway does not support moves the failure to their server, which is the cost the floor exists to avoid. The error has to name the declaration as the likely cause.
- **A mapping shape leaks a pi-ai concept into the SDK's public surface**, and a later adapter change would then be visible to callers.
- **Scope**: this touches the SDK's public configuration, so it lands with its own version bump and documentation, not inside an unrelated change.
