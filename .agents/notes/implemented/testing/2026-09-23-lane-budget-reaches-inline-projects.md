# Agent Note: the lane budget reaches inline Vitest projects through their options

Status: implemented

## Problem

[The one-budget note](2026-09-05-one-budget-covers-a-case-its-polling-and-its-hooks.md) gives a contended lane one budget for a case, its polling, and its hooks: `coverageTestTimeoutArgs` turns `ARX_COVERAGE_TEST_TIMEOUT_MS` into `--testTimeout`, `--expect.poll.timeout`, and `--hookTimeout`. Only the first reached a test. `vitest.config.ts` declares its suites as two inline projects, `thread-safe` and `process-bound`, and Vitest copies only an allow-listed set of command-line options into inline projects. `testTimeout` is on that list; `hookTimeout` and `expect.poll.timeout` are not. Probing the configuration confirmed it: with `--hookTimeout=30000` a twelve-second `afterEach` still timed out at 10 000 ms, and with `--expect.poll.timeout=3000` a poll still gave up after about one second. The native Windows lane failed that way: the `afterEach` teardowns of the Claude Code and Codex real-product suites timed out at 10 000 ms under a 30-second lane budget. Polls that relied on `vi.waitFor`'s one-second default, which no flag raises, outran the scheduling of a contended runner.

## Decision

Each inline project spreads `coverageTestTimeoutOptions(process.env.ARX_COVERAGE_TEST_TIMEOUT_MS)`, which sets `testTimeout`, `hookTimeout`, and `expect.poll.timeout` to the lane budget, or sets nothing when the variable is absent. `parseCoverageTestTimeout` is the one validation both the options and the command-line flags use. [coverage-partitions.spec.ts](../../../../scripts/coverage-partitions.spec.ts) loads `vitest.config.ts` with the variable set and requires the budget on both projects; that case fails against the previous configuration.

Waits that relied on `vi.waitFor`'s implicit one-second deadline in the SDK server suite, the GitHub webhook composition, and the persistence coordinator contract are now `expect.poll`, so the lane governs them. A `vi.waitFor` that names its own timeout, or a child process's kill deadline, still states its floor and takes the larger of that floor and the lane budget, as the one-budget note records.

## Alternatives considered

- **Set the budgets unconditionally in the Vitest configuration.** The one-budget note rejects this: on an idle host a thirty-second hook or poll ceiling hides a hang that should fail within seconds.
- **Set `extends: true` on both projects.** This makes the projects inherit the root options that the command line overrides, but it would also pull in every other root option. The projects deliberately own their `include`, `exclude`, and pool settings.
- **Drop the command-line flags.** They still set the root configuration, and `--testTimeout` reaches the projects through them. The options restate the same budget rather than replace the mechanism the lane scripts and their specs already pin.

## Consequences

In a lane that sets `ARX_COVERAGE_TEST_TIMEOUT_MS`, every hook and every `expect.poll` without an explicit timeout now takes the lane budget, as the one-budget note intended. A hanging hook in such a lane reports after the lane budget instead of after ten seconds. Local runs without the variable keep Vitest's defaults.

With the variable set to 30 000, the SDK server suite passed 25 of 25 cases pinned to one CPU beside eight busy loops. Under the same load, the previous `vi.waitFor` version failed the case that fails on the native Windows lane.
