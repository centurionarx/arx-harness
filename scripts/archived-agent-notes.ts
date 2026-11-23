/** Pure archive-format, triplet, and immutable-manifest helpers. */

import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { AGENT_NOTE_CLASSES } from './agent-note-tree.ts'

/**
 * Current frozen-content manifest version. Version 2 seals English and
 * Brazilian Portuguese counterparts
 * ([reseal](../.agents/notes/implemented/process/2026-09-29-chinese-text-becomes-brazilian-portuguese.md)).
 */
export const ARCHIVE_MANIFEST_VERSION = 2

/** Versioned fields in the frozen-content manifest. */
export interface ArchiveManifest {
  version: typeof ARCHIVE_MANIFEST_VERSION
  files: Readonly<Record<string, string>>
}

/** Hash one archived artifact independently of the repository's Git object format. */
function archiveContentHash(content: Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

/** Compute the SHA-1 Git blob id used by bilingual consistency sidecars. */
export function gitBlobHash(content: Buffer): string {
  const hash = createHash('sha1')
  hash.update(`blob ${content.byteLength}\0`)
  hash.update(content)
  return hash.digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse the manifest of the commit a change is compared with. A version 1
 * baseline sealed counterparts in another language and pins nothing; any other
 * baseline must be a valid manifest of the current version, so its seals bind.
 * @param content - the baseline manifest's JSON text.
 * @returns the seals the current manifest must preserve.
 */
export function parseBaselineArchiveManifest(content: string): ArchiveManifest {
  const value: unknown = JSON.parse(content)
  if (isRecord(value) && value.version === 1) return { version: ARCHIVE_MANIFEST_VERSION, files: {} }
  return parseArchiveManifest(content)
}

/** Parse the archive manifest and reject fields or hashes outside its closed schema. */
export function parseArchiveManifest(content: string): ArchiveManifest {
  const value: unknown = JSON.parse(content)
  if (!isRecord(value)) throw new Error('expected a JSON object')
  const fields = Object.keys(value).sort()
  if (fields.join(',') !== 'files,version') throw new Error('expected exactly the fields `version` and `files`')
  if (value.version !== ARCHIVE_MANIFEST_VERSION) {
    throw new Error(`unsupported manifest version (expected ${String(ARCHIVE_MANIFEST_VERSION)})`)
  }
  if (!isRecord(value.files)) throw new Error('`files` must be an object')
  const files: Record<string, string> = {}
  for (const [path, hash] of Object.entries(value.files)) {
    if (typeof hash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(hash)) {
      throw new Error(`invalid content hash for ${path}`)
    }
    files[path] = hash
  }
  return { version: ARCHIVE_MANIFEST_VERSION, files }
}

/** Render the archive manifest with deterministic path ordering. */
export function renderArchiveManifest(files: Readonly<Record<string, string>>): string {
  return `${JSON.stringify({
    version: ARCHIVE_MANIFEST_VERSION,
    files: Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))),
  }, null, 2)}\n`
}

/** Reject changes or removals of entries sealed by a prior manifest. */
export function validateArchiveManifestExtension(
  baseline: ArchiveManifest,
  current: ArchiveManifest,
): string[] {
  const errors: string[] = []
  for (const [path, expected] of Object.entries(baseline.files)) {
    const actual = current.files[path]
    if (actual === undefined) errors.push(`${path}: sealed manifest entry is missing`)
    else if (actual !== expected) errors.push(`${path}: sealed manifest hash changed`)
  }
  return errors
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

interface Triplet {
  source?: Buffer
  pt?: Buffer
  meta?: Buffer
}

function pairMeta(content: string): Map<string, string> | undefined {
  const entries = new Map<string, string>()
  for (const line of content.split('\n')) {
    if (line === '' || line.startsWith('#')) continue
    const match = /^([^:#]+\.md): ([0-9a-f]{40})$/.exec(line)
    if (match?.[1] === undefined || match[2] === undefined) return undefined
    entries.set(match[1], match[2])
  }
  return entries
}

function validateHeader(path: string, content: Buffer, sourceBase: string, portuguese: boolean): string[] {
  const errors: string[] = []
  const lines = content.toString('utf8').split('\n')
  if (!/^# Agent Note: \S/.test(lines[0] ?? '')) errors.push(`${path}: line 1 must be \`# Agent Note: <title>\``)
  if (lines[1] !== '') errors.push(`${path}: line 2 must be blank`)
  if (lines[2] !== 'Status: implemented') errors.push(`${path}: line 3 must be \`Status: implemented\``)
  const archived = /^Archived: (\d{4}-\d{2}-\d{2})$/.exec(lines[3] ?? '')?.[1]
  if (archived === undefined || !validDate(archived)) {
    errors.push(`${path}: line 4 must be \`Archived: YYYY-MM-DD\` with a valid date`)
  } else if (archived < sourceBase.slice(0, 10)) {
    errors.push(`${path}: archive date ${archived} predates the note filename`)
  }
  if (lines[4] !== '') errors.push(`${path}: line 5 must be blank`)
  const switcher = portuguese
    ? `[English](${sourceBase}.md) | Português`
    : `English | [Português](${sourceBase}.pt-BR.md)`
  if (lines[5] !== switcher) errors.push(`${path}: line 6 must be ${JSON.stringify(switcher)}`)
  return errors
}

/** Validate the closed kind tree, implemented/archive headers, and complete bilingual triplets. */
export function validateArchiveArtifacts(artifacts: ReadonlyMap<string, Buffer>): string[] {
  const errors: string[] = []
  const triplets = new Map<string, Triplet>()
  for (const [path, content] of artifacts) {
    const match = /^([^/]+)\/(\d{4}-\d{2}-\d{2}-.+?)(\.pt-BR\.md|\.i18n\.yaml|\.md)$/.exec(path)
    if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
      errors.push(`${path}: expected {kind}/yyyy-mm-dd-topic.{md,pt-BR.md,i18n.yaml}`)
      continue
    }
    if (!(AGENT_NOTE_CLASSES as readonly string[]).includes(match[1])) {
      errors.push(`${path}: unknown Agent Note kind ${JSON.stringify(match[1])}`)
      continue
    }
    const key = `${match[1]}/${match[2]}`
    const triplet = triplets.get(key) ?? {}
    if (match[3] === '.md') triplet.source = content
    else if (match[3] === '.pt-BR.md') triplet.pt = content
    else triplet.meta = content
    triplets.set(key, triplet)
  }

  for (const [key, triplet] of [...triplets].sort(([left], [right]) => left.localeCompare(right))) {
    const sourcePath = `${key}.md`
    const ptPath = `${key}.pt-BR.md`
    const metaPath = `${key}.i18n.yaml`
    const { source, pt, meta } = triplet
    const missing = [
      source === undefined ? sourcePath : undefined,
      pt === undefined ? ptPath : undefined,
      meta === undefined ? metaPath : undefined,
    ].filter((path): path is string => path !== undefined)
    if (source === undefined || pt === undefined || meta === undefined) {
      errors.push(`${key}: incomplete archived triplet; missing ${missing.join(', ')}`)
      continue
    }
    const sourceBase = basename(key)
    errors.push(...validateHeader(sourcePath, source, sourceBase, false))
    errors.push(...validateHeader(ptPath, pt, sourceBase, true))
    const sourceDate = /^Archived: (\d{4}-\d{2}-\d{2})$/m.exec(source.toString('utf8'))?.[1]
    const ptDate = /^Archived: (\d{4}-\d{2}-\d{2})$/m.exec(pt.toString('utf8'))?.[1]
    if (sourceDate !== undefined && ptDate !== undefined && sourceDate !== ptDate) {
      errors.push(`${key}: English and Portuguese archive dates differ (${sourceDate} vs ${ptDate})`)
    }
    const pair = pairMeta(meta.toString('utf8'))
    if (pair === undefined || pair.size !== 2
      || pair.get(`${sourceBase}.md`) !== gitBlobHash(source)
      || pair.get(`${sourceBase}.pt-BR.md`) !== gitBlobHash(pt)) {
      errors.push(`${metaPath}: consistency record must contain the current Git blob hashes of both archived sides`)
    }
  }
  return errors
}

/** Preserve every sealed path/hash and append hashes for newly archived artifacts. */
export function extendArchiveManifest(
  existing: ArchiveManifest,
  artifacts: ReadonlyMap<string, Buffer>,
): { files: Record<string, string>; added: string[]; errors: string[] } {
  const errors: string[] = []
  const files: Record<string, string> = { ...existing.files }
  for (const [path, expected] of Object.entries(existing.files)) {
    const content = artifacts.get(path)
    if (content === undefined) errors.push(`${path}: sealed artifact is missing`)
    else if (archiveContentHash(content) !== expected) errors.push(`${path}: sealed content hash changed`)
  }
  const added: string[] = []
  for (const [path, content] of [...artifacts].sort(([left], [right]) => left.localeCompare(right))) {
    if (files[path] !== undefined) continue
    files[path] = archiveContentHash(content)
    added.push(path)
  }
  return { files, added, errors }
}
