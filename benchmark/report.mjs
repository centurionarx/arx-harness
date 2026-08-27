#!/usr/bin/env node
/**
 * Aggregate benchmark result files into a comparison table.
 *
 * Usage: node benchmark/report.mjs results/controlled-*.json
 *
 * Two rules govern what this reports:
 *
 * - Only PASSING runs enter the token comparison. A harness that gives up early
 *   spends few tokens; counting that as economy would invert the result. Pass
 *   rates are reported beside the tokens so a cheap-but-failing arm is visible.
 * - A cross-harness ratio is headline-worthy only when both sides ran the same
 *   model. Token counts are tokenizer-dependent, so an as-shipped comparison
 *   measures two tokenizers as well as two harnesses; it is printed with that
 *   warning attached rather than suppressed.
 */

import { readFileSync } from 'node:fs'

/**
 * Median of a numeric sample.
 * @param values - sample; may be empty.
 * @returns the median, or `null` for an empty sample.
 */
function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Interquartile range, the spread this report uses instead of a standard
 * deviation because agent runs are not normally distributed.
 * @param values - sample.
 * @returns `q3 - q1`, or `null` for an empty sample.
 */
function iqr(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
  return q(0.75) - q(0.25)
}

/**
 * Format a token count for the table.
 * @param n - value, possibly null.
 * @returns a grouped string, or `—`.
 */
function fmt(n) {
  return n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-US')
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node benchmark/report.mjs <results.json> [...]')
  process.exit(2)
}

const runs = []
let arm = null
for (const file of files) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  arm = arm ?? parsed.arm
  if (parsed.arm !== arm) {
    console.error(`refusing to merge arm ${parsed.arm} with ${arm}; report each arm separately`)
    process.exit(2)
  }
  runs.push(...parsed.results)
}

const tasks = [...new Set(runs.map((r) => r.task))].sort()
const harnesses = [...new Set(runs.map((r) => r.harness))].sort()
const models = new Map()
for (const run of runs) {
  if (run.model) models.set(run.harness, new Set([...(models.get(run.harness) ?? []), run.model]))
}

console.log(`\n# Benchmark report — ${arm} arm\n`)
console.log(`Runs: ${runs.length}  ·  Tasks: ${tasks.length}  ·  Harnesses: ${harnesses.join(', ')}\n`)

for (const [harness, set] of models) console.log(`- ${harness}: ${[...set].join(', ')}`)

const distinctModels = new Set([...models.values()].flatMap((s) => [...s]))
if (arm !== 'controlled' && distinctModels.size > 1) {
  console.log(
    '\n> WARNING: the harnesses ran different models. Token counts come from different\n' +
      '> tokenizers, so the ratios below are NOT a measure of harness architecture alone.\n' +
      '> Use `--arm controlled` for that claim.',
  )
}

console.log('\n## Per task (passing runs only)\n')
console.log('| task | harness | n | pass rate | total tokens (median) | IQR | billed input | output | requests | cache hit |')
console.log('|---|---|---|---|---|---|---|---|---|---|')

const medians = new Map()
for (const task of tasks) {
  for (const harness of harnesses) {
    const all = runs.filter((r) => r.task === task && r.harness === harness)
    const passing = all.filter((r) => r.outcome === 'pass')
    const totals = passing.map((r) => r.totalTokens)
    const med = median(totals)
    medians.set(`${task}|${harness}`, med)
    const passRate = all.length === 0 ? '—' : `${passing.length}/${all.length}`
    const cache = passing.length === 0 ? null : median(passing.map((r) => r.cacheHitRatio))
    console.log(
      `| ${task} | ${harness} | ${passing.length} | ${passRate} | ${fmt(med)} | ${fmt(iqr(totals))} | ` +
        `${fmt(median(passing.map((r) => r.billedInput)))} | ${fmt(median(passing.map((r) => r.tokens.output)))} | ` +
        `${fmt(median(passing.map((r) => r.requests)))} | ${cache === null ? '—' : `${(cache * 100).toFixed(1)}%`} |`,
    )
  }
}

if (harnesses.length === 2) {
  const [a, b] = harnesses
  console.log(`\n## Ratio (${a} ÷ ${b}), median total tokens on passing runs\n`)
  console.log('| task | ratio | reading |')
  console.log('|---|---|---|')
  for (const task of tasks) {
    const left = medians.get(`${task}|${a}`)
    const right = medians.get(`${task}|${b}`)
    if (left === null || right === null || right === 0) {
      console.log(`| ${task} | — | insufficient passing runs |`)
      continue
    }
    const ratio = left / right
    const reading = ratio < 1 ? `${a} spent ${((1 - ratio) * 100).toFixed(0)}% fewer` : `${a} spent ${((ratio - 1) * 100).toFixed(0)}% more`
    console.log(`| ${task} | ${ratio.toFixed(2)}× | ${reading} |`)
  }
}

const warned = runs.filter((r) => r.warnings.length > 0)
if (warned.length > 0) {
  console.log(`\n## Warnings (${warned.length} run(s))\n`)
  for (const run of warned.slice(0, 20)) {
    console.log(`- ${run.harness}/${run.task}/rep${run.rep}: ${run.warnings.join('; ')}`)
  }
}

const perRep = runs.filter((r) => r.outcome === 'pass').length
if (perRep < runs.length) {
  console.log(`\nNote: ${runs.length - perRep} of ${runs.length} run(s) did not pass and are excluded from the token medians.`)
}
