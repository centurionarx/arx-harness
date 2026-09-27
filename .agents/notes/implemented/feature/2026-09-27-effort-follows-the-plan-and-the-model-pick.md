# Agent Note: Effort levels follow the plan and open from the model pick

Status: implemented

## Problem

The owner asked to choose the reasoning effort in the same menu as the model, and for each model to offer the effort levels its vendor offers for it.

The composer's model menu closed after a model pick. Choosing an effort meant reopening the menu and opening its Effort row, whose pane described only the model already current.

The chat routes that the native account card feeds could offer other levels than the plan. [Current model rosters from updated pins](2026-09-24-current-model-rosters-from-updated-pins.md) made **Update chat models** append only, so a model the route already listed kept the levels it was first written with, whatever the roster reported later. A Codex roster model that pi-ai's installed catalog describes was written by id alone, so it offered the catalog's levels instead of the ones the plan reports for it.

## Decision

**A model pick continues to its effort.** In `arx-client-ui-model-selection`, picking a model selects it with its default effort. When that model offers more than one effort row, the menu stays open on the Effort pane of the picked model, with focus on the level that applies, and picking a level selects the model again with that effort. A model with one row or none closes the menu, as before. Picking the current model again opens its pane without a selection. A refused pick shows the error toast and keeps the model list. The Effort row of the root pane still opens the current model's levels.

**Levels follow the roster on update.** The card's update keeps every model a route lists and every field an operator wrote, except that a roster model reported with efforts takes the roster's levels: `efforts` on the Claude route and `reasoningEfforts` on the Codex route. A Claude `defaultEffort` the new `efforts` lack is removed, because `arx-llm-agent-cli` refuses it. A roster model reported without efforts keeps what the route stores. The card reads a route as `stale`, and offers **Update chat models**, whenever a listed roster model's stored levels differ from the roster's; key order in a `reasoningEfforts` record does not count as a difference.

**Codex catalog models carry the plan's levels.** A roster model the catalog describes keeps the catalog's name and capacities and now carries `reasoningEfforts` with the roster efforts pi-ai can offer.

**A catalog-serving Codex route keeps serving the catalog.** A route with no `models` list takes the levels as `modelOverrides.<id>.reasoningEfforts`, one path per model whose override lacks them, while the catalog describes every roster model. A roster model outside the catalog still makes the update list the catalog explicitly: each stored override is folded into its model's entry, `modelOverrides` is removed in the same mutation because pi-ai refuses it beside a list, and the new models are appended.

**Each update names only what it changes.** The update is a list of settings path operations: a `set` of `models`, a `set` of one override's `reasoningEfforts`, or an `unset` of `modelOverrides`. The settings view omits `role('secret')` fields, so a route object rebuilt from it and written back whole would delete them.

## Alternatives considered

**Keep appending only.** It never touches a stored entry, but a listed model then keeps levels its plan no longer offers, or lacks ones it now offers, until someone edits the route by hand.

**Replace the route's list with the roster.** It would drop the models and fields an operator added, which is why [the earlier note](2026-09-24-current-model-rosters-from-updated-pins.md) rejected it; only the effort levels have the roster as their source.

**Always pin a catalog-serving Codex route.** Listing the catalog on every update would stop later pi-ai catalog additions from reaching the route. Overrides change only the levels while the roster adds no model.

**Open the Effort pane after every model pick.** A model with one effort row or none has nothing to choose, so the pane would add a step without a choice.

**One selection carrying both model and effort.** The model list does not know which level the person wants, so the pick selects the model with its default effort first; each of the two selections is a complete provider, model, and effort choice.

## Consequences

- Choosing a model and a non-default effort now records two selections, the second replacing the first.
- An operator's hand-edited levels on a roster model give way to the roster's the next time someone presses **Update chat models**; no page load writes them.
- A route whose catalog covers the roster stays unpinned, so the next pi-ai catalog update still reaches it.
- The **Append only** statement in [current model rosters from updated pins](2026-09-24-current-model-rosters-from-updated-pins.md) no longer describes the update for effort levels; this note records the change.
