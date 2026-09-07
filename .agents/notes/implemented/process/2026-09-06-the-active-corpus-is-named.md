# Agent Note: the active bilingual corpus is named, not inferred

Status: implemented

## Problem

The pairing gate required a complete Portuguese pair for every document in scope — 1 034 sources — while eight pairs existed. Every documentation gate that reads the corpus was red on the branch: the site build stopped at the first `.pt-BR.md` it could not find, `verify-md-links` reported every Portuguese link to a counterpart that did not exist, `verify-translation-pairing --list` printed 1 029 rows of `missing (required)`, and the Windows and static lanes failed on the same files. The [pairing decision](2026-07-02-bilingual-docs-and-pairing-gate.md) had made the requirement universal on purpose, with an exclusions-only manifest, so that no per-file list could fall out of step with discovery; the corpus switch from Chinese to Portuguese then emptied the corpus in one move and the universal requirement had nothing true to say.

Two rules already assumed a narrower corpus. The link rule says a Portuguese side links to a document *inside the active bilingual corpus* by its `.pt-BR.md` path and to one outside it by the authored path, and the site manifest's header says both locale routes project the available source when a translation is absent. Neither had a definition of "active" to read.

## Decision

`scripts/translation-pairing.manifest.json` gains `included`, a list of globs naming the active corpus; absent, every in-scope document is active, which is the behavior every existing manifest keeps. `translationPairSourcePredicate` is the one definition of "active" — in scope, not excluded, and matched by `included` when it is present — and every consumer reads it: the corpus-wide check requires a pair only inside the active corpus and lists a document outside it as `outside` rather than `missing`; link normalization on both sides of a pair follows it, so a Portuguese file links outside the corpus by the authored `.md` path; and `pairedPages()` in the site manifest projects the Portuguese side at the root locale exactly for active sources and the English source elsewhere, with `contentLocale` saying which.

A pair that exists outside the active corpus is still checked whole. The merge driver composes its record too: it refuses only an excluded source, not one outside `included`, because a half-merged pair is wrong wherever it sits.

`included` names the eight pairs that exist. The corpus grows by extending the list in the PR that lands a pair, so the pair's links, its counterpart, and the root route change together. `verify-translation-pairing` joins `doc-sync` as its README has said since July.

The pairs themselves were brought to green: three had no record, two carried no switcher, one had drifted on its English side, and every Portuguese side linked outside the corpus by a `.pt-BR.md` path that did not exist. The i18n README's Portuguese side carries `<a id="the-pairing-contract"></a>` so the pair's fragments stay identical while the heading is translated, the convention the root README already used.

## Alternatives considered

- **Keep the universal requirement and translate the corpus first.** Sixteen documents are the site's first wave and a thousand are not; the gates would stay red for the months the waves take, and every unrelated PR would be red with them.
- **Per-file `required` entries, dates, or README classes.** The original decision rejected these because an entry can fall outside discovery while appearing enforced. `included` is a filter over discovery, not a second list beside it: a glob that matches nothing requires nothing, and a document discovery does not find is never active.
- **Let the site fall back to English on a missing file without a manifest.** Hides a missing counterpart inside the active corpus, which is the one case the build must refuse.
- **Have the merge driver honor `included` too.** A pair outside the corpus that both branches edited would then fail to merge as "excluded", turning a rollout list into a merge hazard.

## Consequences

`doc-sync` is green on the corpus gates and the site builds with 8 Portuguese pages and English fallbacks elsewhere. `--list` reports 8 ok and 1 026 outside. The one new obligation is on whoever lands a pair: extend `included` in the same PR, which the skill's finish step now says. The site's root locale labels, navigation, and sidebar sections are still Chinese, as are the fixture strings of several translation specs; those are the documentation site wave's work and are inventoried in [the executable plan](../../proposed/process/2026-09-05-ship-sync-integrate-then-translate.md).
