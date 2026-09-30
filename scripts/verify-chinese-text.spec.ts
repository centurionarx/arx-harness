import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  CHINESE_TEXT_MANIFEST_PATH,
  findChineseTextProblems,
  HAN_CHARACTER,
  parseChineseTextManifest,
  scannablePaths,
} from './verify-chinese-text.ts'

/** Two Han characters, built from code points so this spec holds no Chinese text itself. */
const han = String.fromCodePoint(0x4e2d, 0x6587)

const manifest = parseChineseTextManifest(JSON.stringify({
  literal: { 'src/parser.ts': 'matches model output' },
  pending: ['docs/guide.md'],
}))

describe('HAN_CHARACTER', () => {
  it('matches Chinese text and not kana, Hangul, full-width punctuation, or Portuguese', () => {
    expect(HAN_CHARACTER.test(`label ${han}`)).toBe(true)
    expect(HAN_CHARACTER.test(String.fromCodePoint(0x3072, 0x30ab, 0xd55c))).toBe(false)
    expect(HAN_CHARACTER.test('Seguro（RECOMENDADO）')).toBe(false)
    expect(HAN_CHARACTER.test('Opção recomendada')).toBe(false)
  })
})

describe('findChineseTextProblems', () => {
  it('accepts listed files that hold Chinese text', () => {
    const holding = new Set(['src/parser.ts', 'docs/guide.md'])
    expect(findChineseTextProblems(holding, new Set([...holding, 'README.md']), manifest)).toEqual([])
  })

  it('rejects an unlisted file that holds Chinese text', () => {
    const holding = new Set(['src/parser.ts', 'docs/guide.md', 'docs/new.md'])
    expect(findChineseTextProblems(holding, holding, manifest)).toEqual([
      'docs/new.md: holds Chinese text; translate it to Brazilian Portuguese, or list it under literal with the reason code must match that text',
    ])
  })

  it('rejects a listed file that no longer holds Chinese text, so the backlog only shrinks', () => {
    const scanned = new Set(['src/parser.ts', 'docs/guide.md'])
    expect(findChineseTextProblems(new Set(['src/parser.ts']), scanned, manifest)).toEqual([
      `docs/guide.md: holds no Chinese text; remove its entry from ${CHINESE_TEXT_MANIFEST_PATH}`,
    ])
  })

  it('rejects an entry that names no scanned text file', () => {
    expect(findChineseTextProblems(new Set(['docs/guide.md']), new Set(['docs/guide.md']), manifest)).toEqual([
      `src/parser.ts: listed in ${CHINESE_TEXT_MANIFEST_PATH} but not a tracked text file; remove the entry`,
    ])
  })
})

describe('parseChineseTextManifest', () => {
  it.each([
    ['a non-object document', '[]', 'expected an object with literal and pending'],
    ['an unknown key', '{"literal":{},"pending":[],"extra":1}', 'unknown key(s): extra'],
    ['a literal list', '{"literal":[],"pending":[]}', 'literal must be an object of path → reason'],
    ['an empty reason', '{"literal":{"a.ts":" "},"pending":[]}', 'literal a.ts: the reason must be a non-empty string'],
    ['a non-array pending', '{"literal":{},"pending":{}}', 'pending must be an array of paths'],
    ['a duplicate pending entry', '{"literal":{},"pending":["a.md","a.md"]}', 'pending lists a.md twice'],
    ['a path in both sections', '{"literal":{"a.md":"why"},"pending":["a.md"]}', 'a.md is listed under both literal and pending'],
  ])('fails loud on %s', (_case, text, message) => {
    expect(() => parseChineseTextManifest(text)).toThrow(`${CHINESE_TEXT_MANIFEST_PATH}: ${message}`)
  })

  it('parses the committed manifest', () => {
    const committed = parseChineseTextManifest(readFileSync(resolve(import.meta.dirname, '..', CHINESE_TEXT_MANIFEST_PATH), 'utf8'))
    expect(committed.pending.length).toBeGreaterThan(0)
  })
})

describe('scannablePaths', () => {
  it('keeps regular files and skips symlinks, submodules, and vendored sources', () => {
    const entries = [
      '100644 aaaa 0\tdocs/guide.md',
      '100755 bbbb 0\tscripts/run.sh',
      '120000 cccc 0\tCLAUDE.md',
      '160000 dddd 0\tthird_party/module',
      '100644 eeee 0\tvendor/cordis/src/index.ts',
      '',
    ].join('\0')
    expect(scannablePaths(entries)).toEqual(['docs/guide.md', 'scripts/run.sh'])
  })
})
