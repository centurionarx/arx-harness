# Agent Note: Mandatory Graphify task consultation and refresh

Status: implemented

## Problem

Derived architecture artifacts can remain stale across agent tasks, and a successfully written HTML file does not establish that its graph renders. An explicit task lifecycle is needed so every agent consults the available architecture evidence and the final response does not advertise artifacts from an earlier execution.

Fixed time bounds sized for development machines also expire on slower hosts. On a two-core Windows host, the first extraction of a fresh clone took 682 seconds against the 600-second bound, an extraction killed at the bound left the next attempt as slow, and the live smoke exceeded its 30-second session while other work shared the two cores, although it finishes in about 16 seconds on an idle host. Such a host can never complete a refresh.

## Decision

The root [AGENTS.md](../../../../AGENTS.md#mandatory-graphify-lifecycle) requires artifact consultation before every task and a successful refresh before each top-level task’s final response, including read-only and documentation work. The [integration tutorial](../../../../docs/cookbook/project-analysis-integrations.md#mandatory-task-lifecycle) owns the exact files, large-file reading strategy, parent ownership of parallel refreshes, commands, and failure handling. Claude Code inherits the same instruction through the existing `CLAUDE.md` symlink; the instruction is independent of the selected arx model route.

The [refresh entry](../../../../.arx/integrations/graphify/refresh.mjs) performs local code-only extraction, unlabeled reporting with HTML enabled, MCP readiness queries, and focused diagram export. Concurrent refreshes fail rather than rewriting the same graph simultaneously. The [poster renderer](../../../../.arx/integrations/graphify/render-preview.mjs) validates populated community datasets and painted canvas pixels in Chromium, serializes JSON rows with each field schema once, and adds a static JPEG as a CSS data-image fallback within the existing 2 MiB HTML budget. The browser reconstructs every original node and edge field; script delimiters in labels remain escaped. The renderer reopens the enhanced HTML and compares the complete datasets with the original rendering before publishing success. The arx HTML preview strips scripts and URL attributes; default preview CSP and sandbox restrictions remain unchanged. A successful refresh marker is written only after all required outputs and local rendering validate; the actual Web preview path is checked separately.

Every stage runs under a default bound sized for development machines, and `ARX_GRAPHIFY_TIMEOUT_SCALE` multiplies all of them on a slower host: the refresh's subprocess bounds, the live smoke's RPC and session bounds, and the poster's browser launch, page, and asset-download waits. One multiplier keeps each scaled inner bound below the refresh's bound on its child. The poster's sequential waits can still add up past the refresh's bound, and the refresh's kill then ends the poster. The value is a decimal from 1 to 10, unset meaning 1: no host needs less time than the defaults allow, and the cap limits how long a hung stage can hold the refresh lock to 100 minutes. The refresh validates the value before any subprocess runs, and an invalid value fails it like a missing prerequisite.

The root instruction budget reserves space for this load-bearing rule without removing unrelated standing orders. The [model-independent integration decision](2026-10-03-model-independent-project-analysis.md) remains authoritative for source provenance, skills-globais preservation, and the absence of vendor hooks; this note owns the mandatory refresh schedule.

## Alternatives considered

**Refresh only after source edits.** Rejected because the requested lifecycle includes every task, and read-only or documentation work can still encounter missing or stale artifacts.

**Refresh after every tool call or independently in every parallel child.** Rejected because a top-level requested task is the execution unit, and concurrent writers can invalidate each other’s graph outputs. Children consult artifacts and report changes; the parent refreshes after delegates settle.

**Add a runtime hook or modify the agent loop.** Rejected because the requested rule belongs to this repository’s agent instructions and local analysis tooling, not every deployed arx session. A standing instruction is not an automatic post-turn hook.

**Raise the default bounds.** Rejected because every host would wait longer before a hung stage fails, to accommodate the slowest one. The defaults stay sized for development machines.

**One environment variable per bound.** Rejected because the refresh's bound on the smoke and the poster must stay above each of their inner bounds; separate values would leave that ordering to whoever sets them.

**Derive the multiplier from the CPU count.** Rejected because cold-cache cost depends on disk and antivirus scanning as much as on cores: the same two-core host spent 412 seconds detecting files on the first run and 42 seconds on the next.

**Treat file existence as proof of visualization.** Rejected because a nonempty HTML file can still have script-loading or runtime failures. Browser verification is separate from generation and graph readiness.

## Consequences

Every top-level task pays for a local incremental scan and report generation, even without code changes. A host where the defaults expire cannot complete a refresh, and so cannot claim completion of any task, until its environment sets the multiplier. Inference services remain unnecessary. Missing prerequisites or failed stages prevent a freshness/completion claim and must be reported explicitly rather than hidden behind stale output. Large JSON and HTML datasets are queried or read in relevant sections instead of copied wholesale into model context.

## Verification

Focused refresh tests cover required stage ordering, artifact readiness, scoped diagram generation, concurrency refusal, and rejection of failed refreshes without a success marker. They also cover the multiplier's accepted range and rounding, that every refresh subprocess bound is scaled, that the smoke and the poster resolve the multiplier and keep no unscaled bound, and that an invalid value fails before any Graphify subprocess and leaves no success marker or lock. A full refresh on the two-core host passes with the multiplier set to 3. Preview regressions verify exact dataset reconstruction, inert script-like labels and rejection of an unknown emitter or inconsistent field schemas. Documentation checks verify the instruction links and budget. The final execution uses the same refresh entry required of subsequent agents, and visualization diagnostics check the actual browser access path rather than assuming that generation alone is enough.
