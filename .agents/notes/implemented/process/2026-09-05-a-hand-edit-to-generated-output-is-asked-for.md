# Agent Note: a hand edit to generated output is recommended and authorized, not forbidden

Status: implemented

## Problem

The documentation standard forbade hand edits to generated English sources and regions outright. The prohibition is right about the common case — an edit a generator will overwrite is worse than no edit — but it left an agent with nowhere to go when regenerating cannot produce the change: the only compliant move was silence, so a defect in generated output stayed a defect and the reason it could not be fixed reached nobody.

`packages/extensions/cordis-client-runner/src/client/api-catalog.ts` shows the gap. It quotes source JSDoc verbatim, and [the locale event's contract change](../architecture/2026-09-05-locale-change-follows-the-selection.md) made its copy stale. Regenerating fixed that one, but no gate checks the file for drift, so the next stale copy will sit there unreported, and an agent reading the prohibition alone has no sanctioned way to raise it.

## Decision

Regenerating remains the first move and the default. When no generator can produce the change, the agent recommends the hand edit to the owner and makes it only once they authorize it. What the standard now refuses is the unauthorized hand edit, not the hand edit.

The rule reads this way in [docs/AGENTS.md](../../../../docs/AGENTS.md)'s documentation-tier table and in the generated-regions trap of [the current plan](../../proposed/process/2026-09-05-ship-sync-integrate-then-translate.md).

## Alternatives considered

- **Keep the absolute prohibition.** Correct wherever a generator exists and works, and it needs no judgment; but it makes an agent that finds unreachable generated output either stay silent or break the rule.
- **Allow hand edits freely with a comment naming the reason.** Removes the ask, and with it the only signal that a generator is missing or broken — the edit disappears at the next regeneration and nobody learns why it was needed.
- **Add a `--check` gate for every generated artifact and keep the prohibition.** Better in the long run and not mutually exclusive with this decision, but it is a per-generator project; the rule change costs two sentences and covers artifacts no gate reaches yet.

## Consequences

An agent that meets generated output it cannot regenerate correctly now has a sanctioned path: state the defect, propose the edit, wait. That path costs a turn and a human decision, which is the point — the ask is where a missing or broken generator becomes visible.

The prohibition no longer reads as a dead end, so an agent has less reason to route around it silently. It also no longer protects an artifact from an edit the owner wants: authorization is the whole gate, and an agent that edits generated output without it is breaking the rule as plainly as before.

`api-catalog.ts` still has no freshness gate. Its next drift depends on someone noticing, which this decision makes reportable but does not make automatic.
