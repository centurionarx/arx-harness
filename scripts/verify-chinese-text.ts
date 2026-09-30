/**
 * Enforce the rule that Chinese text is translated to Brazilian Portuguese
 * (root `AGENTS.md`, Conventions). Every tracked regular text file outside
 * `vendor/` is scanned for Han characters. A file may hold them only while
 * `scripts/chinese-text.manifest.json` lists it: under `literal`, with the
 * reason code must match that exact text, or under `pending`, the translation
 * backlog, which only shrinks. An unlisted file with Chinese text fails, and so
 * does a listed file that no longer holds any, so the manifest always names
 * exactly the files that still hold Chinese text.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** Repository-relative path of the manifest this gate reads. */
export const CHINESE_TEXT_MANIFEST_PATH = 'scripts/chinese-text.manifest.json'

/** One Han character: the Chinese text the rule targets. Kana, Hangul, and full-width punctuation alone are not Chinese text. */
export const HAN_CHARACTER = /\p{Script=Han}/u

/** Path prefixes never scanned: vendored sources follow the sync procedure in `vendor/README.md`. */
const EXCLUDED_PREFIXES = ['vendor/']

/** The files allowed to hold Chinese text. */
export interface ChineseTextManifest {
  /** Files whose Chinese text code must match, each mapped to that reason. */
  literal: Record<string, string>
  /** Files whose Chinese text awaits translation; entries are removed, never added. */
  pending: string[]
}

/**
 * Validate the manifest document. Malformed input, an empty reason, a
 * duplicate entry, and a path listed in both sections fail loud.
 * @param text - the manifest's JSON text.
 * @returns the validated manifest.
 */
export function parseChineseTextManifest(text: string): ChineseTextManifest {
  const data: unknown = JSON.parse(text)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) fail('expected an object with literal and pending')
  const { literal, pending, ...rest } = data as Record<string, unknown>
  const extra = Object.keys(rest)
  if (extra.length > 0) fail(`unknown key(s): ${extra.join(', ')}`)
  if (typeof literal !== 'object' || literal === null || Array.isArray(literal)) fail('literal must be an object of path → reason')
  for (const [path, reason] of Object.entries(literal)) {
    if (typeof reason !== 'string' || reason.trim() === '') fail(`literal ${path}: the reason must be a non-empty string`)
  }
  if (!Array.isArray(pending) || pending.some(path => typeof path !== 'string')) fail('pending must be an array of paths')
  const seen = new Set<string>()
  for (const path of pending as string[]) {
    if (seen.has(path)) fail(`pending lists ${path} twice`)
    if (Object.hasOwn(literal, path)) fail(`${path} is listed under both literal and pending`)
    seen.add(path)
  }
  return { literal: literal as Record<string, string>, pending: pending as string[] }
}

/**
 * Compare the files that hold Chinese text with the manifest.
 * @param holding - scanned files that contain a Han character.
 * @param scanned - every file the scan read as text.
 * @param manifest - the validated manifest.
 * @returns one message per violation, sorted by path.
 */
export function findChineseTextProblems(
  holding: ReadonlySet<string>,
  scanned: ReadonlySet<string>,
  manifest: ChineseTextManifest,
): string[] {
  const listed = new Set([...Object.keys(manifest.literal), ...manifest.pending])
  const problems: Array<[string, string]> = []
  for (const file of holding) {
    if (!listed.has(file)) {
      problems.push([file, `${file}: holds Chinese text; translate it to Brazilian Portuguese, or list it under literal with the reason code must match that text`])
    }
  }
  for (const file of listed) {
    if (!scanned.has(file)) problems.push([file, `${file}: listed in ${CHINESE_TEXT_MANIFEST_PATH} but not a tracked text file; remove the entry`])
    else if (!holding.has(file)) problems.push([file, `${file}: holds no Chinese text; remove its entry from ${CHINESE_TEXT_MANIFEST_PATH}`])
  }
  return problems.sort(([a], [b]) => a.localeCompare(b)).map(([, message]) => message)
}

/**
 * List the tracked regular files the gate scans: symlinks and submodules are
 * skipped, and so are excluded prefixes.
 * @param lsFiles - `git ls-files -s -z` output.
 * @returns repository-relative paths.
 */
export function scannablePaths(lsFiles: string): string[] {
  const paths: string[] = []
  for (const entry of lsFiles.split('\0')) {
    if (entry === '') continue
    const tab = entry.indexOf('\t')
    const mode = entry.slice(0, entry.indexOf(' '))
    const path = entry.slice(tab + 1)
    if (mode !== '100644' && mode !== '100755') continue
    if (EXCLUDED_PREFIXES.some(prefix => path.startsWith(prefix))) continue
    paths.push(path)
  }
  return paths
}

function fail(message: string): never {
  throw new Error(`${CHINESE_TEXT_MANIFEST_PATH}: ${message}`)
}

if (import.meta.main) {
  const manifest = parseChineseTextManifest(readFileSync(resolve(root, CHINESE_TEXT_MANIFEST_PATH), 'utf8'))
  const lsFiles = execFileSync('git', ['-C', root, 'ls-files', '-s', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  const scanned = new Set<string>()
  const holding = new Set<string>()
  for (const path of scannablePaths(lsFiles)) {
    const bytes = readFileSync(resolve(root, path))
    // A NUL byte marks a binary file, which holds no text to translate.
    if (bytes.includes(0)) continue
    scanned.add(path)
    if (HAN_CHARACTER.test(bytes.toString('utf8'))) holding.add(path)
  }
  const problems = findChineseTextProblems(holding, scanned, manifest)
  if (problems.length > 0) {
    console.error('verify-chinese-text failed:\n')
    for (const problem of problems) console.error(`  ${problem}`)
    console.error('\nChinese text is translated to Brazilian Portuguese (AGENTS.md); the pending list only shrinks.')
    process.exitCode = 1
  } else {
    console.log(`verify-chinese-text: ${String(scanned.size)} text file(s) scanned; ${String(Object.keys(manifest.literal).length)} literal and ${String(manifest.pending.length)} pending file(s) hold Chinese text.`)
  }
}
