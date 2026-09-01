/**
 * Enforce complete English/Chinese pairs, matching structure, and recorded git
 * blob hashes for every in-scope document. The manifest contains only explicit
 * exclusions, which may have neither a counterpart nor a sidecar.
 * `--list` reports state; `--write <pairs...>` records the named confirmed
 * pairs (`--write --all` records every complete pair); `--cached <pairs...>`
 * checks exact index bytes for hooks. A check or write named with pair paths
 * touches only those pairs, so update iteration does not pay for a corpus
 * scan. Translation quality remains a review responsibility.
 * See `docs/i18n/README.md` for the owning contract.
 */

import { existsSync, globSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import {
  gitBlobHash,
  gitIndexPaths,
  readGitIndexBlob,
  storeGitBlob,
} from './translation-pairing-git.ts'
import {
  COUNTERPART_SUFFIXES,
  parseTranslationPairingRecord,
  renderTranslationPairingRecord,
  translationPairPaths,
  type CounterpartSuffix,
} from './translation-pairing-record.ts'
import {
  languageSwitcherTargets,
  parseTranslationMarkdown,
  parseTranslationPairingCliArgs,
  parseTranslationPairingManifest,
  partitionGeneratedRegions,
  requiresSourceLanguageSwitcher,
  isTranslationPairingManifestExcluded,
  isTranslationScopeFile,
  TRANSLATION_SCOPE_GLOB_EXCLUDES,
  translationPairSourcePredicate,
  translationStructureDiff,
  translationStructureSignature,
} from './translation-pairing.ts'
import {
  hasLanguageSwitcher,
  normalizeTranslationMarkdownLinks,
  translationLinkLocaleViolations,
} from './translation-links.ts'

const root = resolve(import.meta.dirname, '..')
let request: ReturnType<typeof parseTranslationPairingCliArgs>
try {
  request = parseTranslationPairingCliArgs(process.argv.slice(2))
} catch (error) {
  console.error(`verify-translation-pairing: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}
const listMode = request.mode === 'list'
const writeMode = request.mode === 'write'
const indexMode = request.input === 'index'
const indexFiles = indexMode ? gitIndexPaths(root) : undefined

const contentCache = new Map<string, Buffer | undefined>()

/** Read one repository path from the selected worktree or index plane. */
function readRepositoryFile(file: string): Buffer | undefined {
  if (contentCache.has(file)) return contentCache.get(file)
  const content = indexMode
    ? indexFiles?.has(file) ? readGitIndexBlob(root, file)?.content : undefined
    : existsSync(join(root, file)) && statSync(join(root, file)).isFile()
      ? readFileSync(join(root, file))
      : undefined
  contentCache.set(file, content)
  return content
}

/** Whether one path exists in the selected content plane. */
function repositoryFileExists(file: string): boolean {
  return indexMode ? indexFiles?.has(file) === true : readRepositoryFile(file) !== undefined
}

/**
 * Resolve a source's counterpart suffix on the selected content plane.
 * `undefined` when neither suffix exists; `'both'` when the pair carries two
 * counterparts, which every caller reports rather than silently picks.
 */
function resolveCounterpartSuffix(source: string): CounterpartSuffix | 'both' | undefined {
  const present = COUNTERPART_SUFFIXES.filter(suffix => repositoryFileExists(source.replace(/\.md$/, suffix)))
  if (present.length === 1) return present[0]
  return present.length === 0 ? undefined : 'both'
}

/** Strip whichever counterpart suffix a path carries. */
function stripCounterpartSuffix(file: string): string {
  const suffix = COUNTERPART_SUFFIXES.find(candidate => file.endsWith(candidate))
  return suffix === undefined ? file : `${file.slice(0, -suffix.length)}.md`
}

/** Discover source Markdown and pairing sidecars before applying the corpus predicate. */
const SCOPE_PATTERNS = [
  '**/*.md',
  '**/*.i18n.yaml',
  '.agents/notes/**/*.md',
  '.agents/notes/**/*.i18n.yaml',
]

const manifestContent = readRepositoryFile('scripts/translation-pairing.manifest.json')
if (manifestContent === undefined) {
  throw new Error('scripts/translation-pairing.manifest.json is missing from the selected content plane')
}
const manifest = parseTranslationPairingManifest(manifestContent.toString('utf8'))
const isTranslationPairSource = translationPairSourcePredicate(manifest)

/**
 * An excluded entry ending in `/` excludes the whole directory. The trailing
 * slash IS the path boundary — `docs/tool-catalog/` cannot prefix-match a
 * sibling like `docs/tool-catalog-notes/x.md` — so directory entries in the
 * manifest must keep their trailing slash.
 */
function isExcluded(file: string): boolean {
  return isTranslationPairingManifestExcluded(file, manifest)
}

// Enumerate the scope once: the whole corpus, or exactly the named pairs'
// three files (a named pair whose files are absent is caught by the same
// completeness rules that cover discovered remnants).
const files = new Set<string>()
if (request.scope === 'pairs') {
  for (const anchor of request.anchors) {
    for (const suffix of COUNTERPART_SUFFIXES) {
      const { source, counterpart, meta } = translationPairPaths(anchor, suffix)
      for (const file of [source, counterpart, meta]) {
        if (repositoryFileExists(file)) files.add(file)
      }
    }
    // A named worktree anchor with no files still enters the source list so
    // an interactive check reports it. An index check accepts a complete
    // three-file deletion and still rejects every partial deletion below.
    if (!indexMode && !repositoryFileExists(anchor)) files.add(anchor)
  }
} else {
  for (const pattern of SCOPE_PATTERNS) {
    for (const match of globSync(pattern, { cwd: root, exclude: TRANSLATION_SCOPE_GLOB_EXCLUDES })) {
      const normalized = match.split(sep).join('/')
      if (isTranslationScopeFile(normalized)) files.add(normalized)
    }
  }
}
const isCounterpartFile = (file: string): boolean => COUNTERPART_SUFFIXES.some(suffix => file.endsWith(suffix))
const translations = [...files].filter(isCounterpartFile).sort()
const metas = [...files].filter(f => f.endsWith('.i18n.yaml')).sort()
const sources = [...files].filter(f => f.endsWith('.md') && !isCounterpartFile(f)).sort()

if (request.scope === 'pairs') {
  const rejected = request.anchors.filter(anchor => !isTranslationScopeFile(anchor) || isExcluded(anchor))
  const absent = request.anchors.filter((anchor) => {
    return !COUNTERPART_SUFFIXES.some((suffix) => {
      const { source, counterpart, meta } = translationPairPaths(anchor, suffix)
      return [source, counterpart, meta].some(repositoryFileExists)
    })
  })
  if (rejected.length > 0 || (!indexMode && absent.length > 0)) {
    for (const anchor of rejected) {
      console.error(`verify-translation-pairing: ${anchor} is not an in-scope pair (excluded or outside the documentation corpus; see docs/i18n/README.md)`)
    }
    for (const anchor of absent) {
      console.error(`verify-translation-pairing: ${anchor} names no pair on disk (none of its three files exist)`)
    }
    process.exit(2)
  }
}

// --write: (re)record both hashes for the requested complete pairs, creating
// missing records. A named pair that cannot be recorded (missing counterpart)
// fails loud; corpus scope (--all) skips pairless sources as before.
if (writeMode) {
  let written = 0
  for (const source of sources) {
    if (isExcluded(source)) continue
    const suffix = resolveCounterpartSuffix(source)
    if (suffix === undefined || suffix === 'both') {
      if (request.scope === 'pairs') {
        console.error(`verify-translation-pairing: cannot record ${source}: ${suffix === 'both' ? 'both counterpart suffixes exist' : 'no counterpart exists'}`)
        process.exit(2)
      }
      continue
    }
    const paths = translationPairPaths(source, suffix)
    const { counterpart, meta } = paths
    if (!repositoryFileExists(source) || !repositoryFileExists(counterpart)) {
      if (request.scope === 'pairs') {
        console.error(`verify-translation-pairing: cannot record ${source}: missing ${repositoryFileExists(source) ? counterpart : source}`)
        process.exit(2)
      }
      continue
    }
    const sourceContent = readRepositoryFile(source)
    const counterpartContent = readRepositoryFile(counterpart)
    if (sourceContent === undefined || counterpartContent === undefined) throw new Error(`${source}: complete pair became unreadable`)
    // A consistency record is also a recovery pointer for the briefing
    // generator. Persist both snapshots even when the sidecar text is already
    // current, because the bytes may exist only in this working tree.
    const record = renderTranslationPairingRecord(paths, {
      sourceHash: storeGitBlob(root, sourceContent),
      counterpartHash: storeGitBlob(root, counterpartContent),
    })
    if (existsSync(join(root, meta)) && readFileSync(join(root, meta), 'utf8') === record) continue
    writeFileSync(join(root, meta), record)
    console.log(`verify-translation-pairing: recorded ${meta}`)
    written++
  }
  console.log(`verify-translation-pairing: ${written} record(s) written; run the check to validate the pairs.`)
  process.exit(0)
}

const errors: string[] = []
const state = new Map<string, 'ok' | 'out-of-sync' | 'missing'>()

// 1. Every discovered, non-excluded source merges bilingual.
for (const source of sources) {
  if (isExcluded(source)) continue
  const suffix = resolveCounterpartSuffix(source)
  if (suffix === undefined) {
    errors.push(`${source}: in-scope documentation must merge bilingual (docs/i18n/README.md); add the counterpart (.pt-BR.md) and record the pair`)
    state.set(source, 'missing')
  } else if (suffix === 'both') {
    errors.push(`${source}: both counterpart suffixes exist; a pair carries one language — remove one`)
    state.set(source, 'out-of-sync')
  }
}

// 2. Every pair that exists at all is complete and consistent. Anchor on the
// union of counterpart files and .i18n.yaml records so a half-deleted pair is
// caught from either remnant.
const pairAnchors = new Set<string>()
for (const counterpart of translations) pairAnchors.add(stripCounterpartSuffix(counterpart))
for (const meta of metas) pairAnchors.add(meta.replace(/\.i18n\.yaml$/, '.md'))

for (const source of [...pairAnchors].sort()) {
  const suffix = resolveCounterpartSuffix(source)
  const paths = translationPairPaths(source, suffix === 'both' || suffix === undefined ? '.pt-BR.md' : suffix)
  const { counterpart, meta } = paths
  const have = {
    source: repositoryFileExists(source),
    counterpart: repositoryFileExists(counterpart),
    meta: repositoryFileExists(meta),
  }

  if (isExcluded(source)) {
    if (have.counterpart) errors.push(`${counterpart}: ${source} is excluded from pairing (generated or bilingual-by-construction); this translation must not exist`)
    if (have.meta) errors.push(`${meta}: ${source} is excluded from pairing; this consistency record must not exist`)
    continue
  }
  if (suffix === 'both') {
    errors.push(`${source}: both counterpart suffixes exist; a pair carries one language — remove one`)
    state.set(source, 'out-of-sync')
    continue
  }
  const missing = Object.entries(have).filter(([, ok]) => !ok).map(([k]) => (k === 'source' ? source : k === 'counterpart' ? counterpart : meta))
  if (missing.length > 0) {
    errors.push(`${source}: incomplete pair — missing ${missing.join(', ')} (pairs merge whole: both languages plus the .i18n.yaml record)`)
    continue
  }

  const sourceContent = readRepositoryFile(source)
  const counterpartContent = readRepositoryFile(counterpart)
  const metaContent = readRepositoryFile(meta)
  if (sourceContent === undefined || counterpartContent === undefined || metaContent === undefined) {
    throw new Error(`${source}: complete pair became unreadable`)
  }
  const record = parseTranslationPairingRecord(metaContent.toString('utf8'), paths)
  if (record === undefined) {
    errors.push(`${meta}: malformed consistency record (expected exactly \`${basename(source)}: <40-hex>\` and \`${basename(counterpart)}: <40-hex>\`)`)
    continue
  }

  let consistent = true
  for (const [file, content] of [[source, sourceContent], [counterpart, counterpartContent]] as const) {
    const current = gitBlobHash(content)
    const recorded = file === source ? record.sourceHash : record.counterpartHash
    if (recorded !== current) {
      errors.push(`${file}: out of sync — content no longer matches the pair's last confirmed-consistent state in ${meta} (bring the other side along, then re-record with --write)`)
      consistent = false
    }
  }
  if (!consistent) {
    state.set(source, 'out-of-sync')
    continue
  }

  const sourceText = sourceContent.toString('utf8')
  const counterpartText = counterpartContent.toString('utf8')
  const sourceSwitcherTargets = languageSwitcherTargets(source)
  const counterpartSwitcherTargets = languageSwitcherTargets(counterpart)
  for (const violation of [
    ...translationLinkLocaleViolations(sourceText, {
      repoRoot: root,
      sourcePath: source,
      isTranslationPairSource,
      repositoryFileExists,
    }, counterpartSwitcherTargets),
    ...translationLinkLocaleViolations(counterpartText, {
      repoRoot: root,
      sourcePath: counterpart,
      isTranslationPairSource,
      repositoryFileExists,
    }, sourceSwitcherTargets),
  ]) {
    errors.push(`${violation.sourcePath}:${violation.line}: link target ${JSON.stringify(violation.url)} uses the wrong locale; expected ${JSON.stringify(violation.expectedUrl)}`)
    state.set(source, 'out-of-sync')
  }

  // Generated regions must remain byte-identical after paired document paths
  // are normalized to one semantic target. The structural signature below
  // compares their contents again as part of the whole document; this named
  // check rejects any prose, ordering, code, marker, or non-locale URL drift.
  let sourceRegions: { regions: string[]; stripped: string }
  let counterpartRegions: { regions: string[]; stripped: string }
  try {
    sourceRegions = partitionGeneratedRegions(sourceText)
    counterpartRegions = partitionGeneratedRegions(counterpartText)
  } catch (error) {
    errors.push(`${source} ↔ ${counterpart}: ${error instanceof Error ? error.message : String(error)}`)
    state.set(source, 'out-of-sync')
    continue
  }
  const normalizedSourceRegions = sourceRegions.regions.map(region => normalizeTranslationMarkdownLinks(region, {
    repoRoot: root,
    sourcePath: source,
    isTranslationPairSource,
    repositoryFileExists,
  }))
  const normalizedCounterpartRegions = counterpartRegions.regions.map(region => normalizeTranslationMarkdownLinks(region, {
    repoRoot: root,
    sourcePath: counterpart,
    isTranslationPairSource,
    repositoryFileExists,
  }))
  if (normalizedSourceRegions.length !== normalizedCounterpartRegions.length
    || normalizedSourceRegions.some((region, index) => region !== normalizedCounterpartRegions[index])) {
    errors.push(`${source} ↔ ${counterpart}: generated regions differ beyond paired-document locale paths — regenerate both sides`)
    state.set(source, 'out-of-sync')
  }

  const sourceTree = parseTranslationMarkdown(sourceText)
  const counterpartTree = parseTranslationMarkdown(counterpartText)
  if (!hasLanguageSwitcher(counterpartTree, counterpartText, sourceSwitcherTargets)) {
    errors.push(`${counterpart}: missing language switcher — no link to ${basename(source)}`)
  }
  if (requiresSourceLanguageSwitcher(source) && !hasLanguageSwitcher(sourceTree, sourceText, counterpartSwitcherTargets)) {
    errors.push(`${source}: missing language switcher — no link back to ${basename(counterpart)}`)
  }
  for (const divergence of translationStructureDiff(
    translationStructureSignature(sourceTree, counterpartSwitcherTargets, {
      repoRoot: root,
      sourcePath: source,
      isTranslationPairSource,
      repositoryFileExists,
      markdown: sourceText,
    }),
    translationStructureSignature(counterpartTree, sourceSwitcherTargets, {
      repoRoot: root,
      sourcePath: counterpart,
      isTranslationPairSource,
      repositoryFileExists,
      markdown: counterpartText,
    }),
  )) {
    errors.push(`${source} ↔ ${counterpart}: ${divergence}`)
  }
  if (!state.has(source)) state.set(source, 'ok')
}

// Complete the state map for --list: any in-scope, non-excluded document with no pair is missing.
for (const source of sources) {
  if (!isExcluded(source) && !state.has(source)) state.set(source, 'missing')
}

if (listMode) {
  const order = { 'out-of-sync': 0, missing: 1, ok: 2 } as const
  const rows = [...state.entries()].sort((a, b) => order[a[1]] - order[b[1]] || a[0].localeCompare(b[0]))
  for (const [file, status] of rows) {
    console.log(`${status.padEnd(11)} ${file}${status === 'missing' ? '  (required)' : ''}`)
  }
  const counts = { 'ok': 0, 'out-of-sync': 0, 'missing': 0 }
  for (const status of state.values()) counts[status]++
  console.log(`verify-translation-pairing: ${counts.ok} ok, ${counts['out-of-sync']} out-of-sync, ${counts.missing} missing (of ${state.size} in scope)`)
  process.exit(0)
}

if (errors.length === 0) {
  console.log(request.scope === 'pairs'
    ? `verify-translation-pairing: ${pairAnchors.size} named ${indexMode ? 'staged ' : ''}pair(s) consistent; the corpus-wide check still runs in doc-sync.`
    : `verify-translation-pairing: ${pairAnchors.size} pair(s) checked across all in-scope documentation, all consistent.`)
  process.exit(0)
}

console.error('verify-translation-pairing: bilingual pairing rules violated (see docs/i18n/README.md):')
for (const message of errors) console.error(`  ${message}`)
process.exit(1)
