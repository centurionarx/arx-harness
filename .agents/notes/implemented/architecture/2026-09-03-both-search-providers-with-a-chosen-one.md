# Agent Note: both search providers, with a chosen one

Status: implemented

## Problem

The web seam shipped selection semantics it could not exercise. `WebRuntime` reads `searchProvider` / `fetchProvider` once in its constructor, from the composition entry or the environment, and `resolveProvider` fails loud with `WEB_PROVIDER_AMBIGUOUS` when two usable providers are registered and nothing pins one. No bundle mounted a search provider at all, so the ambiguity path was unreachable and the choice was a deployment-time edit.

The browser had a card for this, bound to `web-search-deepseek`. That package no longer exists, so the namespace has no owner. Nothing renders — the configurable tab dispatches one slot key per served namespace, and an unserved namespace is never dispatched — so the card was dead code rather than a visible fault.

## Decision

The web seam reports its own topology, and the portal renders it the way the Models page renders model providers. `arx-web` keeps a configurable-provider directory beside the search registry — a provider declares the settings namespace and path where its profile lives — answers `searchSelection()` without executing a search, and fires `web/providers-updated` at every search-registry commit with contained listener failures. Selection follows the `web` settings section at runtime, ahead of the environment and the composition entry.

Exa and Perplexity each install a settings section over their own `Config`, read their options at every search, resolve the key through `apiKeyEnv` — an inlined `apiKey`, then the managed credential store, then the launch environment, re-reading the store when that reference changes — and declare themselves in the directory. `apiproxy` serves `web.providers`: registered providers joined with the directory, plus the selection the next search would resolve. `ui-settings-web` is the browser half: one row per provider with its usability and key state, a select that pins a provider or hands the choice back to the seam's rules, and a key control writing through the credentials domain under the reference the provider's section names.

`arx-web-app` mounts both shipped providers. The base layer keeps mounting none: a provider is a deployment's decision, and base is not a deployment. The portal is, and it is the one surface with a settings page to resolve the ambiguity its own composition creates.

## Consequences

Both providers are dormant without a key — `available()` is false — so a portal nobody configured resolves exactly as it did with neither mounted. One key configured auto-selects that provider. Two keys configured make `web.searchProvider` load-bearing; left unset, the seam fails loud rather than letting composition order answer, and the section says so in words.

A key saved through the portal reaches the provider that resolves it, which it never did before: the providers read the launch environment alone. The `web-search-deepseek` card in `ui-settings-plugins` is gone with the namespace it named; that package ships the shell and agent-loop cards only.

`arx-web` depends on `@arx-ai/arx-settings`, matching `arx-shell`, and exposes a `./types` subpath the remotes assembly reads event merges from, the way `arx-llm` does. Fetch publishes none of this; its directory follows when a second fetch provider needs configuring. The web e2e lane still stages the retired second locale, so the section's assembled-application transcript waits on that migration.

## Alternatives considered

**Mounting both in the base bundle.** Base documents the opposite on the row itself: no provider ships, because a deployment mounts the one it pays for. A shipped pair would make every non-portal deployment inherit an ambiguity it has no surface to resolve.

**Pinning one provider in the portal.** That is the shipped-default anti-pattern the no-shipped-default-model decision retired: it spends whichever account it points at and decides for a deployment what only that deployment knows.

**Three plugin-configuration cards, one per namespace.** Cheaper, but it invented a second pattern beside the Models page for the same problem — several registered providers, each with a key, one selected — and the selection card would still have needed the wire to learn which providers exist. The directory-driven section reuses the pattern the repository already has.

**A text field for the provider id.** Zero new wire, and the user types `exa`. It would have shipped the choice without the facts a choice needs: which providers are mounted, which are usable, and which one the seam would run.
