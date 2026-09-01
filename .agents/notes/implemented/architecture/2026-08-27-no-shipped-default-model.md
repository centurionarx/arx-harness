# Agent Note: no shipped default model

Status: implemented

## Problem

The base bundle named `deepseek-official` / `deepseek-v4-flash` as the default for every Agent an entry point creates, and pinned `deepseek-official` as the web-search provider. A shipped default silently spends whichever account it points at, and it decides for a deployment what only that deployment knows.

## Decision

Neither is named. `agent-default-model` keeps its composition entry and its settings section; both `provider` and `model` became optional, and `currentSelection()` returns `undefined` until a deployment composes a default or a user saves one. The pair is meaningful only together: half a selection names no reachable route, so it is no selection.

`searchProvider` was already optional with documented selection semantics — exactly one usable registered provider auto-selects, two fail loud as `WEB_PROVIDER_AMBIGUOUS`. Pinning DeepSeek overrode that with a composition-order answer, so the pin is gone.

## Consequences

`AgentOptions.provider` and `.model` were already optional, so an Agent is created with no model seed rather than a fabricated one. The web BFF refuses the first request that needs a model, naming that nothing is selected — the same refusal path a session already took when its route had no adapter. `SessionModels.current` became optional and `routable` is false without a selection, so the surface that blocks input reads one field for both causes.

Headless throws instead: it runs one task and exits, with no picker to fall back on, so it has to say which model the run uses.

`llm-deepseek` and `web-search-deepseek` remain mounted and dormant without a key — neither inlines an endpoint or credential — so DeepSeek stays available by API key to a deployment that wants it. What changed is that nothing ships pointed at it.

## Alternatives considered

**Disabling the `agent-default-model` entry.** Both `bundle/headless` and `host/apiproxy` declare it in `inject`, so an absent service blocks them from loading and the web app never starts.

**Naming a different provider as the shipped default.** Every candidate has the same defect as DeepSeek: the bundle cannot know which account a deployment holds, and a wrong guess spends someone's quota on first launch.

**Keeping the default and documenting how to change it.** The request was that the user choose. A default that must be overridden is still a choice the bundle made, and the first session runs before anyone reads the documentation.
