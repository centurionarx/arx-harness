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
  /**
   * GitHub owner of the product repository, independent of `scope`: the two
   * name different registries and move on their own schedule, so they may hold
   * the same literal without moving together.
   */
  owner: string
  /** PascalCase identifier replacing `DeepSeekHarness`. */
  pascal: string
}

/**
 * The identity the tree currently carries. Rules derive their source patterns
 * from it, so a later rename costs two constants rather than a rewritten rule
 * table.
 */
const SOURCE: Brand = {
  scope: 'centurionarx',
  prefix: 'cxh',
  slug: 'centurionarx-harness',
  prose: 'CENTURIONarx Harness',
  owner: 'centurionarx',
  pascal: 'CENTURIONarxHarness',
}

/** The identity the tree is moving to. */
const BRAND: Brand = {
  scope: 'arx-ai',
  prefix: 'arx',
  slug: 'arx-harness',
  prose: 'arx Harness',
  owner: 'centurionarx',
  pascal: 'ArxHarness',
}

const PROTECTED: readonly RegExp[] = [
  /[A-Za-z0-9_./-]*archived\/[a-z-]+\/\d{4}-\d{2}-\d{2}-[A-Za-z0-9_-]+\.(?:zh\.)?md/g,
  /github\.com\/deepseek-harness\/(?!deepseek-harness\.git)[A-Za-z0-9_.-]+/g,
  /(?<![A-Za-z0-9_.-])deepseekharness\/[A-Za-z0-9_.-]+/g,
  /\bDEEPSEEK_[A-Z0-9_]+\b/g,
  /\bdeepseek-official\b/g,
  /\bdeepseek-(?:v\d[a-z0-9-]*|chat|reasoner|coder)\b/g,
  /\b[a-z0-9-]*\.?deepseek\.com\b/g,
  /\bllm-deepseek\b/g,
  /\bdsweb\b/g,
  /\bdeepSeek[A-Za-z0-9]*/g,
  /\bDeepSeek\b(?![\s-]+Harness)/g,
  /(?<![a-zA-Z0-9_.@/-])deepseek(?![a-zA-Z0-9_.-])(?! harness)/g,
]

/**
 * Repository paths excluded from rewriting entirely.
 *
 * The classifier and its spec exclude themselves. A run that rewrites them
 * collapses `SOURCE` onto the target, which costs the ability to re-run, and
 * rewrites the spec's input/expected pairs into identities that assert
 * nothing — a silently disarmed test suite is worse than a failing one.
 */
const EXCLUDED: readonly RegExp[] = [
  /^\.agents\/notes\/archived\//,
  /^scripts\/rebrand(?:\.spec)?\.ts$/,
]

/** Escape a brand literal for use inside a regular expression. */
function quote(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The capitalized stem of a prose product name (`CENTURIONarx Harness` -> `CENTURIONarx`). */
function stem(prose: string): string {
  const [first] = prose.split(' ')
  if (first === undefined || first.length === 0) throw new Error(`brand prose ${JSON.stringify(prose)} has no stem`)
  return first
}

/**
 * Ordered rewrite rules applied to masked text.
 *
 * Order is load-bearing in one direction: every compound carrying the owner
 * (`<owner>-harness`, `<owner>Harness`) must be rewritten before the owner
 * rule, which would otherwise fragment them.
 * @param source - identity the tree currently carries.
 * @param target - identity to move to.
 * @returns pattern/replacement pairs in application order.
 */
function rules(source: Brand, target: Brand): readonly (readonly [RegExp, string])[] {
  const upper = target.prefix.toUpperCase()
  const pascalPrefix = target.prefix.slice(0, 1).toUpperCase() + target.prefix.slice(1)
  const from = {
    prefix: quote(source.prefix),
    upper: quote(source.prefix.toUpperCase()),
    pascalPrefix: quote(source.prefix.slice(0, 1).toUpperCase() + source.prefix.slice(1)),
    owner: quote(source.owner),
    scope: quote(source.scope),
    slug: quote(source.slug),
    pascal: quote(source.pascal),
    prose: quote(source.prose),
    stem: quote(stem(source.prose)),
  }
  const underscored = (slug: string): string => slug.replace(/-/g, '_')
  const spaced = (slug: string): string => slug.replace('-', ' ')

  // No rule anchors its left edge. `\b` fails wherever an escape sequence puts
  // a word character against the match (`\\nCENTURIONarx Harness` in escaped
  // JSON, `\\0cxh-css`), and every product literal here is unambiguous: no
  // English word contains the prefix, and none spells the owner. `\b` is also
  // wrong on the right of a prefix rule, because `_` and digits are word
  // characters and a boundary would hide `__CXH_BOOT__`, `_cxhWebServer`, and
  // the `\0cxh-css:` virtual-module prefixes.
  //
  // The lowercase-follows rule keeps its left guard on principle rather than
  // on evidence: it is the shape that hid `handshake` and `spreadsheet` from
  // the previous source prefix, and dropping it here would leave the tree
  // defenceless if a future prefix collides with a real word.
  return [
    // The product's own clone URL.
    [new RegExp(`github\\.com/${from.owner}/${from.slug}\\.git`, 'g'), `github.com/${target.owner}/${target.slug}.git`],
    // Generated catalog anchors slugify `@<scope>/<prefix>-x` by dropping `@`
    // and `/`, so scope and prefix fuse. Hand-written docs cross-reference
    // those anchors, and a missed one becomes a dead link at `website:build`.
    [new RegExp(`${from.scope}${from.prefix}-`, 'g'), `${target.scope}${target.prefix}-`],
    [new RegExp(`@${from.scope}\\b`, 'g'), `@${target.scope}`],
    // Every owner compound precedes the bare owner rule below.
    [new RegExp(from.pascal, 'g'), target.pascal],
    [new RegExp(quote(source.pascal.toLowerCase()), 'g'), target.pascal.toLowerCase()],
    [new RegExp(from.slug, 'g'), target.slug],
    // No trailing `\b`: the Python distributions extend the module name
    // (`<slug>_runtime`, `<slug>_sdk`) and `_` is a word character, so a
    // boundary would hide every one of them.
    [new RegExp(quote(underscored(source.slug)), 'g'), underscored(target.slug)],
    [new RegExp(from.prose, 'g'), target.prose],
    [new RegExp(quote(spaced(source.slug)), 'g'), spaced(target.slug)],
    [new RegExp(quote(source.prose.replace(' ', '-')), 'g'), target.prose.replace(' ', '-')],
    [new RegExp(`${from.stem}\\b`, 'g'), stem(target.prose)],
    // The GitHub host is the whole guard. `owner` and `scope` are separate
    // fields that may carry the same literal, so an unanchored owner rule
    // rewrites `@<scope>/` too — silently, and only while the two agree.
    // `githubusercontent` covers the raw-content host, which does not contain
    // `github.com`.
    [new RegExp(`(github(?:usercontent)?\\.com/)${from.owner}\\b`, 'g'), `$1${target.owner}`],
    [new RegExp(`${from.prefix}-`, 'g'), `${target.prefix}-`],
    [new RegExp(`${from.prefix}(?=[A-Z])`, 'g'), target.prefix],
    [new RegExp(`${from.prefix}_`, 'g'), `${target.prefix}_`],
    // git lowercases config keys, so an `extensions.<prefix>Unknown` namespace
    // also appears fully lowercased; both must move together.
    [new RegExp(`(?<![A-Za-z])${from.prefix}(?=[a-z])`, 'g'), target.prefix],
    [new RegExp(`${from.prefix}\\b`, 'g'), target.prefix],
    [new RegExp(`${from.pascalPrefix}(?=[A-Z])`, 'g'), pascalPrefix],
    [new RegExp(`${from.pascalPrefix}\\b`, 'g'), pascalPrefix],
    [new RegExp(`${from.upper}_`, 'g'), `${upper}_`],
    [new RegExp(`${from.upper}\\b`, 'g'), upper],
    // The design-system custom-property namespace. `--` on the left is the
    // whole guard and the only safe one: `dsw` on its own sits inside
    // `endsWith` 220 times, and inside opaque ids like `sbtYDSwEVQd`.
    [/--dsw-/g, `--${target.prefix}-`],
  ]
}

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
  for (const [pattern, replacement] of rules(SOURCE, brand)) masked = masked.replace(pattern, replacement)
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
