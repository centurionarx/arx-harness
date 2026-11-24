import { describe, expect, it } from 'vitest'

import { ACCESS_FORMS, ALLOWED_PATHS, BRAND_FORMS, findVendorBrand, judgeLine } from './verify-vendor-name.ts'

describe('judgeLine', () => {
  it.each([
    ['environment variable', 'Real-API tests read `DEEPSEEK_API_KEY` and `DEEPSEEK_BASE_URL`.'],
    ['environment variable inside escaped JSON', String.raw`"sh\nDEEPSEEK_API_KEY=sk-...\n"`],
    ['API host', 'baseURL: https://api.deepseek.com/v1'],
    ['model and route ids', "{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }"],
    ['model display name', '| DeepSeek-V4-Pro | 1M |'],
    ['provider package', 'Mount `@arx-ai/arx-llm-deepseek` or `web-search-deepseek`.'],
    ['provider display name', '  displayName: DeepSeek'],
    ['quoted provider display name', "new CatalogAdapter('DeepSeek', ['deepseek-chat'])"],
    ['provider id', 'providers: { deepseek: { apiKeyEnv: KEY } }'],
    ['code identifier', 'exactly as `validateDeepSeekModels` mirrors the schema'],
    ['prose naming the provider API', 'The DeepSeek adapter wraps a pre-response transport failure.'],
    ['Portuguese prose naming the provider', 'O nome `DeepSeek` aparece só na configuração de acesso ao modelo.'],
    ['chat-completions API', 'a gateway that re-encodes a DeepSeek chat-completions conversation'],
    ['license notice', 'Adapted from [tool-present](https://github.com/deepseek-ai/deepseek-harness/tree/x), copyright 2026 DeepSeek, under the MIT license.'],
  ])('allows %s', (_form, line) => {
    expect(judgeLine(line)).toBeUndefined()
  })

  it.each([
    ['original repository', 'See https://github.com/deepseek-ai/deepseek-harness for the source.'],
    ['original repository', 'This package adapts DeepSeek Harness tool-present.'],
    ['vendor package scope', 'Rename `@deepseek/md` imports.'],
    ['vendor website', '[DeepSeek](https://www.deepseek.com)'],
    ['vendor website', 'Read https://docs.deepseek.com/harness/plugins before adding a plugin.'],
    ['vendor service host', 'default `https://harness-telemetry.deepseeksvc.com/v1/logs`'],
    ['vendor chat product', 'Attachment display aligns with DeepSeek Chat, whose API key users already hold.'],
    ['vendor design system', 'Tokens follow the DeepSeek design system and its model palette.'],
    ['vendor product directory', 'Workflows live in `.deepseek/workflows/`.'],
    ['unqualified name', 'arx Harness was originally built by DeepSeek.'],
    ['unqualified name', 'O arx Harness nasceu dentro da DeepSeek.'],
  ])('rejects %s', (reason, line) => {
    expect(judgeLine(line)).toBe(reason)
  })

  it('rejects a remaining name whose nearest access term is outside the word window', () => {
    expect(judgeLine('DeepSeek created this product, and years later one two three four five six seven the adapter shipped.')).toBe('unqualified name')
  })

  it('ignores a line without the vendor name', () => {
    expect(judgeLine('arx Harness is a plugin-based agent harness.')).toBeUndefined()
  })
})

describe('closed exception lists', () => {
  it('has a rejecting case above for every brand form', () => {
    expect(BRAND_FORMS.map(form => form.name)).toEqual([
      'original repository',
      'vendor package scope',
      'vendor website',
      'vendor service host',
      'vendor chat product',
      'vendor design system',
      'vendor product directory',
    ])
  })

  it('has an allowing case above for every access form', () => {
    expect(ACCESS_FORMS.map(form => form.name)).toEqual([
      'environment variable',
      'API host',
      'model or route id',
      'model display name',
      'provider package',
      'provider display name',
      'provider id',
      'code identifier',
    ])
  })
})

describe('findVendorBrand', () => {
  it('names every failing line of a scanned file', () => {
    const text = ['# Guide', 'Set `DEEPSEEK_API_KEY`.', 'Built by DeepSeek.', 'See https://www.deepseek.com.'].join('\n')
    expect(findVendorBrand('docs/guide.md', text)).toEqual(['docs/guide.md:3: unqualified name', 'docs/guide.md:4: vendor website'])
  })

  it('skips each allowed path and only those paths', () => {
    const text = 'Copyright holder: DeepSeek, see https://www.deepseek.com.'
    expect(ALLOWED_PATHS.map(form => form.name)).toEqual(['license file', 'third-party notices', 'vendored source', 'upstream-sync manifest'])
    for (const path of ['LICENSE', 'packages/fs/tool-present/LICENSE', 'THIRD_PARTY_NOTICES.md', 'vendor/cordis/README.md', 'scripts/upstream-sync.manifest.json']) {
      expect(findVendorBrand(path, text)).toEqual([])
    }
    for (const path of ['LICENSE.md.bak', 'docs/THIRD_PARTY_NOTICES.md', 'packages/vendor/README.md', 'scripts/upstream-sync.ts']) {
      expect(findVendorBrand(path, text)).toEqual([`${path}:1: vendor website`])
    }
  })
})
