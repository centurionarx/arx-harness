import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import test from 'node:test';
import { compactGraphData, withStaticPreview } from './render-preview.mjs';

const fixture = '<!doctype html><html><head></head><body><div id="graph"></div><div id="sidebar"></div><script>' +
  'const container={classList:{remove(){}}};const network={once(){}};network.once(\'stabilizationIterationsDone\',()=>{});</script></body></html>';

test('fallback stays on div classes retained by an inert HTML preview', () => {
  const html = withStaticPreview(fixture, 'aGVsbG8=', { nodes: 4, edges: 6 });
  assert(html.includes('<div id="graph" class="graphify-static-preview">'));
  assert(html.includes('background:url("data:image/jpeg;base64,aGVsbG8=")'));
  assert(html.includes('#graph.graphify-static-preview ~ #sidebar{display:none}'));
  assert(html.includes('Static preview: 4 communities, 6 connections.'));
  assert(!html.includes('<img'));
  assert(!html.includes('<body class='));
});

test('original interactive script still parses and removes static mode', () => {
  const html = withStaticPreview(fixture, 'aGVsbG8=', { nodes: 4, edges: 6 });
  const source = html.split('<script>')[1].split('</script>')[0];
  new Script(source).runInNewContext();
  assert(source.includes("container.classList.remove('graphify-static-preview');\nnetwork.once"));
});

test('unknown upstream initialization, empty data and invalid poster fail loud', () => {
  assert.throws(() => withStaticPreview('<html></html>', 'aGVsbG8=', { nodes: 4, edges: 6 }), /initialization changed/);
  assert.throws(() => withStaticPreview(fixture, 'bad"css', { nodes: 4, edges: 6 }), /base64/);
  assert.throws(() => withStaticPreview(fixture, 'aGVsbG8=', { nodes: 0, edges: 6 }), /Empty rendered graph/);
  const output = withStaticPreview(fixture, 'aGVsbG8=', { nodes: 4, edges: 6 });
  assert.throws(() => withStaticPreview(output, 'aGVsbG8=', { nodes: 4, edges: 6 }), /fresh HTML/);
});


test('compact data reconstructs every graph field in the original key order', () => {
  const original = {
    RAW_NODES: [
      { id: '1', label: 'GitHub / Conta', color: { background: '#fff' }, size: 4, member_count: 7 },
      { id: '2', label: 'quoted "label"', color: { background: '#000' }, size: 8, member_count: 3 },
    ],
    RAW_EDGES: [{ from: '1', to: '2', title: '2 connections', dashes: true, width: 1 }],
  };
  const source = Object.entries(original).map(([name, values]) => 'const ' + name + ' = ' + JSON.stringify(values) + ';').join('\n');
  const compact = compactGraphData(source);
  assert(compact.includes('Object.fromEntries'));
  const restored = new Script(compact + '; JSON.stringify({RAW_NODES, RAW_EDGES})').runInNewContext();
  assert.deepEqual(JSON.parse(restored), original);
  assert.deepEqual(Object.keys(JSON.parse(restored).RAW_NODES[0]), Object.keys(original.RAW_NODES[0]));
});

test('compact graph data preserves script-like labels as inert JSON values', () => {
  const label = '</script><script>globalThis.compromised=true</script> const RAW_EDGES = [1,2]; & \u2028 \u2029';
  const source = 'const RAW_NODES = ' + JSON.stringify([{ id: 'n', label }]) + ';\n' +
    'const RAW_EDGES = ' + JSON.stringify([{ from: 'n', to: 'n', title: label }]) + ';';
  const compact = compactGraphData(source);
  assert(!compact.includes('</script>'));
  assert(!compact.includes('&'));
  const restored = new Script(compact + '; JSON.stringify({RAW_NODES, RAW_EDGES, compromised: globalThis.compromised})').runInNewContext();
  assert.deepEqual(JSON.parse(restored), {
    RAW_NODES: [{ id: 'n', label }],
    RAW_EDGES: [{ from: 'n', to: 'n', title: label }],
  });
});

test('compact data rejects a changed graph emitter or inconsistent rows', () => {
  assert.throws(() => compactGraphData('<html></html>'), /RAW_NODES/);
  assert.throws(() => compactGraphData('const RAW_NODES = [];\nconst RAW_EDGES = [];'), /Empty/);
  assert.throws(() => compactGraphData('const RAW_NODES = [{"id":"a"},{"id":"b","extra":1}];\nconst RAW_EDGES = [{"from":"a","to":"b"}];'), /fields/);
});
