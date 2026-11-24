/**
 * Enforce the rule that the model vendor's name appears only in model-access
 * contexts (root `AGENTS.md`, Conventions: Naming). Every tracked regular text
 * file is scanned line by line for the vendor's name. A line fails when it
 * holds a brand form and no license notice, or when an occurrence remains after the model-access
 * forms are removed and no model-access term stands within
 * {@link ACCESS_TERM_WINDOW} words of it. The allowed paths, the brand forms,
 * the access forms, and the access terms below are the complete, closed list
 * of exceptions; the
 * [brand-naming Agent Note](../.agents/notes/implemented/process/2026-08-31-centurionarx-brand-naming.md)
 * owns the rule.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { scannablePaths, scannableText } from './verify-chinese-text.ts'

const root = resolve(import.meta.dirname, '..')

/** One occurrence of the vendor's name in any spelling. */
export const VENDOR_NAME = /deepseek/i

/** One named pattern of the closed exception lists. */
export interface NamedForm {
  /** Short identifier used in failure messages and tests. */
  readonly name: string
  /** The pattern; access forms carry the `g` flag because every match is removed. */
  readonly pattern: RegExp
}

/** Paths the gate never scans, each with the owner decision that keeps it. */
export const ALLOWED_PATHS: readonly NamedForm[] = [
  { name: 'license file', pattern: /(?:^|\/)LICENSE(?:\.[a-z]+)?$/ },
  { name: 'third-party notices', pattern: /^THIRD_PARTY_NOTICES\.md$/ },
  { name: 'vendored source', pattern: /^vendor\// },
  // The patterns below must name the forms they match.
  { name: 'this gate', pattern: /^scripts\/verify-vendor-name\.ts$/ },
  // Pending owner decision: the upstream-sync tooling reads the original repository URL and maps its package names.
  { name: 'upstream-sync manifest', pattern: /^scripts\/upstream-sync\.manifest\.json$/ },
]

/** Forms that present the vendor as author, origin, owner, or product brand; a line holding one fails even beside model-access terms. */
export const BRAND_FORMS: readonly NamedForm[] = [
  { name: 'original repository', pattern: /deepseek[ -]harness|deepseek-ai\b/i },
  { name: 'vendor package scope', pattern: /@deepseek\//i },
  { name: 'vendor website', pattern: /(?:https?:\/\/|\b(?:www|docs|cdn)\.)deepseek\.com/i },
  { name: 'vendor service host', pattern: /deepseeksvc|dp-cdn-deepseek/i },
  { name: 'vendor chat product', pattern: /DeepSeek Chat(?![ -]?[Cc]ompletions|['"])|deepseekchat/ },
  { name: 'vendor design system', pattern: /DeepSeek design|DeepSeek wordmark|--(?:arx|dsw)-static-deepseek/i },
  { name: 'vendor product directory', pattern: /\.deepseek\//i },
]

/** A copyright notice naming the vendor; a line holding one is a license notice and is allowed whole. */
export const LICENSE_NOTICE = /\b[Cc]opyright (?:\(c\) )?\d{4} DeepSeek\b/

/** Model-access forms removed from a line before the remaining occurrences are judged. */
export const ACCESS_FORMS: readonly NamedForm[] = [
  { name: 'environment variable', pattern: /DEEPSEEK_[A-Z0-9_]+|\bdeepseek_[a-z0-9_]+/g },
  { name: 'API host', pattern: /(?:https?:\/\/)?api\.deepseek\.(?:com|example)[\w./:-]*/gi },
  { name: 'model or route id', pattern: /\bdeepseek-(?:official|v\d[\w.-]*|chat|reasoner|flash|preview|e2e|defaults)\b/gi },
  { name: 'model display name', pattern: /\bDeepSeek[- ]V\d(?:[- ](?:Flash|Pro))?\b/g },
  { name: 'provider package', pattern: /\b(?:arx-)?(?:llm|web-search)-deepseek\b/g },
  { name: 'provider display name', pattern: /(['"])DeepSeek(?: [A-Z][a-z]+)?\1|\b(?:displayName|name|detail): DeepSeek\b(?! \w)/g },
  { name: 'provider id', pattern: /(?<![\w./@-])deepseek(?![\w-])/g },
  { name: 'code identifier', pattern: /\b\w*[Dd]eep[Ss]eek(?=[A-Z])\w*/g },
]

/** Words, as regular-expression alternatives, marking the remaining prose name as the model provider; English and Portuguese. */
export const ACCESS_TERMS: readonly string[] = [
  'adapters?', 'APIs?', 'endpoints?', 'models?', 'providers?', 'routes?', 'keys?', 'credentials?', 'accounts?', 'login',
  'requests?', 'serializ\\w*', 'Files', 'Completions', 'SSE', 'thinking', 'reasoning', 'catalogs?', 'onboarding', 'setup',
  'configuration', 'config', 'wire', 'vision', 'tokens?', 'e2e', 'gateways?', 'function', 'replay', 'defaults', 'services?',
  'implementations?', 'deployments?', 'composition', 'conversations?', 'contract', 'address', 'lookup', 'probe', 'polic(?:y|ies)',
  'layouts?', 'fetch', 'specific', 'readiness', 'nonce', 'URLs?', 'conversion', 'settings',
  'acesso', 'modelos?', 'provedor(?:es)?', 'chaves?', 'contas?', 'configuração', 'credencia\\w*',
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
  if (!VENDOR_NAME.test(line) || LICENSE_NOTICE.test(line)) return undefined
  const brand = BRAND_FORMS.find(form => form.pattern.test(line))
  if (brand !== undefined) return brand.name
  let rest = line
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
