# Agent Note: Windows-lane tests shed measured work instead of raising budgets

Status: implemented

## Problem

On 2026-09-30 the `windows node 24 / native complete` lane failed four pull requests in code none of them touched. The hosted `windows-2025` runner has two cores and 8 GiB, and the lane runs the instrumented inventory as two concurrent coverage partitions on it:

- `packages/subagent/subagent-codex/tests/real-product.spec.ts` › the dangerous-bypass write took 68.0 s against its 60 s budget; passing runs took 10.3–33.2 s, while the same test takes 0.5 s on Linux.
- `packages/test-support/acp-snapshot/tests/harness.spec.ts` › `waitForTurnStart rejects missing, earlier, and malformed durable turns` took 20.8 s against 20 s on a run whose partitions took about 1 090 s instead of about 700.
- `packages/session/session-persistence-sqlite/tests/differential.spec.ts` › the randomized JSONL/Zstandard differential property passed 60 s; passing runs took 24–40 s.
- `packages/workflow/workflow-worker-thread/tests/workflow-worker-thread.spec.ts` lost its Vitest fork mid-file (`Worker exited unexpectedly`), with no exit code or stderr in the log, which also failed the per-file coverage gate for `src/host.ts` and `src/index.ts`.

Budgets had already absorbed this class of failure once ([one lane budget](2026-09-05-one-budget-covers-a-case-its-polling-and-its-hooks.md)). The lane's merged report prints only durations for passing tests and nothing from a fork that dies, so it could not say where any of this time went.

## Decision

Each test was measured on `windows-2025` with Node 24.21.0 before it changed. A temporary push-only workflow on a separate branch ran the four tests idle and beside two instrumented Vitest copies of the worker-thread spec, which loads two cores the way the lane's partitions do. Every change removes work or a race the measurement located; no budget moved.

### Codex dangerous-bypass write

On Windows, Codex 0.147.0 advertises `shell_command` rather than `exec_command` and runs it through PowerShell, so no PTY is involved. The fixture's command was itself `powershell.exe -NoLogo -NoProfile -NonInteractive -Command "Set-Content …"`, a second interpreter start inside the first. The runner has no PowerShell profiles, so profile loading is not a factor, and the Responses fixture answers in milliseconds. Between the model's function call and the next request, the command phase took 2.3–3.4 s idle and 5.0–5.6 s under load with the nested launch, against 1.2–1.6 s and 3.3–3.4 s when the fixture sends `Set-Content` directly. Codex's own reported wall time for the command is a third to a half of that phase; the rest is Codex's work around the command. The test sends the direct form and keeps its 60 s budget; the first lane run with it took 3.1 s.

### ACP `waitForTurnStart` rejections

The rejection test booted five scenario processes in sequence under one 20 s budget. Each scenario costs 0.2–1.1 s on Windows under load. Each rejection is now its own `it.each` case with one scenario process, under the same 20 s budget as the neighboring durable-turn waits.

### SQLite differential property

JSONL has no seek-capable read: its `readFrom` loads and decodes the whole Zstandard log and slices it, so reading every suffix start re-read the same log once per event. Those reads were 30% of the property's time under load (16.1 of 53 s). SQLite still reads every suffix start, because its seek crosses packed rows; JSONL reads the first and past-the-end starts.

That alone left the property at 57–61 s under load, because each of its 100 cases mounted and disposed four plugin instances. One store per backend now holds every case as its own session. Each case still writes, inspects, and reads its suffixes in both backends, so fast-check shrinks read failures to one log. Listing, revision stability, and reopen run once over all sessions after the property, because a JSONL listing reads the header of, and stats, every stored log. The revision check surrounds the reopened store's full reads. Three temporary faults in the SQLite store — a wrong suffix, a rolled-back append, and a suffix read that bumps the revision — each fail the property. It takes 22.6–29.9 s under load on Windows and 3.2–4.1 s on an idle Linux host, against 8.2 s before.

### Worker-thread fork exit

The fork exit is a native crash, and this change does not fix it. Looping the instrumented spec on `windows-2025` with Node 24.21.0 lost the fork in 2 of 44 runs; a preloaded exit-status hook recorded exit code 3221225477 (`0xC0000005`, access violation), with no stderr and no Node fatal-error report.

A standalone driver reproduces it outside Vitest. It spawns the engine's unbuilt worker bootstrap, or a variant, and calls `worker.terminate()` at a chosen moment:

| Worker | Terminated | Process crashes |
|---|---|---|
| unbuilt bootstrap (tsx hooks) | before its `ready` message | 0 of 500 |
| unbuilt bootstrap (tsx hooks) | on its `ready` message | 6 of about 2 300 |
| unbuilt bootstrap with `TSX_DISABLE_CACHE=1` | on its `ready` message | 5 of 1 600 |
| unbuilt bootstrap (tsx hooks) | 300 ms after `ready` | 0 of 800 |
| esbuild CommonJS bundle of `src/worker.ts`, the built shape | on its `ready` message | 0 of 800 |
| plain worker with two `fs.promises.access` calls in flight | on its `ready` message | 0 of 3 000 |

From Node 24.19, `cjs_lexer::Parse` skips an export name it cannot convert instead of calling `ToLocalChecked`, so the lexer abort recorded in [native Windows CI](../process/2026-08-08-native-windows-pull-request-ci.md) is not this crash, and on Node 24 tsx installs in-thread hooks through `module.registerHooks`, so no loader-hooks thread is nested in the worker. The crash needs a worker whose modules tsx loaded and a termination shortly after loading finished; tsx's disk cache and in-flight file I/O do not explain it. The same drivers, about 2 900 terminations, and 32 spec runs on Linux with Node 22 and 24 never crashed.

Every test in the spec ends in `dispose()`, which terminates the worker soon after a short script settles, inside that window. No test can wait on the internal work that closes it, and termination belongs to the engine, so the remedy is outside this change; see Related.

## Alternatives considered

- **Raise the four budgets.** The Codex test ranged from 10 to 68 s and the property from 24 to over 60 s on the same inventory; a budget that covers the tail hides the next regression of the same work, and a budget cannot stop a native crash.
- **Run the differential backends concurrently per case.** Measured at 62 s under load against 57–61 s sequentially: the loaded runner is CPU-bound, so overlapping the backends' I/O saves nothing.
- **Lower the property's `numRuns`.** It would cut time in proportion to the cases it drops; keeping one store per backend removes the mount cost and keeps all 100 cases.
- **Pass `login: false` to the Codex command.** It changed nothing measurable: the runner has no PowerShell profiles to skip.
- **Split the five `waitForTurnStart` scenarios into two or three larger cases.** Any grouping leaves a case whose cost is a multiple of one scenario; one scenario per case matches the neighboring waits.
- **Disable tsx's disk cache in the unbuilt worker.** The cache starts asynchronous file operations right after loading, but with `TSX_DISABLE_CACHE=1` the crash rate did not fall, and each worker booted about 270 ms slower on Linux.
- **Wait a fixed time after `ready` before disposing in the tests.** 300 ms avoided the crash in 800 attempts, but a fixed delay guards a window no test can observe, and `dispose()` is the engine's.

## Consequences

The three changed tests' time now follows the work each one asserts. The Codex test depends on Codex choosing PowerShell for `shell_command` on Windows; if a later Codex release changes that shell, the side-effect assertion fails with the model's last request input in its message. Its first two lane runs took 3.1 s and 18.9 s; the second run's phases were not measured, so the command path keeps a tail that the measurements here do not attribute.

The randomized property no longer checks `list()` or revision stability inside each case. It checks both once over all 100 sessions, and the two fixed-log tests in the same file keep the per-case forms in fresh stores.

The measurement branch `claude/diag-windows-flakes` carried the temporary workflow and scripts; nothing from it is part of this change.

## Related

[The source-mode workflow worker runs a bundle](../architecture/2026-10-01-source-workflow-worker-runs-a-bundle.md): the engine spawns an esbuild bundle without tsx hooks, which removes the fork exit measured here. The bundle crashed in none of 6 000 terminations and none of 226 looped spec runs on `windows-2025`.
