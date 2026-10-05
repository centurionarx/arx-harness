import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { renderIntegrations } from './refresh.mjs';

const entry = fileURLToPath(new URL('./refresh.mjs', import.meta.url));
const root = resolve(dirname(entry), '../../..');
const source = readFileSync(entry, 'utf8');

function temporary(t) {
  const cwd = mkdtempSync(resolve(tmpdir(), 'arx-graphify-refresh-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(resolve(cwd, '.artifacts/graphify'), { recursive: true });
  writeFileSync(resolve(cwd, '.artifacts/graphify/last-refresh.json'), '{"status":"passed"}\n');
  return cwd;
}

function launch(cwd, python) {
  const result = spawnSync(process.execPath, [entry], { cwd, env: { ...process.env, ARX_GRAPHIFY_PYTHON: python }, encoding: 'utf8', timeout: 10_000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
  assert.equal(existsSync(resolve(cwd, '.artifacts/graphify/last-refresh.json')), false);
  assert.equal(existsSync(resolve(cwd, '.artifacts/graphify/refresh.lock')), false);
  return result.stderr;
}

function prerequisites(cwd) {
  for (const file of ['AGENTS.md', 'packages/mcp/mcp-client/package.json', '.arx/integrations/graphify/check.mjs', '.arx/integrations/graphify/render-preview.mjs']) {
    const target = resolve(cwd, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.endsWith('.json') ? '{}' : '');
  }
  symlinkSync(resolve(root, 'packages/mcp/mcp-client/node_modules'), resolve(cwd, 'packages/mcp/mcp-client/node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
}

test('extract precedes offline clustering and live smoke, with HTML enabled', () => {
  const extract = source.indexOf("run(python, ['-m', 'graphify', 'extract', '.', '--code-only', '--max-workers', '2', '--timing']");
  const cluster = source.indexOf("run(python, ['-m', 'graphify', 'cluster-only', '.', '--no-label']");
  const smoke = source.indexOf('run(process.execPath');
  const preview = source.indexOf("run(process.execPath, [resolve(root, '.arx/integrations/graphify/render-preview.mjs')], 120_000)");
  assert(extract > 0 && cluster > extract && smoke > cluster && preview > smoke);
  assert(source.indexOf("regenerated('graph-static.jpg')") > preview);
  assert(source.includes("'graph-static.jpg'].map"));
  assert(source.includes('Missing or invalid JPEG preview'));
  assert(source.includes('2 MiB Web preview limit'));
  assert(!source.includes('graph-static.png'));
  assert(!source.includes('--no-viz'));
  assert(source.indexOf("remove('last-refresh.json')") < extract);
  assert(source.indexOf("writeFileSync(resolve(out, 'last-refresh.json')") > smoke);
});

test('missing repository prerequisites remove stale success and release lock', t => {
  assert.match(launch(temporary(t), process.execPath), /AGENTS.md/);
});

test('missing Python cannot retain stale success', t => {
  const cwd = temporary(t);
  prerequisites(cwd);
  assert.match(launch(cwd, resolve(cwd, 'missing-python')), /missing-python/);
});

test('a real failed subprocess is not reported as a successful refresh', t => {
  const cwd = temporary(t);
  prerequisites(cwd);
  // Node rejects Python's -m argument before any Graphify extraction can run.
  for (const file of ['graph.json', 'GRAPH_REPORT.md', 'graph.html', 'graph-static.jpg']) writeFileSync(resolve(cwd, '.artifacts/graphify', file), 'previous artifact');
  assert.match(launch(cwd, process.execPath), /Graphify command failed:.*graphify extract/);
  for (const file of ['graph.json', 'GRAPH_REPORT.md', 'graph.html', 'graph-static.jpg']) assert.equal(readFileSync(resolve(cwd, '.artifacts/graphify', file), 'utf8'), 'previous artifact');
});

test('a subprocess spawn error cannot publish success', { skip: process.platform === 'win32' }, t => {
  const cwd = temporary(t);
  prerequisites(cwd);
  const python = resolve(cwd, 'not-executable');
  writeFileSync(python, '', { mode: 0o600 });
  assert.match(launch(cwd, python), /Graphify command failed:.*error=.*EACCES/);
});

test('an existing lock refuses writes and retains the other owner lock', t => {
  const cwd = temporary(t);
  const lock = resolve(cwd, '.artifacts/graphify/refresh.lock');
  writeFileSync(lock, 'other owner');
  const result = spawnSync(process.execPath, [entry], { cwd, encoding: 'utf8', timeout: 10_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /lock already exists/);
  assert.equal(readFileSync(lock, 'utf8'), 'other owner');
});

test('renderer uses scoped extracted calls and escapes Mermaid labels', () => {
  const text = [
    'NODE a"<&>() [src=packages/a.ts loc=L1 community=Community 0]',
    'NODE b() [src=packages/b.ts loc=L2 community=Community 0]',
    'NODE .dispose() [src=packages/c.ts loc=L3 community=Community 0]',
    'EDGE a"<&>() --calls [EXTRACTED context=call]--> b() at=packages/a.ts:L4',
    'EDGE b() --calls [EXTRACTED context=call]--> .dispose() at=packages/b.ts:L5',
    'EDGE b() --calls [INFERRED context=call]--> a"<&>() at=packages/b.ts:L6',
    'EDGE unknown() --calls [EXTRACTED context=call]--> b() at=packages/b.ts:L7',
  ].join('\n');
  const result = renderIntegrations([{ title: 'Scoped calls', file: 'query.txt', text }]);
  assert.match(result, /n0_0\["a&#34;&#60;&#38;&#62;\(\)"\]/);
  assert.match(result, /n0_0 --> n0_1/);
  assert.equal((result.match(/ --> /g) || []).length, 1);
  assert(!result.includes('.dispose'));
  assert.match(result, /packages\/a.ts:L1/);
  assert.match(result, /packages\/a.ts:L4/);
  assert.match(result, /does not prove browser rendering/);
});

test('renderer rejects absent source evidence but permits a registry node without calls', () => {
  assert.throws(() => renderIntegrations([{ title: 'Missing', file: 'query.txt', text: 'No matching nodes' }]), /no scoped source nodes/);
  assert.match(renderIntegrations([{ title: 'Registry', file: 'skill.txt', text: 'NODE SkillRegistry [src=packages/skill/skill/src/index.ts loc=L357 community=Community 0]' }]), /SkillRegistry/);
});
