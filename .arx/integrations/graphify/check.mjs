/**
 * Run from the repository root: node .arx/integrations/graphify/check.mjs
 * Requires the local Graphify venv, graph artifact, and existing MCP SDK; installs nothing.
 * Bounds RPCs to 10 seconds and the smoke to 30 seconds, then closes the stdio server.
 * Writes verification.json, three live query files, and a Mermaid integration diagram under .artifacts/graphify.
 * Exits nonzero on protocol or semantic errors; this smoke does not verify browser rendering.
 * Calls only graph reads, disables query logging, and never invokes PR tools or Claude.
 * Verifies and records upstream text-only missing-node responses as a known limitation.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { renderIntegrations } from './refresh.mjs';

const root = process.cwd();
const output = resolve(root, '.artifacts/graphify/verification.json');
const core = ['query_graph', 'get_node', 'get_neighbors', 'get_community', 'god_nodes', 'graph_stats', 'shortest_path'];
const optional = ['list_prs', 'get_pr_impact', 'triage_prs'];
const started = Date.now();
const results = { status: 'failed', tools: [], graphStats: null, queries: [] };
const options = { timeout: 10_000, maxTotalTimeout: 10_000, signal: AbortSignal.timeout(30_000) };
let client;
let transport;
let stderr = '';

try {
  const require = createRequire(resolve(root, 'packages/mcp/mcp-client/package.json'));
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
  client = new Client({ name: 'arx-graphify-smoke', version: '1.0.0' });
  // Capture the negotiated response, not the SDK's preferred protocol version.
  const request = client.request.bind(client);
  client.request = async (...args) => {
    const result = await request(...args);
    if (args[0].method === 'initialize') {
      results.protocolVersion = result.protocolVersion;
      results.server = result.serverInfo;
    }
    return result;
  };
  transport = new StdioClientTransport({
    command: process.env.ARX_GRAPHIFY_PYTHON || resolve(root, '.cache/graphify-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    args: ['-B', '-m', 'graphify.serve', resolve(root, '.artifacts/graphify/graph.json')],
    cwd: root,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(key))), GRAPHIFY_OUT: resolve(root, '.artifacts/graphify'), GRAPHIFY_QUERY_LOG_DISABLE: '1', PYTHONDONTWRITEBYTECODE: '1' },
    stderr: 'pipe',
  });
  transport.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4096); });
  await client.connect(transport, options);
  results.pid = transport.pid;
  assert(client.getServerCapabilities()?.tools, 'Server does not advertise tools');
  const listed = await client.listTools({}, options);
  assert(!listed.nextCursor, 'Unexpected paginated tool list');
  results.tools = listed.tools.map(tool => ({ name: tool.name, inputSchema: tool.inputSchema }));
  const names = listed.tools.map(tool => tool.name);
  assert.equal(new Set(names).size, names.length, 'Duplicate tool names');
  for (const name of core) assert(names.includes(name), 'Missing core tool: ' + name);
  for (const tool of listed.tools) {
    assert([...core, ...optional].includes(tool.name), 'Unexpected tool: ' + tool.name);
    assert.equal(tool.inputSchema.type, 'object', 'Invalid input schema: ' + tool.name);
  }
  results.optionalPrTools = optional.filter(name => names.includes(name));
  const call = async (name, arguments_) => {
    const response = await client.callTool({ name, arguments: arguments_ }, undefined, options);
    const text = response.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
    assert(Buffer.byteLength(text) <= 32_768, name + ' exceeded the 32 KiB response cap');
    return { name, arguments: arguments_, isError: response.isError === true, text };
  };
  results.graphStats = await call('graph_stats', {});
  assert(!results.graphStats.isError && results.graphStats.text.trim(), 'graph_stats failed or empty');
  assert(Number(results.graphStats.text.match(/^Nodes: (\d+)/m)?.[1]) > 0, 'Graph has no nodes');
  assert(Number(results.graphStats.text.match(/^Edges: (\d+)/m)?.[1]) > 0, 'Graph has no edges');
  const query = await call('query_graph', { question: 'SkillRegistry', mode: 'bfs', depth: 1, token_budget: 1200, context_filter: ['call'] });
  results.queries.push(query);
  assert(!query.isError && query.text.trim(), 'query_graph failed or empty');
  assert(/^NODE SkillRegistry \[src=packages\/skill\/skill\/src\/index.ts /m.test(query.text), 'SkillRegistry source node not found');
  const integrations = [];
  for (const [question, title, file] of [
    ['catalogMessage', 'Skill catalog assembly', 'catalog-integration.txt'],
    ['syncTools', 'MCP tool synchronization', 'mcp-integration.txt'],
  ]) {
    const integration = await call('query_graph', { question, mode: 'bfs', depth: 1, token_budget: 1400, context_filter: ['call'] });
    results.queries.push(integration);
    assert(!integration.isError && integration.text.includes('NODE ' + question + '() [src='), question + ': source node missing');
    assert(/^EDGE .+ --calls \[EXTRACTED context=call\]-->/m.test(integration.text), question + ': extracted calls missing');
    integrations.push({ title, file, text: integration.text });
  }
  integrations.push({ title: 'Skill registry', file: 'skill-integration.txt', text: query.text });
  results.diagram = renderIntegrations(integrations);
  results.integrationEvidence = integrations;
  results.liveGraphReads = 'passed';
  const missing = await call('get_node', { label: 'zzzzArxSmokeMissingSymbol7f01a83czzzz' });
  results.missingSymbol = missing;
  assert.equal(missing.text, "No node matching '" + missing.arguments.label.toLowerCase() + "' found.");
  assert.equal(missing.isError, false, 'Upstream missing-node response changed from text-only behavior');
  results.missingSymbol.semanticOutcome = 'not_found';
  results.missingSymbol.verification = 'passed';
  results.knownLimitations = ['get_node reports not-found in text with isError absent/false; clients must inspect text.'];
  results.status = 'passed';
} catch (error) {
  results.error = error.message;
  process.exitCode = 1;
} finally {
  // connect() can fail before the client owns the transport; close both independently.
  for (const resource of [client, transport]) {
    try {
      if (resource) await resource.close();
    } catch (error) {
      results.cleanupError = error.message;
      results.status = 'failed';
      process.exitCode = 1;
    }
  }
  results.durationMs = Date.now() - started;
  if (stderr.trim()) results.serverStderr = stderr.trim();
  if (results.status === 'passed') {
    for (const { file, text } of results.integrationEvidence) writeFileSync(resolve(root, '.artifacts/graphify', file), text.trimEnd() + '\n');
    writeFileSync(resolve(root, '.artifacts/graphify/ARCHITECTURE_INTEGRATIONS.md'), results.diagram);
  }
  writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({
    status: results.status, liveGraphReads: results.liveGraphReads,
    protocolVersion: results.protocolVersion, tools: results.tools.map(tool => tool.name),
    graphStats: results.graphStats?.text, query: results.queries[0]?.arguments,
    knownLimitations: results.knownLimitations, error: results.error, durationMs: results.durationMs, output,
  }, null, 2));
}
