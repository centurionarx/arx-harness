/**
 * Shared filesystem path helpers for arx Harness user data.
 *
 * @module @arx-ai/arx-home-paths
 */

import { opendir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/** Directory name for the default arx Harness home under the OS home. */
export const ARX_HOME_DIR_NAME = '.arx'

/** Stable user-facing display form for the default arx Harness home. */
export const DEFAULT_ARX_HOME_DISPLAY = `~/${ARX_HOME_DIR_NAME}`

/** Environment variable that overrides the default arx Harness home. */
export const ARX_HOME_ENV = 'ARX_HOME'

/**
 * The home this product wrote before it was named arx.
 *
 * Kept so a one-time copy can find data a user already has. It is not a
 * fallback: nothing resolves reads or writes here, and no other product's home
 * belongs in this constant — a directory written by a differently-composed
 * harness holds settings namespaces this one does not own.
 */
export const LEGACY_ARX_HOME = {
  /** Environment variable that overrode the legacy home. */
  env: 'CXH_HOME',
  /** Directory name the legacy home took under the OS home. */
  dirName: '.cxh',
  /** Stable user-facing display form for the default legacy home. */
  display: '~/.cxh',
} as const

/**
 * Give a native filesystem watcher one canonical spelling of a path, even
 * when its final components do not exist yet. The deepest existing ancestor
 * is resolved through {@link realpath}; when a suffix is missing, that
 * ancestor is also proved to be an enumerable directory before the suffix is
 * restored. This prevents Windows from treating a regular-file ancestor as
 * ordinary absence, and prevents short-name aliases from being mixed with
 * long paths emitted by the native watcher backend.
 * @param path - Watch target or root, resolved against the current directory.
 * @returns the target with its existing ancestor canonicalized.
 * @throws when ancestor traversal encounters an error other than absence, or
 * the existing ancestor of a missing suffix is not an enumerable directory.
 */
export async function canonicalizeWatchPath(path: string): Promise<string> {
  let current = resolve(path)
  const missing: string[] = []
  while (true) {
    try {
      const canonical = await realpath(current)
      if (missing.length > 0) {
        // A Windows file-as-parent probe reports ENOENT. Opening the resolved
        // ancestor preserves the cross-platform directory requirement.
        const directory = await opendir(canonical)
        await directory.close()
      }
      return join(canonical, ...missing.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      /* v8 ignore next -- a filesystem root exists, so traversal resolves before this guard */
      if (parent === current) throw error
      missing.push(basename(current))
      current = parent
    }
  }
}

/**
 * Resolve the default arx Harness home using Node's platform path rules.
 * @returns the absolute default harness home path.
 */
export function defaultArxHome(): string {
  return join(homedir(), ARX_HOME_DIR_NAME)
}

/**
 * Expand supported tilde prefixes against the operating-system home.
 * @param path - configured path that may begin with `~`, `~/`, or `~\`.
 * @returns the expanded path, or the original value when no supported prefix is present.
 */
export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the single-root arx Harness home.
 *
 * Precedence, highest first: an explicit configured path, `$ARX_HOME`, then
 * `~/.arx`. The harness keeps all user data under one root. An empty or
 * whitespace-only `$ARX_HOME` is treated as unset, so a blank override never
 * resolves the home to the current working directory.
 * @param configured - explicit harness-home override, which has highest precedence.
 * @param env - environment mapping used to read `ARX_HOME`.
 * @returns the normalized absolute harness home path.
 */
export function resolveArxHome(configured?: string, env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env[ARX_HOME_ENV]
  const selected = configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : defaultArxHome())
  return resolve(expandHomePath(selected))
}

/**
 * Resolve where this product kept user data before it was named arx.
 *
 * It follows {@link resolveArxHome}'s precedence over the legacy names, so a
 * user who pointed `$CXH_HOME` somewhere is found there rather than at
 * `~/.cxh`. Resolving a path says nothing about whether it exists.
 * @param env - environment mapping used to read `CXH_HOME`.
 * @returns the normalized absolute legacy home path.
 */
export function resolveLegacyArxHome(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env[LEGACY_ARX_HOME.env]
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0
    ? fromEnv
    : join(homedir(), LEGACY_ARX_HOME.dirName)
  return resolve(expandHomePath(selected))
}

/**
 * Describe a resolved legacy home symbolically for user-facing display.
 * @param resolvedHome - the absolute path returned by {@link resolveLegacyArxHome}.
 * @returns `~/.cxh` for the default legacy home, otherwise `$CXH_HOME`.
 */
export function legacyArxHomeDisplay(resolvedHome: string): string {
  return resolvedHome === resolve(join(homedir(), LEGACY_ARX_HOME.dirName))
    ? LEGACY_ARX_HOME.display
    : `$${LEGACY_ARX_HOME.env}`
}

/**
 * Join path segments onto the resolved arx Harness home.
 * @param segments - path segments appended to the Harness home; an empty list returns the home itself.
 * @returns the normalized absolute joined path.
 */
export function arxHomePath(...segments: string[]): string {
  return join(resolveArxHome(), ...segments)
}

/**
 * Describe a resolved harness home symbolically for user-facing display.
 *
 * It never returns an absolute machine path: the default home is labelled
 * `~/.arx`, and any configured home is labelled `$ARX_HOME`.
 * @param resolvedHome - the absolute path returned by {@link resolveArxHome}.
 * @returns `~/.arx` for the default home, otherwise `$ARX_HOME`.
 */
export function arxHomeDisplay(resolvedHome: string): string {
  return resolvedHome === resolve(defaultArxHome()) ? DEFAULT_ARX_HOME_DISPLAY : `$${ARX_HOME_ENV}`
}
