---
name: ponytail-review
license: MIT
description: >
  Code review focused exclusively on over-engineering. Finds what to delete:
  reinvented standard library, unneeded dependencies, speculative abstractions,
  dead flexibility. One line per finding: location, what to cut, what replaces
  it. Use when the user says "review for over-engineering", "what can we
  delete", "is this over-engineered", "simplify review", or invokes
  /ponytail-review. Complements correctness-focused review, this one only
  hunts complexity.
---

## arx Harness integration

These are model-independent instructions, not a Claude Code plugin. Use the arx `skill` tool or explicit `/ponytail-review` invocation; do not run marketplace installers, hooks, auto-updaters, or write mode flags. Availability requires the session to expose the `skill` tool. Follow the repository instructions, requested scope, approval policy, security requirements, documentation obligations, and existing test framework. Never remove required validation or tests to reduce line count. Guidance remains ordinary logged context until compaction; no automatic activation, durable intensity setting, or child-context propagation is installed. For other capabilities, keep consulting the existing skills-globais catalog.


Review diffs for unnecessary complexity. One line per finding: location, what to cut, what replaces it. The diff's best outcome is getting shorter.

## Format

`L<line>: <tag> <what>. <replacement>.`, or `<file>:L<line>: ...` for multi-file diffs.

Tags:

- `delete:` dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` hand-rolled thing the standard library ships. Name the function.
- `native:` dependency or code doing what the platform already does. Name the feature.
- `reuse:` equivalent helper, util, or pattern already in this repo. Name the path.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` same logic, fewer lines. Show the shorter form.


## Examples

❌ "This EmailValidator class might be more complex than necessary, have you
considered whether all these validation rules are needed at this stage?"

✅ `L12-38: reuse: duplicated input validator. Reuse the established parser without weakening accepted-input validation.`

✅ `L4: native: moment.js imported for one format call. Intl.DateTimeFormat, 0 deps.`

✅ `L18-29: reuse: slugify helper duplicates src/lib/slug.ts slugify. Delete it, import the existing one.`

✅ `repo.py:L88: yagni: AbstractRepository with one implementation. Inline it until a second one exists.`

✅ `L52-71: delete: retry wrapper around an idempotent local call. Nothing replaces it.`

✅ `L30-44: shrink: manual loop builds dict. dict(zip(keys, values)), 1 line.`

## Scoring

End with the only metric that matters: `net: -<N> lines possible.`

If there is nothing to cut, say `No supported simplification found.` and stop. This is not a correctness or release approval.

## Boundaries

Scope: over-engineering and complexity only. Correctness bugs, security holes, and performance are explicitly out of scope. Route them to a normal review pass, not this one. Required repository coverage is not bloat: preserve unit, real-composition, snapshot, security, and lifecycle tests rather than treating one smoke check as sufficient. Does not apply the fixes, only lists them. "stop ponytail-review" or "normal mode": revert to verbose review style.
