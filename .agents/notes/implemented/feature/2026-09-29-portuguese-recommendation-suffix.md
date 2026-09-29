# Agent Note: A Portuguese recommendation suffix marks the recommended option

Status: implemented

## Problem

The `ask_user_question` tool tells the model to append `(Recommended)` to the option it recommends, and the question card in `arx-client-ui-user-questions` turns that suffix into a "Recommended" badge and removes it from the displayed label. The card also accepted the Chinese suffix a model writes in a Chinese conversation. A model answering a Brazilian Portuguese conversation often writes `(Recomendado)` or `(Recomendada)` instead, and the card showed that suffix as part of the label, without the badge.

## Decision

**`parseRecommendedLabel` accepts the Portuguese suffix.** A trailing `(Recomendado)` or `(Recomendada)`, in ASCII or full-width parentheses and in any letter case, marks the option as recommended exactly as `(Recommended)` does. The feminine form is included because a model agrees the adjective with the option's noun, for example "opção". The English and Chinese suffixes keep working, and the answer value stays the full label the model wrote.

## Alternatives considered

**Tell the model to write only the English suffix.** The tool description already asks for `(Recommended)`; a model writing Portuguese still translates it, and the card must render what the model sends.

**Match any parenthesized word.** It would turn ordinary parentheticals into badges; the parser matches the known suffixes only.

## Consequences

- In a Portuguese conversation, a recommended option shows its label without the suffix, beside the badge.
- The badge text comes from the `question` namespace, which still ships only English, so a Portuguese session reads "Recommended" on the badge until that namespace gains a `pt` dictionary.
- The suggestion for this change came from [the tool-card translation](../bug-fix/2026-09-27-tool-cards-follow-the-session-locale.md), which kept the Chinese suffix in the parser.
