/** Canonical paths, parsing, and rendering for bilingual pairing records. */

import { basename } from 'node:path'

/** The accepted counterpart suffixes of the bilingual corpus. */
export type CounterpartSuffix = '.pt-BR.md'

/** All counterpart suffixes the pairing machinery accepts. */
export const COUNTERPART_SUFFIXES: readonly CounterpartSuffix[] = ['.pt-BR.md']

/** The three repository-relative paths that form one bilingual pair. */
export interface TranslationPairPaths {
  /** English document path. */
  source: string
  /** Translated counterpart path (Simplified Chinese or Brazilian Portuguese). */
  counterpart: string
  /** Generated consistency-record path. */
  meta: string
}

/** The two content hashes recorded for a bilingual pair. */
export interface TranslationPairingRecord {
  /** Git blob hash of the English document. */
  sourceHash: string
  /** Git blob hash of the translated counterpart. */
  counterpartHash: string
}

const META_LINE = /^([^:#]+\.md): ([0-9a-f]{40})$/

/**
 * Derive the counterpart and consistency-record paths from an English document.
 *
 * @param source - Repository-relative English Markdown path.
 * @param counterpartSuffix - Counterpart suffix; defaults to the Simplified
 *   Chinese corpus. Callers resolve which suffix exists on disk before recording.
 * @returns The complete three-path pair.
 */
export function translationPairPaths(
  source: string,
  counterpartSuffix: CounterpartSuffix = '.pt-BR.md',
): TranslationPairPaths {
  if (!source.endsWith('.md') || COUNTERPART_SUFFIXES.some(suffix => source.endsWith(suffix))) {
    throw new Error(`expected an English Markdown path, received ${JSON.stringify(source)}`)
  }
  return {
    source,
    counterpart: source.replace(/\.md$/, counterpartSuffix),
    meta: source.replace(/\.md$/, '.i18n.yaml'),
  }
}

/**
 * Read the counterpart suffix a consistency record confirms, from the one key
 * that is not the English source's basename. Merges need this because the
 * sidecar path alone does not identify the counterpart language.
 *
 * @param content - Complete sidecar text.
 * @param source - Repository-relative English Markdown path.
 * @returns The recorded counterpart suffix, or `undefined` for a malformed record.
 */
export function counterpartSuffixFromRecord(content: string, source: string): CounterpartSuffix | undefined {
  const sourceBase = basename(source)
  for (const line of content.split('\n')) {
    const match = META_LINE.exec(line)
    const key = match?.[1]
    if (key === undefined || key === sourceBase) continue
    return COUNTERPART_SUFFIXES.find(suffix => key.endsWith(suffix))
  }
  return undefined
}

/**
 * Parse a consistency record for its expected sibling names.
 *
 * @param content - Complete sidecar text.
 * @param paths - Expected sibling paths.
 * @returns The two hashes, or `undefined` for malformed, duplicate, or unexpected keys.
 */
export function parseTranslationPairingRecord(
  content: string,
  paths: TranslationPairPaths,
): TranslationPairingRecord | undefined {
  const hashes = new Map<string, string>()
  for (const line of content.split('\n')) {
    if (line === '' || line.startsWith('#')) continue
    const match = META_LINE.exec(line)
    if (!match?.[1] || !match[2] || hashes.has(match[1])) return undefined
    hashes.set(match[1], match[2])
  }
  const sourceHash = hashes.get(basename(paths.source))
  const counterpartHash = hashes.get(basename(paths.counterpart))
  if (hashes.size !== 2 || sourceHash === undefined || counterpartHash === undefined) return undefined
  return { sourceHash, counterpartHash }
}

/**
 * Render the canonical consistency record for a pair.
 *
 * @param paths - Pair paths written into the record and its recovery command.
 * @param record - Confirmed content hashes.
 * @returns Canonical YAML text with exactly one trailing newline.
 */
export function renderTranslationPairingRecord(
  paths: TranslationPairPaths,
  record: TranslationPairingRecord,
): string {
  return [
    '# Bilingual-pair consistency record (docs/i18n/README.md): the git blob hash of each',
    '# side as of the last confirmed-consistent state. Both languages carry equal authority;',
    '# after editing either side, bring the other along and re-record with:',
    `#   pnpm run verify-translation-pairing --write ${paths.source}`,
    `${basename(paths.source)}: ${record.sourceHash}`,
    `${basename(paths.counterpart)}: ${record.counterpartHash}`,
    '',
  ].join('\n')
}
