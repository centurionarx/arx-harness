/**
 * Enforce that client stylesheets read only declared custom properties. A `var(--name)` read without a
 * fallback whose name no stylesheet or inline style declares is invalid at computed-value time: the
 * browser drops the whole declaration and nothing reports it. The gate reads every tracked stylesheet and
 * product TypeScript file outside documentation and vendored roots, collects the custom properties they
 * declare (CSS declarations, inline-style keys, `setProperty` arguments; comments and test files excluded),
 * and fails each fallback-free read of an undeclared name.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** Repository roots whose tracked files are documentation or vendored source, not client styles. */
const EXCLUDED_ROOTS = ['website/', 'vendor/', 'docs/']

/** A custom-property declaration in CSS, such as `--arx-token: value`. */
const CSS_DECLARATION = /(--[A-Za-z0-9-]+)\s*:/g

/** A custom property that TypeScript declares: an inline-style object key or a `setProperty` argument. */
const SCRIPT_DECLARATIONS = [/['"`](--[A-Za-z0-9-]+)['"`]\s*:/g, /setProperty\(\s*['"`](--[A-Za-z0-9-]+)['"`]/g]

/** One `var()` read; the second group is set when the read carries a fallback. */
const READ = /var\(\s*(--[A-Za-z0-9-]+)\s*(,)?/g

/**
 * Remove CSS comments, so a commented-out declaration or read neither declares nor reads a property.
 * @param css - stylesheet text.
 * @returns the text with each comment replaced by the same number of newlines, keeping line numbers.
 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ''))
}

/**
 * Decide whether a tracked file contributes declarations.
 * @param path - repository-relative path.
 * @returns true for stylesheets and for product TypeScript; false for tests, type declarations, and excluded roots.
 */
export function declaresProperties(path: string): boolean {
  if (EXCLUDED_ROOTS.some(prefix => path.startsWith(prefix))) return false
  if (path.endsWith('.css')) return true
  if (!/\.tsx?$/.test(path) || path.endsWith('.d.ts')) return false
  return !path.includes('/tests/') && !/\.(spec|test)\.tsx?$/.test(path)
}

/**
 * Collect the custom properties one file declares.
 * @param path - repository-relative path; the extension selects the CSS or the TypeScript form.
 * @param text - the file's text.
 * @returns the declared names.
 */
export function declaredProperties(path: string, text: string): Set<string> {
  if (path.endsWith('.css')) return new Set([...withoutComments(text).matchAll(CSS_DECLARATION)].map(match => String(match[1])))
  return new Set(SCRIPT_DECLARATIONS.flatMap(pattern => [...text.matchAll(pattern)].map(match => String(match[1]))))
}

/**
 * Report the fallback-free reads of undeclared custom properties in one stylesheet.
 * @param path - repository-relative path used in the messages.
 * @param text - the stylesheet's text.
 * @param declared - every custom property declared in the scanned paths.
 * @returns one message per offending read, empty when every read is declared or carries a fallback.
 */
export function findUndeclaredReads(path: string, text: string, declared: ReadonlySet<string>): string[] {
  const problems: string[] = []
  const css = withoutComments(text)
  for (const match of css.matchAll(READ)) {
    const name = String(match[1])
    if (match[2] !== undefined || declared.has(name)) continue
    const line = css.slice(0, match.index).split('\n').length
    problems.push(`${path}:${String(line)}: reads ${name}, which no client stylesheet or inline style declares`)
  }
  return problems
}

if (import.meta.main) {
  const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split('\0').filter(declaresProperties)
  const texts = new Map(tracked.map(path => [path, readFileSync(resolve(root, path), 'utf8')]))
  const declared = new Set<string>()
  for (const [path, text] of texts) for (const name of declaredProperties(path, text)) declared.add(name)
  const sheets = [...texts.keys()].filter(path => path.endsWith('.css')).sort((a, b) => a.localeCompare(b))
  const problems = sheets.flatMap(path => findUndeclaredReads(path, texts.get(path) ?? '', declared))
  if (problems.length > 0) {
    console.error('verify-css-tokens failed:\n')
    for (const problem of problems) console.error(`  ${problem}`)
    console.error('\nRead a declared token, declare the property, or give the read a fallback.')
    process.exitCode = 1
  } else {
    console.log(`verify-css-tokens: ${String(sheets.length)} stylesheet(s) read only declared custom properties.`)
  }
}
