/**
 * Enforce the rule that the model vendor's name appears only in model-access
 * contexts (root `AGENTS.md`, Conventions: Naming). Every tracked regular text
 * file is scanned line by line for the vendor's name. Sentences holding a
 * vendor copyright notice are removed first. The line then fails when it holds
 * a brand form, or when an occurrence remains after the model-access forms are
 * removed and no model-access term stands within {@link ACCESS_TERM_WINDOW}
 * words of it. The allowed paths, the brand forms, the access forms, and the
 * access terms below are the complete, closed list of exceptions; the
 * [brand-naming Agent Note](../.agents/notes/implemented/process/2026-08-31-centurionarx-brand-naming.md)
 * owns the rule.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { scannablePaths, scannableText } from './verify-chinese-text.ts'

const root = resolve(import.meta.dirname, '..')

/** The vendor's name in its brand spelling, built from parts so this gate's own source holds no occurrence. */
const VENDOR = ['Deep', 'Seek'].join('')

/**
 * Build a pattern that names the vendor.
 * @param source - regular-expression source where `{V}` stands for the brand spelling, `{v}` for lowercase, and `{U}` for uppercase.
 * @param flags - regular-expression flags.
 * @returns the compiled pattern.
 */
function vendorPattern(source: string, flags: string): RegExp {
  return new RegExp(source.replaceAll('{V}', VENDOR).replaceAll('{v}', VENDOR.toLowerCase()).replaceAll('{U}', VENDOR.toUpperCase()), flags)
}

/** One occurrence of the vendor's name in any spelling. */
export const VENDOR_NAME = vendorPattern('{v}', 'i')

/** One named pattern of the closed exception lists. */
export interface NamedForm {
  /** Short identifier used in failure messages and tests. */
  readonly name: string
  /** The pattern; access forms carry the `g` flag because every match is removed. */
  readonly pattern: RegExp
}

/** Paths the gate never scans; every other tracked text file, license files and vendored sources included, is scanned. */
export const ALLOWED_PATHS: readonly NamedForm[] = [
  // TODO: remove once the owner decides whether to retire the upstream-sync tooling, which reads the original repository URL.
  { name: 'upstream-sync manifest', pattern: /^scripts\/upstream-sync\.manifest\.json$/ },
]

/** Verbs that, followed by `by`, `at`, `from`, or `under` and the vendor name, claim authorship or origin. */
const ORIGIN_VERBS = 'created|built|developed|made|owned|authored|founded|originated|forked|written|maintained|published|shipped|branded'

/** Portuguese verbs that, followed by `por`, `pela`, or `pelo` and the vendor name, claim authorship or origin. */
const ORIGIN_VERBS_PT = 'criad[oa]s?|desenvolvid[oa]s?|feit[oa]s?|mantid[oa]s?|construíd[oa]s?|publicad[oa]s?'

/** Nouns that, after the vendor name, present the vendor as the project's owner or brand. */
const ORIGIN_NOUNS = 'product|project|harness|team|company|organization|brand|identity|branding'

/** Forms that present the vendor as author, origin, owner, or product brand; a line holding one fails even beside model-access terms. */
export const BRAND_FORMS: readonly NamedForm[] = [
  { name: 'original repository', pattern: vendorPattern(String.raw`{v}[ -]?harness|{v}-ai\b`, 'i') },
  { name: 'vendor package scope', pattern: vendorPattern(String.raw`@{v}/`, 'i') },
  { name: 'vendor website', pattern: vendorPattern(String.raw`(?:https?://|\b(?:www|docs|cdn)\.){v}\.com`, 'i') },
  { name: 'vendor service host', pattern: vendorPattern(String.raw`{v}svc|dp-cdn-{v}`, 'i') },
  {
    name: 'origin claim',
    pattern: vendorPattern([
      String.raw`\b(?:${ORIGIN_VERBS}) (?:by|at|from|under) {V}\b`,
      String.raw`(?:^|[^\p{L}])(?:${ORIGIN_VERBS_PT}) pel[oa] {V}\b`,
      String.raw`\b{V}(?:'s)? (?:${ORIGIN_NOUNS})\b|\b{V}-(?:made|owned|built|branded)\b`,
      String.raw`\b{V} owns\b|\bbelongs to {V}\b`,
    ].join('|'), 'iu'),
  },
  // A line holding the chat model id may carry that model's display name.
  { name: 'vendor chat product', pattern: vendorPattern(String.raw`^(?!.*\b{v}-chat\b).*(?:\b{V} ?Chat(?![ -]?completions)|{v}chat)`, 'i') },
  { name: 'vendor design system', pattern: vendorPattern(String.raw`{V} design|{V} wordmark|--(?:arx|dsw)-static-{v}`, 'i') },
  { name: 'vendor product directory', pattern: vendorPattern(String.raw`\.{v}/`, 'i') },
]

/** A copyright notice naming the vendor; the sentence holding one is a license notice and is removed before the line is judged. */
export const LICENSE_NOTICE = vendorPattern(String.raw`\b[Cc]opyright (?:\(c\) )?\d{4} {V}\b`, '')

/** Model-access forms removed from a line before the remaining occurrences are judged. */
export const ACCESS_FORMS: readonly NamedForm[] = [
  { name: 'environment variable', pattern: vendorPattern(String.raw`{U}_[A-Z0-9_]+|\b{v}_[a-z0-9_]+`, 'g') },
  { name: 'API host', pattern: vendorPattern(String.raw`(?:https?://)?api\.{v}\.(?:com|example)[\w./:-]*`, 'gi') },
  { name: 'model or route id', pattern: vendorPattern(String.raw`\b{v}-(?:official|v\d[\w.-]*|chat|reasoner|flash|preview|e2e|defaults)\b`, 'gi') },
  { name: 'model display name', pattern: vendorPattern(String.raw`\b{V}[- ]V\d(?:[- ](?:Flash|Pro))?\b`, 'g') },
  { name: 'provider package', pattern: vendorPattern(String.raw`\b(?:arx-)?(?:llm|web-search)-{v}\b`, 'g') },
  {
    name: 'provider display name',
    pattern: vendorPattern([
      String.raw`\b(?:displayName|name|detail)['"]?\s*[:=]\s*(?:(['"]){V}(?: (?:Chat|Reasoner))?\1|{V}(?![\w-]| \w))`,
      String.raw`\b(?:CatalogAdapter|toBe|toEqual)\(\[?(['"]){V}\2`,
    ].join('|'), 'g'),
  },
  {
    name: 'provider id',
    pattern: vendorPattern(String.raw`(['"\x60]){v}\1|\b{v}(?=\??:|\[)|(?<=\b(?:provider|thinkingFormat)\s*[:=]\s*){v}\b`, 'g'),
  },
  { name: 'code identifier', pattern: /\b\w*[Dd]eep[Ss]eek(?=[A-Z])\w*/g },
]

/** Words, as regular-expression alternatives, marking the remaining prose name as the model provider; English and Portuguese. */
export const ACCESS_TERMS: readonly string[] = [
  'adapters?', 'APIs?', 'endpoints?', 'models?', 'providers?', 'routes?', 'keys?', 'credentials?', 'accounts?', 'login',
  'requests?', 'serializ\\w*', 'Completions', 'SSE', 'thinking', 'reasoning', 'catalogs?', 'onboarding', 'wire', 'vision',
  'tokens?', 'gateways?', 'replay', 'config(?:uration)?', 'implementations?', 'deployments?', 'composition', 'contract', 'defaults',
  'services?', 'e2e', 'nonce', 'probe', 'polic(?:y|ies)', 'layouts?', 'lookup', 'Files', 'conversations?',
  'acesso', 'modelos?', 'provedor(?:es)?', 'chaves?', 'contas?', 'credencia\\w*',
]

/** One whole word that is an access term. */
export const ACCESS_TERM = new RegExp(`^(?:${ACCESS_TERMS.join('|')})$`, 'i')

/** How many words on each side of a remaining prose name are searched for an access term. */
export const ACCESS_TERM_WINDOW = 8

/**
 * Judge one line.
 * @param line - one line of a scanned file.
 * @returns the name of the brand form the line holds, `'unqualified name'` when a remaining occurrence has no
 *   access term within the window, or `undefined` when the line is allowed.
 */
export function judgeLine(line: string): string | undefined {
  if (!VENDOR_NAME.test(line)) return undefined
  const judged = line.split(/(?<=[.;])\s+/).filter(sentence => !LICENSE_NOTICE.test(sentence)).join(' ')
  const brand = BRAND_FORMS.find(form => form.pattern.test(judged))
  if (brand !== undefined) return brand.name
  let rest = judged
  for (const form of ACCESS_FORMS) rest = rest.replace(form.pattern, ' ')
  const words = rest.split(/[^\p{L}\p{N}_']+/u).filter(word => word !== '')
  for (const [index, word] of words.entries()) {
    if (!VENDOR_NAME.test(word)) continue
    const window = words.slice(Math.max(0, index - ACCESS_TERM_WINDOW), index + ACCESS_TERM_WINDOW + 1)
    if (!window.some(near => ACCESS_TERM.test(near.replace(/'s$|^'+|'+$/g, '')))) return 'unqualified name'
  }
  return undefined
}

/**
 * Report the brand uses of the vendor's name in one file.
 * @param path - repository-relative path used in the message and matched against {@link ALLOWED_PATHS}.
 * @param text - the file's text.
 * @returns one message per failing line, empty when the file is allowed or holds no brand use.
 */
export function findVendorBrand(path: string, text: string): string[] {
  if (ALLOWED_PATHS.some(form => form.pattern.test(path))) return []
  const problems: string[] = []
  for (const [index, line] of text.split('\n').entries()) {
    const reason = judgeLine(line)
    if (reason !== undefined) problems.push(`${path}:${String(index + 1)}: ${reason}`)
  }
  return problems
}

if (import.meta.main) {
  const lsFiles = execFileSync('git', ['-C', root, 'ls-files', '-s', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  const problems: string[] = []
  let scanned = 0
  for (const path of scannablePaths(lsFiles).sort((a, b) => a.localeCompare(b))) {
    const text = scannableText(readFileSync(resolve(root, path)))
    if (text === undefined) continue
    scanned += 1
    problems.push(...findVendorBrand(path, text))
  }
  if (problems.length > 0) {
    console.error('verify-vendor-name failed:\n')
    for (const problem of problems) console.error(`  ${problem}`)
    console.error('\nThe model vendor\'s name appears only in model-access contexts (AGENTS.md); the closed exception lists live in scripts/verify-vendor-name.ts.')
    process.exitCode = 1
  } else {
    console.log(`verify-vendor-name: ${String(scanned)} text file(s) scanned; the vendor's name appears only in model-access contexts.`)
  }
}
