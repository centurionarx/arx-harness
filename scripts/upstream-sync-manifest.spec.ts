import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  CJK_CHARACTER,
  dropListEntry,
  isCorePath,
  parseUpstreamSyncManifest,
  readUpstreamSyncManifest,
  renameSegments,
} from './upstream-sync-manifest.ts'

const valid = {
  repository: 'https://example.invalid/upstream.git',
  forkBase: 'a'.repeat(40),
  dropPaths: ['packages/llm/llm-acme/', '*.zh.md', 'BRAND.md'],
  corePaths: ['packages/core/*/src/', 'packages/session/persistence*/src/'],
  identifierMap: [['@up/up-', '@arx-ai/arx-'], ['UP_', 'ARX_']],
  slugRenames: { acme: 'vendor', up: 'arx' },
  forbidden: ['Acme'],
  verdicts: { 'some-note': { class: 'incorporate', reason: 'small: one cherry-pick' } },
}

const parse = (overrides: Record<string, unknown>) => parseUpstreamSyncManifest(JSON.stringify({ ...valid, ...overrides }))

describe('parseUpstreamSyncManifest', () => {
  it('accepts a complete manifest and lowercases forbidden words', () => {
    expect(parse({})).toEqual({ ...valid, forbidden: ['acme'] })
  })

  it('validates the checked-in manifest', () => {
    const manifest = readUpstreamSyncManifest(resolve(import.meta.dirname, '..'))
    expect(manifest.forkBase).toMatch(/^[0-9a-f]{40}$/)
    expect(Object.keys(manifest.verdicts).length).toBeGreaterThan(0)
  })

  it.each([
    ['a non-object', [], 'expected an object'],
    ['an unknown field', { ...valid, extra: true }, 'unsupported field(s): extra'],
    ['a short fork base', { ...valid, forkBase: 'abc' }, 'forkBase must be a full lowercase commit SHA'],
    ['a missing repository', { ...valid, repository: '' }, 'repository must be a non-empty string'],
    ['a drop path that is not a list', { ...valid, dropPaths: 'x' }, 'dropPaths must be an array of strings'],
    ['a drop path glob inside a directory', { ...valid, dropPaths: ['packages/*/x/'] }, 'dropPaths[0] must be a dir/ prefix'],
    ['a nested suffix glob', { ...valid, dropPaths: ['*.zh/*.md'] }, 'dropPaths[0] must be a dir/ prefix'],
    ['an identifier map that is not a list', { ...valid, identifierMap: {} }, 'identifierMap must be an array of [upstream, local] pairs'],
    ['an identifier entry that is not a pair', { ...valid, identifierMap: [['only']] }, 'identifierMap[0] must be an [upstream, local] pair'],
    ['an empty identifier', { ...valid, identifierMap: [['', 'x']] }, 'identifierMap[0][0] must be a non-empty string'],
    ['renames that are not an object', { ...valid, slugRenames: [] }, 'slugRenames must be an object'],
    ['a multi-segment rename', { ...valid, slugRenames: { 'two-parts': 'x' } }, 'slugRenames.two-parts must rename one lowercase segment'],
    ['an uppercase replacement', { ...valid, slugRenames: { up: 'Arx' } }, 'slugRenames.up must rename one lowercase segment'],
    ['verdicts that are not an object', { ...valid, verdicts: [] }, 'verdicts must be an object'],
    ['a dated verdict name', { ...valid, verdicts: { '2026-01-01 x': {} } }, 'must be a note name without its date prefix'],
    ['a verdict that is not an object', { ...valid, verdicts: { x: 'drop' } }, 'verdicts.x must be an object'],
    ['an unknown verdict class', { ...valid, verdicts: { x: { class: 'maybe', reason: 'r' } } }, 'verdicts.x.class must be one of'],
    ['an empty verdict reason', { ...valid, verdicts: { x: { class: 'drop', reason: '' } } }, 'verdicts.x.reason must be a non-empty string'],
  ])('rejects %s', (_case, content, message) => {
    expect(() => parseUpstreamSyncManifest(JSON.stringify(content))).toThrow(message)
  })
})

describe('manifest matching', () => {
  const manifest = parse({})

  it('matches drop-list prefixes, suffixes, and exact paths', () => {
    expect(dropListEntry('packages/llm/llm-acme/src/index.ts', manifest)).toBe('packages/llm/llm-acme/')
    expect(dropListEntry('docs/guide.zh.md', manifest)).toBe('*.zh.md')
    expect(dropListEntry('BRAND.md', manifest)).toBe('BRAND.md')
    expect(dropListEntry('docs/BRAND.md', manifest)).toBeUndefined()
    expect(dropListEntry('packages/llm/llm-acme-extra/x.ts', manifest)).toBeUndefined()
  })

  it('matches core prefixes with one-segment wildcards', () => {
    expect(isCorePath('packages/core/agent-loop/src/index.ts', manifest)).toBe(true)
    expect(isCorePath('packages/session/persistence-sqlite/src/store.ts', manifest)).toBe(true)
    expect(isCorePath('packages/core/agent-loop/README.md', manifest)).toBe(false)
    expect(isCorePath('packages/core/a/b/src/index.ts', manifest)).toBe(false)
  })

  it('renames whole segments only', () => {
    expect(renameSegments('single-up-launcher', manifest)).toBe('single-arx-launcher')
    expect(renameSegments('acme-login', manifest)).toBe('vendor-login')
    expect(renameSegments('upstream-acmes', manifest)).toBe('upstream-acmes')
  })

  it('recognizes CJK characters and nothing else', () => {
    for (const codePoint of [0x4e2d, 0x3042, 0x30a2, 0xac00, 0x3001, 0xff0c]) {
      expect(CJK_CHARACTER.test(String.fromCodePoint(codePoint))).toBe(true)
    }
    expect(CJK_CHARACTER.test('plain ASCII, accents: é ç ã — and arrows →')).toBe(false)
  })
})
