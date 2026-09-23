# Agent Note: a vendor-neutral guide while no model provider is usable

Status: implemented

## Problem

A fresh installation ships no model provider and no default model, so it cannot start a task until someone configures one, and nothing in the Web GUI said so. The first-run credential dialog that used to answer this offered one vendor's route; it was deleted rather than renamed when [the vendor stopped being a brand](../architecture/2026-09-03-the-vendor-is-configuration-not-a-brand.md), and nothing replaced it. A first-run user met a composer reading "This model is unavailable — select one to continue" over a model menu with nothing in it, and no pointer to the Settings page where a provider is added. The subscription route that [became configurable from that page](2026-09-22-agent-cli-route-configurable-from-settings.md) sat one page deep in Settings, invisible from the place where the user got stuck.

The composer's block copy was also wrong in two of its three cases: it called a model unavailable when none had ever been selected, and it asked the user to select one when there was nothing to select.

## Decision

**A guide step, neutral by construction.** [`arx-client-ui-settings-models`](../../../../packages/client/ui-settings-models/README.md) registers `provider-guide` in `settings.onboarding` at order `-50`, after the welcome and home-migration notices, over the same modal and step lifecycle as those notices ([shared-modal onboarding](2026-08-13-shared-modal-product-onboarding.md)). It reads the Models page's own join and shows only while no row is usable (`providerUsable`) and this guide version is not dismissed. It names no provider itself. It lists what the directory offers: the catalog providers of the key-bearing adapter by count, whether a route can be declared for an OpenAI-compatible service, and each command-line route by the name its plugin offers it under. The subscription route therefore appears as "Claude (subscription)" because its plugin offers it under that display name, and a composition without that plugin lists nothing of the kind. **Open Models settings** opens the page through the coordinator's `openSection`; **Later** only closes the guide.

**Dismissal never traps.** Both buttons complete the step at once and record `ui-onboarding.providerGuideVersion` without waiting on the write (`useAcknowledgedNotice().dismiss`). A write that fails to persist shows the guide again on the next pass instead of holding the user in a dialog whose purpose is to send them elsewhere. A dismissed version never reads the provider directory, so an installation past the guide pays nothing for it at startup. A usable provider, or a join that fails to load — every non-loopback browser included — completes the step without showing it.

**The composer says what the user can do.** [`arx-client-ui-model-selection`](../../../../packages/client/ui-model-selection/README.md) raises one of three blocks when the Host reports the session's route unservable: "Select a model to start" when nothing is selected, the existing "This model is unavailable — select one to continue" when a selected route lost its adapter, and "Set up a model provider to start" when the Host lists no provider groups and no provider failures, so there is nothing to select at all. Only that last block carries an action.

**A block may carry its recovery.** `ComposerBlock` in [`arx-client-ui-conversation`](../../../../packages/client/ui-conversation/README.md) gains an optional `action` (`label`, `run`). With one, the composer card becomes that action's trigger as it becomes the Workspace picker's when no workspace is chosen: the read-only textarea takes the label as its accessible name and runs the action on Enter or Space, the dashed card runs it on a click, and the model seat locks with every other control, because choosing a model cannot clear this block. A block without an action keeps the model seat live, as before. A click on a control that stays live inside the card, such as the context meter, stays that control's.

**Opening a section is an event.** The block's owner cannot render the settings shell and does not know which plugin does, so [`arx-client-ui-settings`](../../../../packages/client/ui-settings/README.md) declares `settings/open-section(id)` beside the settings slot types, and the shell in [`arx-client-ui-settings-general`](../../../../packages/client/ui-settings-general/README.md) answers it by opening the panel on that section — the open state the coordinator's `openSection` sets. The shell answers every request made while it is mounted, a repeat for the same section included, and does not replay one made before it mounted, so a remounted shell cannot reopen a panel its user closed. The model-selection plugin emits it for the section id `models`.

## Alternatives considered

**Restoring the deleted credential dialog under a neutral name.** Its premise was to prompt for one route's key, and a neutral version would still have to pick the route, which is the vendor choice the vendor note retired. The guide sends the user to the page that already offers every route.

**No durable dismissal, as the deleted dialog had.** That dialog completed only for the current pass and returned on every visit to the empty hero until a provider was usable. With the composer carrying the way to the page wherever the user gets stuck, the guide does not need to repeat itself; one dismissal per guide version is enough.

**Completing only after the dismissal persists, as the notices do.** The welcome and home-migration notices hold until their acknowledgement is stored, because being acknowledged is their purpose. The guide's purpose is to send the user somewhere, and holding the dialog on a failed write would keep them from the page it points at.

**A separate button under the inert composer.** It would add a second recovery affordance beside the one the composer already has for a missing workspace. Reusing the trigger card keeps one pattern with one set of focus, keyboard, and pointer rules.

**A service method on the settings shell instead of an event.** A method would need a Service Definition for a single caller, while the shell's open state is component state. The event keeps the emitter unaware of which plugin draws the shell, as the slot contract already does for sections.

**Keeping one block copy.** "Select one to continue" is wrong when there is nothing to select and misleading when nothing was ever selected, and the Host's answer already says which case holds.

## Consequences

- A first run on loopback shows the welcome notice, then the guide. A user who dismisses it and picks a workspace finds the composer offering the same page.
- `apps/web/tests/first-run-provider-guide.e2e.ts` records the guide and the composer trigger with goldens in the keyless first-run lane, and proves that the dismissal survives a reload. Every other web scenario dismisses the guide before browser boot, as they do the welcome notice; `launchWebScaffold({ providerGuidePending: true })` opts out. The deleted dialog's orphan golden, which still carried that dialog's copy in Chinese, is removed.
- `apps/web/tests/default-model.e2e.ts` keeps one route when it removes the default's, so it still pins "This model is unavailable — select one to continue" with the model seat live. With no provider left at all, the composer now offers the Models page instead.
- The model-selection plugin depends on `ui-settings` for the event declaration. The Models section id `models` is a literal in the emitter, and an id nothing registers opens the panel on its first section.
- The guide keys on the `llm-pi-ai` and `llm-agent-cli` namespaces by name, as the Models page's editor layouts do; a namespace with no curated layout contributes nothing to its list.
