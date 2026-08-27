/**
 * t04 — the t02 sweep over a workspace large enough to force compaction.
 *
 * Token profile: the compaction tradeoff. The same objective as t02 over ~6x
 * the content, so a run cannot finish inside one comfortable context. Reading
 * t02 and t04 together separates a harness's steady-state cost from what its
 * compaction, pruning, and spill policies cost when they actually engage.
 *
 * Compaction and surface replacement invalidate a provider's KV cache from the
 * first shadowed token, so this task can legitimately cost MORE per unit of
 * work than t02. That is the measurement, not a defect.
 */

import { materialize } from '../fixture.mjs'
import { verify as verifySweep } from '../t02-search-sweep/task.mjs'

export const spec = { modules: 90, linesPerModule: 24, seed: 20260830 }

/**
 * Materialize this task's workspace.
 * @param root - workspace directory to create.
 */
export function setup(root) {
  materialize(root, spec)
}

/**
 * Reuse the t02 oracle; the objective is identical and only the scale differs.
 * @param root - the workspace the run operated on.
 * @returns `{ pass, detail }`.
 */
export async function verify(root) {
  return verifySweep(root)
}
