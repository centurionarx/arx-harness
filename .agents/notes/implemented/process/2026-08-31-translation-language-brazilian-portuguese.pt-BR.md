# Agent Note: A documentação é bilíngue em inglês e português do Brasil

Status: implemented

[English](2026-08-31-translation-language-brazilian-portuguese.md) | Português

## Problem

Every document in pairing scope was maintained in English and Simplified Chinese. The project's readership is Portuguese-speaking, and no Chinese-first contribution had landed; every pair cost a full translation pass into a language with no readers. The pairing machinery — terminology, prompt template, gates, merge driver — was built around a second language the project no longer serves.

## Decision

The second language of the pairing contract is Brazilian Portuguese. Concretely:

- The counterpart suffix is `.pt-BR.md`, replacing `.zh.md` across the active pairing scope; each pair remains the same three sibling files (English source, Portuguese counterpart, consistency record).
- The website's second locale is `pt-BR`, with `pt-br-*` route prefixes and switchers of the form `English | [Português](…)`.
- The terminology source of truth, the translation rules, and the pipeline prompt template are rewritten for Portuguese, and `translation-prompt.ts` renders the Portuguese direction.
- The consistency-record keys and the gates that read them (`verify-translation-pairing`, `verify-archived-agent-notes`, the pairing manifest, the `arx-translation-pairing` merge driver configuration) accept the new suffix.
- The frozen `.agents/notes/archived/` tree keeps its Chinese triplets: archived sources are never rewritten, and their verification accepts both suffixes in the frozen tree.

## Alternatives considered

- **Keep Simplified Chinese as the second language.** Rejected: it costs a translation pass on every pair while serving no current readership; the cost was paid on every change with no offset.
- **Drop the second language entirely.** Rejected: the documentation is read by people and agents outside the organization, and the pairing contract keeps review pressure on the English source; a second reviewed language is the mechanism, not the overhead.
- **Locale directories (`docs/pt-br/…`).** Rejected: the three-sibling-files contract already solves discovery, keeps pairs merging whole, and avoids duplicating every directory; a locale tree would re-create the layout the contract deliberately avoids.

## Consequences

- Pairing work updates Portuguese; the terminology table is the first stop for any new term, and its `不要译作` column becomes a Portuguese "não traduzir como" column.
- The conversion of the existing corpus happened in the same change: the 397 Chinese counterparts were translated once, after the brand-naming sweep had settled the English sources, so no pair was translated twice.
- Bilingual gates keep their mechanics; only the suffix, locale, and prompt template changed.
