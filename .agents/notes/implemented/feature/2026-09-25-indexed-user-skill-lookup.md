# Agent Note: Indexed lookup for user-explicit skills

Status: implemented

## Problem

A shared skill repository contains more names than the resident model-facing catalog can afford. The filesystem provider must read each `SKILL.md` to discover it. A user who types `/name` for a non-resident skill gets ordinary prose rather than an injection, although the complete repository is present on the host.

## Decision

`arx-tool-skill` accepts an optional absolute `indexedSkillRoot` (or `ARX_INDEXED_SKILL_ROOT`). A direct user `/name` gesture first resolves against the ordinary scoped skill registry. Only a registry miss checks that root’s bounded `catalogo/indice-skills.tsv`, looking for one exact valid name. A hit loads `<root>/<name>/SKILL.md` through the filesystem provider parser, canonicalizes the path, checks that it remains inside the root, and rechecks the actual skill name and user-invocation policy. The index is a discovery hint, not permission to load a body.

Indexed names are absent from model-facing catalog entries, the `skill` tool, and the Web slash menu. The user types the exact gesture. The ordinary registry remains authoritative for a colliding name, even if its definition is not user-invocable. The optional root is explicit so other ARX installations and hermetic tests do not inherit a host-specific catalog.

## Alternatives considered

- **Publish every skill through the filesystem provider** — its listing reads all bodies and its model-facing catalog includes the entire repository. The name-and-description overhead exceeds the resident budget; the indexed fallback avoids that cost.
- **Treat the TSV description as the skill definition** — the TSV can be copied without bodies and lacks invocation policy. Re-reading the actual `SKILL.md` avoids granting permission from stale or incomplete metadata.
- **Override the slash menu to list all indexed names** — that gives the browser a large directory response and retains the user’s context cost problem in another surface. The exact typed name is sufficient for this opt-in.

## Consequences

A direct gesture can reach an unactivated skill from any workspace whose agent opts into a reachable complete clone. A miss reads the bounded index but not any skill body. The index is reread on each miss; there is no index watcher or persistent cache. Missing, corrupt, renamed, non-user-invocable, or escaping skill bodies do not inject. A separate host restart is needed after configuring the root, and the external Claude Code and Codex clients continue to use their own skill discovery mechanisms.

A keyless [Web composition scenario](../../../../apps/web/tests/skill-indexed-invoke.e2e.ts) pins the injected context and transcript snapshot; the [unit suite](../../../../packages/skill/tool-skill/tests/tool-skill.spec.ts) pins misses, policy checks, and precedence.
