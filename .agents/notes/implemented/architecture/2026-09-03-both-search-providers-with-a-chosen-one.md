# Agent Note: both search providers, with a chosen one

Status: implemented

## Problem

The web seam shipped selection semantics it could not exercise. `WebRuntime` reads `searchProvider` / `fetchProvider` once in its constructor, from the composition entry or the environment, and `resolveProvider` fails loud with `WEB_PROVIDER_AMBIGUOUS` when two usable providers are registered and nothing pins one. No bundle mounted a search provider at all, so the ambiguity path was unreachable and the choice was a deployment-time edit.

The browser had a card for this, bound to `web-search-deepseek`. That package no longer exists, so the namespace has no owner. Nothing renders — the configurable tab dispatches one slot key per served namespace, and an unserved namespace is never dispatched — so the card was dead code rather than a visible fault.

## Decision

The selection follows the settings document. `arx-web` declares `WEB_SETTINGS_NAMESPACE` and installs a section over its own `Config`; `searchProviderId` and `fetchProviderId` became getters that read the live source, then the environment. Selection already resolved per call, so a committed change is in force at the next search with nothing to re-register — `onChange` derives nothing and says so.

`arx-web-app` mounts both shipped providers, `web-search-exa` and `web-search-perplexity`. The base layer keeps mounting none: a provider is a deployment's decision, and base is not a deployment. The portal is, and it is the one surface with a settings page to resolve the ambiguity its own composition creates.

## Consequences

Both providers are dormant without a key — `available()` is false — so a portal nobody configured resolves exactly as it did with neither mounted. One key configured auto-selects that provider. Two keys configured make `web.searchProvider` load-bearing; left unset, the seam fails loud rather than letting composition order answer.

`arx-web` now depends on `@arx-ai/arx-settings`, matching `arx-shell`, which takes the same dependency to declare its own namespace.

The browser card still names the retired namespace. Rebinding it — one card per provider over its own section, plus the selection — is the remaining work; the cards render nothing until then, so the seam change stands on its own.

## Alternatives considered

**Mounting both in the base bundle.** Base documents the opposite on the row itself: no provider ships, because a deployment mounts the one it pays for. A shipped pair would make every non-portal deployment inherit an ambiguity it has no surface to resolve.

**Pinning one provider in the portal.** That is the shipped-default anti-pattern the no-shipped-default-model decision retired: it spends whichever account it points at and decides for a deployment what only that deployment knows.
