# Agent Note: the locale event follows the selection, not the rendered language

Status: implemented

## Problem

`locale/change` announced that the rendered language had switched, and `LocaleRuntime` decided that by comparing the incoming id against `snapshot.active`. Once [the client shipped one locale](../simplification/2026-09-03-the-client-ships-one-locale.md), `active` could no longer move: every registered locale is the same locale, so both comparisons — `setLocale`'s `this.snapshot.active !== match.id` and `adopt`'s `this.snapshot.active === target` — were decided at compile time. The event could not fire, and the code paths behind them could not run. `oxlint` reported them as comparisons between literal values, and the per-file coverage gate reported their branches and the statements they guarded as unreachable, so the file sat below the repository's 100% threshold with no test able to reach it.

The behavior underneath the dead comparisons still mattered. What decides the active locale can change while the rendered language does not: a browser-derived provisional resolution stands until an explicit pick or a Host settings answer replaces it, and that replacement is exactly what a subscriber re-registering slots or re-reading a preference needs to hear about.

## Decision

`LocaleRuntime` holds a `selection` field beside the snapshot, absent while the provisional browser resolution stands, and one private `select(target)` funnel owns the transition. `setLocale` and `adopt` both call it; it records the target and publishes only when the selection moves. `publish` names its second parameter `selectionMoved`, and `locale/change` documents itself as the selection moving — an explicit pick or an adopted Host answer replacing what decided the active locale.

The first pick therefore publishes even when it names the language already on screen, because a provisional resolution is not a selection and replacing it is a real transition. A repeat — the same pick again, or a settings revision carrying the standing selection — publishes nothing. The durable write is unconditional and unchanged: picking the language already on screen must survive a different browser sharing the same arx home.

Dictionary registrations stay off the event, as before: registration-heavy boot would otherwise storm listeners that re-register slots in response, and continuous render refresh rides the `LocaleFace` revision instead.

## Alternatives considered

- **Keep comparing against `snapshot.active` and exempt the branches from coverage.** The repository treats an unreachable guard as a hole to restructure, not to exempt, and the exemption would have frozen an event that cannot fire behind a comment claiming it can.
- **Widen the locale union so `active` can move again.** That reverses a shipped product decision to serve a gate, and the second locale would have to exist for the comparison alone.
- **Delete `locale/change`.** Its subscribers need the transition the provisional resolution hides; removing the event would push each of them to poll the `LocaleFace` revision and re-derive whether the change was a selection or a dictionary registration.
- **Publish on every `setLocale` call.** Simpler, but a settings revision that repeats the standing selection would churn every subscriber, which is the cost the original conditional existed to avoid.

## Consequences

`locale/change` fires once for the first explicit pick or adopted Host answer in a one-locale client, where it previously could not fire at all. A subscriber that treated the event as "the rendered text just changed" now also hears a selection that leaves the rendering identical; the payload is the same immutable snapshot, so a listener that reads `active` sees the value it already had.

The two statically impossible comparisons are gone, dropping the repository's lint baseline from eleven errors to nine. The file reaches the 100% per-file coverage threshold. The three remaining `oxlint` errors in it are unrelated: two `no-redundant-type-constituents` on the declare-merge key pattern the file's own header documents as a false positive, and one `no-unnecessary-condition` on the `navigator.languages` fallback that exists for embedders whose Navigator omits it and that tests already cover.

`packages/extensions/cordis-client-runner/src/client/api-catalog.ts` quotes the event's JSDoc and was regenerated with `pnpm run gen-cordis-inspect-catalog`; no gate checks that catalog for drift, so a later JSDoc edit there will go stale silently.
