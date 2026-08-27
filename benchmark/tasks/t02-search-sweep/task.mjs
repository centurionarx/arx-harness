/**
 * t02 — search sweep over the whole workspace.
 *
 * Token profile: tool-result volume. The agent must read or grep every module,
 * so results dominate the request. This is the task where output spilling and
 * tool-result pruning either pay for themselves or do not.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { materialize } from '../fixture.mjs'
import { exportManifest } from '../exports.mjs'

export const spec = { modules: 24, linesPerModule: 10, seed: 20260828 }

/**
 * Materialize this task's workspace.
 * @param root - workspace directory to create.
 */
export function setup(root) {
  materialize(root, spec)
}

/**
 * Compare the produced manifest against one recomputed from the fixture.
 * @param root - the workspace the run operated on.
 * @returns `{ pass, detail }`.
 */
export async function verify(root) {
  const expected = exportManifest(root)
  let actual
  try {
    actual = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  } catch (error) {
    return { pass: false, detail: `manifest.json missing or invalid: ${error.message}` }
  }

  const expectedKeys = Object.keys(expected).sort()
  const actualKeys = Object.keys(actual).sort()
  if (expectedKeys.join(',') !== actualKeys.join(',')) {
    const missing = expectedKeys.filter((k) => !actualKeys.includes(k))
    const extra = actualKeys.filter((k) => !expectedKeys.includes(k))
    return { pass: false, detail: `key mismatch (missing: ${missing.length}, extra: ${extra.length})` }
  }
  for (const key of expectedKeys) {
    const want = expected[key].join(',')
    const got = Array.isArray(actual[key]) ? [...actual[key]].sort().join(',') : String(actual[key])
    if (want !== got) return { pass: false, detail: `${key} lists the wrong exports` }
  }
  return { pass: true, detail: `${expectedKeys.length} modules manifested` }
}
