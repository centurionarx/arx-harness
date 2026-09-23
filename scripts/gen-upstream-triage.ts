/**
 * Generate `docs/upstream-triage.md`: one row per Agent Note the upstream
 * repository added on its first-parent history after the manifest's fork
 * base, with the upstream PR number, the commit that landed it, the areas it
 * touched, and a class — the verdict recorded in the manifest when there is
 * one, otherwise a mechanical class. A row carries the note's date and name
 * through the manifest's `slugRenames`, plus numbers and path-derived area
 * names; upstream titles, branch names, and prose are never copied.
 *
 * Usage: `ARX_UPSTREAM_CHECKOUT=<clone> pnpm run gen-upstream-triage [--ref <rev>]`
 * (`--ref` defaults to `origin/master`). `doc-sync` does not run it: it reads
 * a checkout outside this repository
 * ([reference](../docs/upstream-sync.md#triage)).
 */

import { execFileSync } from 'node:child_process'
import { globSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  CJK_CHARACTER,
  dropListEntry,
  isCorePath,
  readUpstreamSyncManifest,
  renameSegments,
  type UpstreamSyncManifest,
} from './upstream-sync-manifest.ts'

const root = resolve(import.meta.dirname, '..')

/** Repository-relative path of the generated page. */
export const TRIAGE_PATH = 'docs/upstream-triage.md'

/** Every class a triage row can carry, in summary order. */
export const TRIAGE_CLASSES = ['present', 'incorporate', 'evaluate', 'drop', 'deferred', 'untriaged'] as const

/** A row's class: a recorded verdict, `present`, or `untriaged`. */
export type TriageClass = typeof TRIAGE_CLASSES[number]

/** One upstream Agent Note in the triage. */
export interface TriageRow {
  /** The note's date prefix. */
  date: string
  /** The note name after `slugRenames`, without its date prefix. */
  name: string
  /** The upstream status directory the note was added under. */
  status: string
  /** The upstream PR number, when the landing commit names one. */
  pr: number | undefined
  /** Abbreviated SHA of the first-parent commit that added the note. */
  commit: string
  /** Areas the landing commit touched outside Agent Notes, most files first. */
  areas: string[]
  /**
   * Whether the landing commit also touched drop-listed directories or files;
   * translation sides (`*.ext` entries) are dropped without this mark.
   */
  dropListed: boolean
  class: TriageClass
  /** Empty only for an `untriaged` row with no mechanical finding. */
  reason: string
}

/** The triage of one upstream revision. */
export interface TriageReport {
  /** Full SHA of the triaged upstream revision. */
  sha: string
  /** Committer date of that revision, ISO 8601. */
  date: string
  rows: TriageRow[]
}

/** Inputs of {@link collectTriage}. */
export interface TriageOptions {
  /** Path of a local clone of the upstream repository. */
  checkout: string
  /** Upstream revision to triage through. */
  ref: string
  manifest: UpstreamSyncManifest
  /** This repository's Agent Notes: `<date>-<name>` → repository-relative path. */
  localNotes: ReadonlyMap<string, string>
}

const NOTE_PATH = /^\.agents\/notes\/(implemented|proposed|rejected)\/[^/]+\/(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/
const LOCAL_NOTE = /^\.agents\/notes\/([^/]+)\/(?:[^/]+\/)*(\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*)\.md$/
const MERGE_SUBJECT = /^Merge pull request #(\d+)\b/
const SQUASH_SUBJECT = /\(#(\d+)\)\s*$/
const AREA_SEGMENT = /^[A-Za-z0-9._@-]+$/
const EVENT_MAP_DECLARATION = 'interface SessionEventMap'
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
const MAX_AREAS = 4

function git(checkout: string, args: string[]): string {
  return execFileSync('git', ['-C', checkout, ...args], {
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function succeeds(checkout: string, args: string[]): boolean {
  try {
    git(checkout, args)
    return true
  } catch {
    // A non-zero exit is the answer this probe asks for; stderr is discarded with it.
    return false
  }
}

/**
 * Index this repository's Agent Notes by their dated file name.
 * @param repoRoot - repository root.
 * @returns `<date>-<name>` → repository-relative path, translation sides excluded.
 */
export function localNoteIndex(repoRoot: string): Map<string, string> {
  const index = new Map<string, string>()
  for (const path of globSync('.agents/notes/**/*.md', { cwd: repoRoot }).map(p => p.replaceAll('\\', '/')).sort()) {
    const match = LOCAL_NOTE.exec(path)
    if (match !== null) index.set(match[2] ?? '', path)
  }
  return index
}

/**
 * The area one changed path belongs to: `<group>/<package>` under
 * `packages/`, `apps/<app>`, `(root)` for a top-level file, otherwise the
 * top-level directory. Segments pass through `slugRenames`.
 * @param path - repository-relative upstream path.
 * @param manifest - the validated manifest.
 * @returns the area name.
 */
export function areaOf(path: string, manifest: UpstreamSyncManifest): string {
  const segments = path.split('/')
  if (segments.length === 1) return '(root)'
  const [top = '', second = '', third = ''] = segments
  let area: string[] = [top]
  if (top === 'packages' && segments.length >= 4) area = [second, third]
  else if ((top === 'packages' || top === 'apps') && segments.length >= 3) area = [top, second]
  if (!area.every(segment => AREA_SEGMENT.test(segment))) return '(other)'
  return area.map(segment => renameSegments(segment, manifest)).join('/')
}

/**
 * Line ranges of every `interface SessionEventMap` body in a source text.
 * @param source - one TypeScript file.
 * @returns 1-based inclusive `[first, last]` ranges.
 */
export function eventMapRanges(source: string): Array<[number, number]> {
  const lines = source.split('\n')
  const ranges: Array<[number, number]> = []
  for (let start = 0; start < lines.length; start++) {
    if (!(lines[start] ?? '').includes(EVENT_MAP_DECLARATION)) continue
    let depth = 0
    let opened = false
    for (let line = start; line < lines.length; line++) {
      for (const character of lines[line] ?? '') {
        if (character === '{') {
          depth++
          opened = true
        } else if (character === '}') {
          depth--
        }
      }
      if (opened && depth <= 0) {
        ranges.push([start + 1, line + 1])
        start = line
        break
      }
    }
  }
  return ranges
}

function overlaps(ranges: ReadonlyArray<readonly [number, number]>, first: number, count: number): boolean {
  return count > 0 && ranges.some(([start, end]) => first <= end && first + count - 1 >= start)
}

function grepDeclarations(checkout: string, revisions: readonly string[], paths: readonly string[]): string[] {
  try {
    return git(checkout, ['grep', '-l', '-F', EVENT_MAP_DECLARATION, ...revisions, '--', ...paths])
      .split('\n')
      .filter(line => line !== '')
  } catch (error) {
    // git grep exits 1 when nothing matches; every other failure propagates.
    if ((error as { status?: unknown }).status === 1) return []
    throw error
  }
}

/** Whether one commit changes a line inside a `SessionEventMap` declaration. */
function changesEventMap(checkout: string, commit: string, paths: readonly string[]): boolean {
  const candidates = paths.filter(path => /\.m?tsx?$/.test(path))
  if (candidates.length === 0) return false
  const parent = `${commit}^1`
  const declared = new Map<string, Set<string>>()
  for (const hit of grepDeclarations(checkout, [parent, commit], candidates)) {
    const revision = hit.slice(0, hit.indexOf(':'))
    const path = hit.slice(revision.length + 1)
    declared.set(path, (declared.get(path) ?? new Set()).add(revision))
  }
  for (const [path, revisions] of declared) {
    const rangesAt = (revision: string): Array<[number, number]> =>
      revisions.has(revision) ? eventMapRanges(git(checkout, ['show', `${revision}:${path}`])) : []
    const before = rangesAt(parent)
    const after = rangesAt(commit)
    for (const line of git(checkout, ['diff', '-U0', '--no-renames', parent, commit, '--', path]).split('\n')) {
      const hunk = HUNK.exec(line)
      if (hunk === null) continue
      if (overlaps(before, Number(hunk[1]), Number(hunk[2] ?? '1'))) return true
      if (overlaps(after, Number(hunk[3]), Number(hunk[4] ?? '1'))) return true
    }
  }
  return false
}

function pullRequestOf(subject: string): number | undefined {
  const match = MERGE_SUBJECT.exec(subject) ?? SQUASH_SUBJECT.exec(subject)
  return match === null ? undefined : Number(match[1])
}

function byCodePoint(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function summarizeAreas(paths: readonly string[], manifest: UpstreamSyncManifest): string[] {
  const counts = new Map<string, number>()
  for (const path of paths) {
    const area = areaOf(path, manifest)
    counts.set(area, (counts.get(area) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || byCodePoint(a[0], b[0])).map(([area]) => area)
}

function coreReason(paths: readonly string[], eventMap: boolean, manifest: UpstreamSyncManifest): string | undefined {
  const touched = [...new Set(paths.filter(path => isCorePath(path, manifest)).map(path => areaOf(path, manifest)))]
  const subjects = [...touched.sort(byCodePoint), ...eventMap ? ['SessionEventMap'] : []]
  return subjects.length === 0 ? undefined : `core rule applies: changes ${subjects.join(', ')}`
}

interface LandedNote {
  date: string
  name: string
  status: string
}

/**
 * Walk the upstream first-parent history after the fork base and classify
 * every Agent Note it added. A note added twice (moved between status
 * directories) keeps the later addition.
 * @param options - checkout, revision, manifest, and local note index.
 * @returns the triage, in landing order.
 * @throws Error when the fork base is not an ancestor of the revision, or a
 * recorded verdict names no row or a note already present here.
 */
export function collectTriage(options: TriageOptions): TriageReport {
  const { checkout, ref, manifest, localNotes } = options
  const sha = git(checkout, ['rev-parse', '--verify', `${ref}^{commit}`]).trim()
  if (!succeeds(checkout, ['merge-base', '--is-ancestor', manifest.forkBase, sha])) {
    throw new Error(`gen-upstream-triage: fork base ${manifest.forkBase} is not an ancestor of ${ref}; fetch the upstream repository first`)
  }
  const date = git(checkout, ['log', '-1', '--format=%cI', sha]).trim()
  const rows = new Map<string, TriageRow>()
  const log = git(checkout, ['log', '--first-parent', '--reverse', '--format=%H%x1f%s%x1e', `${manifest.forkBase}..${sha}`])
  for (const record of log.split('\x1e')) {
    const [commit = '', subject = ''] = record.trim().split('\x1f')
    if (commit === '') continue
    const changes = git(checkout, ['diff', '--no-renames', '--name-status', '-z', `${commit}^1`, commit]).split('\0')
    const landed: LandedNote[] = []
    const paths: string[] = []
    for (let index = 0; index + 1 < changes.length; index += 2) {
      const status = changes[index] ?? ''
      const path = changes[index + 1] ?? ''
      const note = NOTE_PATH.exec(path)
      if (status === 'A' && note !== null) {
        landed.push({ status: note[1] ?? '', date: note[2] ?? '', name: renameSegments(note[3] ?? '', manifest) })
      } else if (!path.startsWith('.agents/notes/')) {
        paths.push(path)
      }
    }
    if (landed.length === 0) continue
    const entries = paths.map(path => dropListEntry(path, manifest))
    const kept = paths.filter((_, index) => entries[index] === undefined)
    const onlyDropListed = paths.length > 0 && kept.length === 0
    const core = onlyDropListed ? undefined : coreReason(kept, changesEventMap(checkout, commit, kept), manifest)
    const shared = {
      pr: pullRequestOf(subject),
      commit: commit.slice(0, 10),
      areas: summarizeAreas(kept, manifest),
      dropListed: entries.some(entry => entry !== undefined && !entry.startsWith('*.')),
    }
    for (const note of landed) {
      const key = `${note.date}-${note.name}`
      rows.delete(key)
      const localStatus = localNotes.get(key)?.split('/')[2]
      const verdict = manifest.verdicts[note.name]
      let classified: Pick<TriageRow, 'class' | 'reason'>
      if (localStatus === note.status) classified = { class: 'present', reason: `here as ${note.status}` }
      else if (verdict !== undefined) classified = { class: verdict.class, reason: verdict.reason }
      else if (localStatus !== undefined) classified = { class: 'untriaged', reason: `here as ${localStatus}, upstream as ${note.status}` }
      else if (onlyDropListed) classified = { class: 'drop', reason: 'touches only drop-listed paths' }
      else if (core !== undefined) classified = { class: 'evaluate', reason: core }
      else classified = { class: 'untriaged', reason: '' }
      rows.set(key, { ...note, ...shared, ...classified })
    }
  }
  const all = [...rows.values()]
  for (const name of Object.keys(manifest.verdicts)) {
    const matching = all.filter(row => row.name === name)
    if (matching.length === 0) {
      throw new Error(`gen-upstream-triage: verdicts.${name} names no Agent Note added upstream after the fork base`)
    }
    if (matching.some(row => row.class === 'present')) {
      throw new Error(`gen-upstream-triage: verdicts.${name} is stale; the note is already here; remove the verdict`)
    }
  }
  return { sha, date, rows: all }
}

function cell(text: string): string {
  return text.replaceAll('|', '\\|')
}

function areasCell(row: TriageRow): string {
  const shown = row.areas.slice(0, MAX_AREAS)
  const hidden = row.areas.length - shown.length
  const parts = [
    ...shown,
    ...hidden > 0 ? [`+${String(hidden)} more`] : [],
    ...row.dropListed ? ['drop-listed paths'] : [],
  ]
  return parts.length === 0 ? 'notes only' : cell(parts.join(', '))
}

/**
 * Render the triage page.
 * @param report - the collected triage.
 * @param manifest - the validated manifest.
 * @returns the page content.
 * @throws Error when the page would contain a CJK character or a forbidden word.
 */
export function renderTriage(report: TriageReport, manifest: UpstreamSyncManifest): string {
  const counts = new Map<TriageClass, number>(TRIAGE_CLASSES.map(triageClass => [triageClass, 0]))
  for (const row of report.rows) counts.set(row.class, (counts.get(row.class) ?? 0) + 1)
  const lines = [
    '<!-- Generated by scripts/gen-upstream-triage.ts — do not edit by hand.',
    '     Run `pnpm run gen-upstream-triage` with ARX_UPSTREAM_CHECKOUT set to regenerate. -->',
    '',
    '# Upstream Triage',
    '',
    `Every Agent Note the upstream repository added on its first-parent history after the fork base, through upstream commit \`${report.sha.slice(0, 10)}\` (${report.date}). [The upstream sync reference](upstream-sync.md#triage) defines the classes and where a verdict is recorded; [the sync procedure](cookbook/syncing-from-upstream.md) regenerates this page. A row names the note through the manifest's name renames; the upstream PR number and commit locate the original.`,
    '',
    '| Class | Notes |',
    '|---|---|',
    ...TRIAGE_CLASSES.map(triageClass => `| ${triageClass} | ${String(counts.get(triageClass) ?? 0)} |`),
    '',
    '| Date | Note | Status | Upstream PR | Commit | Areas | Class | Reason |',
    '|---|---|---|---|---|---|---|---|',
    ...report.rows.map(row => [
      row.date,
      `\`${row.name}\``,
      row.status,
      row.pr === undefined ? '—' : `\`${String(row.pr)}\``,
      `\`${row.commit}\``,
      areasCell(row),
      row.class,
      row.reason === '' ? '—' : cell(row.reason),
    ].join(' | ')).map(line => `| ${line} |`),
    '',
  ]
  const page = lines.join('\n')
  const cjk = lines.findIndex(line => CJK_CHARACTER.test(line))
  if (cjk !== -1) throw new Error(`gen-upstream-triage: line ${String(cjk + 1)} would contain a CJK character`)
  for (const word of manifest.forbidden) {
    const hit = lines.findIndex(line => line.toLowerCase().includes(word))
    if (hit !== -1) {
      throw new Error(`gen-upstream-triage: line ${String(hit + 1)} would contain a forbidden word; add a slugRenames entry`)
    }
  }
  return page
}

if (import.meta.main) {
  const checkout = process.env.ARX_UPSTREAM_CHECKOUT
  if (checkout === undefined || checkout === '') {
    console.error('gen-upstream-triage: set ARX_UPSTREAM_CHECKOUT to a clone of the repository named in scripts/upstream-sync.manifest.json')
    process.exit(1)
  }
  const { values } = parseArgs({ options: { ref: { type: 'string', default: 'origin/master' } } })
  const manifest = readUpstreamSyncManifest(root)
  const report = collectTriage({ checkout, ref: values.ref, manifest, localNotes: localNoteIndex(root) })
  writeFileSync(resolve(root, TRIAGE_PATH), renderTriage(report, manifest))
  const untriaged = report.rows.filter(row => row.class === 'untriaged').length
  console.log(`gen-upstream-triage: wrote ${TRIAGE_PATH} with ${String(report.rows.length)} notes through ${report.sha.slice(0, 10)}; ${String(untriaged)} untriaged.`)
}
