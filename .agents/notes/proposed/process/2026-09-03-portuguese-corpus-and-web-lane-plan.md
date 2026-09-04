# Agent Note: the Portuguese corpus and the web lane, in executable order

Status: proposed

## Problem

Four bodies of work are open after the vendor retirement and the Web search settings section landed on `rebrand/arx` (`9884209ccb`), and none of them is a single change. The numbers below were measured on 2026-09-03 with the commands named beside them; re-measure before acting on them.

**The bilingual corpus is 0.5% translated.** `npx tsx scripts/verify-translation-pairing.ts --list` reports 1,025 documents in scope, 1,020 without a Portuguese counterpart, 1 out of sync (`docs/development.md`, whose English side changed after its record), 4 consistent. The missing side is 1,082,950 words: 603 implemented Agent Notes (653,606 words), 11 rejected notes (6,298), 86 documents under `docs/` (170,466) plus 14 under `docs/user/` (8,207) and 5 under `docs/cordis-api/` (5,301), about 275 package READMEs (about 228,000), and a long tail of 22 files under `apps/`, `examples/`, `python/`, `native/`, and the root (about 10,000). Archived notes are outside the scope by `TRANSLATION_SCOPE_GLOB_EXCLUDES` and stay frozen; their 143 legacy `.zh.md` files are not work.

**The order the user chose is blocked by the link rule.** The user chose the whole corpus, documentation site first. But `docs/i18n/README.md` makes a missing counterpart an error, and the pairing gate enforces it on every link a Portuguese file makes into the corpus: the 14 files under `docs/user/` link, transitively, to 739 documents (859,476 words), because pages cite `docs/`, which cite package READMEs, which cite Agent Notes. Under the rule as it stands, the site can be translated only after almost everything it cites. The foundation that every translation inherits is in place — `docs/i18n/terminology.md` (190 terms, English column byte-identical to the original, no two English terms sharing one Portuguese word), `style-samples.md`, `translation-prompt.md`, and a corrected `translation-rules.pt-BR.md` — so the block is the sequencing rule, not the vocabulary.

**The browser e2e lane still stages the retired locale.** 24 files under `apps/web/tests/` assert Chinese copy or set `ZH_BROWSER_LOCALE`, and 24 recorded goldens under `apps/web/tests/snapshots/` contain Chinese, so `pnpm run test:web` cannot pass. `apps/web/tests/onboarding-usable-provider.e2e.ts` drives a first-run dialog the vendor retirement deleted; `apps/web/tests/scaffold.ts` still patches the plugin rows `llm-deepseek` and `web-search-deepseek`, which no bundle mounts; `apps/web/tests/shipped-composition.e2e.ts` updates the settings namespace `llm-deepseek`, which no plugin owns. The Web search section therefore has no assembled-application transcript, which [docs/testing.md](../../../../docs/testing.md) requires for a product-visible change.

**Shipping and hygiene.** The branch carries 16 unreleased commits at version 1.0.8; the cadence in [docs/development.md](../../../../docs/development.md#version-cadence) wants a patch per shipped change. Pre-existing gate debt that predates this work: knip's eight findings (all in `scripts/translation-*.ts` and `packages/client/ui-directory-picker-browse/package.json`), one clone between `packages/hooks/hooks-claude-code/src/index.ts` and `packages/hooks/hooks-codex/src/index.ts`, `accessZh` in `packages/client/ui-permission-presets/src/client/locales.ts` without JSDoc, 11 lint errors (five from the single-element locale union in `packages/client/locale/src/client/index.ts`), and 11 environment-dependent test failures (pwsh, `claude-code`, `terminal-bash`) that CI's platform matrix owns.

## Proposal

The plan is eight phases. Phases 0 and 1 are independent of each other and of the corpus; Phase 2 is the machinery every wave depends on; Phases 3 to 7 are the corpus in waves; Phase 8 is debt. Each phase names the commands that prove it, and every commit follows the conventions in [AGENTS.md](../../../../AGENTS.md): split independent changes, one Agent Note per non-trivial change, `--force-with-lease` never raw `--force`, and nothing merged before checks pass.

### Read this before touching anything

These are the mistakes made while shipping the last seven commits; each cost a turn, and the executor can skip all of them.

- **Client bundle purity forbids runtime imports between browser plugins.** `packages/client/tsdown.client.ts` allows values only from the preloaded externals, the inline-safe wire layer (`INLINE_SAFE`: `arx-host-apiproxy`, `arx-file-reference`, `arx-session`, `arx-llm`, `arx-tools`, `arx-brand`), and generated `/remote` modules. A helper shared by two client plugins must live in one of those or be repeated with a `/* jscpd:ignore-start -- <reason> */` block naming the gate. Only `pnpm run build` enforces this; `vitest` and `typecheck` do not.
- **The pairing gate has two modes.** `--cached <records>` (the pre-commit hook) checks only the staged `.i18n.yaml` files; the corpus-wide check in `doc-sync` checks everything in scope. A pair whose Portuguese side links to a counterpart that does not exist fails both — the English side resolves to `arx-translation-target:<source>` and the sides diverge. Record a pair with `--write <english path>` only after both sides are final.
- **An Agent Note's language switcher sits on line 5.** Line 3 is `Status:`; `scripts/verify-agent-note-format.ts` and `scripts/archived-agent-notes.ts` both pin it. The pairing gate accepts the first switcher paragraph after the H1, so line 5 satisfies both; line 3 breaks the note gate.
- **`scripts/rescope-vendor.ts` walks `git ls-files`.** A file deleted from disk but still tracked fails the gate with `ENOENT`; stage the deletion before running `pnpm run hygiene`.
- **Generated regions are locked.** `docs/subsystems/*.md` carry `ts type-equiv` blocks that must match source JSDoc (`verify-type-equiv`); the `## Cordis API` regions come from `pnpm run gen-cordis-catalog`; `docs/config-catalog.md`, the graph documents, `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`, and `packages/extensions/tool-cordis/src/api-catalog.ts` are generated. Regenerate, never edit, and add new seam types to `LINK_MAP` and new event scopes to `EVENT_SCOPE_PAGE` in `scripts/gen-cordis-catalog.ts` or the generator refuses.
- **Coverage is 100% per file under `packages/*/*/src`.** Measure with `npx vitest run --coverage --coverage.include='<package>/src/**' --coverage.reporter=text <package>` before committing; an unreachable guard is a coverage hole, so restructure rather than exempt.
- **Workflows die at the session limit.** Two workflows were killed by "You've hit your session limit" mid-run today; both resumed from `resumeFromRunId` with completed agents cached. Keep batches small, checkpoint by committing per layer, and expect to resume. Ultracode is off: the Workflow tool needs the user to say "use um workflow" (or turn ultracode on) before any multi-agent run.
- **`pnpm run lint` sits at 11 errors and `pnpm run test` at 16 failures (4 files) on this branch.** Both are the baseline; measure against them, not against zero.

### Effort checkpoints

The plan is executed by a model whose reasoning effort the user sets per session, and the phases do not want the same level: two of them change contracts that a thousand files then inherit, while others are mechanical. At each checkpoint below the executor **stops before running the phase's first command** and ends its turn with this line, in the language the user writes in — for this user, Portuguese:

`PARADA <n> — ajuste o esforço do modelo para <level> e responda "continuar".`

It runs nothing from that phase until the reply arrives. A checkpoint reached with the effort already at the named level still stops: the stop is also where the user reads the previous phase's proof before paying for the next. Checkpoints govern the executor's own session; agents inside a workflow take the `effort` option their script gives them, and the table names those levels too.

| Checkpoint | Before | Set effort to | Why this level |
|---|---|---|---|
| 0 | Phase 0 | `medium` | The release script and the PR are mechanical; CI does the judging. |
| 1 | Phase 1 | `high` | Converting 24 tests and reading 24 golden diffs is judgment work: a wrong conversion becomes the new truth the moment it is re-recorded. |
| 2 | Phase 2a and 2c | `max` | Two contract changes — what the pairing gate calls the active corpus, and how a generator emits a second language. A wrong answer here propagates to every document translated afterwards. |
| 3 | Phase 2b, 2d, 2e, 2f | `high` | Scripts with specs, a re-sync, and the batch shape; correctness matters, the design is settled. |
| 4 | Phase 3 (wave 1) | `high` | Sixteen files translated interactively — the first real test of the terminology table and the style samples, read closely. |
| 5 | Phases 4 to 7 (waves 2 to 5) | `high` for the session; in workflow scripts, `effort: 'high'` for translators and verifiers and `'medium'` for link-flip and regeneration agents | Fidelity of meaning is the one thing no gate checks; the mechanical agents need none of it. |
| 6 | Phase 8 | `medium` | Lint, knip, one clone; small and local. |

Between checkpoints the level stays where the last one set it. A phase that is skipped or reordered keeps its own checkpoint.

### Phase 0 — ship the branch

Effort: `medium` — checkpoint 0.

1. `pnpm run release:arx patch` (1.0.8 to 1.0.9; it rewrites every manifest and commits; the lockfile follows).
2. `git push`, then `gh pr create --base master --head rebrand/arx` with one `kind/*` label, every material `area/*` label, and the native issue type, per the [label taxonomy](../../implemented/process/2026-08-08-unified-github-label-taxonomy.md). PRs #13 and #14 from this branch merged the same way.
3. Wait for CI; it owns the platform matrix and the pwsh lanes. Do not merge before it is green.

Proof: the PR's checks. This phase can run before or after Phase 1; it should not wait for the corpus.

### Phase 1 — the web e2e lane speaks English

Effort: `high` — checkpoint 1.

Scope: `apps/web/tests/*.ts` (24 files staging the retired locale), `apps/web/tests/support.ts` (owns `ZH_BROWSER_LOCALE`), the 24 goldens with Chinese under `apps/web/tests/snapshots/`, and the three files pointing at retired ids. The VM has Playwright's Chromium (`~/.cache/ms-playwright/chromium-1228`), so the lane runs locally.

1. Inventory: `grep -rlE "ZH_BROWSER_LOCALE|[一-龥]" apps/web/tests/*.ts` and `grep -rlE "[一-龥]" apps/web/tests/snapshots`.
2. Delete `apps/web/tests/onboarding-usable-provider.e2e.ts` and `apps/web/tests/snapshots/onboarding-usable-provider/`; its subject was retired with the first-run dialog, as [the vendor note](../../implemented/architecture/2026-09-03-the-vendor-is-configuration-not-a-brand.md) records.
3. In `apps/web/tests/scaffold.ts`, replace the `llm-deepseek` and `web-search-deepseek` row patches with the rows the portal actually mounts (`llm-pi-ai`, `web-search-exa`, `web-search-perplexity`); in `shipped-composition.e2e.ts`, drop the `llm-deepseek` namespace update and keep the `llm-pi-ai` one that follows it.
4. Convert every remaining assertion to the shipped English copy. The dictionaries are the source of truth: `packages/client/*/src/client/locales.ts`. Remove `ZH_BROWSER_LOCALE` and the `locale:` option on `browser.newPage(...)` once nothing reads them.
5. Add `apps/web/tests/web-search-settings.e2e.ts`: open Settings, enter Web search, assert one row per shipped provider with its usability dot, pin Perplexity through the select, store a key for Exa, and capture the aria golden through `captureStableAria` + `compareOrRefreshGolden` like the other files. The section's copy is `packages/client/ui-settings-web/src/client/locales.ts`.
6. Re-record: `pnpm run test:web:refresh`, then review every golden diff by eye — a refreshed golden that still contains Chinese, or a dialog title that changed meaning, is a bug in the conversion, not in the product.
7. Prove: `pnpm run test:web` green; `pnpm run test:web:ci` green.

Commit as one change with an Agent Note under `implemented/testing/`; the note's Problem section is paragraph three of this note's Problem.

### Phase 2 — the machinery the waves need

Effort: `max` for 2a and 2c (checkpoint 2), then `high` for 2b, 2d, 2e, and 2f (checkpoint 3). Do 2a and 2c first, stop, then the rest.

Do this before translating anything beyond a leaf, and record it as a process Agent Note.

**2a. An active corpus in the pairing manifest.** `scripts/translation-pairing.manifest.json` supports only `excluded`; `translationPairSourcePredicate` already models "the active bilingual corpus". Add `included` (an array of globs; absent means everything in scope, as today) and make `isTranslationPairSource` true only for files matching it. Effects, all of which the code already implements for excluded destinations: a Portuguese file may link to an English `.md` outside the active corpus with the original path; the corpus-wide check reports missing counterparts only inside it; `--list` stays honest. Widen `included` at the start of each wave. Write the spec cases in `scripts/translation-pairing.spec.ts` beside the existing `isTranslationScopeFile` cases, and update the contract paragraph in `docs/i18n/README.md` (and its Portuguese side, then `--write docs/i18n/README.md`).

**2b. A link flip.** When a wave widens the active corpus, every already-translated Portuguese file that linked to a now-included English `.md` must point at the `.pt-BR.md` instead, or the gate reports "wrong locale". `scripts/translation-links.ts` has the replacement machinery (`Replacement`, `languageSwitcherLinkOffset`); add `scripts/flip-translation-links.ts --write <wave globs>` that rewrites those targets and re-records the touched pairs, with a `--check` mode wired into `doc-sync`. Proof: after widening, `pnpm run doc-sync` reports no "wrong locale" line.

**2c. Generated documents.** The English sources listed under `requiresSourceLanguageSwitcher` in `scripts/translation-pairing.ts` (`docs/agent-lifecycle.md`, `docs/capability-seams.md`, `docs/config-catalog.md`, `docs/cordis-api/*.md`, `docs/event-producer-consumer.md`, and the rest of that list) are generator output, and no generator emits a Portuguese side today (`grep -n "pt-BR" scripts/gen-*.ts` is empty). Spike first: for each generator, decide whether the Portuguese side is the English generated regions verbatim plus translated prose kept in a template, or a second emission with locale-specific paths only (the `## Cordis API` region already says the sides differ only in paired document paths). Implement emission for the generators whose documents fall in the current wave; if a generator needs more than a day, add its documents to `excluded` with an audit reason and an Agent Note, and take them back later.

**2d. Re-sync `docs/development.md`.** Its English side changed in `b2266a3aa7` after the record. Bring `docs/development.pt-BR.md` along with a minimal patch against `git diff 13fd1f1125..HEAD -- docs/development.md`, then `--write docs/development.md`.

**2e. A terminology gate.** `docs/i18n/terminology.md` carries a "Não traduzir como" column of forbidden renderings. Add `scripts/verify-translation-terminology.ts`: for every `.pt-BR.md` in the active corpus, report any forbidden rendering that appears as a whole word outside code spans and fences, plus any Chinese character. Wire it into `doc-sync`. This is the cheapest defense against the drift that a thousand documents would otherwise accumulate silently; it would have caught `parâmetro` for `counterpart` on day one.

**2f. The batch shape.** One workflow per batch of eight to ten documents, each agent translating whole files against `docs/i18n/translation-prompt.md`, the terminology table, and the nearest gold pair in `style-samples.md`; one verifier per batch that runs the structural check (`npx tsx scripts/verify-translation-pairing.ts <records>`), the terminology gate, `verify-md-wrap`, and `verify-md-links` on the batch, and reads two files of the batch adversarially against the English. Record pairs only after the verifier passes. The `.agents/skills/arx-translate-docs` skill is the extended per-pair workflow and stays the reference for a single hard document.

Proof for the phase: `pnpm run doc-sync` green with `included` set to the four pairs that exist today plus `docs/development.md`.

### Phase 3 — wave 1, the documentation site

Effort: `high` — checkpoint 4. No workflow: sixteen files are interactive work.

The site's sources are the `source:` rows of `website/docs.ts` — 16 distinct files today (10,420 words), none of them generated: `docs/user/index.md`, the four `docs/user/guide/` pages, the nine `docs/user/develop/` pages, `docs/cordis-primer.md`, and `docs/cookbook/adding-a-conversation-node.md`. Read the list from the file rather than from here, and set `included` to exactly those files plus their `docs/i18n/*` neighbors. Under the active-corpus rule their links into `packages/` and `.agents/notes/` legitimately keep the `.md` path, so the wave is link-closed by construction.

Proof: `pnpm run doc-sync` green including `documentation build` and `documentation site checks`; `scripts/project-doc-site.spec.ts` green (its five red cases are exactly the missing site counterparts); `pnpm run website:build` green.

### Phase 4 — wave 2, the rest of `docs/`

Effort: `high` — checkpoint 5 covers Phases 4 to 7; translators and verifiers run at `effort: 'high'`, link-flip and regeneration agents at `'medium'`.

The remaining 86 files (170,466 words) plus `docs/cordis-api/` (generated). Widen `included` to `docs/**`, run the link flip, translate in batches; the generated documents come through the Phase 2c emission.

Proof: `doc-sync` green; `--list` shows no missing counterpart under `docs/`.

### Phase 5 — wave 3, package READMEs

Effort: `high` — no checkpoint of its own; checkpoint 5 covers this wave.

About 275 files (about 228,000 words), grouped by package group so each batch shares vocabulary (`packages/client/*` alone is 43 files and 33,593 words). Widen `included` to `packages/**/README.md`, flip links, translate. `verify-package-readme-model-experience` and the type-equiv gate read the English side only, so nothing there changes.

Proof: `doc-sync` green; `--list` shows no missing counterpart under `packages/`.

### Phase 6 — wave 4, Agent Notes

Effort: `high` — no checkpoint of its own; checkpoint 5 covers this wave.

603 implemented and 11 rejected notes (659,904 words). Widen `included` to `.agents/notes/implemented/**` and `.agents/notes/rejected/**`, flip links, then translate leaves first — 174 notes link to nothing else in the corpus — and the rest in link order, so no batch ever waits on a later one. Every Portuguese note carries its switcher on line 5. This wave also lands the `parâmetro` correction in `.agents/notes/implemented/process/2026-07-02-bilingual-docs-and-pairing-gate.pt-BR.md` and `docs/i18n/README.pt-BR.md` (nine and four occurrences of the mistranslation; the terminology gate will name them).

Proof: `doc-sync` green; `verify-agent-note-format` green across the pairs; `--list` shows no missing counterpart.

### Phase 7 — wave 5, the long tail

Effort: `high` — no checkpoint of its own; checkpoint 5 covers this wave.

`README.md`'s siblings at the root (`BRAND_GUIDELINES.md`, `CONTRIBUTING.md`), `apps/` (3), `examples/` (7), `python/` (4), `native/` (5), `packages/README.md`, `.agents/notes/README.md`. Set `included` to everything in scope; from here the manifest field can be removed and the rule returns to "everything must merge bilingual".

Proof: `--list` reports 0 missing, 0 out of sync; `doc-sync` green; the pre-commit `--cached` check and the corpus check now agree.

### Phase 8 — debt that predates this work

Effort: `medium` — checkpoint 6.

Independent, small, and worth one commit each: the knip findings (delete or reference `scripts/gen-translation-brief.ts` and `scripts/verify-translation-prompt.ts`, drop the two unused devDependencies, remove the five unused exports and three types); the hooks clone (extract or mark with a reason); the `accessZh` JSDoc; the five lint errors the single-element locale union causes (`packages/client/locale/src/client/index.ts`), which want the comparisons rewritten rather than the union widened.

Proof: `pnpm run hygiene`, `pnpm run duplication`, and `pnpm run lint` at zero.

### Backlog, trigger-based

- A fetch-provider directory and observable fetch selection on `ctx.web`, when a second fetch provider needs configuring.
- Per-provider cards for endpoint, search mode, and model on the Web search section, when a field needs a control the settings document does not already give.

## Acceptance criteria

- Phase 0: PR merged to `master` with CI green, version 1.0.9 or later.
- Phase 1: `pnpm run test:web` and `pnpm run test:web:ci` green on this VM; no Chinese under `apps/web/tests/`; a `web-search-settings` golden exists.
- Phase 2: `included` documented and enforced; `flip-translation-links --check` and `verify-translation-terminology` run in `doc-sync`; `docs/development.md` consistent; the generator decision recorded.
- Phases 3 to 7: after each wave, `verify-translation-pairing --list` reports no missing counterpart inside the active corpus and `pnpm run doc-sync` is green; after Phase 7, 0 missing overall.
- Every wave's Portuguese files pass the terminology gate and the structural check; a 20% sample per batch was read adversarially against the English and the findings fixed before the pairs were recorded.
- Phase 8: `hygiene`, `duplication`, `lint` at zero.

## Risks

- **Terminology drift across a thousand files** is the quiet failure; the terminology gate (2e) and the batch verifier are the mitigation, and neither exists yet. Do not start Phase 4 without 2e.
- **Link flips touch already-recorded pairs**; every flip re-records them, so a flip that lands wrong looks consistent. Review the flip diff, not only the gate.
- **Generated documents** may need generator changes larger than a spike; the exclusion escape hatch in 2c keeps a wave from stalling on them.
- **Session limits interrupt workflows**; committing after every verified batch is the only checkpoint that survives.
- **The e2e goldens** are re-recorded wholesale in Phase 1; a conversion mistake becomes the new truth unless every diff is read.
- **Cost**: the corpus is roughly a million words of output plus review; budget it per wave and stop between waves, never mid-batch.

## Alternatives considered

- **Translate leaves first and the site last**, honoring the link rule as written. Correct and mechanical, but it inverts the order the user chose and defers the only user-visible outcome — a Portuguese site — to the end of a million words. The active corpus keeps the rule's intent (a link inside the bilingual corpus resolves in both languages) while letting the corpus grow in the chosen order.
- **A migration flag that tolerates missing counterparts everywhere.** Simpler than 2a, but it makes the gate lie for the whole migration instead of telling the truth about a declared scope.
- **Excluding generated documents from pairing permanently.** Removes 2c, but leaves the Portuguese site without its catalogs and API pages, which are among the most-read documents.
- **Translating archived notes.** Out of scope by the manifest and frozen by the archive gate; the 143 legacy `.zh.md` files stay as they are.
