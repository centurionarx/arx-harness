# Agent Note: Chinese text becomes Brazilian Portuguese

Status: implemented

## Problem

The product and this repository came from a Chinese-language upstream. The UI dictionaries and the documentation pairing moved to Brazilian Portuguese ([translation language](2026-08-31-translation-language-brazilian-portuguese.md)), yet 429 tracked files still held Chinese text: the GitHub issue and pull-request templates, the issue policy's messages (the policy also required a Chinese character in every issue title), Agent Notes, test data, recorded transcripts, and the Chinese counterparts frozen in `.agents/notes/archived/`. The upstream import procedure translated imported strings to English, and nothing stopped a change from adding Chinese text.

## Decision

**Chinese text in any file is translated to Brazilian Portuguese.** The owner set this as a hard rule. English prose stays English: the rule replaces Chinese text only, so a Chinese sample inside an English document becomes a Portuguese sample, and an upstream `zh` dictionary becomes the `pt` dictionary.

**No tracked file holds a Han character.** On 2026-11-23 the owner removed the exception that had let a file keep Chinese text code must match. The question card's parser still recognizes the recommendation suffix a model writes in Chinese, because the owner kept that behavior; the source names the two characters by `\u` escapes. Tests of cell width, table wrapping, and emphasis against CJK punctuation use full-width Latin forms, which are double-width without being words of a language; where the emphasis extension classifies by script, the character after the closing marker is the Katakana-Hiragana prolonged sound mark (U+30FC), the nearest non-word character that code treats as CJK. The Chinese locale of the vendored HMR package's description and two unreferenced Chinese screenshots of the provider settings are removed.

**`verify-chinese-text` enforces the rule in `doc-sync`.** It scans every tracked text file, `vendor/` included, for Han characters and fails on any occurrence, naming the file and its first such line. It reads no exception list. Kana, Hangul, and full-width forms and punctuation alone are not Chinese text. The gate reads text only: a binary file such as a screenshot is outside it and is reviewed by eye.

**Upstream imports translate to Brazilian Portuguese.** `check-upstream-import` and the sync procedure name Brazilian Portuguese as the target language.

## Alternatives considered

**Translate Chinese text to English.** English matches the prose and code around most of this text, but the owner's rule names Brazilian Portuguese for every file.

**Keep an exception list for text code must match.** The first form of the gate listed such files in `scripts/chinese-text.manifest.json`. The owner's rule admits no Chinese text in any file, a `\u` escape keeps the one runtime match without the character, and a list that can grow is a way around the rule.

**State the rule without a gate.** Upstream imports and inherited tests would reintroduce Chinese text unnoticed; a rule that code can check belongs in an executed gate.

## Consequences

- The backlog started at 416 files and is empty since 2026-11-23: 286 archived-note files (143 Chinese counterparts and their frozen siblings), 37 active Agent Notes, 80 test and golden files, 8 GitHub templates and issue-policy files, the three files of the `arx-trim-cot-leakage` skill, the terminal README, and one translation script. The Goal fixture's recorded session log was translated by hand rather than re-recorded, because its replay reads only the assistant chunks; it no longer reproduces the bytes a model returned.
- The issue policy refuses Chinese text in an Issue title instead of requiring it ([decision](2026-09-30-issue-titles-hold-no-chinese-text.md)).
- The owner's rule outranks the archive freeze once. [The translation-language decision](2026-08-31-translation-language-brazilian-portuguese.md) had kept the archived Chinese counterparts frozen; on 2026-11-23 the owner decided that the 100 archived notes that do not name the model vendor carry a Brazilian Portuguese counterpart (`.pt-BR.md`) in place of the Chinese one, and that the 43 that name it are deleted as whole triplets. Archive manifest version 2 seals the result: `verify-archived-agent-notes` treats a version 1 baseline manifest as pinning nothing, and from version 2 on a sealed artifact is frozen again. A pull request whose base commit still holds the version 1 manifest is not bound by the seals until it takes a newer base, so the version 1 branch of `parseBaselineArchiveManifest` is removed once no open pull request has such a base. Links from the kept archived notes to the deleted ones stay as written, because links out of archived notes are not maintained.
- The root `AGENTS.md` ceiling in `scripts/doc-budgets.manifest.json` rose by 90 words for this rule and [the session-length rule](2026-09-29-a-long-session-names-its-handoff-point.md), which the owner set as standing orders.
