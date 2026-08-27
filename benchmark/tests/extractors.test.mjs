/**
 * Extractor tests over hand-built transcripts.
 *
 * The fixtures encode the two structures that make naive summing wrong: a
 * Claude Code response split across several records that repeat one `usage`
 * object, and a cxh log mixing packed chunk rows, an auxiliary compaction call,
 * and a step whose adapter reported no usage.
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { extractClaudeCode } from '../lib/extract-claude-code.mjs'
import { extractCxh } from '../lib/extract-cxh.mjs'
import { billedInput, totalTokens } from '../lib/normalize.mjs'

const here = dirname(fileURLToPath(import.meta.url))
let failures = 0

/**
 * Report one assertion.
 * @param name - assertion label.
 * @param actual - observed value.
 * @param expected - required value.
 */
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) console.log(`  ok   ${name}`)
  else {
    failures += 1
    console.log(`  FAIL ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
  }
}

console.log('\nclaude-code extractor')
const cc = extractClaudeCode(join(here, 'fixtures', 'claude-code.jsonl'))
// req_1 spans three records but is one billed request.
eq('dedupes records sharing a requestId', cc.requests, 3)
eq('counts tool_use across all records', cc.toolCalls, 3)
eq('sums cache reads once per request', cc.tokens.cacheRead, 1000 + 2000 + 500)
eq('sums output once per request', cc.tokens.output, 50 + 7 + 9)
eq('reports thinking tokens', cc.tokens.reasoning, 20)
eq('flags sidechain requests', cc.sidechainRequests, 1)
eq('emits no warnings on a well-formed transcript', cc.warnings, [])
eq('billed input is the disjoint sum', billedInput(cc.tokens), 9 + 100 + 3500)

const ccNoSide = extractClaudeCode(join(here, 'fixtures', 'claude-code.jsonl'), { includeSidechain: false })
eq('excludes sidechain on request', ccNoSide.requests, 2)
eq('excludes sidechain cache reads', ccNoSide.tokens.cacheRead, 3000)

console.log('\ncxh extractor')
const cx = extractCxh(join(here, 'fixtures', 'cxh-session.jsonl'))
eq('counts only usage-bearing assistant messages', cx.requests, 1)
eq('counts the compaction call separately', cx.auxRequests, 1)
eq('counts tool/call events', cx.toolCalls, 2)
eq('includes auxiliary usage in the totals', cx.tokens.inputUncached, 40 + 300)
eq('sums output across main and auxiliary', cx.tokens.output, 60 + 80)
eq('reads the route from request/header', cx.models, ['deepseek-official/deepseek-v4-flash'])
eq('warns about the unpriced step', cx.warnings.length, 1)
eq('total is billed input plus output', totalTokens(cx.tokens), 340 + 900 + 10 + 140)

console.log(failures === 0 ? '\nall extractor tests passed' : `\n${failures} extractor test(s) failed`)
process.exit(failures === 0 ? 0 : 1)
