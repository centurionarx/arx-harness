/**
 * Deterministic synthetic workspace generator shared by every benchmark task.
 *
 * Both harnesses must see byte-identical inputs, and a run must not inherit
 * state from the previous one, so each repetition materializes a fresh copy
 * from this generator rather than reusing a checkout. Content is derived from
 * a seeded linear congruential generator, never from `Math.random`, so the same
 * seed produces the same tree on every machine and every repetition.
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Seeded pseudo-random source (Numerical Recipes LCG parameters).
 * @param seed - initial state.
 * @returns a function returning successive integers in [0, 2^32).
 */
function lcg(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
}

const WORDS = [
  'parse', 'render', 'commit', 'resolve', 'encode', 'flush', 'merge', 'scan',
  'index', 'batch', 'digest', 'route', 'signal', 'window', 'buffer', 'token',
]

/**
 * Render one synthetic module with a stable, readable body.
 * @param index - module index, used in its exported names.
 * @param next - seeded integer source.
 * @param lines - approximate number of function bodies to emit.
 * @param buggy - emit the empty-input defect t01 asks the agent to repair.
 * @returns the module source text.
 */
function moduleSource(index, next, lines, buggy) {
  const parts = [`// Module ${index} of the synthetic benchmark workspace.\n`]
  for (let i = 0; i < lines; i += 1) {
    const verb = WORDS[next() % WORDS.length]
    const noun = WORDS[next() % WORDS.length]
    const n = next() % 97
    // The defect: reading element 0 before mapping throws on an empty array.
    // `input.map` alone would already return `[]`, which would let an unsolved
    // fixture pass t01's oracle.
    const body = buggy
      ? `  const base = input[0].valueOf()\n  const scale = ${n + 1}\n` +
        `  return input.map((value) => value * scale + base + ${i})\n`
      : `  const scale = ${n + 1}\n  return input.map((value) => value * scale + ${i})\n`
    parts.push(
      `export function ${verb}${noun[0].toUpperCase()}${noun.slice(1)}${index}_${i}(input) {\n` +
        body +
        `}\n`,
    )
  }
  return parts.join('\n')
}

/**
 * Materialize a synthetic workspace.
 *
 * @param root - directory to create; removed first when it already exists.
 * @param options - `modules`, `linesPerModule`, `seed`, and the optional
 * `bugModule` index whose functions throw on empty input.
 * @returns the absolute paths of the files written.
 */
export function materialize(root, options = {}) {
  const modules = options.modules ?? 12
  const linesPerModule = options.linesPerModule ?? 8
  const next = lcg(options.seed ?? 20260827)

  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, 'src'), { recursive: true })

  const written = []
  for (let i = 0; i < modules; i += 1) {
    const path = join(root, 'src', `mod${String(i).padStart(3, '0')}.js`)
    writeFileSync(path, moduleSource(i, next, linesPerModule, i === options.bugModule))
    written.push(path)
  }

  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'bench-fixture', version: '0.0.0', type: 'module', private: true }, null, 2)}\n`,
  )
  written.push(join(root, 'package.json'))
  return written
}
