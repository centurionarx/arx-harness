/**
 * One-time copy of the pre-rename harness home into the current one.
 *
 * The product renamed its home from `~/.cxh` to `~/.arx` without carrying the
 * data across, so an upgrading user booted against an empty home: their
 * settings document, managed credentials, profile patch layers, and sessions
 * were all still on disk and none of them were read. This module copies that
 * tree once, on the boot that finds the new home absent.
 *
 * It copies and never moves. The legacy directory is left exactly as it was,
 * so a user who upgrades, dislikes the result, and reinstalls the older build
 * still has their data; deleting it is theirs to do. The copy is staged beside
 * the destination and published with a single rename, so an interrupted or
 * failed copy never leaves a half-populated `$ARX_HOME` that the next boot
 * would mistake for a migrated one.
 * @module @arx-ai/arx-app-boot/home-migration
 */

import { cp, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  arxHomeDisplay, legacyArxHomeDisplay, resolveArxHome, resolveLegacyArxHome,
} from '@arx-ai/arx-home-paths'

/** Filename of the marker the migration writes into the home it creates. */
export const HOME_MIGRATION_MARKER = '.migrated-from.json'

/** Prefix of the staging directory a migration publishes from. */
const STAGING_PREFIX = '.migrating-'

/** What one completed migration did, in the display forms user-facing surfaces may show. */
export interface HomeMigrationReport {
  /** Symbolic name of the home the data came from (`~/.cxh` or `$CXH_HOME`). */
  fromDisplay: string
  /** Symbolic name of the home it was copied into (`~/.arx` or `$ARX_HOME`). */
  toDisplay: string
  /** When the copy was published, as an ISO-8601 instant. */
  at: string
  /** Version of the application that performed the copy. */
  appVersion: string
}

/** Options for {@link migrateLegacyHome}. */
export interface HomeMigrationOptions {
  /** Environment mapping used to resolve both homes. */
  env?: Record<string, string | undefined>
  /** Sink for the one-line notice a performed copy emits. */
  warn: (line: string) => void
  /** Application version recorded in the marker. */
  appVersion: string
  /** Clock for the marker's instant. */
  now?: () => Date
}

/**
 * Read the marker a previous migration left in a home.
 *
 * Absence is the ordinary answer for a home nothing migrated into, and a
 * marker that is unreadable or not a migration report is treated as absent:
 * the marker exists to tell a user what happened, and a damaged one must not
 * stop a boot.
 * @param home - the resolved harness home to read from.
 * @returns the recorded report, or `undefined` when there is none to read.
 */
export async function readHomeMigrationMarker(home: string): Promise<HomeMigrationReport | undefined> {
  let text: string
  try {
    text = await readFile(join(home, HOME_MIGRATION_MARKER), 'utf8')
  } catch {
    // Absent, unreadable, or a directory: all mean this home carries no report.
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Hand-edited or truncated: the boot proceeds without a notice.
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  const fields = ['fromDisplay', 'toDisplay', 'at', 'appVersion'] as const
  if (fields.some(field => typeof record[field] !== 'string')) return undefined
  return {
    fromDisplay: record['fromDisplay'] as string,
    toDisplay: record['toDisplay'] as string,
    at: record['at'] as string,
    appVersion: record['appVersion'] as string,
  }
}

/**
 * Whether a path exists, whatever kind of entry it is.
 * @param path - the absolute path to probe.
 * @returns true when `stat` resolves.
 */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    // Any stat failure means this boot cannot treat the path as present.
    return false
  }
}

/**
 * Remove staging directories a previous interrupted run left beside the home.
 *
 * Only this module's own prefix is considered, and failure is ignored: leftover
 * staging costs disk, while refusing to boot over it costs the user their
 * session.
 * @param home - the destination home whose siblings are scanned.
 */
async function clearStaleStaging(home: string): Promise<void> {
  const parent = dirname(home)
  const prefix = `${basename(home)}${STAGING_PREFIX}`
  let entries: string[]
  try {
    entries = await readdir(parent)
  } catch {
    // The parent of the home does not exist yet, so nothing was ever staged.
    return
  }
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue
    // Swallowed: a staging directory another process still holds costs disk,
    // while refusing to boot over it costs the user their session.
    /* v8 ignore next */
    await rm(join(parent, entry), { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Copy the legacy harness home into the current one, once.
 *
 * The current home existing is the whole idempotence rule: a second boot, an
 * interrupted first one, and a user who made `$ARX_HOME` by hand all take the
 * same branch and copy nothing. A boot that finds neither home has nothing to
 * migrate.
 * @param binName - diagnostic prefix on the notice and on failures.
 * @param options - environment, notice sink, version, and clock.
 * @returns the report of the copy this boot performed, or the one a previous
 * boot recorded; `undefined` when no migration has happened.
 * @throws when the legacy home is present and copying it fails, since booting
 * into an empty home would hide data the user still has.
 */
export async function migrateLegacyHome(
  binName: string,
  options: HomeMigrationOptions,
): Promise<HomeMigrationReport | undefined> {
  const env = options.env ?? process.env
  const to = resolveArxHome(undefined, env)
  if (await exists(to)) return readHomeMigrationMarker(to)

  const from = resolveLegacyArxHome(env)
  if (from === to) return undefined
  if (!await exists(from)) return undefined

  const fromDisplay = legacyArxHomeDisplay(from)
  const toDisplay = arxHomeDisplay(to)
  const report: HomeMigrationReport = {
    fromDisplay,
    toDisplay,
    at: (options.now?.() ?? new Date()).toISOString(),
    appVersion: options.appVersion,
  }

  await clearStaleStaging(to)
  let staging: string
  try {
    staging = await mkdtemp(`${to}${STAGING_PREFIX}`)
  } catch (error) {
    throw new Error(
      `${binName}: could not prepare a copy of ${fromDisplay} beside ${toDisplay}: ${String(error)}.`
      + ` Create ${toDisplay} yourself — an empty directory skips this copy — or set ARX_HOME elsewhere.`,
    )
  }
  try {
    // Symlinks cross as symlinks: a profile's flat module fallback is a tree of
    // them, and resolving each one would copy the whole installation into the
    // user's home.
    await cp(from, staging, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true })
    await writeFile(join(staging, HOME_MIGRATION_MARKER), `${JSON.stringify(report, undefined, 2)}\n`, 'utf8')
    // The one moment the destination appears. Until it lands, a concurrent or
    // retried boot still sees an absent home and stages its own copy.
    await rename(staging, to)
  } catch (error) {
    // Swallowed: cleanup failing after the copy already did adds nothing the
    // operator can act on; the error thrown below is what they must see.
    /* v8 ignore next */
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    throw new Error(
      `${binName}: could not copy ${fromDisplay} to ${toDisplay}: ${String(error)}.`
      + ` Create ${toDisplay} yourself — an empty directory skips this copy — or set ARX_HOME elsewhere.`,
    )
  }

  options.warn(
    `${binName}: copied your previous configuration from ${fromDisplay} to ${toDisplay}.`
    + ` ${fromDisplay} was left untouched; delete it once everything works.\n`,
  )
  return report
}
