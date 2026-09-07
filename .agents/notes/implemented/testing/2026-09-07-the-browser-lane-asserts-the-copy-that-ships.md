# Agent Note: the browser lane asserts the copy that ships

Status: implemented

## Problem

`LOCALES` in [the locale registry](../../../../packages/client/locale/src/client/index.ts) ships one entry, `en`. Every dictionary under `packages/client/*/src/client/locales.ts` exports `en` alone, and no `zh` dictionary exists anywhere in the client. The browser lane did not follow: fifteen scenario files asked Playwright for `zh-CN`, drove the surface through Chinese role names, and compared against goldens written in Chinese. Each of those locators waited its full budget and the lane reported 43 failures — a quarter of `node 24 / snapshots and artifacts`, a required check.

The conversion exposed four defects the Chinese locators had been hiding, because a locator that never resolves never reaches the assertion after it.

`web-search-deepseek` left with the vendor rebrand, and with it the plugin card the `settings.plugin.item` slot rendered for web search. `plugin-config.e2e.ts` still counted three cards. Web search now owns a settings section of its own, [`ui-settings-web`](../../../../packages/client/ui-settings-web/README.md), which had no browser coverage at all.

`declared-reasoning.overlay.yml` pins the default model to the route the scenario declares, and the scaffold's own replay seed sits after the extra overlay in the patch list, so it silently replaced that pin. The effort pane describes the current model, and the current model was never the one the scenario came to test.

A Host with no native desktop opener renders the settings document's path and a copy button where a Host with one renders "Open configuration file", and `ProducedFiles` drops its "Show in folder" action the same way. Platform detection answers that question from the recording host: true on a macOS desktop and on a hosted Linux runner, which exports `DISPLAY`, and false in a bare container, which does not.

The four shipped `preset.yml` files under [`apps/cli/config/agent-presets`](../../../../apps/cli/config/agent-presets) still published Chinese display copy. The Web client overrides it for built-in presets through `presetDisplayText`, so the page reads English while the file a user duplicates carries Chinese into their own preset directory.

## Decision

Every browser scenario advertises `en-US` and asserts the dictionary value. `ZH_BROWSER_LOCALE` and `connectFreshWorkspaceZh` are gone from `apps/web/tests/support.ts`: the Chinese helper was character-for-character the English one, because the picker copy it targeted no longer exists. The `约…年`/`…月…日` duration and clock normalizers in `scaffold.ts` go with them — no shipped locale can produce those spellings.

Content whose subject is CJK stays: `markdown-cjk-strong.e2e.ts`, the wide-table sentence, the `关于我.md` filename in `produced-files.e2e.ts`, and the recorded prompt in `goal-multi-turn-actions.e2e.ts`, whose fixture would no longer replay. The custom-provider rename in `models-settings.e2e.ts` keeps a non-ASCII display name — `Acme Gateway São Paulo` — so the settings document still proves it round-trips a name outside ASCII.

`preset.yml` publishes the same English the dictionary does, so a duplicated preset carries the copy its source displays.

`plugin-config.e2e.ts` counts the two cards the composition contributes and names the file that covers the third surface. That file, `web-search-settings.e2e.ts`, is new: it pins the shipped page — both providers dormant, no key field, and the seam reporting `WEB_PROVIDER_UNAVAILABLE` — then drives a deployment that names the credential references through the key write, the ambiguity two usable providers produce, the pin, and the removal. The shipped scenario's golden records a real gap: the bundle mounts both providers with no config, so neither settings section carries an `apiKeyEnv` and the page has no reference to write a key under.

`launchWebScaffold` gained `nativeOpen`, pinned true — the answer both CI and a developer desktop give — and patched onto the `api-gateway` row. `settings-chrome.e2e.ts` drives the opener on the shared page and covers the path-and-copy branch in a scenario that asks for false, so both halves are pinned and neither depends on the recording host. Agent-preset authoring asks for false as well: where a duplicated preset landed is what it proves, and the section names that path only where no opener exists.

The scaffold skips its replay-route seed when the scenario's own overlay pins `agent-default-model`. A scenario that names a default came to test that route.

`shipped-composition.e2e.ts` asserted the retry policy of `deepseek-official`, a route no adapter serves since the vendor row retired. It now asserts what the dormant adapter contract actually gives: `providerRetryPolicy` throws until a settings section supplies a provider profile, and the composed default applies to the route that section creates.

`conversation-ui.client.spec.tsx` advances its fake clock through `advanceRendered`, which wraps the advance in `act`. A bare `advanceTimersByTimeAsync` yields one microtask; React's scheduler needs its own tick, and under coverage instrumentation the assertion after the advance read the pre-update tree. That one failing case was the whole of the coverage lane's shortfall — the hover-open and hover-close timers it drives were the twelve uncovered locations reported against `SubagentHeaderLineage.tsx`.

## Alternatives considered

- **Re-register a `zh` dictionary so the scenarios keep working.** Restores a locale the product deliberately dropped, and would have to be maintained against every key the English dictionaries add.
- **Keep the goldens Chinese and translate only the locators.** The goldens capture the rendered surface; they cannot spell copy the client no longer registers.
- **Leave `preset.yml` Chinese because the Web client overrides it.** The override covers built-ins only. A duplicated preset is user trust, gets no override, and would show its Chinese source copy in the picker.
- **Let `nativeOpen` follow platform detection and assert whichever branch appears.** A golden cannot record both, and a scenario that accepts either stops testing the control.
- **Pin `nativeOpen` false, matching a bare container.** The container is the outlier: a hosted Linux runner exports `DISPLAY` and a macOS desktop needs no detection, so false would remove an affordance that works on every host this lane runs on — which is exactly what it did to `ProducedFiles` before the value was corrected.
- **Delete the settings-language scenario now that one locale ships.** The row still writes a preference the Host owns across a reload and a distinct port; only the switch between two locales is gone, and that half is what the scenario now omits.

## Consequences

The browser lane is now a check on the copy the client registers. Adding a dictionary key that a scenario asserts and forgetting to register it fails the lane instead of passing on a locale nothing serves; renaming one fails it in the golden. The cost is that a copy change now touches the scenario and the golden together, which was already true of every non-locale string in the lane.

The two `nativeOpen` scenarios pin both branches of the same control, so neither the settings goldens nor `ProducedFiles` depends on whether the recording host has a desktop. A scenario that wants the other branch asks for it; a scenario that adds a surface offering "open this path" gets the desktop answer unless it says otherwise.

`web-search-settings.e2e.ts` records a shipped gap rather than fixing it: the Web bundle mounts both search providers with no `apiKeyEnv`, so the settings page it ships cannot accept a key and the section's own intro promises one. Wiring the references on those rows is a composition change with its own consequences for a deployment that resolves keys another way, so it is left to a change that can weigh them; the golden makes the current answer visible until then.

`hmr-live.e2e.ts` cannot run below Node 24 — `import-without-cache` throws from its `load` hook — so the local proof for this change is the rest of the pool. CI's `node 24 / snapshots and artifacts` is what covers that file.
