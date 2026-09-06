# Agent Note: one lane budget covers a case, its polling, and its hooks

Status: implemented

## Problem

`test:coverage-exempt-heavy` failed in CI at 502 seconds while the same suites pass locally in 93. Nothing in them is wrong: the lane runs them at `--maxWorkers=2` on a shared runner, roughly five times slower than an idle host, and two ceilings did not move with it.

`ARX_COVERAGE_TEST_TIMEOUT_MS` is the lane's answer to that slowdown — CI sets it to 30 000 on the Windows lane, and since this change on the Linux coverage lane too, whose real-pwsh executor cases timed out at Vitest's 5-second default under the same load — but `coverageTestTimeoutArgs` spent it on `--testTimeout` and `--expect.poll.timeout` only. No Vitest configuration raises `hookTimeout`, so every `beforeEach` and `afterEach` in the lane kept Vitest's 10-second default however much the lane granted a case. `scripts/install-lefthook.spec.ts` builds git worktrees and installs hooks in exactly those hooks, so its setup was capped at a third of what its cases had.

The second ceiling was a suite lowering its own grant. A `describe` timeout overrides the lane's `--testTimeout` rather than deferring to it, and `scripts/translation-pairing-merge.spec.ts` named 15 000 — half of what the lane gave it, on cases that compose real git blobs.

## Decision

`coverageTestTimeoutArgs` emits `--hookTimeout` beside `--testTimeout` and `--expect.poll.timeout`. One environment variable governs one budget for the work a contended lane must finish, whether that work sits in a case, in its polling, or in its setup and teardown.

`translation-pairing-merge.spec.ts` names 30 000, matching `ARX_COVERAGE_TEST_TIMEOUT_MS` in [ci.yml](../../../../.github/workflows/ci.yml). It and `install-lefthook.spec.ts` both carry a comment naming that coupling at the `describe`, because the two numbers must move together and neither file can see the other.

Both decisions are ported from deepseek-harness — `translation-pairing-merge-budget` (2026-08-27) and `windows-lane-hook-and-lefthook-budget` (2026-08-29) — and their match belongs in the upstream sync manifest when [the sync policy](../../proposed/process/2026-09-05-ship-sync-integrate-then-translate.md) creates it.

## Alternatives considered

- **Raise `ARX_COVERAGE_TEST_TIMEOUT_MS` alone.** Buys nothing for hooks, which is where the lefthook suite spends its time, and buys nothing for a suite that overrides the flag downward.
- **Set `hookTimeout` in the Vitest configuration.** Applies to every lane including the fast local one, where a 30-second hook ceiling hides a hang instead of reporting it. The budget belongs to the contended lane that asks for it.
- **Delete the `describe` timeouts and inherit the flag.** Correct in CI and broken locally, where the flag is absent and Vitest's 5-second default is far below what these suites need.
- **Read the environment variable inside each spec.** Removes the duplicated literal, but puts lane configuration inside a test file and leaves the local run with no ceiling at all.

## Consequences

A contended lane now grants its whole budget to the whole test, and a suite that names its own ceiling states why the number is what it is. A future change to `ARX_COVERAGE_TEST_TIMEOUT_MS` has to touch two spec files, which the comments say out loud; nothing enforces it.

Locally this proves only that the flags are accepted and the suites pass with them — 240 tests in 93 seconds, unchanged. Whether the lane's own failure is gone is answered by CI, because the contention that caused it cannot be reproduced on an idle host.

`--hookTimeout` now reaches both coverage gates, so a genuinely hanging hook in an instrumented lane takes 30 seconds to report instead of 10.
