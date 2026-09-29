import { describe, expect, it } from 'vitest'

import { findImportProblems } from './check-upstream-import.ts'
import { parseUpstreamSyncManifest } from './upstream-sync-manifest.ts'

const manifest = parseUpstreamSyncManifest(JSON.stringify({
  repository: 'https://example.invalid/upstream.git',
  forkBase: 'a'.repeat(40),
  dropPaths: ['*.zh.md'],
  corePaths: ['packages/core/*/src/'],
  identifierMap: [['@up/up-', '@arx-ai/arx-'], ['UP_', 'ARX_']],
  slugRenames: { up: 'arx' },
  forbidden: ['acme'],
  verdicts: {},
}))

const han = String.fromCodePoint(0x4e2d, 0x6587)

const diff = [
  'diff --git a/packages/x/src/a.ts b/packages/x/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/packages/x/src/a.ts',
  '+++ b/packages/x/src/a.ts',
  '@@ -3 +3,2 @@ export const kept = 1',
  '-const old = 1',
  `+const label = '${han}'`,
  '+++counter',
  '@@ -10,0 +12 @@',
  '+import { thing } from \'@up/up-session\'',
  'diff --git a/packages/llm/presets/src/models.ts b/packages/llm/presets/src/models.ts',
  '--- a/packages/llm/presets/src/models.ts',
  '+++ b/packages/llm/presets/src/models.ts',
  '@@ -1,0 +1 @@',
  '+export const model = \'Acme-chat\'',
  'diff --git a/scripts/upstream-sync.manifest.json b/scripts/upstream-sync.manifest.json',
  '--- a/scripts/upstream-sync.manifest.json',
  '+++ b/scripts/upstream-sync.manifest.json',
  '@@ -1,0 +1 @@',
  '+    ["@up/up-", "@arx-ai/arx-"],',
  'diff --git a/docs/guide.zh.md b/docs/guide.zh.md',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/docs/guide.zh.md',
  '@@ -0,0 +1 @@',
  `+${han}`,
  'diff --git a/gone.ts b/gone.ts',
  'deleted file mode 100644',
  '--- a/gone.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  `-const removed = '${han}'`,
  '',
].join('\n')

describe('findImportProblems', () => {
  it('fails drop-listed files, CJK text, and unmapped identifiers, and lists forbidden words for review', () => {
    expect(findImportProblems(diff, manifest)).toEqual([
      { file: 'packages/x/src/a.ts', line: 3, severity: 'fail', problem: 'CJK text; translate it to Brazilian Portuguese' },
      { file: 'packages/x/src/a.ts', line: 12, severity: 'fail', problem: 'unmapped identifier @up/up-; map it to @arx-ai/arx-' },
      { file: 'packages/llm/presets/src/models.ts', line: 1, severity: 'review', problem: 'acme: keep only in model-access configuration' },
      { file: 'docs/guide.zh.md', line: 0, severity: 'fail', problem: 'drop-listed path; remove it from the import' },
    ])
  })

  it('reports nothing for a clean diff', () => {
    expect(findImportProblems('diff --git a/a.ts b/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+export const a = 1\n', manifest)).toEqual([])
  })
})
