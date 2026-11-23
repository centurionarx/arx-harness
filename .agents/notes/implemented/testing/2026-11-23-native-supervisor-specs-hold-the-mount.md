# Agent Note: Native supervisor specs hold the worker mount and never hand a Context to `expect`

Status: implemented

## Problem

The first Sandbox run on `master` after the AUTH merge failed two tests of [native-operation-cancel.host.spec.ts](../../../../packages/host/isolated-project-runtime/tests/native-operation-cancel.host.spec.ts) on the macOS job and was then cancelled by the job's 20-minute limit.

The first test cancels a prompt that waits for the worker mount. It slept 100 ms and then asserted that the [native test supervisor](../../../../packages/host/isolated-project-runtime/tests/native-supervisor.ts) had no worker Context yet. The mount takes 156 to 195 ms on an idle 4-core Linux machine, so the assertion depended on the speed of the machine. On the macOS runner the mount had finished when the timer callback ran.

The failed assertion was `expect(supervisor.ctxOf(id)).toBeUndefined()`. Vitest formats the received value of a failed matcher, the value was a cordis Context, and a Context throws on a read of `$$typeof`. The report showed `PrettyFormatPluginError` instead of the assertion, and the file's `afterEach` did not run before the next test. The `globalThis.fetch` spy of the failed test stayed installed. The next test stored that spy as the original `fetch` and installed its implementation on the same spy, so every request recursed until the stack was exhausted and the test ended at the 5-second default. The second failure had no cause of its own.

The same suite has a third assertion that depends on the load of the machine. In [stream-deadline.spec.ts](../../../../packages/host/isolated-project-runtime/tests/stream-deadline.spec.ts) the test that keeps a stream open beyond `requestTimeoutMs` sets that limit to 50 ms and counted every cancel request the [supervisor fixture](../../../../packages/host/isolated-project-runtime/tests/supervisor.ts) received. Its attach step sends a unary request, and the runtime cancels that request when the reply takes longer than 50 ms. The count then reached 1 while the stream was still open, and the coverage job failed on a loaded runner.

The `client/ui-auth` specs that use a real HTTP authority start it as a child process through [browser-fixture.host.ts](../../../../examples/web-identity/tests/browser-fixture.host.ts) in a `beforeEach` hook. The start takes about 5 seconds on an idle 4-core Linux machine and about 12 seconds when six other processes occupy the cores. The macOS job ran the suite with the Vitest defaults of 5 seconds for a test and 10 seconds for a hook, and two hooks of [extended-http.client.spec.ts](../../../../packages/client/ui-auth/tests/extended-http.client.spec.ts) ended at 10 seconds. The same specs wait with Testing Library for the result of a login, a password change or a password reset. Those requests hash a password, and a Testing Library wait ends after 1 second whatever the Vitest limits are; [auth-http.client.spec.ts](../../../../packages/client/ui-auth/tests/auth-http.client.spec.ts) failed there on the same run.

The unit suite on that job grew from 983 to 1091 test files with the merge and from 6 min 40 s to 16 min 1 s. With the library build that the suite needs, a run in which every test passes takes about 20 min 15 s.

## Decision

The supervisor fixture has two more controls. `holdMount(barrier)` makes every later worker mount wait for the barrier before it starts, as `holdStop` does for a stop. `awaitingMount(workspaceId)` returns the request paths the supervisor has admitted for a worker that wait for its mount.

The first test holds the mount and opens the event stream before it invokes the prompt, so the stream's request starts the mount and the prompt waits inside the runtime for that attach. The test waits until the supervisor reports the event stream request waiting for the mount, asserts that no worker Context exists, cancels the prompt, checks the refusal and the receipt, and releases the mount in a `finally` block. The mount cannot finish before the cancellation, so the test does not depend on how long a mount takes.

No assertion in the `isolated-project-runtime` specs receives a Context. The sixteen assertions that passed the result of `supervisor.ctxOf(...)` to `toBeUndefined()` or `toBeDefined()` compare it with `undefined` and assert the boolean. Each test verifies the same condition; a failure prints `expected false to be true` and the cleanup runs.

The stream deadline test counts only the cancel requests that name the stream's own operation, read from the fixture's `cancelled` list. It verifies the same property: the stream stays open beyond `requestTimeoutMs` and is cancelled once, when the consumer aborts.

The unit step of the macOS leg sets `ARX_COVERAGE_TEST_TIMEOUT_MS` to `30000`, the value the coverage lanes of `ci.yml` set. [vitest.config.ts](../../../../vitest.config.ts) applies it to the test, hook and poll limits of every project, so `pnpm run test` uses it without another mechanism.

The HTTP bridge of the `client/ui-auth` specs has `answered(path)`, which settles when the next request to a path has an answer. The six form submissions of `auth-http.client.spec.ts` and `extended-http.client.spec.ts` whose server answer the test waits for await that answer before the Testing Library wait, so the 1-second wait covers only the rendering that follows the answer.

The macOS leg of the [Sandbox workflow](../../../../.github/workflows/sandbox.yml) has a 30-minute limit; the three Linux legs keep 20. A pull request that changes the workflow file runs the workflow, so a change to it is exercised on every leg before the merge.

## Alternatives considered

**Raise the test timeout.** The 5-second failure was a recursion that never ends, not a slow test. A longer limit would only delay the same failure.

**Raise `requestTimeoutMs` in the stream deadline test.** A larger limit makes the cancellation of the attach request rarer, not impossible, and lengthens the test, which waits four times the limit.

**Shorten or lengthen the 100 ms sleep.** Any fixed delay keeps the dependence on the duration of the mount.

**Cancel immediately after invoking the prompt.** The test would no longer establish that the prompt was waiting for a mount in progress.

**Restore the spies at the start of each test.** That hides the skipped cleanup: the harness and the supervisor of the failed test would still stay open, and the failure message would still be unreadable.

**Raise the Testing Library limit in the `client/ui-auth` specs.** One limit would then cover both a slow server answer and a slow render, and a slow render would pass.

**Start the HTTP authority once per file in the `client/ui-auth` specs.** It removes the 5-second start from every test and is the larger correction, but each test would share server state with the others of its file and the specs need a reset step between tests. It is deferred.

**Add `workflow_dispatch` to the Sandbox workflow.** GitHub starts a manual run only for a workflow whose trigger is already on the default branch, so it cannot exercise a change before its merge.

**Run the Sandbox workflow on every pull request.** Each run costs about 21 minutes of hosted macOS time and 10 minutes across the Linux legs. The unit suite already runs on Linux in the required checks.

**Move the darwin unit suite to its own job.** That job would need the same limit above 20 minutes and a second install on a macOS runner.

## Consequences

- The first test accepts one request order: the stream request reaches the supervisor before the prompt is cancelled. If the prompt request reached the supervisor first, its cancellation would wait behind the held mount and the test would fail; it cannot pass while a prompt is dispatched.
- With the mount held no request body is read, so the receipt check of that test only counts the receipt. The evidence that the prompt was never dispatched is the check of the supervisor's seen methods after the mount is released.
- A spec that needs a worker to stay unmounted holds the mount and releases it in `finally`. A barrier that is never released keeps `supervisor.close()` waiting.
- A spec reads a Context from `ctxOf` only to compare it with `undefined` or to use it. Passing one to `expect` hides the failure and skips the cleanup of that test.
- A pull request that edits `sandbox.yml` spends about 31 minutes of hosted runner time per push, about 21 of them on macOS. Other pull requests are unaffected, and the four jobs stay outside `all checks passed`.
- The macOS leg has about 50% margin over the current suite. The limit bounds a stuck job; it is not a performance budget.
- The stream deadline test does not assert that no other operation is cancelled while the stream is open. A cancel request for another operation id passes it.
- No CI lane runs the whole unit suite with the Vitest defaults; a local `pnpm run test` still does. A test that takes between 5 and 30 seconds, or a hook between 10 and 30, passes on every lane; a regression that makes a fast test slow is detected only when it passes 30 seconds or by the duration of the job.
- The `client/ui-auth` specs still start one server process per test. On the macOS runner that start is the largest part of each test, and the two files take about 95 seconds of the suite.
