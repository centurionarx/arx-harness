/**
 * Run from the repository root before each top-level final response, even without source changes.
 * Read the graph/report/diagram before every task. This entry refreshes ignored artifacts only;
 * it does not install hooks or enforce agent instructions. Requires the existing venv and MCP SDK.
 * Extraction/clustering are bounded to ten minutes each, the live smoke to 45 seconds, and preview to 120 seconds.
 * Existing graph/report/HTML remain readable during refresh; changed mtimes prove their regeneration.
 * Any existing lock refuses concurrent writers; remove an abandoned lock only after checking its owner.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Render named-function call edges from scoped live query text, not inferred runtime relationships.
 * @param {Array<{title: string, file: string, text: string}>} queries Live query evidence.
 * @returns {string} Markdown with escaped Mermaid labels and source locations.
 */
export function renderIntegrations(queries) {
  const escape = value => value.replace(/[&"<>\[\]\x60\r\n]/g, char => '&#' + char.charCodeAt(0) + ';');
  const sections = queries.map(({ title, file, text }, index) => {
    const nodes = new Map();
    for (const match of text.matchAll(/^NODE (.+) \[src=(\S+) loc=(\S+) community=.*\]$/gm)) {
      if (!match[1].startsWith('.')) nodes.set(match[1], match[2] + ':' + match[3]);
    }
    assert(nodes.size > 0, title + ': no scoped source nodes');
    const ids = new Map([...nodes.keys()].map((label, i) => [label, 'n' + index + '_' + i]));
    const edges = [...text.matchAll(/^EDGE (.+) --calls \[EXTRACTED context=call\]--> (.+) at=(\S+)$/gm)]
      .filter(match => ids.has(match[1]) && ids.has(match[2]));
    const diagram = [...ids].map(([label, id]) => '  ' + id + '["' + escape(label) + '"]')
      .concat(edges.map(match => '  ' + ids.get(match[1]) + ' --> ' + ids.get(match[2])));
    const locations = [...nodes].map(([label, location]) => '- ' + escape(label) + ': ' + escape(location) + '.')
      .concat(edges.map(match => '- ' + escape(match[1]) + ' → ' + escape(match[2]) + ': ' + escape(match[3]) + '.'));
    return '## ' + title + '\n\nQuery evidence: [' + file + '](' + file + ').\n\n```mermaid\nflowchart LR\n' + diagram.join('\n') + '\n```\n\n' + locations.join('\n');
  });
  return '# Architecture integrations extracted with Graphify\n\nLive scoped AST queries provide navigation evidence, not runtime verification. Ambiguous member calls are omitted. The protocol smoke does not prove browser rendering.\n\n' + sections.join('\n\n') + '\n';
}

/** Refresh all artifacts from cwd; publish success only after live counts and required outputs pass.
 * @returns {void} Throws on missing prerequisites, lock contention, or any failed subprocess/output.
 */
export function refresh() {
  const root = process.cwd();
  const out = resolve(root, '.artifacts/graphify');
  mkdirSync(out, { recursive: true });
  const lock = resolve(out, 'refresh.lock');
  let fd;
  try { fd = openSync(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Graphify refresh lock already exists: ' + lock + '; check its owner before removing it.');
    throw error;
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n');
    const remove = file => {
      try { unlinkSync(resolve(out, file)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    };
    remove('last-refresh.json');
    const python = process.env.ARX_GRAPHIFY_PYTHON || resolve(root, '.cache/graphify-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    for (const path of ['AGENTS.md', 'packages/mcp/mcp-client/package.json', '.arx/integrations/graphify/check.mjs', '.arx/integrations/graphify/render-preview.mjs']) {
      assert(statSync(resolve(root, path)).isFile(), 'Missing prerequisite: ' + path);
    }
    assert(statSync(python).isFile(), 'Missing Graphify Python: ' + python);
    createRequire(resolve(root, 'packages/mcp/mcp-client/package.json')).resolve('@modelcontextprotocol/sdk/client/index.js');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(key)));
    Object.assign(env, { GRAPHIFY_OUT: out, GRAPHIFY_QUERY_LOG_DISABLE: '1', PYTHONDONTWRITEBYTECODE: '1' });
    const run = (command, args, timeout) => {
      const result = spawnSync(command, args, { cwd: root, env, timeout, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      if (result.error || result.signal || result.status !== 0) {
        throw new Error('Graphify command failed: ' + command + ' ' + args.join(' ') + '; status=' + result.status + '; signal=' + result.signal + '; error=' + (result.error?.message || 'none') + '\n' + result.stderr);
      }
    };
    const previous = new Map();
    for (const file of ['graph.json', 'GRAPH_REPORT.md', 'graph.html', 'graph-static.jpg']) {
      try { previous.set(file, statSync(resolve(out, file), { bigint: true }).mtimeNs); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const regenerated = file => assert.notEqual(statSync(resolve(out, file), { bigint: true }).mtimeNs, previous.get(file), 'Graphify did not regenerate ' + file);
    for (const file of ['verification.json', 'catalog-integration.txt', 'mcp-integration.txt', 'skill-integration.txt']) remove(file);
    run(python, ['-m', 'graphify', 'extract', '.', '--code-only', '--max-workers', '2', '--timing'], 600_000);
    regenerated('graph.json');
    run(python, ['-m', 'graphify', 'cluster-only', '.', '--no-label'], 600_000);
    regenerated('GRAPH_REPORT.md');
    regenerated('graph.html');
    run(process.execPath, [resolve(root, '.arx/integrations/graphify/check.mjs')], 45_000);
    run(process.execPath, [resolve(root, '.arx/integrations/graphify/render-preview.mjs')], 120_000);
    regenerated('graph-static.jpg');
    for (const file of ['graph.json', 'GRAPH_REPORT.md', 'ARCHITECTURE_INTEGRATIONS.md', 'graph.html']) {
      assert(readFileSync(resolve(out, file), 'utf8').trim(), 'Empty Graphify artifact: ' + file);
    }
    const jpeg = readFileSync(resolve(out, 'graph-static.jpg'));
    assert(jpeg.length > 4 && jpeg[0] === 0xff && jpeg[1] === 0xd8 && jpeg.at(-2) === 0xff && jpeg.at(-1) === 0xd9, 'Missing or invalid JPEG preview');
    assert(statSync(resolve(out, 'graph.html')).size <= 2 * 1024 * 1024, 'Graphify HTML exceeds the 2 MiB Web preview limit');
    const artifacts = Object.fromEntries(['graph.json', 'GRAPH_REPORT.md', 'ARCHITECTURE_INTEGRATIONS.md', 'graph.html', 'graph-static.jpg'].map(file => {
      const { size, mtimeMs } = statSync(resolve(out, file));
      assert(size > 0, 'Empty Graphify artifact: ' + file);
      return [file, { size, mtimeMs }];
    }));
    const graph = JSON.parse(readFileSync(resolve(out, 'graph.json'), 'utf8'));
    assert(Array.isArray(graph.nodes) && graph.nodes.length > 0, 'Graph has no nodes');
    assert(Array.isArray(graph.links) && graph.links.length > 0, 'Graph has no edges');
    const evidence = JSON.parse(readFileSync(resolve(out, 'verification.json'), 'utf8'));
    assert.equal(evidence.status, 'passed', 'Live smoke failed');
    assert.equal(Number(evidence.graphStats.text.match(/^Nodes: (\d+)/m)?.[1]), graph.nodes.length, 'Live node count differs');
    assert.equal(Number(evidence.graphStats.text.match(/^Edges: (\d+)/m)?.[1]), graph.links.length, 'Live edge count differs');
    writeFileSync(resolve(out, 'last-refresh.json'), JSON.stringify({ status: 'passed', refreshedAt: new Date().toISOString(), nodes: graph.nodes.length, edges: graph.links.length, artifacts }, null, 2) + '\n');
  } finally {
    try { closeSync(fd); } finally { unlinkSync(lock); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { refresh(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
