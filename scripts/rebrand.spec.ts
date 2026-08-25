import { describe, expect, it } from 'vitest'

import { rebrandText } from './rebrand.ts'

/**
 * The rebrand is a classifier, not a substitution: most `deepseek` spans name
 * the DeepSeek model, provider, credential, or third-party repository and must
 * survive untouched. Each case pins one span the rewrite owns or one it must
 * not reach.
 */
const CHANGED: readonly (readonly [string, string])[] = [
  // npm scope and package prefix
  ['@deepseek-ai/dsh-session', '@centurionarx/cxh-session'],
  ['@deepseek-ai/cordis', '@centurionarx/cordis'],
  ['@deepseek-ai/schemastery', '@centurionarx/schemastery'],
  ['@deepseek-ai/dsh-llm-deepseek', '@centurionarx/cxh-llm-deepseek'],
  // product identity in prose, paths, and identifiers
  ['DeepSeek Harness (`dsh`) is an open-source', 'CENTURIONarx Harness (`cxh`) is an open-source'],
  ['a DeepSeek-Harness PR', 'a CENTURIONarx-Harness PR'],
  ['DeepSeekHarnessConfig', 'CENTURIONarxHarnessConfig'],
  ['deepseek harness architecture', 'centurionarx harness architecture'],
  ['deepseek_harness_runtime_bin', 'centurionarx_harness_runtime_bin'],
  // the product's own repository
  [
    'https://github.com/deepseek-ai/deepseek-harness.git',
    'https://github.com/centurionarx/centurionarx-harness.git',
  ],
  // the same repository as the fork org spelled it, in the native packages
  [
    'git+https://github.com/deepseek-harness/deepseek-harness.git',
    'git+https://github.com/centurionarx/centurionarx-harness.git',
  ],
  // environment and identifier prefixes a word boundary would hide
  ['window.__DSH_BOOT__', 'window.__CXH_BOOT__'],
  ['_dsh_base_agent_default_model', '_cxh_base_agent_default_model'],
  ['_dshWebServer', '_cxhWebServer'],
  ['DshWindow', 'CxhWindow'],
  ['extensions.dshUnknown', 'extensions.cxhUnknown'],
  ['DSH_HOME', 'CXH_HOME'],
  // generated catalog anchors fuse scope and prefix; hand-written docs link to them
  ['<a id="deepseek-aidsh-tool-bash"></a>', '<a id="centurionarxcxh-tool-bash"></a>'],
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
  'packages/llm/llm-deepseek/src/adapter.ts',
  // the MIT notice names the original copyright holder
  'Copyright (c) 2026 DeepSeek',
  // third-party repositories: the vendor manifest pins their commits and the
  // notes cite their pull requests, so a rename points both at nothing
  'https://github.com/deepseek-harness/cordis',
  'https://github.com/deepseek-harness/cosmokit',
  'https://github.com/deepseek-harness/schemastery',
  'https://github.com/deepseek-harness/deepseek-harness/pull/436',
  'https://github.com/deepseek-harness/deepseek-harness/issues/2488',
  "repository: 'deepseekharness/dsh-test'",
  // an unrelated word that merely contains the prefix
  'handshake',
]

describe('rebrandText', () => {
  it.each(CHANGED)('rewrites %j', (input, expected) => {
    expect(rebrandText(input)).toBe(expected)
  })

  it.each(PRESERVED)('preserves %j', (input) => {
    expect(rebrandText(input)).toBe(input)
  })

  it('rewrites the product repository without touching the third-party one', () => {
    const mixed = 'see https://github.com/deepseek-ai/deepseek-harness and https://github.com/deepseek-harness/cordis'
    expect(rebrandText(mixed)).toBe(
      'see https://github.com/centurionarx/centurionarx-harness and https://github.com/deepseek-harness/cordis',
    )
  })

  it('keeps the bilingual link label intact', () => {
    expect(rebrandText('English | [中文](CONTRIBUTING.zh.md)')).toBe('English | [中文](CONTRIBUTING.zh.md)')
  })

  it('is idempotent', () => {
    for (const [input] of CHANGED) expect(rebrandText(rebrandText(input))).toBe(rebrandText(input))
  })
})
