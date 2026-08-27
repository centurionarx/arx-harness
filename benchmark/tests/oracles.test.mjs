/**
 * Oracle discrimination tests.
 *
 * A benchmark whose oracle passes an untouched workspace measures nothing, so
 * each task must be shown to REJECT the unsolved fixture and to ACCEPT a
 * correct solution. These run without an API key and touch no harness.
 */

import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportManifest } from '../tasks/exports.mjs'

const TASKS = ['t01-targeted-edit', 't02-search-sweep', 't03-multifile-refactor', 't04-long-context']

/**
 * Create an isolated workspace directory.
 * @returns the new directory path.
 */
function workspace() {
  return mkdtempSync(join(tmpdir(), 'cxh-bench-test-'))
}

/** Solve t01 by guarding every export in mod003 against an empty input. */
function solveT01(root) {
  const path = join(root, 'src', 'mod003.js')
  const text = readFileSync(path, 'utf8')
  writeFileSync(path, text.replaceAll('(input) {\n', '(input) {\n  if (input.length === 0) return []\n'))
}

/** Solve t02/t04 by writing the manifest the task asks for. */
function solveSweep(root) {
  writeFileSync(join(root, 'manifest.json'), `${JSON.stringify(exportManifest(root), null, 2)}\n`)
}

/** Solve t03 by suffixing every exported function name. */
function solveT03(root) {
  for (const file of Object.keys(exportManifest(root))) {
    const path = join(root, 'src', file)
    const text = readFileSync(path, 'utf8')
    writeFileSync(path, text.replace(/export function (\w+)\s*\(/g, 'export function $1V2('))
  }
}

const SOLVERS = {
  't01-targeted-edit': solveT01,
  't02-search-sweep': solveSweep,
  't03-multifile-refactor': solveT03,
  't04-long-context': solveSweep,
}

let failures = 0

/**
 * Report one assertion.
 * @param name - assertion label.
 * @param ok - whether it held.
 * @param detail - context printed on failure.
 */
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

for (const id of TASKS) {
  console.log(`\n${id}`)
  const task = await import(`../tasks/${id}/task.mjs`)

  const unsolved = workspace()
  task.setup(unsolved)
  const before = await task.verify(unsolved)
  check('rejects the unsolved fixture', before.pass === false, `-> ${before.detail}`)
  rmSync(unsolved, { recursive: true, force: true })

  const solved = workspace()
  task.setup(solved)
  SOLVERS[id](solved)
  const after = await task.verify(solved)
  check('accepts a correct solution', after.pass === true, `-> ${after.detail}`)
  rmSync(solved, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nall oracle tests passed' : `\n${failures} oracle test(s) failed`)
process.exit(failures === 0 ? 0 : 1)
