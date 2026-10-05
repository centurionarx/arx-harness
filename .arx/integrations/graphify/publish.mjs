/**
 * Opt-in publication of trusted, locally generated Graphify HTML on the existing
 * webServer. The owner activates the profile; this plugin never opens a server.
 * Each request rereads graph.html. CSP sandbox keeps scripts at an opaque origin,
 * without ARX storage or API access. This is not an arbitrary HTML publisher.
 */
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, isAbsolute } from 'node:path';

const require = createRequire(new URL('../../../packages/host/frontend-static/package.json', import.meta.url));
const z = require('@arx-ai/schemastery');

export const name = 'graphify-publish';
export const inject = ['webServer'];
export const Config = z.object({
  path: z.string().required(),
  graphPath: z.string().required(),
  maxBytes: z.natural().min(1).max(16 * 1024 * 1024).required(),
});

const external = '<script src="https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js"\n' +
  '        integrity="sha384-Ux6phic9PEHJ38YtrijhkzyJ8yQlH8i/+buBR8s3mAZOJrP1gwyvAcIYl3GWtpX1"\n' +
  '        crossorigin="anonymous">';

async function graphHtml(graphPath, maxBytes, nonce) {
  let html;
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of createReadStream(graphPath)) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error('Graphify byte limit exceeded.');
      chunks.push(chunk);
    }
    html = Buffer.concat(chunks, bytes).toString('utf8');
  } catch {
    // Missing or unreadable generated artifacts are unavailable, never stale.
    throw new Error('Graphify graph.html is unavailable; run the Graphify refresh.');
  }
  const scripts = [...html.matchAll(/^<script\b[^>]*>/gm)].map(match => match[0]);
  if (!html.startsWith('<!DOCTYPE html>') || !/<title>graphify - [^<]+<\/title>/.test(html) ||
      !/<div id="graph"(?: class="graphify-static-preview")?>/.test(html) || !html.includes('new vis.Network(') ||
      scripts.length !== 3 || scripts[0] !== external || scripts[1] !== '<script>' || scripts[2] !== '<script>' ||
      !html.includes('const hyperedges = ') || !html.includes("network.on('afterDrawing',")) {
    throw new Error('Graphify graph.html is invalid; run the Graphify refresh.');
  }
  html = html.replace(/^<script\b[^>]*>/gm, tag => tag.replace('<script', '<script nonce="' + nonce + '"'));
  if (Buffer.byteLength(html) > maxBytes) throw new Error('Graphify byte limit exceeded.');
  return html;
}

/**
 * Register one exact route and remove it on fiber disposal. Invalid configuration
 * or missing/invalid generated HTML rejects activation. Runtime failures return
 * 503 without filesystem diagnostics; request URLs never select a file. maxBytes
 * bounds both the streamed artifact and the complete nonce-injected response.
 * @param ctx Cordis context with the existing webServer injection.
 * @param config Explicit route pathname, absolute graph.html path and byte limit.
 * @returns Resolves after validation and effect-owned route registration.
 */
export async function apply(ctx, config) {
  config = Config(config);
  if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(config.path)) {
    throw new Error('Graphify path must be an absolute non-root pathname without a trailing slash, query or fragment.');
  }
  if (!isAbsolute(config.graphPath) || basename(config.graphPath) !== 'graph.html') {
    throw new Error('Graphify graphPath must be an absolute path ending in graph.html.');
  }
  await graphHtml(config.graphPath, config.maxBytes, randomBytes(24).toString('base64'));
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: config.path,
    async handler(req, res) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
      }
      const nonce = randomBytes(24).toString('base64');
      let html;
      try {
        html = await graphHtml(config.graphPath, config.maxBytes, nonce);
      } catch {
        // Every read or signature failure yields the same path-free HTTP error.
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : 'Graphify graph unavailable.');
        return;
      }
      const csp = "sandbox allow-scripts; default-src 'none'; script-src 'nonce-" + nonce +
        "'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; " +
        "object-src 'none'; form-action 'none'; base-uri 'none'";
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': csp,
        'Content-Length': Buffer.byteLength(html),
      });
      res.end(req.method === 'HEAD' ? undefined : html);
    },
  }));
}
