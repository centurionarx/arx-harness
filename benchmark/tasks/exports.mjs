/**
 * Shared oracle helper: the exported function names of a synthetic workspace.
 *
 * Oracles compute the expected answer from the fixture itself rather than from
 * a committed golden file, so a fixture parameter change cannot leave a stale
 * expectation silently passing.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Collect exported function names per module.
 * @param root - workspace root containing `src/`.
 * @returns a mapping of module filename to its sorted exported function names.
 */
export function exportManifest(root) {
  const src = join(root, 'src')
  const manifest = {}
  for (const file of readdirSync(src).sort()) {
    if (!file.endsWith('.js')) continue
    const text = readFileSync(join(src, file), 'utf8')
    const names = [...text.matchAll(/export function (\w+)\s*\(/g)].map((m) => m[1])
    manifest[file] = names.sort()
  }
  return manifest
}
