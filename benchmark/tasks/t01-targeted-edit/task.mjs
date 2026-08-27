/**
 * t01 — targeted single-file edit.
 *
 * Token profile: the floor. One small file, few tool calls, so the run is
 * dominated by fixed per-request cost (system prompt plus tool schemas) rather
 * than by accumulated history. This is the task that exposes a harness's
 * baseline overhead.
 */

import { materialize } from '../fixture.mjs'
import { exportManifest } from '../exports.mjs'

export const spec = { modules: 12, linesPerModule: 8, seed: 20260827, bugModule: 3 }

/**
 * Materialize this task's workspace.
 * @param root - workspace directory to create.
 */
export function setup(root) {
  materialize(root, spec)
}

/**
 * Check that mod003's exports short-circuit on an empty array while other
 * modules are untouched.
 * @param root - the workspace the run operated on.
 * @returns `{ pass, detail }`.
 */
export async function verify(root) {
  const before = exportManifest(root)
  const mod = await import(`${root}/src/mod003.js?t=${Date.now()}`)
  const names = before['mod003.js']
  if (names.length === 0) return { pass: false, detail: 'mod003.js exports nothing' }

  for (const name of names) {
    const fn = mod[name]
    if (typeof fn !== 'function') return { pass: false, detail: `${name} is no longer exported` }
    let empty
    try {
      empty = fn([])
    } catch (error) {
      return { pass: false, detail: `${name}([]) still throws: ${error.message}` }
    }
    if (!Array.isArray(empty) || empty.length !== 0) {
      return { pass: false, detail: `${name}([]) did not return an empty array` }
    }
    let some
    try {
      some = fn([1, 2, 3])
    } catch (error) {
      return { pass: false, detail: `${name}([1,2,3]) now throws: ${error.message}` }
    }
    if (!Array.isArray(some) || some.length !== 3) {
      return { pass: false, detail: `${name}([1,2,3]) no longer returns 3 elements` }
    }
  }

  const pristine = exportManifest(root)
  for (const [file, exported] of Object.entries(pristine)) {
    if (file === 'mod003.js') continue
    if (exported.join(',') !== before[file].join(',')) {
      return { pass: false, detail: `${file} was modified but should not have been` }
    }
  }
  return { pass: true, detail: `${names.length} exports guarded` }
}
