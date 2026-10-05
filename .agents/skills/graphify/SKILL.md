---
name: graphify
description: Navigate arx Harness architecture and source integrations using the local Graphify AST graph, queries, and reports; regenerate it after source changes without a Claude plugin or inference API.
---

# Graphify for arx Harness

Use the local source graph for finding symbols, neighbors, and candidate call paths. This is model-independent navigation guidance, not evidence that inferred integrations are correct. Preserve the existing skills-globais catalog for other tasks.

## Query before broad source exploration

If available, call `mcp__graphify__graph_stats` to inspect the loaded graph, then `mcp__graphify__query_graph` with a scoped symbol or topic and a small requested `token_budget` (for example 1200). Inspect truncation and budget warnings: Graphify can exceed that budget when including edges; it is not a strict limit. Inspect `get_node`, `get_neighbors`, or `shortest_path` for the relevant symbols rather than dumping the whole graph. Graphify PR tools are optional and may contact GitHub; they are not needed for architecture navigation.

Without MCP, use the project-local Python environment from the repository root:

```sh
GRAPHIFY_OUT=.artifacts/graphify .cache/graphify-venv/bin/python -m graphify query "SkillRegistry" --graph .artifacts/graphify/graph.json
```

Read the reported source locations using arx file tools before changing code. Use [the architecture map](../../../docs/architecture.md) and [the module graph](../../../docs/module-graph.md) for authoritative Cordis and package relationships. AST import/call edges can miss dynamic registration, YAML composition, or modern TypeScript syntax; absence of an edge does not prove absence of a dependency. Ignore dependency/build/cache directories. Do not use the graph as proof when auditing its own extraction accuracy.

## Mandatory task lifecycle

Before every task, read the report and focused diagrams, query the JSON graph with a bounded scope, and inspect the HTML shell and relevant sections as required by [the integration guide](../../../docs/cookbook/project-analysis-integrations.md#mandatory-task-lifecycle). If an artifact is missing, regenerate it before relying on it.

Before every top-level task’s final response, including read-only and documentation tasks, wait for delegated work to settle and run `node .arx/integrations/graphify/refresh.mjs` from the repository root. The parent owns the final refresh; parallel children must not race to rewrite shared artifacts. Do not claim freshness or completion if refresh fails: report the failed stage. Always keep `--code-only` and `--no-label`: removing either can enable semantic inference or labeling with external APIs. Preserve HTML generation; do not use `--no-viz` for the mandatory refresh. Never run `graphify install`, a vendor marketplace command, or install Agent Skills/OmniRoute. The generated report and visualization live under `.artifacts/graphify`; they are derived, uncommitted artifacts and may need regeneration after a checkout changes.

On Windows use `.cache/graphify-venv/Scripts/python.exe` and set `GRAPHIFY_OUT` in the process environment rather than POSIX inline assignment. If the environment or graph is missing, follow the integration guide; do not fabricate query results.
