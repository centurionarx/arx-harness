# Project analysis with Ponytail and Graphify

This tutorial adds model-independent simplification guidance and local AST navigation to an arx session working in this checkout. It requires Python 3.10 or newer, the existing Node/pnpm workspace, and a session that exposes the arx `skill` tool. The runtime mechanisms are documented in [skill-filesystem](../../packages/skill/skill-filesystem/README.md), [tool-skill](../../packages/skill/tool-skill/README.md), and [mcp-client](../../packages/mcp/mcp-client/README.md).

## Mandatory task lifecycle

Before each task, including delegated tasks and resumed sessions, read the current `.artifacts/graphify/GRAPH_REPORT.md` and `.artifacts/graphify/ARCHITECTURE_INTEGRATIONS.md`, inspect `.artifacts/graphify/graph.json` through a bounded MCP or CLI query, and read the shell and relevant sections of `.artifacts/graphify/graph.html`. Large serialized datasets are queried rather than dumped into context. Confirm nonzero graph counts and source locations; reading the HTML alone does not prove browser rendering. If an artifact is missing, follow the installation and refresh steps before relying on it.

Before the final response for every top-level requested task, including read-only and documentation tasks, wait for delegated work to settle and run:

```sh
node .arx/integrations/graphify/refresh.mjs
```

This [refresh entry](../../.arx/integrations/graphify/refresh.mjs) re-extracts code locally, regenerates the report and HTML, runs MCP readiness queries, updates the focused architecture diagrams, and renders a static poster through the existing Playwright browser. It never uses `--no-viz`, semantic extraction, or model-generated community labels. The parent owns the final refresh after parallel children; children report changed paths and must not race to rewrite shared graph artifacts. The script refuses concurrent refreshes and records success in `.artifacts/graphify/last-refresh.json` only after all required outputs validate.

On a host where a refresh stage times out, set `ARX_GRAPHIFY_TIMEOUT_SCALE` in its environment to a decimal from 1 to 10 with a dot separator; the refresh entry multiplies every default time bound by that value, and any other value fails the refresh before a Graphify subprocess runs. The first refresh of a fresh clone needs the most headroom. In PowerShell, quote a fractional value, as in `$env:ARX_GRAPHIFY_TIMEOUT_SCALE = '1.5'`, because an unquoted number takes the current culture's separator.

Do not claim fresh artifacts or task completion after a failed refresh. Report the failed stage and concrete missing prerequisite or error; do not substitute an old HTML or silently skip generation. The command applies across supported model routes and operating systems, with the interpreter override described below. This is a mandatory agent instruction, not an automatically installed post-turn hook.

## 1. Use the installed Ponytail skills

The six reviewed skills live in [.agents/skills](../../.agents/skills/ponytail/SKILL.md). Invoke `/ponytail`, `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain`, or `/ponytail-help`, or ask the agent to load the exact skill name. Their catalog and bodies are shared across configured model routes, including routes that do not use Claude. The minimal preset does not expose the skill tool.

Intensity is conversational guidance: request lite, full, or ultra in task text. There are no vendor hooks, persisted mode flags, status-line changes, or automatic updates. Compaction and independent child sessions may require another load. Repository validation, approval, security, and documentation requirements take precedence over brevity. Continue consulting the existing skills-globais catalog for other capabilities; neither Agent Skills nor OmniRoute is part of this integration.

The [source provenance](../../.arx/integrations/provenance.json) pins Ponytail 4.10.3 and records the adaptations. Its [MIT license](../../.agents/skills/ponytail/LICENSE) covers the six adapted files. Review updates as source changes; do not use a Claude marketplace installer.

## 2. Install the isolated Graphify environment

Run from the repository root on Linux or macOS:

```sh
python3 -m venv .cache/graphify-venv
.cache/graphify-venv/bin/python -m pip install -r .arx/integrations/graphify/requirements.txt
.cache/graphify-venv/bin/python -m pip check
.cache/graphify-venv/bin/python -m graphify --version
```

The [requirements](../../.arx/integrations/graphify/requirements.txt) pin `graphifyy` 0.9.74 with MCP and SQL support; the package name has two trailing `y` characters. Dependency resolution occurs only inside the virtual environment and can require network access during installation. Python and the environment are machine-local, not dependencies of the published arx runtime. Do not run `graphify install`: that configures other assistants.

On Windows, create the environment with `py -3 -m venv .cache/graphify-venv`, use `.cache/graphify-venv/Scripts/python.exe`, and set `$env:GRAPHIFY_OUT = ".artifacts/graphify"` before the following commands instead of POSIX inline assignment.

## 3. Generate the source integrations and report

```sh
GRAPHIFY_OUT=.artifacts/graphify .cache/graphify-venv/bin/python -m graphify extract . --code-only --max-workers 2 --timing
GRAPHIFY_OUT=.artifacts/graphify .cache/graphify-venv/bin/python -m graphify cluster-only . --no-label --no-viz
```

Inspect `.artifacts/graphify/graph.json` and `.artifacts/graphify/GRAPH_REPORT.md`. The graph contains extracted symbols and source relationships; the report describes communities and highly connected symbols. `.artifacts` and `.cache` are ignored by Git and by normal Graphify source discovery. Keep `--code-only` and `--no-label` to avoid semantic extraction and model-generated labeling. This generation path does not require an inference API or a Claude account.

For the mandatory task refresh, use the refresh entry above: it always enables HTML, and large graphs are aggregated by Graphify into a community view. The manual `--no-viz` command is only a diagnostic report-generation option and does not satisfy the task lifecycle. Never treat the report as permanently current.

The arx HTML preview deliberately removes scripts, so the interactive canvas cannot run there. The [poster renderer](../../.arx/integrations/graphify/render-preview.mjs) verifies the original graph in Chromium and embeds `.artifacts/graphify/graph-static.jpg` as a CSS data-image fallback that survives inert preview sanitization. It changes no GUI sandbox or CSP. Use the [dedicated HTTP route](#5-publish-the-interactive-graph) or open the original HTML outside the harness preview for interactive exploration; a local-file URL requires the original file on the browser’s machine. The generated JPEG also opens through the ordinary image preview.

Poster rendering uses the existing `apps/web` Playwright dependency and cached Chromium. If the browser is missing, install it with `pnpm --filter @arx-ai/arx-web-frontend exec playwright install chromium` and retry the refresh; do not bypass a rendering failure. The visualization library is fetched only when absent from the local cache and verified against the HTML’s SHA-384 integrity before browser use. No inference API is involved. Enhanced HTML must fit the existing 2 MiB preview limit; an oversized file fails rather than silently omitting the poster.

Parser warnings identify incomplete coverage, not TypeScript compilation failures. Dynamic Cordis registration, YAML composition, and syntax unsupported by the installed grammar can be missing. Verify relevant source files and use the authoritative [architecture](../architecture.md), [module graph](../module-graph.md), and [graph atlas](../graph-atlas.md); generated AST relationships do not replace those references.

## 4. Query from any model route

Load `/graphify` for the [navigation instructions](../../.agents/skills/graphify/SKILL.md). A direct local query works without a mounted MCP server:

```sh
GRAPHIFY_OUT=.artifacts/graphify .cache/graphify-venv/bin/python -m graphify query "SkillRegistry" --graph .artifacts/graphify/graph.json
```

To expose Graphify tools to arx, apply the [MCP overlay](../../.arx/integrations/graphify/cordis.patch.yml) when launching an existing profile from this checkout:

```sh
pnpm arx --profile web --patch .arx/integrations/graphify/cordis.patch.yml
```

This is a launch configuration, not a command to start a second server alongside the current GUI. An already running profile needs that entry applied through its own profile overlay. The overlay derives paths from the launch working directory; `ARX_GRAPHIFY_PYTHON` can select an explicit interpreter. `failOnStartupError` rejects connection or tool-discovery failures, but Graphify can advertise tools without loading a valid default graph. After activation, call `mcp__graphify__graph_stats` and confirm nonzero node and edge counts before relying on queries; a missing or corrupt graph can otherwise fail only when queried. Stdio keeps the query server local without opening a listening port.

Run `node .arx/integrations/graphify/check.mjs` for the [local protocol smoke](../../.arx/integrations/graphify/check.mjs); it checks graph counts, a source-node query, and known text-only not-found responses, then closes its own server. It writes `.artifacts/graphify/verification.json` and does not activate a profile.

The model sees `mcp__graphify__graph_stats`, `mcp__graphify__query_graph`, and other server-qualified tools. Prefer scoped queries with a small requested `token_budget`, inspect truncation and budget warnings, then read the returned source locations. Graphify can exceed that requested budget when including all edges for the selected nodes; it is not a strict output limit. MCP schemas and returned text still consume model context; neither Graphify nor Ponytail guarantees token savings. Graphify PR tools can contact GitHub when requested; they are unnecessary for offline source navigation.

## 5. Publish the interactive graph

Generate and validate the current HTML with the mandatory refresh entry, then apply the [publication overlay](../../.arx/integrations/graphify/publish.patch.yml) to the existing Web profile. Replace its literal plugin name with the absolute path to [publish.mjs](../../.arx/integrations/graphify/publish.mjs) in this checkout; Loader metadata does not evaluate `!!js`. The `graphPath` configuration can derive its absolute path from the launch working directory. Set `maxBytes` explicitly; the example reserves 2 MiB plus 1 KiB for response nonces and rejects larger complete responses. For an already running profile, add this entry to that profile’s own overlay instead of starting another server.

With the configured route `/graphify`, open `http://127.0.0.1:3080/graphify` in a separate browser tab. When the GUI is reached through another hostname or forwarded URL, use that same origin followed by `/graphify`; no extra port is required. Confirm a populated canvas, search a community label, and select a search result to inspect its members and connections. Reload the page after a task refresh to see current data.

The route serves only the configured generated HTML, accepts GET and HEAD, and sends `Cache-Control: no-store`. Its response CSP permits nonce-authorized scripts but sandboxes the document without same-origin access, cookies, local storage, API connections, nested frames, or forms. The ordinary HTML preview remains inert. This is an explicitly enabled project-artifact route, not arbitrary HTML hosting or publication to an external provider. Its exposure follows the existing GUI listener and forwarding configuration. The [integration decision](../../.agents/notes/implemented/process/2026-10-03-model-independent-project-analysis.md) records the isolation rationale.
