/**
 * Enforce that client stylesheets read only declared custom properties. A `var(--name)` read without a
 * fallback whose name no client stylesheet or inline style declares is invalid at computed-value time:
 * the browser drops the whole declaration and nothing reports it. The gate scans the tracked CSS of the
 * client packages and the Web app, collects every custom-property declaration from that CSS and from the
 * TypeScript that sets inline styles, and fails each fallback-free read of an undeclared name.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** Repository paths whose tracked CSS and TypeScript the gate reads. */
export const SCANNED_PATHS = ['packages/client', 'apps/web/src'] as const

/** A custom-property declaration in CSS, such as `--arx-token: value`. */
const CSS_DECLARATION = /(--[A-Za-z0-9-]+)\s*:/g

/** A custom property named by a TypeScript string: an inline-style key or a `setProperty` argument. */
const SCRIPT_DECLARATION = /['"`](--[A-Za-z0-9-]+)['"`]\s*[:,)\]]/g

/** One `var()` read; the second group is set when the read carries a fallback. */
const READ = /var\(\s*(--[A-Za-z0-9-]+)\s*(,)?/g

/**
 * Collect the custom properties one file declares.
 * @param path - repository-relative path; the extension selects the CSS or the TypeScript form.
 * @param text - the file's text.
 * @returns the declared names.
 */
export function declaredProperties(path: string, text: string): Set<string> {
  const pattern = path.endsWith('.css') ? CSS_DECLARATION : SCRIPT_DECLARATION
  return new Set([...text.matchAll(pattern)].map(match => String(match[1])))
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
  for (const match of text.matchAll(READ)) {
    const name = String(match[1])
    if (match[2] !== undefined || declared.has(name)) continue
    const line = text.slice(0, match.index).split('\n').length
    problems.push(`${path}:${String(line)}: reads ${name}, which no client stylesheet or inline style declares`)
  }
  return problems
}

if (import.meta.main) {
  const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', ...SCANNED_PATHS], { encoding: 'utf8' })
    .split('\0').filter(path => /\.(css|tsx?)$/.test(path) && !path.endsWith('.d.ts'))
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
