import { describe, expect, it } from 'vitest'

import { findChineseText, HAN_CHARACTER, scannablePaths, scannableText } from './verify-chinese-text.ts'

/** Two Han characters, built from code points so this spec holds no Chinese text itself. */
const han = String.fromCodePoint(0x4e2d, 0x6587)

describe('HAN_CHARACTER', () => {
  it('matches Chinese text and not kana, Hangul, full-width forms, or Portuguese', () => {
    expect(HAN_CHARACTER.test(`label ${han}`)).toBe(true)
    expect(HAN_CHARACTER.test(String.fromCodePoint(0x3072, 0x30ab, 0xd55c))).toBe(false)
    expect(HAN_CHARACTER.test('Seguro（RECOMENDADO）')).toBe(false)
    expect(HAN_CHARACTER.test('ＡＢＣ')).toBe(false)
    expect(HAN_CHARACTER.test('Opção recomendada')).toBe(false)
  })
})

describe('findChineseText', () => {
  it('rejects a file that holds Chinese text, naming its first line and the line count', () => {
    const text = ['# Guide', '', `A ${han} sample.`, 'English.', han].join('\n')
    expect(findChineseText('docs/guide.md', text)).toBe(
      'docs/guide.md:3: holds Chinese text on 2 line(s); translate it to Brazilian Portuguese, or write a Han character code must match as a \\u escape',
    )
  })

  it('rejects a single Han character inside source code', () => {
    expect(findChineseText('src/parser.ts', `const suffix = /${han[0] ?? ''}/`)).toMatch(/^src\/parser\.ts:1: holds Chinese text on 1 line\(s\)/)
  })

  it('accepts a file whose code names a Han character by its escape', () => {
    expect(findChineseText('src/parser.ts', String.raw`const suffix = /\u63a8\u8350/`)).toBeUndefined()
  })

  it('accepts Portuguese, full-width punctuation, and an empty file', () => {
    expect(findChineseText('docs/guia.md', 'Opção（recomendada）。\n')).toBeUndefined()
    expect(findChineseText('empty.txt', '')).toBeUndefined()
  })
})

describe('scannableText', () => {
  it('decodes UTF-8 text and leaves a file with a NUL byte unscanned', () => {
    expect(scannableText(Buffer.from(`A ${han} sample.`, 'utf8'))).toBe(`A ${han} sample.`)
    expect(scannableText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))).toBeUndefined()
  })
})

describe('scannablePaths', () => {
  it('keeps regular files, vendored sources included, and skips symlinks and submodules', () => {
    const entries = [
      '100644 aaaa 0\tdocs/guide.md',
      '100755 bbbb 0\tscripts/run.sh',
      '120000 cccc 0\tCLAUDE.md',
      '160000 dddd 0\tthird_party/module',
      '100644 eeee 0\tvendor/cordis/src/index.ts',
      '',
    ].join('\0')
    expect(scannablePaths(entries)).toEqual(['docs/guide.md', 'scripts/run.sh', 'vendor/cordis/src/index.ts'])
  })
})
