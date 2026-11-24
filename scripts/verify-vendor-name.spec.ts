import { describe, expect, it } from 'vitest'

import { ACCESS_FORMS, BRAND_FORMS, findVendorBrand, judgeLine } from './verify-vendor-name.ts'

/** The vendor name in its brand spelling, built from parts so this spec holds no brand form itself. */
const Name = ['Deep', 'Seek'].join('')
/** The vendor name in lowercase. */
const name = Name.toLowerCase()
/** The vendor name in uppercase. */
const NAME = Name.toUpperCase()

/** Lines each allowed only by the named access form: no access term stands near the name. */
const allowedByForm: readonly (readonly [form: string, line: string])[] = [
  ['environment variable', `Export \`${NAME}_BASE_URL\` before the run.`],
  ['environment variable', `"sh\\n${NAME}_API_KEY=sk-...\\n"`],
  ['API host', `Point the client at https://api.${name}.com/v1 today.`],
  ['model or route id', `Pick \`${name}-v4-flash\` or \`${name}-official\` here.`],
  ['model display name', `| ${Name}-V4-Pro | 1M |`],
  ['provider package', `Mount \`@arx-ai/arx-llm-${name}\` here.`],
  ['provider display name', `  displayName: ${Name}`],
  ['provider display name', `  "displayName": "${Name}",`],
  ['provider display name', `new CatalogAdapter('${Name}', [])`],
  ['provider id', `{ ${name}: {} }`],
  ['provider id', `thinkingFormat: ${name}`],
  ['provider id', `  ${name}["@arx-ai/x"] --> web`],
  ['code identifier', `exactly as \`validate${Name}Models\` mirrors it`],
]

describe('judgeLine', () => {
  it.each(allowedByForm)('allows the %s form', (_form, line) => {
    expect(judgeLine(line)).toBeUndefined()
  })

  it.each(allowedByForm)('rejects the %s case once its form is replaced by the bare name', (form, line) => {
    const pattern = ACCESS_FORMS.find(access => access.name === form)?.pattern
    expect(pattern).toBeDefined()
    expect(judgeLine(line.replace(pattern ?? /$^/, Name))).toBe('unqualified name')
  })

  it.each([
    ['prose naming the provider adapter', `The ${Name} adapter wraps a pre-response transport failure.`],
    ['Portuguese prose naming the provider', `O nome \`${Name}\` aparece só no acesso ao modelo.`],
    ['the chat-completions API', `a gateway that re-encodes a ${Name} chat-completions conversation`],
    ['a model display name beside its model id', `{ id: '${name}-chat', name: '${Name} Chat' }`],
    ['a copyright sentence beside the original repository link', `Adapted from [x](https://github.com/${name}-ai/${name}-harness), copyright 2026 ${Name}, under the MIT license. It adds metadata.`],
  ])('allows %s', (_case, line) => {
    expect(judgeLine(line)).toBeUndefined()
  })

  it.each([
    ['original repository', `See https://github.com/${name}-ai/${name}-harness for the source.`],
    ['original repository', `This package adapts ${Name} Harness tool-present.`],
    ['vendor package scope', `Rename \`@${name}/md\` imports.`],
    ['vendor website', `[${Name}](https://www.${name}.com)`],
    ['vendor website', `Read https://docs.${name}.com/harness/plugins before adding a plugin.`],
    ['vendor service host', `default \`https://harness-telemetry.${name}svc.com/v1/logs\``],
    ['origin claim', `built by ${name}`],
    ['origin claim', `arx Harness was created by ${Name} as its model harness.`],
    ['origin claim', `Copyright 2026 ${Name}. arx Harness is a ${Name} product.`],
    ['origin claim', `O arx Harness foi criado pela ${Name} com o modelo.`],
    ['origin claim', `A ${Name}-made harness for the model.`],
    ['origin claim', `${Name} owns arx and its model routes.`],
    ['origin claim', `The adapter belongs to ${Name}.`],
    ['original repository', `class ${Name}Harness {}`],
    ['vendor chat product', `Attachment display aligns with ${Name} Chat, whose API key users already hold.`],
    ['vendor chat product', `title: '${Name} Chat'`],
    ['vendor chat product', `class ${Name}ChatView {}`],
    ['vendor design system', `Tokens follow the ${Name} design system and its model palette.`],
    ['vendor product directory', `Workflows live in \`.${name}/workflows/\`.`],
    ['unqualified name', `"author": "${Name}"`],
    ['unqualified name', `arx Harness came out of ${Name}.`],
    ['unqualified name', `O arx Harness nasceu dentro da ${Name}.`],
  ])('rejects %s', (reason, line) => {
    expect(judgeLine(line)).toBe(reason)
  })

  it('rejects a remaining name whose nearest access term is outside the word window', () => {
    expect(judgeLine(`${Name} wrote this, and years later one two three four five six seven the adapter shipped.`)).toBe('unqualified name')
  })

  it('ignores a line without the vendor name', () => {
    expect(judgeLine('arx Harness is a plugin-based agent harness.')).toBeUndefined()
  })

  it('exercises every access form and every brand form above', () => {
    expect(new Set(allowedByForm.map(([form]) => form))).toEqual(new Set(ACCESS_FORMS.map(form => form.name)))
    const rejected = BRAND_FORMS.map(form => form.name)
    expect(rejected).toEqual([
      'original repository',
      'vendor package scope',
      'vendor website',
      'vendor service host',
      'origin claim',
      'vendor chat product',
      'vendor design system',
      'vendor product directory',
    ])
  })
})

describe('findVendorBrand', () => {
  it('names every failing line of a scanned file', () => {
    const text = ['# Guide', `Set \`${NAME}_API_KEY\`.`, `Ask ${Name}.`, `See https://www.${name}.com.`].join('\n')
    expect(findVendorBrand('docs/guide.md', text)).toEqual(['docs/guide.md:3: unqualified name', 'docs/guide.md:4: vendor website'])
  })

  it('scans every path, including the retired upstream-sync manifest, license files, and vendored sources', () => {
    const text = `Holder: ${Name}, see https://www.${name}.com.`
    for (const path of ['scripts/upstream-sync.manifest.json', 'LICENSE', 'packages/fs/tool-present/LICENSE', 'THIRD_PARTY_NOTICES.md', 'vendor/cordis/README.md', 'scripts/verify-vendor-name.ts']) {
      expect(findVendorBrand(path, text)).toEqual([`${path}:1: vendor website`])
    }
  })

  it('accepts a license file whose vendor mention is its copyright notice', () => {
    expect(findVendorBrand('packages/fs/tool-present/LICENSE', ['MIT License', '', `Copyright (c) 2026 ${Name}`].join('\n'))).toEqual([])
  })
})
