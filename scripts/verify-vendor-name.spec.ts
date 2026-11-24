import { describe, expect, it } from 'vitest'

import { ACCESS_FORMS, ALLOWED_PATHS, BRAND_FORMS, findVendorBrand, judgeLine } from './verify-vendor-name.ts'

/** The vendor name in its brand spelling, built from parts so this spec holds no brand form itself. */
const Name = ['Deep', 'Seek'].join('')
/** The vendor name in lowercase. */
const name = Name.toLowerCase()

describe('judgeLine', () => {
  it.each([
    ['environment variable', `Real-API tests read \`${Name.toUpperCase()}_API_KEY\` and \`${Name.toUpperCase()}_BASE_URL\`.`],
    ['environment variable inside escaped JSON', `"sh\\n${Name.toUpperCase()}_API_KEY=sk-...\\n"`],
    ['API host', `baseURL: https://api.${name}.com/v1`],
    ['model and route ids', `{ provider: '${name}-official', model: '${name}-v4-flash' }`],
    ['model display name', `| ${Name}-V4-Pro | 1M |`],
    ['provider package', `Mount \`@arx-ai/arx-llm-${name}\` or \`web-search-${name}\`.`],
    ['provider display name', `  displayName: ${Name}`],
    ['quoted provider display name', `new CatalogAdapter('${Name}', ['${name}-chat'])`],
    ['provider id', `providers: { ${name}: { apiKeyEnv: KEY } }`],
    ['code identifier', `exactly as \`validate${Name}Models\` mirrors the schema`],
    ['prose naming the provider API', `The ${Name} adapter wraps a pre-response transport failure.`],
    ['Portuguese prose naming the provider', `O nome \`${Name}\` aparece só na configuração de acesso ao modelo.`],
    ['chat-completions API', `a gateway that re-encodes a ${Name} chat-completions conversation`],
    ['license notice', `Adapted from [tool-present](https://github.com/${name}-ai/${name}-harness/tree/x), copyright 2026 ${Name}, under the MIT license.`],
  ])('allows %s', (_form, line) => {
    expect(judgeLine(line)).toBeUndefined()
  })

  it.each([
    ['original repository', `See https://github.com/${name}-ai/${name}-harness for the source.`],
    ['original repository', `This package adapts ${Name} Harness tool-present.`],
    ['vendor package scope', `Rename \`@${name}/md\` imports.`],
    ['vendor website', `[${Name}](https://www.${name}.com)`],
    ['vendor website', `Read https://docs.${name}.com/harness/plugins before adding a plugin.`],
    ['vendor service host', `default \`https://harness-telemetry.${name}svc.com/v1/logs\``],
    ['vendor chat product', `Attachment display aligns with ${Name} Chat, whose API key users already hold.`],
    ['vendor design system', `Tokens follow the ${Name} design system and its model palette.`],
    ['vendor product directory', `Workflows live in \`.${name}/workflows/\`.`],
    ['unqualified name', `arx Harness was originally built by ${Name}.`],
    ['unqualified name', `O arx Harness nasceu dentro da ${Name}.`],
  ])('rejects %s', (reason, line) => {
    expect(judgeLine(line)).toBe(reason)
  })

  it('rejects a remaining name whose nearest access term is outside the word window', () => {
    expect(judgeLine(`${Name} created this product, and years later one two three four five six seven the adapter shipped.`)).toBe('unqualified name')
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
    const text = ['# Guide', `Set \`${Name.toUpperCase()}_API_KEY\`.`, `Built by ${Name}.`, `See https://www.${name}.com.`].join('\n')
    expect(findVendorBrand('docs/guide.md', text)).toEqual(['docs/guide.md:3: unqualified name', 'docs/guide.md:4: vendor website'])
  })

  it('skips each allowed path and only those paths', () => {
    const text = `Copyright holder: ${Name}, see https://www.${name}.com.`
    expect(ALLOWED_PATHS.map(form => form.name)).toEqual(['license file', 'third-party notices', 'vendored source', 'this gate', 'upstream-sync manifest'])
    for (const path of ['LICENSE', 'packages/fs/tool-present/LICENSE', 'THIRD_PARTY_NOTICES.md', 'vendor/cordis/README.md', 'scripts/verify-vendor-name.ts', 'scripts/upstream-sync.manifest.json']) {
      expect(findVendorBrand(path, text)).toEqual([])
    }
    for (const path of ['LICENSE.md.bak', 'docs/THIRD_PARTY_NOTICES.md', 'packages/vendor/README.md', 'scripts/verify-vendor-name.spec.ts', 'scripts/upstream-sync.ts']) {
      expect(findVendorBrand(path, text)).toEqual([`${path}:1: vendor website`])
    }
  })
})
