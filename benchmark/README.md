# Token-cost benchmark

This directory measures what a coding task actually costs, in tokens, on cxh and on Claude Code, over identical inputs with a verifiable definition of success.

It exists because the claim that one harness "spends fewer tokens" than another was not testable from the repository: `BENCHMARK.md` described how to launch a run but recorded no measurement, and no comparison against another harness existed anywhere in `docs/`.

## What this answers, and what it does not

It answers: for a fixed task that both harnesses complete correctly, how many tokens does each bill, split into uncached input, cache reads, cache writes, and output.

It does not answer which harness is better, faster, or cheaper in currency. Price per token is a provider decision that changes independently of either harness, so this measures tokens and leaves pricing to whoever reads the table.

## The two arms

**`--arm controlled`** puts the same model behind both harnesses. cxh reaches it through `llm-pi-ai`'s `anthropic-messages` route, configured by [`profiles/bench-anthropic.patch.yml`](profiles/bench-anthropic.patch.yml). This is the only arm whose cross-harness ratio measures harness architecture.

**`--arm as-shipped`** runs each harness on its own default (cxh on DeepSeek, Claude Code on Claude). This answers "what do I pay in practice" but confounds the harness with the model and its tokenizer, so `report.mjs` prints it with that warning attached.

Token counts are tokenizer-dependent. Two tokenizers assign different counts to identical text, so an as-shipped ratio is never evidence about harness design on its own.

## Extraction rules

Both harnesses report DISJOINT input counts: the "input" field excludes cache reads and cache writes, and billed input is the sum of all three. Neither side's input field alone is the billed input.

| normalized | cxh (`TokenUsage`) | Claude Code (`message.usage`) |
|---|---|---|
| `inputUncached` | `inputTokens` | `input_tokens` |
| `cacheRead` | `cacheReadTokens` | `cache_read_input_tokens` |
| `cacheWrite` | `cacheWriteTokens` | `cache_creation_input_tokens` |
| `output` | `outputTokens` | `output_tokens` |
| `reasoning` | `reasoningTokens` | `output_tokens_details.thinking_tokens` |

**A Claude Code transcript must be deduplicated by `requestId`.** One `assistant` record holds exactly one content block, so a single response is split across several records that all repeat the same `usage` object. On a sample transcript, 67 records represented 22 requests, and summing per record inflated cache reads by 3x. Tool calls are counted over all records, because each one carries a distinct block.

**A cxh log counts `compaction/summary` alongside `assistant/message`.** Summarization is a real billed call the harness makes on the session's behalf; the extractor reports it separately as `auxRequests` so it can be read apart from the main loop.

Auxiliary calls that append no usage-bearing session event are invisible to the extractor. Session titling is the shipped example, so [`profiles/bench-common.patch.yml`](profiles/bench-common.patch.yml) disables it rather than leaving it spent but unmeasured.

## Controls

**Identical inputs.** Every task materializes its workspace from [`tasks/fixture.mjs`](tasks/fixture.mjs), a seeded generator that produces a byte-identical tree on every machine and every repetition. No run inherits state from the previous one.

**Verified success.** Every task carries an oracle that recomputes the expected answer from the fixture. A run that does not pass is excluded from the token medians, because a harness that gives up early spends few tokens and counting that as economy would invert the result. Pass rates are reported beside the tokens. [`tests/oracles.test.mjs`](tests/oracles.test.mjs) proves each oracle rejects the unsolved fixture and accepts a correct solution.

**Interleaved order.** Repetitions alternate harnesses rather than running one to completion first, so provider-side cache warmth and transient API conditions are spread across both arms instead of being handed entirely to whichever ran second.

**Spread, not a single number.** `report.mjs` reports medians with an interquartile range over `--reps` repetitions. Agent runs vary in tool-call count between identical invocations; a single run is not a measurement.

## Tasks

Each task targets a different part of the token profile.

| task | what it stresses |
|---|---|
| `t01-targeted-edit` | The floor: one small file, so fixed per-request cost (system prompt plus tool schemas) dominates. |
| `t02-search-sweep` | Tool-result volume, where output spilling and tool-result pruning either pay for themselves or do not. |
| `t03-multifile-refactor` | History growth: a trivial edit repeated across many files, resent on every step. |
| `t04-long-context` | The compaction tradeoff, at roughly 6x t02's content. Compaction invalidates a provider's KV cache from the first shadowed token, so this task can legitimately cost more per unit of work than t02. |

## Running

Dry run is the default. Nothing executes and no API call is made until `--execute` is passed.

```sh
node benchmark/tests/oracles.test.mjs      # oracles discriminate
node benchmark/tests/extractors.test.mjs   # extractors count correctly

node benchmark/run.mjs --arm as-shipped --reps 3            # print the plan
CXH_BENCH_MODEL=<shared-model-id> \
  node benchmark/run.mjs --arm controlled --reps 5 --execute

node benchmark/report.mjs benchmark/results/controlled-*.json
```

`--tasks`, `--harness`, `--reps`, `--timeout`, and `--out` narrow a sweep. The controlled arm requires `CXH_BENCH_MODEL`; cxh additionally needs `ANTHROPIC_API_KEY` for that route, and the as-shipped cxh arm needs `DEEPSEEK_API_KEY`.

## What would falsify the hypothesis

The hypothesis under test is that cxh bills fewer tokens than Claude Code for the same completed task on the same model.

It is falsified if, in the controlled arm across repetitions, cxh's median total is at or above Claude Code's on tasks where both reach a comparable pass rate. It is unsupported, rather than falsified, if cxh's totals are lower but its pass rate is also lower: that is a different tradeoff and the report shows both columns for exactly this reason.

Reasoning passback is the mechanism most likely to move the result against cxh. The DeepSeek adapter carries every reasoned turn's chain of thought into later requests, which grows input per turn; whether the shipped compaction, pruning, and spill policies recover more than that costs is the open question this benchmark exists to settle.
