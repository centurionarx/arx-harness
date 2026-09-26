# Agent Note: an E2B process group counts as live only after a post-grace probe

Status: implemented

## Problem

`E2BSubprocessHandle` waits for a remote process group to exit after `SIGTERM` and again after `SIGKILL`. The wait computed a wall-clock deadline from `graceMs` and checked it after each liveness probe, so a probe that began before the deadline and returned after it decided the verdict. Each probe is a control-plane round trip to the sandbox. When one probe outlasted `graceMs`, the handle judged the group from that single probe, sent right after the signal, and the force-kill path reported `remained live after force termination` for a group that exited while the probe ran. Publication rollback wraps that failure, so a start that failed with an invalid process-group id rejected with `process-group publication failed and rollback did not reach quiescence` instead of the startup error. The native Windows CI lane met this in `subprocess.spec.ts` ("rejects invalid or absent process-group publication"), whose fixture uses `graceMs: 5` and whose first probe still sees the group live.

## Decision

`waitForGroupExit` in [`packages/e2b/subprocess-e2b/src/process.ts`](../../../../packages/e2b/subprocess-e2b/src/process.ts) reads the deadline only after each poll tick. A probe that finds the group empty ends the wait at once. A live result ends it only when the probe followed a poll tick and began after `graceMs` elapsed, so the wait lasts at most `graceMs` plus one poll tick and two probes. `terminateGroup` (TERM, then escalation) and `forceKillGroup` (KILL, then failure) share the function, so TERM escalation waits for the same kind of observation.

The spec pins the order with a `Date.now` spy that jumps past the grace after the first probe, so the case no longer depends on the runner's speed.

`awaitSessionEmpty` in [`terminal.ts`](../../../../packages/e2b/subprocess-e2b/src/terminal.ts) keeps its loop. Its non-kill branch can return groups seen by a probe that began before the deadline, but that result only escalates to `SIGKILL`, and the kill branch probes again after the deadline before it reports survivors.

## Alternatives considered

**Raise `graceMs` in the test fixture.** A larger grace hides the race on a slow runner but leaves the product judging survival from a probe that started inside the grace. Production graces are larger, but so are real sandbox round trips.

**Compare against the deadline immediately before each probe.** The first probe can still decide when the thread stalls for longer than the grace between computing the deadline and that comparison, which a loaded runner makes plausible. Requiring a poll tick before the deciding probe closes that window as well.

## Consequences

A group that exits while a slow probe is in flight counts as quiescent instead of failed, and publication rollback rethrows the original startup error. A group that stays live is still reported, by a probe that began after the grace. TERM escalation and the force-kill failure can arrive up to one poll tick and one probe later than before.
