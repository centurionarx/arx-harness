# Agent Note: Chinese text becomes Brazilian Portuguese

Status: implemented

## Problem

The product and this repository came from a Chinese-language upstream. The UI dictionaries and the documentation pairing moved to Brazilian Portuguese ([translation language](2026-08-31-translation-language-brazilian-portuguese.md)), yet 429 tracked files still held Chinese text: the GitHub issue and pull-request templates, the issue policy's messages (the policy also required a Chinese character in every issue title), Agent Notes, test data, recorded transcripts, and the Chinese counterparts frozen in `.agents/notes/archived/`. The upstream import procedure translated imported strings to English, and nothing stopped a change from adding Chinese text.

## Decision

**Chinese text in any file is translated to Brazilian Portuguese.** The owner set this as a hard rule. English prose stays English: the rule replaces Chinese text only, so a Chinese sample inside an English document becomes a Portuguese sample, and an upstream `zh` dictionary becomes the `pt` dictionary.

**A file keeps Chinese text only when code must match that exact text.** The question card's parser recognizes the recommendation suffix a model writes in Chinese, the translation scripts read the switcher of the archived Chinese counterparts, and tests of CJK cell width, table wrapping, and emphasis need the characters they exercise. Where a user sees such a literal, a Portuguese parallel sits beside it, as the Portuguese recommendation suffix does.

**`verify-chinese-text` enforces the rule in `doc-sync`.** It scans every tracked text file outside `vendor/` for Han characters and compares the result with `scripts/chinese-text.manifest.json`: `literal` maps each file of the exception above to its reason, and `pending` lists the translation backlog. An unlisted file holding Chinese text fails, and so does a listed file holding none, so the backlog only shrinks and adding a `pending` entry breaks the rule. Kana, Hangul, and full-width punctuation alone are not Chinese text; `vendor/` follows its own sync procedure.

**Upstream imports translate to Brazilian Portuguese.** `check-upstream-import` and the sync procedure name Brazilian Portuguese as the target language.

## Alternatives considered

**Translate Chinese text to English.** English matches the prose and code around most of this text, but the owner's rule names Brazilian Portuguese for every file.

**State the rule without a gate.** Upstream imports and inherited tests would reintroduce Chinese text unnoticed; a rule that code can check belongs in an executed gate.

## Consequences

- The backlog starts at 416 files: 286 archived-note files (143 Chinese counterparts and their frozen siblings), 37 active Agent Notes, 80 test and golden files, 8 GitHub templates and issue-policy files, the three files of the `arx-trim-cot-leakage` skill, the terminal README, and one translation script. Recorded transcripts among the goldens change only by re-recording with a model key.
- The issue policy refuses Chinese text in an Issue title instead of requiring it ([decision](2026-09-30-issue-titles-hold-no-chinese-text.md)).
- [The translation-language decision](2026-08-31-translation-language-brazilian-portuguese.md) kept the archived Chinese counterparts frozen; translating or deleting them needs the owner's decision and a change to `verify-archived-agent-notes`.
- A change that translates a file removes its manifest entry in the same change.
- The root `AGENTS.md` ceiling in `scripts/doc-budgets.manifest.json` rose by 90 words for this rule and [the session-length rule](2026-09-29-a-long-session-names-its-handoff-point.md), which the owner set as standing orders.
