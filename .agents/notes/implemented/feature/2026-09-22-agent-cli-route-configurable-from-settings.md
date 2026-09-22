# Agent Note: the subscription-CLI route becomes configurable without editing composition

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

The route's licence position is unchanged. Driving a subscription tool from another program may exceed that subscription's terms, that judgement belongs to whoever configures it, and this change moves where the decision is expressed without touching what the decision is. The warning and the tool's own sign-in command live in [the provider guide](../../../../docs/user/guide/providers.md), not in the page: a control that says "sign in" would imply the harness handles the login, and it does not.

This completes [the route's note](2026-08-26-vendor-cli-as-model-route.md) rather than reversing it. That note decided what the adapter is and left it dormant in the base bundle; it never decided against a configuration surface, it simply shipped without one. The dormant posture it describes still holds: no configured provider, no route.

## What this does not yet give

The Models page lists the route and opens an editor that says its fields live in `settings.yaml`, with apply disabled — the generic layout for a namespace the editor has no form for. That is honest and points at the surface that now works, but it is not the form this route needs: no API key, no base URL, no protocol, and a model list that must state `contextWindow`. That editor layout is the client half of this work and lands separately, with the assembled-application evidence for it.

The package therefore carries no new snapshot. A configuration surface that makes zero model calls is covered by the web e2e goldens for the page, and those goldens are worth recording against the editor a person will actually use rather than against the placeholder. The plugin half is proved over a real `llm` registry and a real settings document instead: dormant offer, route from entry, route from section, rename, `declared` marking, refusal at the write, collision with previous routes intact, entry-as-base overlay, provider detachment, disposal, and the discovery run.

## Alternatives considered

**Leaving configuration in composition, and documenting the profile patch.** It is the status quo and it works, for someone who edits YAML and restarts a server. It also makes the harness's own configuration page a partial view of its own capabilities, which is the defect this note exists to close, and it leaves no way for a page to ever offer the route.

**Shipping preset models with the preset route.** Rejected on a hard constraint: `contextWindow` is required per model, automatic compaction refuses a route that advertises none, and the tool discloses no capacity. Any shipped number would be a guess that silently governs when a session compacts. The route is offered by name with no models, and discovery lists ids a person then completes.

**Probing the tool at mount or at save, to fill the roster automatically.** It would spawn a process on behalf of a host that may never have signed in, at the one moment nothing asked it to, and turn a dormant mount into a process launch. Discovery is offered instead and runs only when a surface asks.

**Making the settings section replace the composition entry rather than overlay it.** It reads simpler — one source of truth — but it would mean a deployment that pins a route in `cordis.yml` loses it the moment a user adds one from the page. The seam's layering already answers this correctly.

## Consequences

Which adapters exist stays composition; which routes run becomes the user's settings document — the same split `arx-llm-pi-ai` already has, now true for both adapters the base bundle mounts.

A route configured from settings carries no credential anywhere: the settings document holds no key, no credential reference, and no place to put one. The package test asserts that the written document contains no `apiKeyEnv`, because this is the property a future editor could quietly break.

`resolveRoutes` now defaults the absent `providers` section itself, alongside every other default it materializes, and the two `?? {}` at its call sites are gone. Defaulting inside the resolve step is the package convention; the call sites had drifted into re-stating it, and one of the two restatements was unreachable because the schema already defaults the section before `validate` sees it.

Configuring this route is still a decision about a subscription's terms. The page makes that decision reachable; it does not make it safer.
