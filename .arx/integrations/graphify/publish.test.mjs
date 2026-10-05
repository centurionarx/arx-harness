/** Real Loader + built webServer HTTP evidence; no registration mocks. */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const owner = createRequire(new URL('../../../packages/host/frontend-static/package.json', import.meta.url));
const includeOwner = createRequire(new URL('../../../vendor/include/package.json', import.meta.url));
const { Context } = await import(pathToFileURL(owner.resolve('@arx-ai/cordis')));
const { default: Loader } = await import(pathToFileURL(owner.resolve('@arx-ai/cordis-plugin-loader')));
const { default: Include } = await import(pathToFileURL(includeOwner.resolve('./lib/index.js')));
const serverPath = owner.resolve('@arx-ai/arx-host-webserver');
const pluginPath = fileURLToPath(new URL('./publish.mjs', import.meta.url));

const external = '<script src="https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js"\n' +
  '        integrity="sha384-Ux6phic9PEHJ38YtrijhkzyJ8yQlH8i/+buBR8s3mAZOJrP1gwyvAcIYl3GWtpX1"\n' +
  '        crossorigin="anonymous"></script>';
const fixture = (label = 'first', poster = true) => '<!DOCTYPE html>\n<html><head>\n<title>graphify - graphify/graph.html</title>\n' +
  external + '\n</head><body><div id="graph"' + (poster ? ' class="graphify-static-preview"' : '') + '></div>\n<script>\n' +
  'const serialized = "<script>not a tag";\n' +
  'const nodes = [{ id: 1, label: "example" }];\n' +
  'const edges = [];\n' +
  'const network = new vis.Network(document.getElementById("graph"), { nodes, edges }, {});\n' +
  'const label = ' + JSON.stringify(label) + ';\n</script>\n<script>\n' +
  'const hyperedges = [];\n' +
  "network.on('afterDrawing', function(ctx) { hyperedges.forEach(h => ctx.fillText(h.label, 0, 0)); });\n" +
  '</script>\n</body></html>\n';

async function composition(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'arx-graphify-publish-'));
  const graphPath = join(dir, 'graph.html');
  if (!options.missing) await writeFile(graphPath, options.html ?? fixture());
  const config = { path: '/graphify', graphPath, maxBytes: 2098176, ...options.config };
  const configPath = join(dir, 'cordis.yml');
  await writeFile(configPath, JSON.stringify([
    { name: serverPath, config: { host: '127.0.0.1', port: 0 } },
    { id: 'graphify-publish', name: pluginPath, config },
  ]));
  const ctx = new Context();
  t.after(async () => {
    await ctx.fiber.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  ctx.baseUrl = pathToFileURL(dir).href + '/';
  await ctx.plugin(Loader);
  ctx.loader.builtins.include = Include;
  const boot = async () => {
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } });
    await ctx.loader.await();
  };
  return { ctx, graphPath, config, boot, url: () => 'http://127.0.0.1:' + ctx.webServer.port };
}

function nonceOf(response) {
  const csp = response.headers.get('content-security-policy');
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
  assert.ok(nonce);
  assert.equal(csp, "sandbox allow-scripts; default-src 'none'; script-src 'nonce-" + nonce +
    "'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; " +
    "object-src 'none'; form-action 'none'; base-uri 'none'");
  return nonce;
}

test('exact route exposes only fresh Graphify HTML with opaque-origin policy; disposal removes it', async t => {
  const app = await composition(t);
  await app.boot();
  const response = await fetch(app.url() + '/graphify');
  const html = await response.text();
  const nonce = nonceOf(response);
  // Stable real-HTTP policy snapshot; nonce equality is checked locally, not normalized globally.
  assert.deepEqual({ status: response.status, type: response.headers.get('content-type'),
    cache: response.headers.get('cache-control'), sniff: response.headers.get('x-content-type-options'),
    referrer: response.headers.get('referrer-policy'), cors: response.headers.get('access-control-allow-origin') },
  { status: 200, type: 'text/html; charset=utf-8', cache: 'no-store', sniff: 'nosniff', referrer: 'no-referrer', cors: null });
  assert.equal(html, fixture().replace(/^<script/gm, '<script nonce="' + nonce + '"'));
  assert.equal([...html.matchAll(/^<script nonce="([^"]+)"/gm)].length, 3);
  assert.ok(html.includes('"<script>not a tag"'));
  const head = await fetch(app.url() + '/graphify', { method: 'HEAD' });
  assert.equal(head.status, 200);
  nonceOf(head);
  assert.ok(Number(head.headers.get('content-length')) > 0);
  assert.equal(await head.text(), '');
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const denied = await fetch(app.url() + '/graphify', { method });
    assert.equal(denied.status, 405);
    assert.equal(denied.headers.get('allow'), 'GET, HEAD');
  }
  for (const path of ['/unknown', '/graphify/', '/graphify/graph.html', '/graphify/graph.json', '/graph.json', '/AGENTS.md']) {
    assert.equal((await fetch(app.url() + path)).status, 404, path);
  }
  const query = await fetch(app.url() + '/graphify?file=/etc/passwd&path=graph.json');
  assert.equal(query.status, 200);
  assert.ok((await query.text()).includes('const label = "first"'));
  await writeFile(app.graphPath, fixture('fresh', false));
  const fresh = await fetch(app.url() + '/graphify');
  assert.equal(fresh.headers.get('cache-control'), 'no-store');
  assert.notEqual(nonceOf(fresh), nonce);
  assert.ok((await fresh.text()).includes('const label = "fresh"'));
  for (const invalid of ['<!DOCTYPE html><html>private unrelated content</html>', fixture().replace('@9.1.6', '@9.1.7'), fixture().replace('sha384-Ux6', 'sha384-bad')]) {
    await writeFile(app.graphPath, invalid);
    const unavailable = await fetch(app.url() + '/graphify');
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get('cache-control'), 'no-store');
    assert.equal(await unavailable.text(), 'Graphify graph unavailable.');
  }
  await rm(app.graphPath);
  assert.equal((await fetch(app.url() + '/graphify')).status, 503);
  const missingHead = await fetch(app.url() + '/graphify', { method: 'HEAD' });
  assert.equal(missingHead.status, 503);
  assert.equal(await missingHead.text(), '');
  await writeFile(app.graphPath, fixture('recovered'));
  assert.equal((await fetch(app.url() + '/graphify')).status, 200);
  const entry = [...app.ctx.loader.entries()].find(entry => entry.options.name === pluginPath);
  await entry.fiber.dispose();
  assert.equal((await fetch(app.url() + '/graphify')).status, 404);
});

test('byte limit includes nonce expansion and rejects oversized streams without stale success', async t => {
  const html = fixture('ação');
  const completeBytes = Buffer.byteLength(html.replace(/^<script/gm, '<script nonce="' + 'A'.repeat(32) + '"'));
  const app = await composition(t, { html, config: { maxBytes: completeBytes } });
  await app.boot();
  const fit = await fetch(app.url() + '/graphify');
  assert.equal(fit.status, 200);
  assert.equal(Number(fit.headers.get('content-length')), completeBytes);
  assert.equal(Buffer.byteLength(await fit.text()), completeBytes);
  await writeFile(app.graphPath, html + '\n');
  assert.ok(Buffer.byteLength(html + '\n') < completeBytes);
  const expanded = await fetch(app.url() + '/graphify');
  assert.equal(expanded.status, 503);
  assert.equal(await expanded.text(), 'Graphify graph unavailable.');
  await writeFile(app.graphPath, html + ' '.repeat(70000));
  const oversized = await fetch(app.url() + '/graphify');
  assert.equal(oversized.status, 503);
  assert.equal(await oversized.text(), 'Graphify graph unavailable.');
  await writeFile(app.graphPath, html);
  assert.equal((await fetch(app.url() + '/graphify')).status, 200);
  for (const maxBytes of [Buffer.byteLength(html) - 1, completeBytes - 1]) {
    await t.test('prerequisite rejects limit ' + maxBytes, async t => {
      const invalid = await composition(t, { html, config: { maxBytes } });
      await assert.rejects(invalid.boot());
      assert.equal((await fetch(invalid.url() + '/graphify')).status, 404);
    });
  }
});

test('Loader rejects invalid configuration and missing or non-Graphify prerequisites', async t => {
  for (const path of ['/', 'graphify', '/graphify/', '/graphify?q=1', '/graphify#x', '//graphify']) {
    await t.test('route ' + path, async t => {
      const app = await composition(t, { config: { path } });
      await assert.rejects(app.boot(), /Graphify path/);
      assert.equal((await fetch(app.url() + '/graphify')).status, 404);
    });
  }
  for (const maxBytes of [undefined, 0, -1, 1.5, 16 * 1024 * 1024 + 1, '2098176']) {
    await t.test('byte limit ' + maxBytes, async t => {
      const app = await composition(t, { config: { maxBytes } });
      await assert.rejects(app.boot());
      assert.equal((await fetch(app.url() + '/graphify')).status, 404);
    });
  }
  for (const graphPath of ['graph.html', '/tmp/graph.json']) {
    await t.test('file ' + graphPath, async t => {
      const app = await composition(t, { config: { graphPath } });
      await assert.rejects(app.boot(), /Graphify graphPath/);
    });
  }
  for (const [label, options] of [
    ['missing HTML', { missing: true }],
    ['unrelated HTML', { html: '<html>not Graphify</html>' }],
    ['unpinned CDN', { html: fixture().replace('@9.1.6', '@9.1.7') }],
    ['unexpected script', { html: fixture() + '\n<script>alert(1)</script>' }],
    ['missing path', { config: { path: null } }],
    ['non-string graphPath', { config: { graphPath: 42 } }],
  ]) {
    await t.test(label, async t => {
      const app = await composition(t, options);
      await assert.rejects(app.boot());
      assert.equal((await fetch(app.url() + '/graphify')).status, 404);
    });
  }
});
