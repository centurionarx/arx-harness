#!/usr/bin/env node
/**
 * Benchmark orchestrator: run each task on each harness and record normalized
 * token accounting.
 *
 * Dry run is the DEFAULT. Nothing is executed and no API call is made until
 * `--execute` is passed, so the plan can be reviewed first.
 *
 * Usage:
 *   node benchmark/run.mjs --arm controlled --tasks t01,t02 --reps 3
 *   node benchmark/run.mjs --arm controlled --reps 3 --execute
 *
 * Repetitions interleave the harnesses (cxh, claude-code, cxh, ...) rather than
 * running one harness to completion first. Provider-side cache warmth and
 * transient API conditions drift over minutes; interleaving spreads that drift
 * across both arms instead of giving it entirely to whichever ran second.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractClaudeCode } from './lib/extract-claude-code.mjs'
import { extractCxh } from './lib/extract-cxh.mjs'
import { assertRun, makeRun } from './lib/normalize.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))
const ALL_TASKS = ['t01-targeted-edit', 't02-search-sweep', 't03-multifile-refactor', 't04-long-context']

/**
 * Parse `--flag value` and `--flag` arguments.
 * @param argv - raw process arguments after the script name.
 * @returns a flag dictionary.
 */
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else {
      out[key] = next
      i += 1
    }
  }
  return out
}

/**
 * Build the command for one harness run.
 *
 * @param harness - `cxh` or `claude-code`.
 * @param arm - `controlled` (one shared model) or `as-shipped` (each default).
 * @param prompt - the task text.
 * @param sessionRoot - per-run cxh persistence root.
 * @returns `{ command, args, env }` ready for spawn.
 */
function buildCommand(harness, arm, prompt, sessionRoot) {
  if (harness === 'cxh') {
    const patches = ['--patch', join(ROOT, 'profiles', 'bench-common.patch.yml')]
    if (arm === 'controlled') patches.push('--patch', join(ROOT, 'profiles', 'bench-anthropic.patch.yml'))
    return {
      command: 'pnpm',
      // Launcher flags must precede app arguments: the first token the launcher
      // does not recognize starts the inner arguments.
      args: ['cxh', '--profile', 'headless', ...patches, prompt],
      env: { CXH_BENCH_SESSION_ROOT: sessionRoot, CXH_BENCH_MODEL: process.env.CXH_BENCH_MODEL ?? '' },
    }
  }
  const args = ['-p', prompt]
  if (arm === 'controlled' && process.env.CXH_BENCH_MODEL) args.push('--model', process.env.CXH_BENCH_MODEL)
  return { command: 'claude', args, env: {} }
}

/**
 * Locate the single session log a cxh run wrote under its private root.
 * @param sessionRoot - the per-run persistence root.
 * @returns the log path, or `null` when the run wrote none.
 */
function findCxhLog(sessionRoot) {
  const candidates = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.startsWith('session.jsonl')) candidates.push(path)
    }
  }
  try {
    walk(sessionRoot)
  } catch {
    // An absent root means the run never materialized a session; the caller
    // reports that as an error outcome rather than crashing the sweep.
    return null
  }
  return candidates.length === 1 ? candidates[0] : null
}

/**
 * Locate the Claude Code transcript for a workspace, newest first.
 * @param workspace - the directory the run used as its cwd.
 * @param startedAt - epoch ms before the run began; older transcripts are ignored.
 * @returns the transcript path, or `null` when none was written.
 */
function findClaudeTranscript(workspace, startedAt) {
  const slug = workspace.replaceAll('/', '-').replaceAll('.', '-')
  const dir = join(process.env.HOME ?? '', '.claude', 'projects', slug)
  try {
    const found = readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
      .filter((f) => f.mtime >= startedAt)
      .sort((a, b) => b.mtime - a.mtime)
    return found[0]?.path ?? null
  } catch {
    // No project directory means the harness never wrote a transcript here.
    return null
  }
}

/**
 * Execute one (task, harness, rep) cell and extract its accounting.
 *
 * @param cell - `{ task, harness, arm, rep, execute, timeoutMs }`.
 * @returns a normalized run record.
 */
async function runCell(cell) {
  const { task, harness, arm, rep, execute, timeoutMs } = cell
  const module = await import(join(ROOT, 'tasks', task, 'task.mjs'))
  const prompt = readFileSync(join(ROOT, 'tasks', task, 'TASK.md'), 'utf8').trim()

  const workspace = mkdtempSync(join(tmpdir(), `cxh-bench-${task}-`))
  const sessionRoot = mkdtempSync(join(tmpdir(), 'cxh-bench-sessions-'))
  module.setup(workspace)

  const { command, args, env } = buildCommand(harness, arm, prompt, sessionRoot)

  if (!execute) {
    rmSync(workspace, { recursive: true, force: true })
    rmSync(sessionRoot, { recursive: true, force: true })
    return { plan: { task, harness, arm, rep, cwd: workspace, command, args, env } }
  }

  const startedAt = Date.now()
  const proc = spawnSync(command, args, {
    cwd: workspace,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: timeoutMs,
    // `pnpm cxh` resolves through the repo's workspace scripts.
    shell: false,
  })
  const wallMs = Date.now() - startedAt

  const warnings = []
  if (proc.error) warnings.push(`spawn failed: ${proc.error.message}`)
  if (proc.status !== 0) warnings.push(`exit status ${proc.status}`)

  let extracted = { tokens: undefined, requests: 0, toolCalls: 0, models: [], warnings: [] }
  const logPath =
    harness === 'cxh' ? findCxhLog(sessionRoot) : findClaudeTranscript(workspace, startedAt)
  if (logPath === null) warnings.push('no session log found; token accounting unavailable')
  else extracted = harness === 'cxh' ? extractCxh(logPath) : extractClaudeCode(logPath)

  let outcome = 'error'
  let detail = 'not verified'
  if (logPath !== null) {
    try {
      const verdict = await module.verify(workspace)
      outcome = verdict.pass ? 'pass' : 'fail'
      detail = verdict.detail
    } catch (error) {
      detail = `oracle threw: ${error.message}`
    }
  }

  const run = makeRun({
    harness,
    arm,
    task,
    rep,
    model: extracted.models[0] ?? null,
    outcome,
    requests: extracted.requests,
    toolCalls: extracted.toolCalls,
    wallMs,
    tokens: extracted.tokens,
    warnings: [...warnings, ...extracted.warnings],
  })
  assertRun(run)

  rmSync(workspace, { recursive: true, force: true })
  rmSync(sessionRoot, { recursive: true, force: true })
  return { ...run, detail }
}

const flags = parseArgs(process.argv.slice(2))
const arm = flags.arm ?? 'as-shipped'
const tasks = flags.tasks === undefined ? ALL_TASKS : String(flags.tasks).split(',').map((t) => t.trim())
const reps = Number(flags.reps ?? 3)
const harnesses = (flags.harness === undefined ? 'cxh,claude-code' : String(flags.harness))
  .split(',')
  .map((h) => h.trim())
const execute = flags.execute === true
const timeoutMs = Number(flags.timeout ?? 900_000)

if (!['controlled', 'as-shipped'].includes(arm)) {
  console.error(`--arm must be controlled or as-shipped, got ${arm}`)
  process.exit(2)
}
if (arm === 'controlled' && !process.env.CXH_BENCH_MODEL) {
  console.error('the controlled arm needs CXH_BENCH_MODEL set to the shared model id')
  process.exit(2)
}
for (const task of tasks) {
  if (!ALL_TASKS.includes(task)) {
    console.error(`unknown task ${task}; known: ${ALL_TASKS.join(', ')}`)
    process.exit(2)
  }
}

const results = []
const plans = []
for (let rep = 0; rep < reps; rep += 1) {
  for (const task of tasks) {
    // Interleaved on purpose: both harnesses see the same slice of wall time.
    for (const harness of harnesses) {
      const cell = await runCell({ task, harness, arm, rep, execute, timeoutMs })
      if (cell.plan) {
        plans.push(cell.plan)
        continue
      }
      results.push(cell)
      const total = cell.totalTokens.toLocaleString('en-US')
      console.log(
        `${harness.padEnd(12)} ${task.padEnd(24)} rep ${rep} ${cell.outcome.padEnd(5)} ` +
          `${total.padStart(12)} tokens  ${cell.requests} req  ${cell.detail}`,
      )
    }
  }
}

if (!execute) {
  console.log(`\nDRY RUN — ${plans.length} cell(s) planned, nothing executed.\n`)
  for (const plan of plans) {
    const env = Object.entries(plan.env)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
    console.log(`# ${plan.harness} / ${plan.task} / rep ${plan.rep}  (cwd: fresh temp workspace)`)
    console.log(`${env ? `${env} ` : ''}${plan.command} ${plan.args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}\n`)
  }
  console.log('Re-run with --execute to perform these runs.')
  process.exit(0)
}

const outPath = flags.out ?? join(ROOT, 'results', `${arm}-${Date.now()}.json`)
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, `${JSON.stringify({ arm, reps, tasks, harnesses, results }, null, 2)}\n`)
console.log(`\nwrote ${results.length} run(s) to ${outPath}`)
console.log(`aggregate with: node benchmark/report.mjs ${outPath}`)
