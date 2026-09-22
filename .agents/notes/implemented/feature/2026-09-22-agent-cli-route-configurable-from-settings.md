# Agent Note: the subscription-CLI route becomes configurable from the Models page

Status: implemented

## Problem

[`arx-llm-agent-cli`](../../../../packages/llm/llm-agent-cli/README.md) shipped mounted in the base bundle and configurable only from `cordis.yml`. It installed no settings section and declared nothing to the configurable-provider directory, so the Models page could not list it, could not offer it, and could not be told to configure it. The only working path was a profile patch plus a restart, which is not a path a person using the product has.

The effect was that a capability the product ships reads, from the outside, as a capability the product removed. A user who could reach a model through a subscription tool found a page offering API-key providers and nothing else, with no indication that the route existed at all. Nothing had been deleted — [the route's own note](2026-08-26-vendor-cli-as-model-route.md) records it arriving this way — but an unreachable feature and an absent one are the same feature to the person looking for it.

The gap was structural rather than accidental. [`arx-llm-pi-ai`](../../../../packages/llm/llm-pi-ai/README.md) is the pattern for a configurable adapter — settings section, directory entry, model discovery, atomic re-registration — and this package implemented none of the four.

## Decision

The plugin mounts dormant and stays mounted, holding the three registrations that let a surface configure it and registering an adapter only once some route exists.

Its settings section uses the composition entry as the section's `base` layer. A route a deployment pins in `cordis.yml` therefore keeps serving beside routes a user adds from the page, emptying the user layer falls back to the entry, and a settings provider detaching does the same. That is the seam's existing semantics rather than a choice made here, and it is what `installSettingsSection` already gives every consumer.

The directory declares `claude-subscription` whether or not it is configured, because a page cannot offer a route that nothing declares — and the route being added is precisely the one that does not exist yet. A route named only in settings joins the directory under its own `displayName`, marked `declared`, which is what distinguishes a deployment's own route from one the product offers. The offer survives the route: emptying a section leaves the entry available to add back.

Model discovery is registered for the namespace, not per route, for the same reason. It starts one vendor run with an empty prompt, no tools, no skills and every permission denied, reads `supportedModels()`, and releases the run. It reports ids and display names only, because the tool discloses no capacity — which is why a configured model still states its own `contextWindow`, and why discovery completes a route rather than replacing the person filling it in.

Nothing interrogates the tool at mount or at save. A dormant route spawns no process, and a host that never signed the tool in runs nothing on its behalf.

Configuration changes take effect without a restart, through one atomic `replace` on the adapter registration. The alternative — dispose, then register — has a failure mode that matters here: a section naming a route another adapter family already owns would leave this plugin's routes withdrawn and its rows gone from the page. Instead the refusal is caught where the swap happens and logged naming the route, with the previous routes still serving. `validate` cannot see the `llm` registry, so that collision is only knowable at the swap; what `validate` can see — a model whose default effort is not among its declared efforts — is refused at the write, before anything is stored.

The route's licence position is unchanged. Driving a subscription tool from another program may exceed that subscription's terms, that judgement belongs to whoever configures it, and this change moves where the decision is expressed without touching what the decision is. The card carries the terms warning where the route is configured; the tool's own sign-in stays in [the provider guide](../../../../docs/user/guide/providers.md) and off the page, because a control that says "sign in" would imply the harness handles the login, and it does not.

This completes [the route's note](2026-08-26-vendor-cli-as-model-route.md) rather than reversing it. That note decided what the adapter is and left it dormant in the base bundle; it never decided against a configuration surface, it simply shipped without one. The dormant posture it describes still holds: no configured provider, no route.

## The page's card

A route in the `llm-agent-cli` namespace gets its own editor layout rather than the pi-ai one with fields hidden, because the two adapters disagree about what a model list means. On a pi-ai route an empty list serves the installed catalog, capacities are the exception and fold behind each row, and an unlisted id can still be sent; on the CLI-backed route the list is exactly what it serves, a model without a context window cannot be served at all, and an unlisted id is refused with `UNKNOWN_MODEL`. The layout is chosen from the namespace name, like pi-ai's, and the per-adapter differences live in one table keyed by that layout — which rules the rows are validated by, whether capacities fold, what a blank capacity hints, whether a row carries the image flag, and what an empty list says — so no rule is a boolean some caller forgets to pass.

The card asks for no key, endpoint, or protocol, and never asks the credential service about one. It says what the route signs in with and that the subscription's terms are the operator's to check, and it names no vendor: the route's name arrives as the directory's display name, like every other provider's. **Apply** waits for at least one model with its context window, and the context-window field is never folded, because it is the field a refusal points at. **Restore defaults** appears only when the composition pinned models beneath the user layer; a route configured only from the page has nothing to restore to. The page's own intro no longer asks for API keys, since one of the routes it offers takes none.

Two defects surfaced by putting the route on the page are fixed where they originate. A profile saved without a display name took the route id as its name, so the row a user picked as **Claude (subscription)** turned into `claude-subscription` once saved, in the picker too; `resolveRoutes` now gives an offered route the name it is offered under, and only an unoffered route falls back to its id. And the add card preselected the first directory entry, which is whichever adapter registered first — the CLI-backed plugin registers at mount, so the page opened on the subscription route. The add card now orders providers by name, which returns the preselection to the alphabetical first and lets no registration timing promote one vendor over another.

Evidence: the plugin half is proved over a real `llm` registry and a real settings document — dormant offer, route from entry, route from section, rename, the offered name kept when a section names none, `declared` marking, refusal at the write, collision with previous routes intact, entry-as-base overlay, provider detachment, disposal, and the discovery run. The card is proved by client tests over a scripted wire and by a web e2e through the shipped composition in the first-run lane, which seeds no default model: the route offered and added with no credential, the section written with no `apiKeyEnv`, and its model picked in the composer, which unblocks the composer and becomes the default, with goldens for the add card and the configured page. That path is what surfaced [the model menu that never loaded without a selection](../bug-fix/2026-09-22-model-menu-without-a-selection.md), fixed in the same change. No model call and no CLI launch happens in either.

## Alternatives considered

**Leaving configuration in composition, and documenting the profile patch.** It is the status quo and it works, for someone who edits YAML and restarts a server. It also makes the harness's own configuration page a partial view of its own capabilities, which is the defect this note exists to close, and it leaves no way for a page to ever offer the route.

**Shipping preset models with the preset route.** Rejected on a hard constraint: `contextWindow` is required per model, automatic compaction refuses a route that advertises none, and the tool discloses no capacity. Any shipped number would be a guess that silently governs when a session compacts. The route is offered by name with no models, and discovery lists ids a person then completes.

**Probing the tool at mount or at save, to fill the roster automatically.** It would spawn a process on behalf of a host that may never have signed in, at the one moment nothing asked it to, and turn a dormant mount into a process launch. Discovery is offered instead and runs only when a surface asks.

**Reusing the pi-ai card with the key field hidden.** Less code, but every pi-ai rule the card applies would be wrong here: an empty list would read as "the built-in catalog", a missing context window as "the route's fallback", and the empty-list copy would promise that an unlisted id can still be sent. Hiding fields would leave all three in place.

**Materializing the offered name into the profile from the page.** It would fix the rename for profiles this page writes and leave it for one written by hand in `settings.yaml`. The resolve step is the one place both paths pass through, and it is where every other default of this route is materialized.

**Making the settings section replace the composition entry rather than overlay it.** It reads simpler — one source of truth — but it would mean a deployment that pins a route in `cordis.yml` loses it the moment a user adds one from the page. The seam's layering already answers this correctly.

## Consequences

Which adapters exist stays composition; which routes run becomes the user's settings document — the same split `arx-llm-pi-ai` already has, now true for both adapters the base bundle mounts.

A route configured from settings carries no credential anywhere: the settings document holds no key, no credential reference, and no place to put one. Both the package test and the page's web e2e assert that the written document contains no `apiKeyEnv`, because this is the property a future editor could quietly break.

`resolveRoutes` now defaults the absent `providers` section itself, alongside every other default it materializes, and the two `?? {}` at its call sites are gone. Defaulting inside the resolve step is the package convention; the call sites had drifted into re-stating it, and one of the two restatements was unreachable because the schema already defaults the section before `validate` sees it.

Configuring this route is still a decision about a subscription's terms. The page makes that decision reachable; it does not make it safer.
