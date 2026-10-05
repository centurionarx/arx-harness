---
name: ponytail-debt
license: MIT
description: >
  Harvest every `ponytail:` comment in the codebase into a debt ledger, so the
  deliberate shortcuts and deferrals ponytail leaves behind get tracked instead
  of rotting into "later means never". Use when the user says "ponytail debt",
  "/ponytail-debt", "what did ponytail defer", "list the shortcuts", "ponytail
  ledger", or "what did we mark to do later". One-shot report, changes nothing.
---

## arx Harness integration

These are model-independent instructions, not a Claude Code plugin. Use the arx `skill` tool or explicit `/ponytail-debt` invocation; do not run marketplace installers, hooks, auto-updaters, or write mode flags. Availability requires the session to expose the `skill` tool. Follow the repository instructions, requested scope, approval policy, security requirements, documentation obligations, and existing test framework. Never remove required validation or tests to reduce line count. Guidance remains ordinary logged context until compaction; no automatic activation, durable intensity setting, or child-context propagation is installed. For other capabilities, keep consulting the existing skills-globais catalog.


Every deliberate ponytail shortcut is marked with a `ponytail:` comment naming its ceiling and upgrade path. This collects them into one ledger so a deferral can't quietly become permanent.

## Scan

Grep the repo for comment markers, skipping `node_modules`, `.git`, and build output:

Use the arx `grep` tool with a comment-marker pattern such as `(#|//|/[*]).*ponytail:` on the requested source directories. Include repository-style TODO/FIXME/XXX prefixes before the marker. Confirm each match is an actual comment, not a quoted string or example. Exclude dependencies, generated output, imported skills, and caches from the report; add other comment prefixes for the language being inspected.

Each hit is one ledger row. The comment prefix keeps prose that merely mentions the convention out of the ledger.

## Output

One row per marker, grouped by file:

`<file>:<line>, <what was simplified>. ceiling: <the limit named>. upgrade: <the trigger to revisit>.`

The convention is `ponytail: <ceiling>, <upgrade path>`, so pull the ceiling and the trigger straight from the comment. Want an owner per row too? add `git blame -L<line>,<line>`.

Flag the rot risk: any `ponytail:` comment that names no upgrade path or trigger gets a `no-trigger` tag, those are the ones that silently rot.

End with `<N> markers, <M> with no trigger.` Nothing found: `No ponytail: debt. Clean ledger.`

## Boundaries

Reads and reports only, changes nothing. To persist it, ask and it writes the ledger to a file (e.g. `PONYTAIL-DEBT.md`). One-shot. "stop ponytail-debt" or "normal mode" to revert.
