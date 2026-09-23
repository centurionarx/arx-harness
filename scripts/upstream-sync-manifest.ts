/**
 * Read and validate `scripts/upstream-sync.manifest.json`, the data half of
 * the upstream sync policy: which upstream repository and commit this tree
 * was forked from, which upstream paths an import never takes, which paths
 * the core rule governs, how upstream identifiers map to this tree's, and
 * the recorded triage verdicts ([reference](../docs/upstream-sync.md)).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Verdict classes a person records in the manifest. */
const VERDICT_CLASSES = ['incorporate', 'evaluate', 'drop', 'deferred'] as const

/** One recorded verdict class. */
type VerdictClass = typeof VERDICT_CLASSES[number]

/** A recorded judgment about one upstream decision. */
interface Verdict {
  /** What this tree does with the decision. */
  class: VerdictClass
  /** Why, in terms of this tree; never upstream wording. */
  reason: string
}

/** The validated manifest. */
export interface UpstreamSyncManifest {
  /** Clone URL of the upstream repository. */
  repository: string
  /** Full SHA of the upstream commit this tree was forked from. */
  forkBase: string
  /**
   * Upstream paths an import never takes: a `dir/` prefix, a `*.ext` suffix
   * matched against the file name, or one exact path.
   */
  dropPaths: readonly string[]
  /**
   * Path prefixes whose changes fall under the core rule; `*` matches within
   * one path segment.
   */
  corePaths: readonly string[]
  /** Ordered `[upstream, local]` identifier prefixes; the first match wins. */
  identifierMap: ReadonlyArray<readonly [string, string]>
  /** Whole `-`-separated name segments renamed when a note name is shown here. */
  slugRenames: Readonly<Record<string, string>>
  /** Case-insensitive substrings no generated triage may contain. */
  forbidden: readonly string[]
  /** Recorded verdicts, keyed by the note name without its date prefix. */
  verdicts: Readonly<Record<string, Verdict>>
}

const FIELDS = [
  'repository', 'forkBase', 'dropPaths', 'corePaths', 'identifierMap', 'slugRenames', 'forbidden', 'verdicts',
] as const

const FULL_SHA = /^[0-9a-f]{40}$/
const NOTE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Repository-relative location of the checked-in manifest. */
export const UPSTREAM_SYNC_MANIFEST_PATH = 'scripts/upstream-sync.manifest.json'

/**
 * One CJK character: Han, kana, Hangul, CJK punctuation, or a halfwidth or
 * fullwidth form. No imported or generated text may contain one.
 */
export const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u

function fail(message: string): never {
  throw new Error(`${UPSTREAM_SYNC_MANIFEST_PATH}: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${field} must be a non-empty string`)
  return value
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) fail(`${field} must be an array of strings`)
  return value.map((entry, index) => nonEmptyString(entry, `${field}[${String(index)}]`))
}

function dropPath(entry: string, index: number): string {
  const wildcard = entry.indexOf('*')
  if (wildcard === -1) return entry
  if (wildcard === 0 && entry.startsWith('*.') && !entry.slice(1).includes('*') && !entry.includes('/')) return entry
  return fail(`dropPaths[${String(index)}] must be a dir/ prefix, a *.ext suffix, or an exact path`)
}

function identifierPair(entry: unknown, index: number): readonly [string, string] {
  if (!Array.isArray(entry) || entry.length !== 2) fail(`identifierMap[${String(index)}] must be an [upstream, local] pair`)
  const pair: unknown[] = entry
  return [
    nonEmptyString(pair[0], `identifierMap[${String(index)}][0]`),
    nonEmptyString(pair[1], `identifierMap[${String(index)}][1]`),
  ]
}

function slugRenames(value: unknown): Record<string, string> {
  if (!isRecord(value)) fail('slugRenames must be an object')
  const renames: Record<string, string> = {}
  for (const [from, to] of Object.entries(value)) {
    const replacement = nonEmptyString(to, `slugRenames.${from}`)
    if (!NOTE_NAME.test(from) || from.includes('-') || !NOTE_NAME.test(replacement)) {
      fail(`slugRenames.${from} must rename one lowercase segment to a lowercase name`)
    }
    renames[from] = replacement
  }
  return renames
}

function verdict(value: unknown, name: string): Verdict {
  if (!isRecord(value)) fail(`verdicts.${name} must be an object`)
  const verdictClass = value.class
  if (typeof verdictClass !== 'string' || !(VERDICT_CLASSES as readonly string[]).includes(verdictClass)) {
    fail(`verdicts.${name}.class must be one of ${VERDICT_CLASSES.join(', ')}`)
  }
  return { class: verdictClass as VerdictClass, reason: nonEmptyString(value.reason, `verdicts.${name}.reason`) }
}

function verdicts(value: unknown): Record<string, Verdict> {
  if (!isRecord(value)) fail('verdicts must be an object')
  const parsed: Record<string, Verdict> = {}
  for (const [name, entry] of Object.entries(value)) {
    if (!NOTE_NAME.test(name)) fail(`verdicts.${name} must be a note name without its date prefix`)
    parsed[name] = verdict(entry, name)
  }
  return parsed
}

/**
 * Parse and validate manifest text.
 * @param content - the manifest file content.
 * @returns the validated manifest.
 * @throws Error naming the manifest and the first invalid field.
 */
export function parseUpstreamSyncManifest(content: string): UpstreamSyncManifest {
  const value: unknown = JSON.parse(content)
  if (!isRecord(value)) fail('expected an object')
  const unknown = Object.keys(value).filter(field => !(FIELDS as readonly string[]).includes(field))
  if (unknown.length > 0) fail(`unsupported field(s): ${unknown.join(', ')}`)
  const forkBase = nonEmptyString(value.forkBase, 'forkBase')
  if (!FULL_SHA.test(forkBase)) fail('forkBase must be a full lowercase commit SHA')
  if (!Array.isArray(value.identifierMap)) fail('identifierMap must be an array of [upstream, local] pairs')
  const identifiers: unknown[] = value.identifierMap
  return {
    repository: nonEmptyString(value.repository, 'repository'),
    forkBase,
    dropPaths: stringList(value.dropPaths, 'dropPaths').map(dropPath),
    corePaths: stringList(value.corePaths, 'corePaths'),
    identifierMap: identifiers.map(identifierPair),
    slugRenames: slugRenames(value.slugRenames),
    forbidden: stringList(value.forbidden, 'forbidden').map(word => word.toLowerCase()),
    verdicts: verdicts(value.verdicts),
  }
}

/**
 * Read the checked-in manifest.
 * @param root - repository root.
 * @returns the validated manifest.
 */
export function readUpstreamSyncManifest(root: string): UpstreamSyncManifest {
  return parseUpstreamSyncManifest(readFileSync(resolve(root, UPSTREAM_SYNC_MANIFEST_PATH), 'utf8'))
}

/**
 * The drop-list entry that covers an upstream path.
 * @param path - repository-relative upstream path.
 * @param manifest - the validated manifest.
 * @returns the first matching `dropPaths` entry, or undefined when an import may take the path.
 */
export function dropListEntry(path: string, manifest: UpstreamSyncManifest): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return manifest.dropPaths.find((entry) => {
    if (entry.startsWith('*.')) return name.endsWith(entry.slice(1))
    return entry.endsWith('/') ? path.startsWith(entry) : path === entry
  })
}

function prefixPattern(prefix: string): RegExp {
  const escaped = prefix.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^${escaped.join('[^/]*')}`)
}

/**
 * Whether an upstream path falls under the core rule.
 * @param path - repository-relative upstream path.
 * @param manifest - the validated manifest.
 * @returns true when a `corePaths` prefix matches the path.
 */
export function isCorePath(path: string, manifest: UpstreamSyncManifest): boolean {
  return manifest.corePaths.some(prefix => prefixPattern(prefix).test(path))
}

/**
 * Show one upstream name the way this tree spells it: each `-`-separated
 * segment named in `slugRenames` is replaced whole.
 * @param name - an upstream note name or path segment.
 * @param manifest - the validated manifest.
 * @returns the renamed name.
 */
export function renameSegments(name: string, manifest: UpstreamSyncManifest): string {
  return name.split('-').map(segment => manifest.slugRenames[segment] ?? segment).join('-')
}
