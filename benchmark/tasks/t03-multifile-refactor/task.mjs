/**
 * t03 — mechanical refactor across every module.
 *
 * Token profile: history growth. The edit is trivial per file but must be
 * repeated many times, so accumulated tool calls and results are resent on
 * every step. This is where a multi-step turn's resend cost shows up.
 */

import { materialize } from '../fixture.mjs'
import { exportManifest } from '../exports.mjs'

export const spec = { modules: 16, linesPerModule: 6, seed: 20260829 }

/** Export names captured before the run, keyed by module filename. */
let baseline = null

/**
 * Materialize this task's workspace and record its pre-run export names.
 * @param root - workspace directory to create.
 */
export function setup(root) {
  materialize(root, spec)
  baseline = exportManifest(root)
}

/**
 * Check every export gained the suffix and none were lost.
 * @param root - the workspace the run operated on.
 * @returns `{ pass, detail }`.
 */
export async function verify(root) {
  if (baseline === null) return { pass: false, detail: 'verify called without setup' }
  const after = exportManifest(root)

  let renamed = 0
  for (const [file, names] of Object.entries(baseline)) {
    const got = after[file]
    if (got === undefined) return { pass: false, detail: `${file} disappeared` }
    if (got.length !== names.length) {
      return { pass: false, detail: `${file} has ${got.length} exports, expected ${names.length}` }
    }
    for (const name of got) {
      if (!name.endsWith('V2')) return { pass: false, detail: `${file} still exports ${name}` }
      renamed += 1
    }
    // A rename must preserve identity: stripping the suffix must recover the
    // original set, so a wholesale rewrite cannot pass by emitting new names.
    const stripped = got.map((n) => n.slice(0, -2)).sort().join(',')
    if (stripped !== names.join(',')) {
      return { pass: false, detail: `${file} renamed functions to unrelated names` }
    }
  }
  return { pass: true, detail: `${renamed} exports renamed` }
}
