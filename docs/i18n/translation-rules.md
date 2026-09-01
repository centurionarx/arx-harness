# Translation rules

English | [Português](translation-rules.pt-BR.md)

How to translate between the two sides of a documentation pair in this repo. Both languages carry equal authority ([README.md](README.md)): a change is authored in either language, and that side is the source for that update — these rules govern producing or updating the counterpart. They bind humans and agents equally. Routine agent work translates the changed content directly in one terminology-guided pass; the extended [.agents/skills/arx-translate-docs](../../.agents/skills/arx-translate-docs/SKILL.md) workflow runs only when the user explicitly invokes it. Rule levels follow RFC 2119 usage: **MUST** / **MUST NOT** are gate- or review-blocking; **SHOULD** needs a stated reason to deviate; **MAY** is discretionary.

## Faithfulness

- The counterpart *MUST* say what the authored side says — no added behavior, prerequisites, warnings, version claims, or examples, and no dropped ones. If the pair disagrees on substance, neither language wins by default: fix the side that is wrong, then bring the other along in the same change.
- The counterpart *SHOULD* read as natural technical writing in its own language, not word-by-word gloss. Translate meaning, restructure sentences where the target grammar wants it, and keep the author's register — terse stays terse.
- Do not translate the untranslatable: if a sentence resists natural rendering because it leans on an idiom of the source language, translate the idea, not the idiom.

## Voice

- The register is calibrated by [style-samples.md](style-samples.md) — human-approved gold pairs, one per document genre. The counterpart MUST match the target-language side of the nearest sample; where its voice and a prose voice rule disagree, the sample wins. Portuguese targets use natural Brazilian technical Portuguese; English targets use concise professional developer prose.
- Write as a native technical author restating the content, not as a translator transposing sentences, while preserving every source clause: nothing added, nothing dropped — fluency never justifies losing a clause.
- Give sentences an explicit actor when the target language would otherwise obscure it; for Portuguese, replace vague passives or abstract subjects with the actual actor (o sistema, o gate, a revisão).
- Prefer established target-language engineering idiom over calques (falso positivo/falso negativo for false positive/negative; "atualizar o counterpart" for bringing a translation along, not "junto com o"); localize metaphors instead of transplanting them, and unpack noun chains where the target language requires it.
- Split long paragraphs by semantic unit — one idea per paragraph. Paragraph boundaries MAY differ from the source; the structural signature does not count paragraphs.
- When translating into Portuguese, category nouns use Portuguese with a first-mention English annotation (manual prático (cookbook)); when translating into English, use the conventional English category name. Literal directory or file references stay code-formatted English.

## Structure preservation

The pairing gate checks heading depths, fenced code blocks, table row and column counts, list kinds, ordered-list starts, list item counts, link locale, and semantic targets. Preserve the rest of the frame manually; the paired files MUST match one to one in:

- heading hierarchy (same levels, same order — heading TEXT is translated),
- list shape and numbering,
- tables (same columns, same row order; header cells translated per terminology),
- fenced code blocks — **byte-identical, including comments**; the pairing signature compares their info strings and contents, and ` ```ts ` blocks compile under `doc-typecheck`,
- inline code spans (commands, flags, config keys, file paths, event names, API names, version numbers) — verbatim, never translated or reformatted,
- links and anchors: every relative document link MUST keep the same semantic target and exact query/fragment suffix. When the target belongs to the active bilingual corpus, the English side uses its `.md` path and the Portuguese side uses its `.pt-BR.md` path; a missing counterpart in that corpus is an error, while targets outside it keep the original path. External URLs, images, and pure in-page fragments stay unchanged. The language switcher remains the explicit cross-locale exception, and a README rendered outside GitHub MAY use the canonical public repository URL to its exact counterpart as documented in [README.md](README.md). Link TEXT is translated.

The repo's Markdown conventions apply to `.pt-BR.md` files unchanged: one physical line per paragraph (`verify-md-wrap`), resolving relative links (`verify-md-links`), exactly one trailing newline.

## Terminology

- [terminology.md](terminology.md) is the source of truth in both directions. Before translating, load it; every listed term MUST follow its row and its "Do not translate as" prohibitions. A Portuguese target uses the "Portuguese" column and its "First occurrence" annotation; an English target uses the "English" column without adding a Portuguese gloss.
- For a Portuguese target, an unlisted technical term MAY use an established Brazilian rendering from major pt-BR vendor or OSS documentation, cited in the PR. Without such precedent it MUST stay in English and be listed under pending terms with a suggested rendering.
- For an English target, use the established English technical term. If the source term has no unambiguous established equivalent, preserve it with a short explanatory gloss and list it under pending terms. Neither direction may invent a rendering inline; a decided term enters [terminology.md](terminology.md) in the same PR or a follow-up.

## Typography

These rules govern the Portuguese side; the English side follows the repo's normal Markdown conventions (root `AGENTS.md`). The Portuguese conventions below follow Brazil's [Acordo Ortográfico da Língua Portuguesa](https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2006/decreto/d6.583.htm) as in force, in line with major pt-BR technical-documentation practices:

- MUST write Brazilian Portuguese (pt-BR): prefer Brazilian forms over European ones (`usuário`, not `utilizador`), except when the terminology table decides otherwise for a fixed product name.
- MUST use standard Latin (half-width) punctuation in Portuguese prose. Portuguese does not use CJK punctuation forms, and no space goes before sentence punctuation.
- Portuguese prose *SHOULD* prefer colons, periods, commas, or parentheses over em dashes; keep an em dash (travessão) only where it is the natural punctuation of the idiom.
- Use half-width digits and Latin letters, and keep current-orthography accents (`ação`, `sequência`, `não`); the trema is obsolete.
- Markdown emphasis markers do not create a word boundary; a bold or italic Portuguese word keeps ordinary single spaces around surrounding words.
- Proper nouns keep their canonical casing: GitHub, TypeScript, pnpm — never `github`/`Github` unless quoting code.
- Second person is `você` (or a bare imperative verb), never `tu`.
- Emphasis markers (`**bold**`, `*italic*`) stay on the same spans as the source; do not substitute quotation marks or other decoration for them.

## Quality bar

- A pair is done when a bilingual engineer reading either file alone gets everything a reader of the other gets — same facts, same caveats, same tone — and nothing extra.
- Run `pnpm run verify-translation-pairing` and the rest of `doc-sync` for records, switchers, heading depths, code blocks, table row and column counts, list kinds, ordered-list starts, list item counts, links, and repository Markdown rules. Human review owns list and table order, noncanonical list numbering, inline code, emphasis, meaning, terminology, and tone.

## References

Authorities cited by these rules, for humans and agents who want the underlying reasoning:

- [Acordo Ortográfico da Língua Portuguesa](https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2006/decreto/d6.583.htm) — the Brazilian orthographic agreement in force; accent, hyphen, and spelling forms this file assumes.
- [Microsoft Style Guides](https://learn.microsoft.com/en-us/globalization/reference/microsoft-style-guides) — the vendor-localization baseline family, including Brazilian Portuguese terminology and tone practice.
- [Google developer documentation style guide](https://developers.google.com/style) — the register-level conventions (terse direct prose, actors, second person) this file's Voice section mirrors.
- [MDN Web Docs (pt-BR)](https://developer.mozilla.org/pt-BR/) — an in-use pt-BR technical corpus for established renderings of web-platform terms.
