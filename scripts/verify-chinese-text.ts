/**
 * Enforce the rule that no tracked file holds Chinese text (root `AGENTS.md`,
 * Conventions). Every tracked regular text file, vendored sources included, is
 * scanned for Han characters, and any occurrence fails. There is no exception
 * list: Chinese text is translated to Brazilian Portuguese, and code that must
 * match a Han character names it by a `\u` escape.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** One Han character: the Chinese text the rule targets. Kana, Hangul, and full-width punctuation alone are not Chinese text. */
export const HAN_CHARACTER = /\p{Script=Han}/u

/**
 * Report the Chinese text one file holds.
 * @param path - repository-relative path used in the message.
 * @param text - the file's text.
 * @returns one message naming the first line with a Han character and the number of such lines, or `undefined` when the file holds none.
 */
export function findChineseText(path: string, text: string): string | undefined {
  const lines: number[] = []
  for (const [index, line] of text.split('\n').entries()) {
    if (HAN_CHARACTER.test(line)) lines.push(index + 1)
  }
  const first = lines[0]
  if (first === undefined) return undefined
  return `${path}:${String(first)}: holds Chinese text on ${String(lines.length)} line(s); translate it to Brazilian Portuguese, or write a Han character code must match as a \\u escape`
}

/**
 * List the tracked regular files the gate scans: symlinks and submodules are
 * skipped.
 * @param lsFiles - `git ls-files -s -z` output.
 * @returns repository-relative paths.
 */
export function scannablePaths(lsFiles: string): string[] {
  const paths: string[] = []
  for (const entry of lsFiles.split('\0')) {
    if (entry === '') continue
    const mode = entry.slice(0, entry.indexOf(' '))
    if (mode !== '100644' && mode !== '100755') continue
    paths.push(entry.slice(entry.indexOf('\t') + 1))
  }
  return paths
}

if (import.meta.main) {
  const lsFiles = execFileSync('git', ['-C', root, 'ls-files', '-s', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  const problems: string[] = []
  let scanned = 0
  for (const path of scannablePaths(lsFiles).sort((a, b) => a.localeCompare(b))) {
    const bytes = readFileSync(resolve(root, path))
    // A NUL byte marks a binary file, which holds no text to translate.
    if (bytes.includes(0)) continue
    scanned += 1
    const problem = findChineseText(path, bytes.toString('utf8'))
    if (problem !== undefined) problems.push(problem)
  }
  if (problems.length > 0) {
    console.error('verify-chinese-text failed:\n')
    for (const problem of problems) console.error(`  ${problem}`)
    console.error('\nNo tracked file holds Chinese text (AGENTS.md); the gate has no exception list.')
    process.exitCode = 1
  } else {
    console.log(`verify-chinese-text: ${String(scanned)} text file(s) scanned; none holds Chinese text.`)
  }
}
