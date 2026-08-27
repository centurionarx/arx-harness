import { describe, expect, it } from 'vitest'

import { type Brand, rebrandText } from './rebrand.ts'

/**
 * The rebrand is a classifier, not a substitution: most `deepseek` spans name
 * the DeepSeek model, provider, credential, or third-party repository and must
 * survive untouched, while every span carrying this product's own identity
 * moves. Each case pins one span the rewrite owns or one it must not reach.
 */
const CHANGED: readonly (readonly [string, string])[] = [
  // npm scope and package prefix
  ['@centurionarx/cxh-session', '@arx-ai/arx-session'],
  ['@centurionarx/cordis', '@arx-ai/cordis'],
  ['@centurionarx/schemastery', '@arx-ai/schemastery'],
  ['@centurionarx/cxh-llm-deepseek', '@arx-ai/arx-llm-deepseek'],
  // product identity in prose, paths, and identifiers
  ['CENTURIONarx Harness (`cxh`) is an open-source', 'arx Harness (`arx`) is an open-source'],
  ['a CENTURIONarx-Harness PR', 'a arx-Harness PR'],
  ['CENTURIONarxHarnessConfig', 'ArxHarnessConfig'],
  ['centurionarx harness architecture', 'arx harness architecture'],
  ['centurionarx_harness_runtime_bin', 'arx_harness_runtime_bin'],
  ['CENTURIONarx ships nothing', 'arx ships nothing'],
  // the product's own repository: the slug moves, the GitHub owner does not
  [
    'https://github.com/centurionarx/centurionarx-harness.git',
    'https://github.com/centurionarx/arx-harness.git',
  ],
  [
    'https://raw.githubusercontent.com/centurionarx/centurionarx-harness/master/README.md',
    'https://raw.githubusercontent.com/centurionarx/arx-harness/master/README.md',
  ],
  // environment and identifier prefixes a word boundary would hide
  ['window.__CXH_BOOT__', 'window.__ARX_BOOT__'],
  ['_cxh_base_agent_default_model', '_arx_base_agent_default_model'],
  ['_cxhWebServer', '_arxWebServer'],
  ['CxhWindow', 'ArxWindow'],
  ['isInternalCxh(name)', 'isInternalArx(name)'],
  ['resolveCxhHome', 'resolveArxHome'],
  ['extensions.cxhUnknown', 'extensions.arxUnknown'],
  ['CXH_HOME', 'ARX_HOME'],
  // a prefix glued to a preceding word or escape: only the separator identifies it
  ['Skillcxh-manage-issues', 'Skillarx-manage-issues'],
  ['CXH_CRED_TEST: a\\nCXH_CRED_OTHER: [b]', 'ARX_CRED_TEST: a\\nARX_CRED_OTHER: [b]'],
  ['[type: shell]\\ncxh> ', '[type: shell]\\narx> '],
  ['```sh\\ncxh plugin --profile <name> add', '```sh\\narx plugin --profile <name> add'],
  // the design-system custom-property namespace
  ['--dsw-alias-label-primary', '--arx-alias-label-primary'],
  ['var(--dsw-static-deepseek-450)', 'var(--arx-static-deepseek-450)'],
  // generated catalog anchors fuse scope and prefix; hand-written docs link to them
  ['<a id="centurionarxcxh-tool-bash"></a>', '<a id="arx-aiarx-tool-bash"></a>'],
]

const PRESERVED: readonly string[] = [
  // credentials, routes, and model ids owned by the DeepSeek provider
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'provider: deepseek-official',
  'model: deepseek-v4-flash',
  'deepseek-chat',
  'https://api.deepseek.com/v1',
  "provider: 'deepseek'",
  'thinkingFormat: deepseek',
  'deepSeekReadiness',
  'The DeepSeek adapter. Shipped default',
  // the MIT notice names the original copyright holder
  'Copyright (c) 2026 DeepSeek',
  // third-party repositories: the vendor manifest pins their commits and the
  // notes cite their pull requests, so a rename points both at nothing
  'https://github.com/deepseek-ai/deepseek-harness',
  'https://github.com/deepseek-harness/cordis',
  'https://github.com/deepseek-harness/cosmokit',
  'https://github.com/deepseek-harness/schemastery',
  'https://github.com/deepseek-harness/deepseek-harness/pull/436',
  'https://github.com/deepseek-harness/deepseek-harness/issues/2488',
  // archived notes are frozen, so links into them keep the file names they had
  '../../archived/architecture/2026-07-28-dsh-native-typescript-source-launch.md',
  '[note](../../archived/feature/2026-08-08-dsh-run-headless-command.zh.md)',
  // `dsw` outside the custom-property namespace: a String method, an opaque
  // id, and DeepSeek's own web product
  'value.endsWith(suffix)',
  'sbtYDSwEVQd',
  "dsweb's likely lightbox wash",
  // the GitHub organization keeps its name, so prose naming it stays put even
  // though the identical literal moves as an npm scope
  'the centurionarx organization',
  // words that merely contain a prefix-shaped run
  'handshake',
  'spreadsheet',
  'CardShell',
]

describe('rebrandText', () => {
  it.each(CHANGED)('rewrites %j', (input, expected) => {
    expect(rebrandText(input)).toBe(expected)
  })

  it.each(PRESERVED)('preserves %j', (input) => {
    expect(rebrandText(input)).toBe(input)
  })

  it('rewrites the product repository without touching either third-party one', () => {
    const mixed = 'see https://github.com/centurionarx/centurionarx-harness,'
      + ' https://github.com/deepseek-ai/deepseek-harness and https://github.com/deepseek-harness/cordis'
    expect(rebrandText(mixed)).toBe(
      'see https://github.com/centurionarx/arx-harness,'
      + ' https://github.com/deepseek-ai/deepseek-harness and https://github.com/deepseek-harness/cordis',
    )
  })

  // The bare literal is the discriminating case: `@<scope>` is claimed by an
  // earlier rule, so only an unidentified occurrence can show whether the owner
  // rule reaches beyond a repository URL.
  it('moves the GitHub owner and the npm scope independently', () => {
    const elsewhere: Brand = {
      scope: 'arx-ai',
      prefix: 'arx',
      slug: 'arx-harness',
      prose: 'arx Harness',
      owner: 'another-org',
      pascal: 'ArxHarness',
    }
    const input = 'https://github.com/centurionarx/centurionarx-harness.git,'
      + ' https://raw.githubusercontent.com/centurionarx/centurionarx-harness/master/README.md,'
      + ' @centurionarx/cxh-session, and the centurionarx organization'
    expect(rebrandText(input, elsewhere)).toBe(
      'https://github.com/another-org/arx-harness.git,'
      + ' https://raw.githubusercontent.com/another-org/arx-harness/master/README.md,'
      + ' @arx-ai/arx-session, and the centurionarx organization',
    )
  })

  it('keeps the bilingual link label intact', () => {
    expect(rebrandText('English | [中文](CONTRIBUTING.zh.md)')).toBe('English | [中文](CONTRIBUTING.zh.md)')
  })

  it('is idempotent', () => {
    for (const [input] of CHANGED) expect(rebrandText(rebrandText(input))).toBe(rebrandText(input))
  })
})
