/**
 * Generate a static community-graph poster and embed it as a CSS-only fallback in Graphify HTML.
 * Run from the repository root after cluster-only: node .arx/integrations/graphify/render-preview.mjs
 * Uses the existing apps/web Playwright dependency and browser; changes no GUI security policy.
 * The preview strips scripts and image src attributes, but its CSP permits data-image CSS backgrounds.
 * ARX_GRAPHIFY_TIMEOUT_SCALE multiplies the asset-download, browser-launch, and page bounds, including the page default.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bound, timeoutScale } from './refresh.mjs';

/** Encode Graphify rows once per field schema; the browser reconstructs identical graph objects.
 * @param {string} html Fresh Graphify HTML with its JSON-only RAW_NODES and RAW_EDGES assignments.
 * @returns {string} HTML retaining every graph field and escaping script delimiters in serialized data.
 */
export function compactGraphData(html) {
  const serialize = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,
    char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  for (const name of ['RAW_NODES', 'RAW_EDGES']) {
    const pattern = new RegExp('^const ' + name + ' = (\\[[^\\n]*\\]);$', 'm');
    const match = pattern.exec(html);
    assert(match, 'Graphify JSON initialization changed: missing ' + name);
    const items = JSON.parse(match[1]);
    assert(items.length > 0 && items.every(item => item && typeof item === 'object' && !Array.isArray(item)), 'Empty or invalid ' + name);
    const fields = Object.keys(items[0]);
    assert(fields.length > 0 && items.every(item => {
      const keys = Object.keys(item);
      return keys.length === fields.length && fields.every((field, index) => keys[index] === field);
    }), 'Graphify data fields changed within ' + name);
    const rows = items.map(item => fields.map(field => item[field]));
    const replacement = 'const ' + name + ' = ' + serialize(rows) +
      '.map(values => Object.fromEntries(' + serialize(fields) + '.map((key, index) => [key, values[index]])));';
    html = html.slice(0, match.index) + replacement + html.slice(match.index + match[0].length);
  }
  return html;
}

/** Add a inert-preview fallback without changing the interactive network data or CDN integrity.
 * @param {string} html Fresh Graphify HTML containing its original graph container and initialization.
 * @param {string} jpegBase64 Browser-rendered JPEG encoded as base64.
 * @param {{nodes: number, edges: number}} counts Rendered community counts.
 * @returns {string} HTML retaining interactive scripts and a script-free CSS image fallback.
 */
export function withStaticPreview(html, jpegBase64, counts) {
  assert(!html.includes('graphify-static-style'), 'Regenerate fresh HTML with cluster-only before adding its poster');
  for (const anchor of ['</head>', '<body>', '<div id="graph"></div>', "network.once('stabilizationIterationsDone'"]) {
    assert(html.includes(anchor), 'Graphify HTML initialization changed: missing ' + anchor);
  }
  assert(/^[A-Za-z0-9+/]+={0,2}$/.test(jpegBase64), 'Invalid poster base64');
  assert(Number.isSafeInteger(counts.nodes) && counts.nodes > 0 && Number.isSafeInteger(counts.edges) && counts.edges > 0, 'Empty rendered graph');
  const style = '<style id="graphify-static-style">' +
    '#graph.graphify-static-preview ~ #sidebar{display:none}' +
    '#graph.graphify-static-preview{width:100%;min-width:0;background:url("data:image/jpeg;base64,' + jpegBase64 + '") center/contain no-repeat}' +
    '#graphify-static-note{position:fixed;top:0;left:0;right:0;padding:8px;font:12px sans-serif;color:#eee;background:#1a1a2e;z-index:2}' +
    '#graph:not(.graphify-static-preview) ~ #graphify-static-note{display:none}</style>';
  const note = '<p id="graphify-static-note">Static preview: ' + counts.nodes + ' communities, ' + counts.edges + ' connections. Open the original HTML outside the arx preview for interactive exploration.</p>';
  return html.replace('</head>', style + '</head>')
    .replace('<div id="graph"></div>', '<div id="graph" class="graphify-static-preview"></div>' + note)
    .replace("network.once('stabilizationIterationsDone'", "container.classList.remove('graphify-static-preview');\nnetwork.once('stabilizationIterationsDone'");
}

/** Render the original HTML offline with an integrity-checked CDN asset and write validated preview files.
 * @returns {Promise<void>} Rejects on dependency, browser, rendering, integrity, or preview-size failures.
 */
export async function renderPreview() {
  const scale = timeoutScale();
  const root = process.cwd();
  const out = resolve(root, '.artifacts/graphify');
  const target = resolve(out, 'graph.html');
  const html = readFileSync(target, 'utf8');
  const script = /<script\s+src="([^"]+)"\s+integrity="sha384-([^"]+)"/.exec(html);
  assert(script, 'Graphify CDN script or integrity metadata missing');
  const [ , cdn, digest ] = script;
  assert.equal(cdn, 'https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js', 'Unreviewed visualization CDN version');
  const cache = resolve(root, '.cache/integrations');
  mkdirSync(cache, { recursive: true });
  const assetPath = resolve(cache, 'vis-network.min.js');
  let asset;
  try { asset = readFileSync(assetPath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(cdn, { signal: AbortSignal.timeout(bound(20_000, scale)) });
    assert(response.ok, 'Visualization asset HTTP ' + response.status);
    asset = Buffer.from(await response.arrayBuffer());
  }
  assert.equal(createHash('sha384').update(asset).digest('base64'), digest, 'Visualization library integrity mismatch');
  writeFileSync(assetPath, asset);
  const require = createRequire(resolve(root, 'apps/web/package.json'));
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, timeout: bound(30_000, scale) });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 740 } });
    page.setDefaultTimeout(bound(30_000, scale));
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url === cdn) await route.fulfill({ body: asset, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' } });
      else if (url === pathToFileURL(target).href) await route.continue();
      else await route.abort('blockedbyclient');
    });
    await page.goto(pathToFileURL(target).href, { waitUntil: 'load', timeout: bound(30_000, scale) });
    await page.waitForFunction(() => typeof network !== 'undefined' && network.physics.options.enabled === false, undefined, { timeout: bound(30_000, scale) });
    const readGraph = () => {
      const canvas = document.querySelector('#graph canvas');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) painted++;
      return {
        nodes: nodesDS.length, edges: edgesDS.length, painted, width: canvas.width, height: canvas.height,
        data: { nodes: RAW_NODES, edges: RAW_EDGES },
      };
    };
    const rendered = await page.evaluate(readGraph);
    const { data, ...counts } = rendered;
    assert(counts.nodes > 0 && counts.edges > 0 && counts.painted > 0, 'Graph canvas is empty');
    assert.deepEqual(errors, [], 'Visualization raised JavaScript errors');
    const jpeg = await page.locator('#graph').screenshot({ type: 'jpeg', quality: 75 });
    const enhanced = withStaticPreview(compactGraphData(html), jpeg.toString('base64'), counts);
    const maxBytes = Number(process.env.ARX_GRAPHIFY_HTML_MAX_BYTES || 2 * 1024 * 1024);
    assert(Number.isSafeInteger(maxBytes) && maxBytes > 0, 'Invalid ARX_GRAPHIFY_HTML_MAX_BYTES');
    assert(Buffer.byteLength(enhanced) <= maxBytes, 'HTML with poster exceeds configured preview budget: ' + Buffer.byteLength(enhanced) + ' > ' + maxBytes);
    writeFileSync(resolve(out, 'graph-static.jpg'), jpeg);
    const temporary = target + '.poster-' + process.pid;
    writeFileSync(temporary, enhanced);
    renameSync(temporary, target);
    await page.goto(pathToFileURL(target).href, { waitUntil: 'load', timeout: bound(30_000, scale) });
    await page.waitForFunction(() => typeof network !== 'undefined' && network.physics.options.enabled === false, undefined, { timeout: bound(30_000, scale) });
    const verified = await page.evaluate(readGraph);
    assert(verified.painted > 0, 'Compact graph canvas is empty');
    assert.equal(verified.nodes, counts.nodes, 'Compact node count changed');
    assert.equal(verified.edges, counts.edges, 'Compact edge count changed');
    assert.deepEqual(verified.data, data, 'Compact graph data changed');
    assert.deepEqual(errors, [], 'Compact visualization raised JavaScript errors');
    const evidence = { status: 'passed', ...counts, dataEquivalent: true, maxHtmlBytes: maxBytes, htmlBytes: Buffer.byteLength(enhanced), jpegBytes: jpeg.length, scriptIntegrity: 'sha384-' + digest, externalRequests: 'CDN served from integrity-checked local cache', javascriptErrors: errors };
    writeFileSync(resolve(out, 'render-verification.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence));
  } finally { await browser.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  renderPreview().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
