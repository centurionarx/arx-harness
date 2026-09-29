# Agent Note: The question card speaks Brazilian Portuguese

Status: implemented

## Problem

The `ask_user_question` tool tells the model to append `(Recommended)` to the option it recommends, and the question card in `arx-client-ui-user-questions` turns that suffix into a badge and removes it from the displayed label. The card also accepted the Chinese suffix a model writes in a Chinese conversation. A model answering a Brazilian Portuguese conversation often writes `(Recomendado)` or `(Recomendada)` instead, and the card showed that suffix as part of the label, without the badge. The card's own copy (pager, buttons, placeholder, badge, validation feedback, and the plan-review decision row) shipped only in English, so a Portuguese session read English chrome around Portuguese questions. The component spec's sample questions were Chinese text inherited with the product.

## Decision

**`parseRecommendedLabel` accepts the Portuguese suffix.** A trailing `(Recomendado)` or `(Recomendada)`, in ASCII or full-width parentheses and in any letter case, marks the option as recommended exactly as `(Recommended)` does. The feminine form is included because a model agrees the adjective with the option's noun, for example "opção". The English and Chinese suffixes keep working, and the answer value stays the full label the model wrote.

**The `question` namespace ships a `pt` dictionary.** The plugin registers `en` and `pt`, so a Portuguese session reads the card's chrome in Portuguese, including the "Recomendado" badge. The namespace leaves the English-only list of the locale parity gate.

**The component spec's sample text is Portuguese.** Its sample questions, options, answers, and failure messages are Brazilian Portuguese, as the owner's rule for inherited Chinese text requires. Only the parser cases for the Chinese suffix keep Chinese, because that suffix is text a model writes and the parser must match.

## Alternatives considered

**Tell the model to write only the English suffix.** The tool description already asks for `(Recommended)`; a model writing Portuguese still translates it, and the card must render what the model sends.

**Match any parenthesized word.** It would turn ordinary parentheticals into badges; the parser matches the known suffixes only.

## Consequences

- In a Portuguese conversation, a recommended option shows its label without the suffix, beside a "Recomendado" badge, inside Portuguese chrome.
- The web question scenario records the card on a page that asks for Brazilian Portuguese (`ui.pt-BR.expected.md`). That question is asked through the user-questions seam, so the scenario records no model round for it.
- Twenty-eight namespaces remain on the parity gate's English-only list.
- The suggestion for the suffix came from [the tool-card translation](../bug-fix/2026-09-27-tool-cards-follow-the-session-locale.md), which kept the Chinese suffix in the parser.
