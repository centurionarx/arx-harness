/** Resolve materialized files without allowing traversal outside their cache root. */

import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Resolve a cache entry and reject paths outside its containing directory.
 * @param root - Directory that owns the cache entry.
 * @param path - Relative cache entry path.
 * @returns Absolute path contained by the root.
 */
export function safeJoin(root: string, path: string): string {
  const base = resolve(root)
  const target = resolve(base, path)
  const child = relative(base, target)
  if (child === '' || (!child.startsWith('..' + sep) && child !== '..' && !isAbsolute(child))) return target
  throw new TypeError('skill-git path escapes its cache root')
}
