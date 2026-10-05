# Agent Note: Mandatory Graphify task consultation and refresh

Status: implemented

## Problem

Derived architecture artifacts can remain stale across agent tasks, and a successfully written HTML file does not establish that its graph renders. An explicit task lifecycle is needed so every agent consults the available architecture evidence and the final response does not advertise artifacts from an earlier execution.

## Decision

The root [AGENTS.md](../../../../AGENTS.md#mandatory-graphify-lifecycle) requires artifact consultation before every task and a successful refresh before each top-level task’s final response, including read-only and documentation work. The [integration tutorial](../../../../docs/cookbook/project-analysis-integrations.md#mandatory-task-lifecycle) owns the exact files, large-file reading strategy, parent ownership of parallel refreshes, commands, and failure handling. Claude Code inherits the same instruction through the existing `CLAUDE.md` symlink; the instruction is independent of the selected arx model route.

The [refresh entry](../../../../.arx/integrations/graphify/refresh.mjs) performs local code-only extraction, unlabeled reporting with HTML enabled, MCP readiness queries, and focused diagram export. Concurrent refreshes fail rather than rewriting the same graph simultaneously. The [poster renderer](../../../../.arx/integrations/graphify/render-preview.mjs) validates populated community datasets and painted canvas pixels in Chromium, serializes JSON rows with each field schema once, and adds a static JPEG as a CSS data-image fallback within the existing 2 MiB HTML budget. The browser reconstructs every original node and edge field; script delimiters in labels remain escaped. The renderer reopens the enhanced HTML and compares the complete datasets with the original rendering before publishing success. The arx HTML preview strips scripts and URL attributes; default preview CSP and sandbox restrictions remain unchanged. A successful refresh marker is written only after all required outputs and local rendering validate; the actual Web preview path is checked separately.

The root instruction budget reserves space for this load-bearing rule without removing unrelated standing orders. The [model-independent integration decision](2026-10-03-model-independent-project-analysis.md) remains authoritative for source provenance, skills-globais preservation, and the absence of vendor hooks; this note owns the mandatory refresh schedule.

## Alternatives considered

**Refresh only after source edits.** Rejected because the requested lifecycle includes every task, and read-only or documentation work can still encounter missing or stale artifacts.

**Refresh after every tool call or independently in every parallel child.** Rejected because a top-level requested task is the execution unit, and concurrent writers can invalidate each other’s graph outputs. Children consult artifacts and report changes; the parent refreshes after delegates settle.

**Add a runtime hook or modify the agent loop.** Rejected because the requested rule belongs to this repository’s agent instructions and local analysis tooling, not every deployed arx session. A standing instruction is not an automatic post-turn hook.

**Treat file existence as proof of visualization.** Rejected because a nonempty HTML file can still have script-loading or runtime failures. Browser verification is separate from generation and graph readiness.

## Consequences

Every top-level task pays for a local incremental scan and report generation, even without code changes. Inference services remain unnecessary. Missing prerequisites or failed stages prevent a freshness/completion claim and must be reported explicitly rather than hidden behind stale output. Large JSON and HTML datasets are queried or read in relevant sections instead of copied wholesale into model context.

## Verification

Focused refresh tests cover required stage ordering, artifact readiness, scoped diagram generation, concurrency refusal, and rejection of failed refreshes without a success marker. Preview regressions verify exact dataset reconstruction, inert script-like labels and rejection of an unknown emitter or inconsistent field schemas. Documentation checks verify the instruction links and budget. The final execution uses the same refresh entry required of subsequent agents, and visualization diagnostics check the actual browser access path rather than assuming that generation alone is enough.
