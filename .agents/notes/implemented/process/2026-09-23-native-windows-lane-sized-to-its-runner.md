# Agent Note: the native Windows lane sizes itself to its runner

Status: implemented

## Problem

`windows node 24 / native complete` failed its instrumented coverage gate on every pull request, with 18 to 27 failing test files per run that pass on Linux and on an idle host. Its concurrency was measured for the 16-core `arx-windows-2025-16core` pool that [the native Windows lane note](2026-08-08-native-windows-pull-request-ci.md) records: eight single-worker coverage shards, four concurrent outer gates, and eight publint workers. This repository's job lands on the standard `windows-2025` label instead. GitHub sizes that runner by repository visibility: two cores and 7 GB for a private repository, and four cores and 16 GB for a public one. This repository is private, while the job's comment assumed four cores. [The one-budget note](../testing/2026-09-05-one-budget-covers-a-case-its-polling-and-its-hooks.md) already tied the coverage worker count to the Windows failover switch, but it kept the shard, gate, and publint counts. On the hosted runner, eight instrumented Vitest processes, the exempt gate, and up to three other gates therefore shared two cores. Cases that take a second on an idle host took ten, and the budgets they carry failed first: `vi.waitFor`'s one-second default, a five-second child-process kill, ten-second hooks, and a three-second wall-clock bound.

## Decision

A step before the gate inventory derives the counts from `[Environment]::ProcessorCount`, writes them to `GITHUB_ENV`, and prints them with the runner's memory. On a hosted runner:

- `ARX_COVERAGE_PARTITIONS` is the core count, and at least two, the minimum the partition coordinator accepts.
- `ARX_COVERAGE_MAX_WORKERS` is the core count; the exempt gate's third comes out of that total.
- `ARX_GATE_CONCURRENCY` is a quarter of the cores, and at least one.
- `ARX_PUBLINT_CONCURRENCY` is the core count.

The self-hosted pool keeps its measured 8, 6, 4, and 8. `ARX_COVERAGE_TEST_TIMEOUT_MS` stays a job constant. [ci-workflow.spec.ts](../../../../scripts/ci-workflow.spec.ts) pins the sizing step before the gate inventory and rejects any of the four counts as a job constant.

A quarter of the cores reproduces the measured point: four outer gates on sixteen cores. On two or four cores it runs one gate at a time, so the instrumented shards never share cores with the exempt gate, the build, or the site checks. The native Windows lane note records that the standard image completed the inventory reliably when run serially.

## Alternatives considered

- **Keep the counts and raise each budget that failed.** This treats a sizing error as a set of flaky tests. Every budget would have to absorb a tenfold slowdown, and the next contended case would fail the same way.
- **Pin hosted counts for two cores.** Correct today, but wrong if the repository becomes public or GitHub resizes the standard runner, which is the error this note corrects.
- **Move the job to a larger GitHub-hosted Windows runner.** This restores the measured design, but larger runners bill per minute and need organization settings the owner controls. The sizing step keeps working if the label changes.
- **Mark the job `continue-on-error` or drop it.** The native Windows lane note rejects both: the job's result stays visible and unmasked.

## Consequences

On a two-core runner the outer gates run one at a time, so the job takes longer than the roughly 32 minutes it took while failing; the 120-minute timeout still bounds it. Windows minutes on a private repository bill at twice the Linux rate, so the longer job costs more per pull request. The job log states the core count, memory, and counts it used, which confirms the runner size on every run.

The contention cannot be reproduced on a Linux host, so CI answers whether the lane passes. Fixture defects that did not depend on load were fixed in their own suites: roots taken from `tmpdir()` instead of its canonical spelling, which the Windows runner gives as an 8.3 short name, and ripgrep sidecar cases that inherited the host platform.
