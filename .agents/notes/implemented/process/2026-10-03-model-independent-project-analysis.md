# Agent Note: Model-independent project analysis integrations

Status: implemented

## Problem

Assistant-specific installers mix portable analysis instructions with lifecycle hooks, mode state, and vendor authentication assumptions. This checkout needs reusable simplification guidance and source navigation across arx model routes without replacing the skills-globais catalog or exposing code to semantic inference services.

## Decision

Ponytail is a reviewed, MIT-licensed set of six project skills under [.agents/skills](../../../skills/ponytail/SKILL.md), loaded through the existing arx skill registry and logged tool results. The [provenance record](../../../../.arx/integrations/provenance.json) pins upstream versions and source commits. Help and benchmark reporting describe supported arx behavior; repository testing and validation requirements override brevity. No vendor hooks, updater, or persistent session mode is installed.

Graphify is a pinned, project-local Python environment with code-only AST extraction, offline reporting, and an opt-in stdio MCP overlay. Its derived graph and report stay under ignored `.artifacts`, and the environment stays under ignored `.cache`. The [mandatory task lifecycle](2026-10-03-mandatory-graphify-task-refresh.md) owns artifact consultation and final refresh scheduling. The [integration tutorial](../../../../docs/cookbook/project-analysis-integrations.md) owns installation, querying, regeneration, and platform-specific commands. Existing generated package and Cordis diagrams remain authoritative for their owned relationships.

The opt-in [publication plugin](../../../../.arx/integrations/graphify/publish.mjs) registers one exact HTTP route on the existing Web server, serving only the current generated graph HTML. An explicit byte limit bounds file reads and complete HTTP responses. A response CSP uses per-request script nonces and `sandbox allow-scripts` without `allow-same-origin`; the interactive document has an opaque origin and cannot access GUI cookies, local storage, API connections, forms, or nested frames. It preserves the ordinary inert HTML preview and requires no extra listener or external hosting provider.

## Alternatives considered

**Install Ponytail as a Claude plugin.** Rejected because the upstream hooks depend on vendor state and output conventions that the arx compatibility bridge does not fully implement. Importing its unchanged help would promise modes and update commands that arx does not provide.

**Implement a native persistent Ponytail mode.** Rejected for this integration because no automatic per-turn mode, status line, or child propagation is required. Ordinary logged skill context gives every configured model route access without adding lifecycle code.

**Run Graphify semantic extraction or commit its complete graph.** Rejected because local source navigation does not require external inference, and large derived artifacts become stale as the checkout changes. AST extraction and unlabeled communities keep inference cost and disclosure out of this generation path.

**Allow scripts in the ordinary file preview or serve arbitrary HTML with GUI-origin privileges.** Rejected because repository files are not a trusted browser application. The dedicated Graphify route is explicit, restricted to the generated artifact, and sandboxed with an opaque origin.

**Start a second HTTP server or upload the graph to a public hosting service.** Rejected because the existing GUI listener already supplies the browser’s reachable origin; an additional port can require forwarding, and external hosting discloses project architecture unnecessarily.

**Replace skills-globais with Agent Skills, or add OmniRoute.** Rejected by the requested scope; the existing shared catalog and model adapters remain in use.

## Consequences

All model routes exposing arx skills can load Ponytail without Claude credentials; availability does not guarantee identical model adherence. Instructions may need reloading after compaction or in independent children. Benchmark figures are upstream observations, not measured local savings. Third-party instruction updates require source review, and the MIT notice remains with the adapted bundle.

Graphify adds local Python installation and graph regeneration work. AST edges can be incomplete or inferred and do not prove runtime composition; parser warnings require source confirmation rather than relaxed compiler checks. MCP schemas and query results consume model context, and optional PR tools can contact GitHub when invoked.

## Verification

The [keyless snapshot](../../../../examples/headless-agent/tests/ponytail.snapshot.ts) boots a real Loader composition, parses the installed files with the filesystem skill provider, loads all six bodies through actual tools and slash invocations, excludes user-home roots, and compares logged context across two non-Claude replay routes. Graph generation uses no semantic extraction or labeling, and live stdio queries validate the installed server independently of a vendor CLI. Publication tests boot the real Loader and built Web server to exercise HTTP policy, freshness, invalid inputs, byte limits, and route disposal. The actual configured URL is checked in Chromium for a populated canvas, search-result selection, an opaque origin, and denied cookie/local-storage access.
