# Agent Note: Optional operations catalogs for schedules, teams, and preset composition

Status: implemented

## Problem

Schedule reminders, Agent Team membership and task dependencies, and per-preset plugin composition already existed on the Host, but the Web client could not inspect them. A direct UI dependency on experimental services would also make otherwise valid compositions fail, and exposing raw preset configuration would send secret-bearing values into the browser.

## Decision

Session projections now receive the actual Session header and inherited-event boundary on fresh construction and checkpoint restore. Schedule uses the boundary to exclude a fork's copied parent history. Agent Team uses the header to retain the original lead identity. Both registrations are optional injections, and both projections return the same state object for unrelated events so the projection registry does not publish redundant view changes.

`@arx-ai/arx-client-ui-schedule` renders a read-only active-reminder catalog only when an open Session has a Schedule projection. `@arx-ai/arx-experimental-client-ui-agent-team` renders a roster and task dependency catalog only for a projected Team participant. Teammate links use the existing public Session and subagent navigation APIs. The implementations were adapted from `deepseek-ai/deepseek-harness` snapshot `c291e7961a515f6d7af9304e7fd1d257929aef26` to this repository's older client slot, locale, projection, and positioning contracts.

Agent presets now provide `compositionInventory()`, which flattens Loader groups and reports identity, effective enablement, conditions, phase, trust, default selection, and generic health. Plugin configuration values and broken-preset diagnostics stay on the Host. Plugin Inventory includes these groups when the preset registry is present, and the existing Settings tab adds a scope selector without changing its global catalog default.

The inventory work exposed a Loader lifecycle defect: a disposed standing preset subtree remained attached to its owner entry and leaked its rows into the root Loader inventory. `PresetTree` now clears that exact back-reference during disposal. It does not remove or rewrite unrelated Loader entries.

## Alternatives considered

- Browser RPCs for each catalog would duplicate existing Session state and introduce polling or subscription lifecycles.
- Making the projections mandatory would break compositions that intentionally omit Schedule or experimental Team support.
- Sending raw preset Loader rows would reveal configuration values and would conflate source shape with evaluated runtime phase.
- Navigating teammates by guessed routes would bypass the existing Session store's subagent-address resolution.

## Consequences

- Catalog state is read-only and follows the Session log or current Loader tree; mutation remains with the existing services and tools.
- Schedule delivery is still process-local and requires a live owning Session. The catalog makes no external notification claim.
- The Schedule clock has one one-second interval only while its popover is open and clears it on close. Closed catalogs perform no clock updates or Host reads.
- Preset inventory parses unmounted compositions on demand. Existing discovery already reads those files, so the operation adds parsing work to an explicit inventory request rather than a background loop.
- Chinese copy remains directly unit-tested for the imported upstream formatter, while the current client locale registry registers the English dictionary supported by this snapshot.

## Verification

Focused Vitest coverage exercises fork-prefix exclusion and checkpoint restart, strict Schedule and Team projection folds, optional rendering, stable ordering, portal dismissal and focus, public teammate navigation, real Cordis preset mounting, conditional expressions, broken compositions, loader-entry disposal, global and per-preset inventory rendering, and redaction of private diagnostics. The final focused runs completed 24 tests across five files and 19 tests across three directly affected files with no failures.
