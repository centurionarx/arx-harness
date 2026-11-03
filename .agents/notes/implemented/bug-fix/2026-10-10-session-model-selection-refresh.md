# Agent Note: Refresh the model directory after accepted session selection

Status: implemented

## Problem

The composer can retain an unselected, unroutable directory after another client selects a valid route for its session. The Host accepts the selection and reports the correct current route, but the browser keeps the input disabled until opening the model picker performs a directory read. Initial directory loading and later session selection have independent arrival times.

The measured sequence has a directory answer before the accepted selection event and no later directory request. A separate Host read reports a current routable model without changing the browser's directory. A real picker open causes the directory read and makes the original composer fill succeed. This establishes a missing consumer refresh; it does not establish a stale Host catalog as the cause.

## Decision

After the runtime's existing acceptance and sequence deduplication, a bound Session emits the client-only Cordis notification `session/model-selection` with its `SessionId` when a `model/selection` event enters its live event window. History hydration, an overlapping or replayed event, an unbound Session and a disposed Session do not emit it. The durable `model/selection` event, its payload, wire decoding and server APIs are unchanged; the event is declared in the type-only `@arx-ai/arx-agent/types` face so the client runtime compares against a typed `SessionEventMap` member.

`ModelDirectoryResolver` listens in the owning Session scope and calls the existing `ModelDirectory.load()` only for that `SessionId` and only when the dispatch comes from that binding's scope, so a recreated scope with the same `SessionId` does not trigger the old directory. The Host remains the authority for current selection and routability. The existing operation generation discards late replies, and scope disposal removes the listener. The composer block continues to follow the Host's routability result.

## Alternatives considered

**Listen to raw transport frames in the feature.** That bypasses the runtime's accepted event window and deduplication and couples a UI consumer to transport decoding. The runtime already owns the acceptance point.

**Remove the composer block.** A Host-reported unservable route must keep the composer unavailable. Clearing the block without an authoritative directory read would permit input for a route the Host cannot serve.

**Require a picker gesture, poll, or extend waits.** A selection accepted outside the picker must update its session's consumer without another user action. Timers or longer waits do not supply the missing notification.

**Move a Host catalog read.** Changing where the producer reads current selection does not deliver a change to an already loaded browser directory. The observed Host answer already contains the correct current routable model.

## Consequences

An external selection updates the current route and the composer block while the picker is closed, at the cost of one asynchronous Host directory read per accepted live selection. That read can fail through the existing directory error state and cannot publish after a newer operation or Session disposal. The notification adds no Host protocol message, durable event or shared SDK wire change.

The [Session suite](../../../../packages/client/runtime/tests/session.client.spec.ts) covers scoped dispatch, buffered history overlap, duplicate suppression, unbind and rebind, and disposal. The [directory plugin suite](../../../../packages/client/ui-model-selection/tests/browser-plugin.client.spec.ts) covers the intended-session refresh without a selection RPC, superseded late answers and disposed or recreated scopes. The [owning keyless Web scenario](../../../../apps/web/tests/declared-reasoning.e2e.ts) selects through the real Host API with the picker closed, observes the updated selector and editable composer, asserts that no model or tool request occurs, and compares a dedicated selection snapshot; its two earlier expected files are unchanged.

The [Web selector decision](../feature/2026-07-24-web-session-model-selector.md) still owns provider grouping, effort selection and composer placement. The [optional-current and failed-call handling decision](2026-09-22-model-menu-without-a-selection.md) still owns absent selection parsing and operation error publication. The [advisory catalog decision](../architecture/2026-07-15-llm-model-catalog-and-acp-selection.md) still prevents catalog membership from becoming a route whitelist. This note supersedes none of them.
