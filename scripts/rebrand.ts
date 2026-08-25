/**
 * Rebrand DeepSeek Harness to a new product identity across the whole tree.
 *
 * The rename is a CLASSIFIER, not a substitution: roughly 4,000 of the 29,600
 * `deepseek` occurrences name the DeepSeek model, provider, or credential and
 * must survive untouched. Protected spans are masked before any rule runs and
 * restored afterwards, so no rule can reach them regardless of ordering.
 *
 * Modes: dry-run (default) reports counts; `--write` applies the rewrite.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, TextDecoder } from 'node:util'

/** Product identity replacing the DeepSeek Harness one. */
export interface Brand {
  /** npm scope without the leading `@`. */
  scope: string
  /** Lowercase package and binary prefix replacing `dsh`. */
  prefix: string
  /** Lowercase hyphenated product slug replacing `deepseek-harness`. */
  slug: string
  /** Prose product name replacing `DeepSeek Harness`. */
  prose: string
  /** Repository owner replacing `deepseek-ai`. */
  owner: string
  /** PascalCase identifier replacing `DeepSeekHarness`. */
  pascal: string
}

/**
 * The target identity. `prefix` is the one naming choice still open: changing
 * it here and re-running is the whole cost of picking `carx` or `cah` instead.
 */
export const BRAND: Brand = {
  scope: 'centurionarx',
  prefix: 'cxh',
  slug: 'centurionarx-harness',
  prose: 'CENTURIONarx Harness',
  owner: 'centurionarx',
  pascal: 'CENTURIONarxHarness',
}

/**
 * Spans naming the DeepSeek model, provider, credential, or endpoint. Masked
 * before the rules run, so rule ordering can never corrupt them. Every entry
 * is global and must not capture surrounding product text.
 */
export const PROTECTED: readonly RegExp[] = [
  /[A-Za-z0-9_./-]*archived\/[a-z-]+\/\d{4}-\d{2}-\d{2}-[A-Za-z0-9_-]+\.(?:zh\.)?md/g,
  /github\.com\/deepseek-harness\/(?!deepseek-harness\.git)[A-Za-z0-9_.-]+/g,
  /(?<![A-Za-z0-9_.-])deepseekharness\/[A-Za-z0-9_.-]+/g,
  /\bDEEPSEEK_[A-Z0-9_]+\b/g,
  /\bdeepseek-official\b/g,
  /\bdeepseek-(?:v\d[a-z0-9-]*|chat|reasoner|coder)\b/g,
  /\b[a-z0-9-]*\.?deepseek\.com\b/g,
  /\bllm-deepseek\b/g,
  /\bdeepSeek[A-Za-z0-9]*/g,
  /\bDeepSeek\b(?![\s-]+Harness)/g,
  /(?<![a-zA-Z0-9_.@/-])deepseek(?![a-zA-Z0-9_.-])(?! harness)/g,
]

/** Repository paths excluded from rewriting entirely. */
export const EXCLUDED: readonly RegExp[] = [/^\.agents\/notes\/archived\//]

/**
 * Ordered rewrite rules applied to masked text.
 * @param brand - target identity.
 * @returns pattern/replacement pairs in application order.
 */
function rules(brand: Brand): readonly (readonly [RegExp, string])[] {
  const upper = brand.prefix.toUpperCase()
  const pascalPrefix = brand.prefix.slice(0, 1).toUpperCase() + brand.prefix.slice(1)
  // No rule anchors its left edge: `\b` fails wherever an escape sequence
  // puts a word character against the match (`\\nDeepSeek Harness` in escaped
  // JSON, `\\0dsh-css`), and every product literal here is unambiguous.
  // A separator after the prefix is itself the evidence: no English word
  // spells `dsh-`, `dsh_`, or `DSH_`, so those rules need no left guard at
  // all - and without one they still reach a prefix glued to a preceding
  // word (`Skilldsh-manage-issues` in a rendered test expectation) or to an
  // escape (`\\nDSH_CRED_OTHER` inside a string literal). The guard stays only
  // where a lowercase letter follows, which is where `handshake` and
  // `spreadsheet` live.
  // `\b` is likewise NOT used for the prefix rules: `_` and digits are
  // word characters, so a boundary hides `__DSH_BOOT__`, `_dshWebServer`, and
  // the `\0dsh-css:` virtual-module prefixes. Excluding only letters reaches
  // them, and the tree holds no digit- or underscore-prefixed `dsh` that names
  // anything but this product.
  return [
    // The product's own clone URL, spelled with the fork org that hosted it.
    [/github\.com\/deepseek-harness\/deepseek-harness\.git/g, `github.com/${brand.owner}/${brand.slug}.git`],
    // Generated catalog anchors slugify `@deepseek-ai/dsh-x` by dropping `@`
    // and `/`, so the scope and prefix fuse. Hand-written docs cross-reference
    // those anchors, and a missed one becomes a dead link at `website:build`.
    [/deepseek-aidsh-/g, `${brand.owner}${brand.prefix}-`],
    [/@deepseek-ai\b/g, `@${brand.scope}`],
    [/deepseek-ai\b/g, brand.owner],
    [/DeepSeekHarness/g, brand.pascal],
    [/deepseekharness/g, brand.pascal.toLowerCase()],
    [/deepseek-harness/g, brand.slug],
    // No trailing `\b`: the Python distributions extend the module name
    // (`deepseek_harness_runtime`, `deepseek_harness_sdk`) and `_` is a word
    // character, so a boundary would hide every one of them.
    [/deepseek_harness/g, brand.slug.replace(/-/g, '_')],
    [/DeepSeek Harness/g, brand.prose],
    [/deepseek harness/g, brand.slug.replace('-', ' ')],
    [/DeepSeek-Harness/g, brand.prose.replace(' ', '-')],
    [/dsh-/g, `${brand.prefix}-`],
    [/(?<![A-Za-z])dsh(?=[A-Z])/g, brand.prefix],
    [/dsh_/g, `${brand.prefix}_`],
    // git lowercases config keys, so the `extensions.dshUnknown` namespace also
    // appears as `extensions.dshunknown`; both must move together.
    [/(?<![A-Za-z])dsh(?=[a-z])/g, brand.prefix],
    [/(?<![A-Za-z])dsh\b/g, brand.prefix],
    [/(?<![A-Za-z])Dsh(?=[A-Z])/g, pascalPrefix],
    [/DSH_/g, `${upper}_`],
    [/(?<![A-Za-z])DSH\b/g, upper],
  ]
}

// U+0001 delimits a mask. No text file in the tree contains it, and binary
// files never reach the rewriter, so a mask cannot collide with real content.
const MARK = '\u0001'
const RESTORE = /\u0001(\d+)\u0001/g
const UTF8 = new TextDecoder('utf-8', { fatal: true })

/**
 * Apply the rebrand to one file's text with protected spans masked out.
 * @param text - original file contents.
 * @param brand - target identity.
 * @returns the rewritten text, identical when no rule matched.
 */
export function rebrandText(text: string, brand: Brand = BRAND): string {
  const held: string[] = []
  let masked = text
  for (const pattern of PROTECTED) {
    masked = masked.replace(pattern, match => `${MARK}${held.push(match) - 1}${MARK}`)
  }
  for (const [pattern, replacement] of rules(brand)) masked = masked.replace(pattern, replacement)
  return masked.replace(RESTORE, (_, index: string) => held[Number(index)] ?? '')
}

/** List every tracked, non-excluded repository file. */
function trackedFiles(): string[] {
  const listed = spawnSync('git', ['ls-files', '-z'], { maxBuffer: 512 * 1024 * 1024 })
  if (listed.status !== 0) throw new Error('git ls-files failed')
  return listed.stdout.toString('utf8').split('\0')
    .filter(path => path.length > 0 && !EXCLUDED.some(pattern => pattern.test(path)))
}

/** Run the rewrite over the tracked tree and report what moved. */
function main(): void {
  const { values } = parseArgs({ options: { write: { type: 'boolean' } } })
  let contentChanges = 0
  let pathChanges = 0

  for (const file of trackedFiles()) {
    if (rebrandText(file) !== file) pathChanges += 1
    let buffer: Buffer
    try {
      buffer = readFileSync(file)
    } catch {
      // A tracked path that cannot be read is a symlink or submodule gitlink;
      // neither holds product text.
      continue
    }
    let text: string
    try {
      text = UTF8.decode(buffer)
    } catch {
      // Not UTF-8, so it is a real binary (image, font, archive); decoding and
      // re-encoding it would corrupt it. A NUL byte alone does not qualify:
      // source files embed NUL as test data and must still be rewritten.
      continue
    }
    const next = rebrandText(text)
    if (next === text) continue
    contentChanges += 1
    if (values.write === true) writeFileSync(file, next)
  }

  process.stdout.write(`mode:                 ${values.write === true ? 'WRITE' : 'DRY-RUN'}\n`)
  process.stdout.write(`files rewritten:      ${contentChanges}\n`)
  process.stdout.write(`paths needing rename: ${pathChanges}\n`)
}

// Guarded so the spec can import the classifier without running the rewrite.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
