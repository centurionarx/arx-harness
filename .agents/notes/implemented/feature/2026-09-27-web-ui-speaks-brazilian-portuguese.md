# Agent Note: The Web UI speaks Brazilian Portuguese around the composer

Status: implemented

## Problem

The owner works in Brazilian Portuguese and asked for the mode menu (the Standard, PTC, Minimal and Creator modes, their descriptions, and "Starts a new session in this mode") and for the model, effort and access pickers in pt-BR, with the effort levels named Baixo, Médio, Alto, Extra and Máx. The client shipped one locale since [the client ships one locale](../simplification/2026-09-03-the-client-ships-one-locale.md), and the typed `register(ns, dicts)` required a dictionary for every shipped locale, so adding a second locale meant translating about 930 strings across 36 namespaces in one change.

The effort labels were not client copy at all. Adapters name each level by capitalizing its id (`Xhigh` for `xhigh`), and the Host renders one model catalog for every viewer without knowing the viewer's locale; a remote browser keeps its locale in the page process only.

## Decision

**A second locale, `pt`.** `LOCALE_IDS` is `['en', 'pt']`. The id is the primary language subtag, as for `en`, so a browser asking for any `pt-*` tag opens in Portuguese; `<html lang>` carries `pt-BR`, and the Language row lists "Português (Brasil)". `locale.preference: pt` in `settings.yaml` selects it for every browser that shares the ARX home.

**English is required, other locales are optional.** The typed registration takes `{ en, pt? }` (`LocaleDictionaries<N>`): English stays complete, and a `pt` dictionary, when present, carries exactly the English key set. A namespace registered without `pt` renders English while `pt` is active, because the lookup chain falls back to English per key.

**The parity gate returns, with an explicit list.** `scripts/locale-dictionary-parity.spec.ts` reads every dictionary from the AST, requires each `pt` dictionary to declare exactly its English keys, and requires every English dictionary without a Portuguese counterpart to be named in its `ENGLISH_ONLY` list. An entry that no longer names an English-only dictionary fails the gate, so the list shrinks as translations land and always shows what remains in English.

**Translated surfaces.** The shared `common` vocabulary, the Language row, the mode menu and preset management (`settings.agentPreset`), the model and effort menu (`model`), the composer with its access chip (`conversation`), the `/permission` picker (`permission.access`) and the Permission row (`settings.permission`). Terms follow [docs/i18n/terminology.md](../../../../docs/i18n/terminology.md): agent, subagent, skill, workflow, preset and prompt stay in English.

**The client labels the shared effort ids.** `effort-labels.ts` in `arx-client-ui-model-selection` maps `off`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max` to locale keys: Desligado, Mínimo, Baixo, Médio, Alto, Extra and Máx in Portuguese, and Off, Minimal, Low, Medium, High, Extra high and Max in English. Which levels a model offers still comes from the Host; an id outside the shared set shows the name the Host reports.

**Access presets follow one label rule on all three surfaces.** Full access and the Host's `custom` state always show the locale's product label. `read-only` and `workspace-write` show it while the Host reports no operator-given name, and an operator's name renders as written.

## Alternatives considered

**Translate every namespace in this change.** It avoids a mixed UI, at about 930 strings across some 60 files. The owner chose the requested screens first; the gate's `ENGLISH_ONLY` list keeps the untranslated rest visible instead of silent.

**Locale id `pt-BR`.** It names the variant directly, but the locale id is the primary subtag by design: browser detection compares primary subtags, so `pt-BR` as an id would need its own matching rule, and the regional tag already lives in the `<html lang>` table.

**Localize the effort names on the Host.** One catalog serves every viewer, and the Host has no per-viewer locale, so it cannot choose a language for a remote browser. The ids are already a shared vocabulary across the model routes, which makes a client-side label table enough.

**Keep every locale required and register English copies as `pt`.** A copied dictionary passes a key-set check while rendering English, which hides the untranslated namespaces from the gate that exists to show them.

**An "UltraCode" entry in the effort menu.** The owner's example for the Claude subscription route listed it after Máx. In the vendor SDK it is not an effort level: it is a session setting that runs extra-high effort plus the CLI's own workflow orchestration. The harness drives that CLI as one model call with its tools refused, so the entry would name orchestration that never runs; the effort menu offers the levels the model reports.

## Consequences

- Under `pt`, every namespace in `ENGLISH_ONLY` (settings pages other than the Language and Permission rows, tool rows) still renders English, so the Portuguese UI is mixed until those namespaces are translated.
- The plugin inventory tab shows the preset names the files publish, in English, because its namespace ships English only.
- Text captured at registration time outside the slot render path, such as the `/model` command description, keeps the language it was registered under until it registers again.
- The English label for `xhigh` reads "Extra high" instead of the adapter's "Xhigh".
- A later namespace translation is a local change: add `pt` beside `en`, register both, and remove the entry from `ENGLISH_ONLY`.
