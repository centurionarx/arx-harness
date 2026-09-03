# Agent Note: The client ships one locale

Status: implemented

## Problem

The Web UI shipped two locales, `zh` and `en`, and the whole locale subsystem was built around that pair: `FALLBACK_LOCALE` served double duty as both the opening locale and the dictionary fallback *because* the two dictionaries were symmetric, and `scripts/locale-dictionary-parity.spec.ts` existed to gate that symmetry.

The product retired Chinese. `LOCALE_IDS` became `['en']` and every namespace dictionary was rewritten to English, but the change stopped at the source: the client locale package's `zh.ts` dictionary stayed on disk with nothing importing it, five `*.client.spec` files still staged `zh` on the runtime they constructed, and JSDoc across three packages still named `zh` as the key-set source of truth. `LocaleRuntime.setLocale` throws on an unregistered locale, so the specs that staged `zh` failed with `locale "zh" is not registered` — twenty-six failing assertions describing a language the product no longer ships.

## Decision

**English is the only shipped locale, and the dictionaries that encoded a second one are gone.** that `zh.ts` dictionary is deleted; `locales/index.ts` already exported `en` alone, so nothing lost a referent.

**The parity gate is retired with the invariant it guarded.** `scripts/locale-dictionary-parity.spec.ts` asserted that every shipped dictionary declares the same keys in `zh` and `en`. With one locale there is no second side to disagree, so the gate could only pass vacuously — and its own opening paragraph says a gate that silently narrows is worse than no gate. Restoring a real parity check is the job of whichever change adds the second locale, against that locale's dictionaries.

**Specs assert the shipped copy, not a staged language.** The five affected specs drop their `setLocale('zh')` and `usePinnedBrowserLanguages('zh-CN')` staging and assert the English strings the product actually renders. Two tests in `packages/client/ui-sidebar/tests/sidebar-snapshot.client.spec.tsx` lost their subject rather than their language: one pinned "the default locale, no `setLocale`" and became a duplicate of the `en` test beside it, and one drove a locale switch that has nowhere to switch to. Both are removed with the behavior they described.

**`FALLBACK_LOCALE` keeps both of its jobs.** It still answers "which language does the UI open in when the browser names none we ship" and "which dictionary backs a key the active locale misses". The second answer is now unreachable — a key missing from `en` has no other dictionary to reach — so the constant is documented as serving both roles without claiming a symmetry that no longer exists.

## Alternatives considered

**Keeping `zh.ts` as reference material for a future locale.** It reads as cheap insurance, and the file is a complete translation someone paid for. Rejected: nothing imports it, so no gate keeps it correct, and an unreferenced dictionary drifts from the English key set silently — the exact failure the deleted parity gate existed to catch. Git holds it for anyone who wants it back.

**Making the parity gate tolerate a single locale.** A guard clause returning early when `LOCALE_IDS.length === 1` keeps the file for the day a second locale lands. Rejected: it would report green while checking nothing, which is the state a reviewer is least equipped to notice.

**Adding `pt-BR` as the second UI locale now, so the two-locale machinery keeps its subject.** Brazilian Portuguese is the repository's documentation translation target, so pairing the UI to it looks like one consistent decision. Rejected here as a separate change: the documentation corpus and the UI dictionaries have different owners, different gates, and different completion states, and folding an unwritten dictionary into a cleanup would leave a second half-migration behind the first.

## Consequences

- Twenty of the suite's twenty-six stale failures resolve, and no product behavior changes: every string these specs now assert is the string the shipped English dictionary already rendered.
- The client can no longer demonstrate a locale switch in a test, because there is nothing to switch to. The switch mechanism itself is untouched in `packages/client/locale`; the first change to add a locale gets its coverage back along with the parity gate.
- `packages/client/ui-agent-preset` and `packages/client/locale` keep Chinese *fixture data* — row ids, option labels for a store that never registers them. They exercise arbitrary strings, not shipped copy, and rewriting them would churn tests without changing what they prove.
- `packages/client/ui-primitives` still declares Chinese `DEFAULT_LABELS` on its blocks. Every call site passes a complete label set derived from the locale service, so no viewer can reach them; they are dead defaults, and retiring them is a change to the primitives' own callers rather than to the locale subsystem.

- The browser e2e lane is not covered here. Twenty-three files under `apps/web/tests/` still open their page with `ZH_BROWSER_LOCALE` and assert Chinese copy, so that lane asserts a language the client no longer serves. It runs outside `pnpm run test`, which is why the unit lane reports green while it does not; retiring its staging is the same shape of change against a different suite.

## Related

[Browser-derived initial locale](../feature/2026-07-31-browser-derived-initial-locale.md) owns how the opening locale resolves; its two-locale rationale for the shared `FALLBACK_LOCALE` constant is superseded here.
