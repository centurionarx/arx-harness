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

The flag alone was not the whole answer. A budget written into a `describe`, an `it`, or a test helper's own poll deadline overrides `--testTimeout` instead of deferring to it, so six suites kept failing at their literals after the lane granted 30 seconds: the `pwsh-local` executor's `readUntil` poll at its 5-second default, the worker-thread runtime's two 64-MiB cases at 60 seconds, `gen-client-catalog` and the doc-site mirror at budgets a contended runner outran, the Oxlint executable contract's three cases at 20 seconds, one of which spawns an oxlint run per probed file class, and the pi-ai adapter's idle-watchdog case, whose one-second deadline for observing a socket close across a mock HTTP server now takes half the lane's case budget. Each now takes the larger of its own floor and `ARX_COVERAGE_TEST_TIMEOUT_MS`, so the lane can raise them and nothing lowers them, and two floors are the measured cost rather than the idle-host one: the 64-MiB worker-thread cases settle in under a second on an idle host and took 98 seconds on the runner, and the real-workspace slot walk took 39 against a 30-second budget. One failure was not a budget at all. The pwsh bootstrap case asserted on the viewport a send returns, which is empty when the send settles on the silence bound before the shell speaks; it now polls the session's retained scrollback, which is non-consuming and holds the output whenever it lands.

The budgets were also masking a sizing error. Every count on the two required Linux lanes was calibrated for a large box and landed on the standard hosted runner, which has four cores: coverage ran six instrumented workers, and the snapshot lane ran thirty-two agent subprocesses at eight concurrent gates while the failover pool — a shared 64-core VM — ran twelve, under a comment calling that value the halved one. The `windows node 24 / native complete` lane was the same error on the platform its own comments blame: it kept six instrumented workers and four concurrent gates on a `windows-2025` box with four cores, and the six multi-worktree Lefthook cases that wait on a peer installer's lock spent their whole 30-second budget on a peer that had no core to run, then failed cleanup with `EPERM` because the timed-out subprocesses still held the fixture. Its worker count follows the Windows failover switch now, as the Linux counts follow the Linux one. All three lanes size to the runner they land on, and the terminal-bash pwsh bootstrap case accepts either readiness tier, as every bash case in that file already does: a runner that misses the foreground handoff inside a 300 ms silence bound proves the send landed through the silence tier, and that case is about bootstrap, persistence, and the secret scrub.

Worker counts were only half of that sizing error; the aggregate's own schedule was the other half. `ci-consumers` runs four gates at once on those four cores, and two of them wait on wall clock rather than on CPU they can share: the browser gate drives eighty browser scenarios whose polls and readiness waits are fixed budgets, and the built-bin smoke boots the published bin four times inside one case. Both lost to `lint and duplication` and the snapshot pool, which are pure CPU burn and finish on their own schedule — `dev:web` was still enumerating tsdown configs at 152 seconds against its 150-second budget, and the four-boot case timed out at 30 on all three attempts. Both now carry `after: ['lint-and-duplication', 'snapshot']`, and the built-bin smoke waits for the browser gate as well, leaving the browser pool the runner to itself: sharing it with the smoke alone still cost seven scenarios across five files, every one of which passes on an idle host. The four-boot case also takes 120 seconds rather than the 30 its single-boot siblings take: a hosted runner spends five to seven seconds per boot, and the budget follows the count.

`smoke-real.e2e.ts`'s transport-retry case was the same literal problem one level down. `vitest.web.config.ts` grants 180 seconds and the case named 30, a sixth of it, while the two scenarios beside it — which spawn the same bin against the same kind of mock provider — name 150. It now names nothing and takes what the lane gives.

Six browser scenarios then failed on something a budget cannot buy: they race the product rather than wait on it, and only ran to completion at all once the lane stopped aborting on its serial files.

Two race a replay stream, and the lever for both is its pace. `steering.e2e.ts`'s empty-draft flush lands three sends inside call 0's stream window, and each send is a Playwright round trip whose cost is the host's; that scenario paces at 250 ms rather than the file's shared 50. `chat-scroll-contract.e2e.ts`'s reader anchor samples the chunk count after two wheel walks and a held history request, then waits for the stream to grow past it — at the file's shared 24 ms those 120 chunks are spent in under three seconds, so on a hosted runner the count was already final and no budget could move it; that scenario paces at 200 ms.

Two measure a layout mid-transition. `queue-actions.e2e.ts` read the dock's box in the frame a viewport change was still reflowing; both of its measurement sites poll now, and the three context panels are read in one `page.evaluate` rather than one locator at a time, because a spread computed across separate reads compares two different layouts.

One samples a surface that has not settled: `question-composer.e2e.ts` captured its golden while the transcript still offered "Back to bottom", and now waits for that affordance to go.

One races a window that closes. `workflow-run.e2e.ts` measures the member's link styles, and [the panel](../../../../packages/client/ui-workflow-run/src/client/WorkflowRunPanel.tsx) renders a member as a link only while its child session runs — about 1.4 seconds at the file's 50 ms pace. Four round-trips sat inside that window: a focus, a light-colour read, a theme swap, and the measurement. CI lost it between the focus, which resolved, and the measurement, which read the plain row a settled member becomes and reported a missing underline. All four now run as one synchronous `page.evaluate` the run cannot settle inside, and it asserts the member is still navigable before the link-only facts, so a window lost anyway names itself. The scroll this scenario was first given is gone: the member was never scrolled away, it had stopped being a button.

## Alternatives considered

- **Raise `ARX_COVERAGE_TEST_TIMEOUT_MS` alone.** Buys nothing for hooks, which is where the lefthook suite spends its time, and buys nothing for a suite that overrides the flag downward.
- **Set `hookTimeout` in the Vitest configuration.** Applies to every lane including the fast local one, where a 30-second hook ceiling hides a hang instead of reporting it. The budget belongs to the contended lane that asks for it.
- **Delete the `describe` timeouts and inherit the flag.** Correct in CI and broken locally, where the flag is absent and Vitest's 5-second default is far below what these suites need.
- **Read the environment variable inside each spec.** Removes the duplicated literal, but puts lane configuration inside a test file and leaves the local run with no ceiling at all.

## Consequences

A contended lane now grants its whole budget to the whole test, and a suite that names its own ceiling states why the number is what it is. A future change to `ARX_COVERAGE_TEST_TIMEOUT_MS` has to touch two spec files, which the comments say out loud; nothing enforces it.

Locally this proves only that the flags are accepted and the suites pass with them — 240 tests in 93 seconds, unchanged. Whether the lane's own failure is gone is answered by CI, because the contention that caused it cannot be reproduced on an idle host.

`--hookTimeout` now reaches both coverage gates, so a genuinely hanging hook in an instrumented lane takes 30 seconds to report instead of 10.

`workflow-run.e2e.ts` still spends a closing window on a golden capture and a disclosure round before it measures, and [`paceMs`](../../../../packages/test-support/llm-replay/src/index.ts) cannot widen that window: it is a per-chunk realism knob whose contract says correctness must never depend on it, and raising it past 50 ms starves the parent stream the scenario waits on first. The navigability assertion is what reports the window if a runner ever outruns it again.
