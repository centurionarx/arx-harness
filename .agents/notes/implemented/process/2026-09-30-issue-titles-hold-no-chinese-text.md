# Agent Note: Issue titles hold no Chinese text

Status: implemented

## Problem

The issue policy in `.github/issue-management/policy.mjs` came from a Chinese-language upstream and required a Chinese character in every Issue title. Its messages, the five issue templates, and the pull-request template were Chinese too. [The rule that Chinese text becomes Brazilian Portuguese](2026-09-29-chinese-text-becomes-brazilian-portuguese.md) contradicts the title rule directly: a title written only in Portuguese fails the policy, so Issue #26 carries a Chinese parenthetical after its Portuguese title only to pass.

## Decision

**The policy rejects an Issue title that holds Chinese text.** `validateIssue` reports `o título da Issue não pode ter texto em chinês` when the title contains a Han character. As in `verify-chinese-text`, kana, Hangul, and full-width punctuation alone are not Chinese text. The rule against Type, Priority, Status, area, and Owner prefixes stays.

**Templates and messages are Portuguese.** Each issue template asks for an action or result sentence in Portuguese and names its sections in Portuguese, and every policy message, audit comment, and CI error reads in Portuguese. The closing keywords (`Fixes`, `Related to`), the five native Types, and the Project Status names stay English, because GitHub and the policy match those exact words.

**The visible-body limit reads as words.** The limit stays at 50 units, where a unit is a Latin, numeric, or code token or a Han character. For Portuguese text that is a word count, so the templates and the message say `palavras`.

## Alternatives considered

**Drop the title rule.** Nothing would then stop an Issue titled in Chinese, which the owner's rule excludes, while the inverted check never fires on a Portuguese title.

**Require a Portuguese title.** No mechanical check tells Portuguese from English or Spanish; the absence of Han characters is the part of the owner's rule a check can decide.

## Consequences

- A title that quotes Chinese text, such as a UI string, fails the policy until it paraphrases the text; the body can still quote it.
- Issue #26 fails the title rule whenever the lifecycle job next audits it, until its Chinese parenthetical is removed.
- The Issue policy and Issue lifecycle workflows run the default branch's `policy.mjs`, so the new rule and messages apply from the merge on; the pull request that introduces them is still checked by the previous policy.
