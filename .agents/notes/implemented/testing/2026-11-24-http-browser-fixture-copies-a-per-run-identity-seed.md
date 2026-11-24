# Agent Note: The HTTP browser fixture copies a per-run identity seed

Status: implemented

## Problem

The `client/ui-auth` and `client/runtime` HTTP specs start [the browser fixture server](../../../../examples/web-identity/tests/browser-server.host.ts) in a child process. A USER start bootstraps MASTER and two ready users, which costs about eight scrypt operations at the product's fixed N=131072 cost. On an idle 4-core Linux machine a start took 6.1 seconds: 2.2 seconds of module loading through tsx and 3.9 seconds of harness, most of it password hashing. On the native Windows runner, `logout-http.client.spec.ts` exceeded the 30-second hook budget in its `beforeAll` in two of three runs on 2026-11-24, skipped its 22 tests and left `client/ui-auth/src/browser.ts:165` uncovered. The CI log had no breakdown of where a start spent its time.

## Decision

[identity-seed.global.ts](../../../../examples/web-identity/tests/identity-seed.global.ts) is a Vitest global setup of the `thread-safe` project. When a run starts, it forks [identity-seed.host.ts](../../../../examples/web-identity/tests/identity-seed.host.ts), which runs the same `storageHarness({ http: true })` bootstrap into a private temporary root, closes it, and sends the root, the MASTER password and the two users over IPC. The setup does not await the seed. A loopback HTTP server answers each fixture start with the seed after it exists; it accepts only the per-run bearer token that `provide('identitySeed')` gives the workers. Teardown stops an unfinished seed process and removes the root.

`browserFixture` in [http-fixture.client.ts](../../../../packages/client/ui-auth/tests/http-fixture.client.ts) passes `inject('identitySeed')` to the launcher, which hands it to the server process in `ARX_TEST_IDENTITY_SEED`. Every start without `--first-password` copies the seed root into its own temporary root and logs MASTER in again: a USER start runs the storage harness over the copy, and an admin start runs the identity harness over the identity part of the same copy. Credentials travel only over loopback and private IPC; the copied root holds verifiers, never passwords.

The `ready` message carries `timing`: the module load, the harness start, and the time to ready, in milliseconds since the server process started, and whether the start was seeded. The helper writes one `identity fixture start:` line to stderr per start, because this Vitest setup does not print console calls, so the CI log shows where each start spent its time.

With the seed ready, a start took 3.1 to 4.8 seconds on an otherwise idle Linux machine, against 6.1 to 7.1 seconds unseeded; the harness phase fell from 3.9 to about 1.0 second.

## Alternatives considered

**Raise the hook timeout.** The lane budget stays 30 seconds; a larger value makes the failure rarer without removing the cost.

**Seed once per spec file, as `writer-handoff.spec.ts` does.** `logout-http.client.spec.ts` starts the fixture once, so a per-file seed saves nothing there.

**Share the seed through a file.** The fixture passwords would reach the disk, and the fixture's contract is that credentials travel only over private IPC.

**Await the seed in the global setup.** Every run of the project, including a local run of one unrelated spec, would wait for the bootstrap before its first test.

**Lower the scrypt cost in the fixture.** The cost is a fixed product security parameter, and the fixture exercises the real provider.

## Consequences

- A fixture start that asks before the background seed finishes waits for it, so the first USER start of a run can still pay the bootstrap.
- `--first-password` starts, which test the MASTER bootstrap itself, and fixture starts outside Vitest such as the native browser gates still start from an empty root.
- A copy holds no captured delivery: `recovery-link` returns only mail sent after the start, which is all any spec asks for.
- Every run of the `thread-safe` project spends one bootstrap of CPU in the background, including runs that start no HTTP fixture. Teardown stops the seed process if it is still running.
- A failed seed fails every seeded fixture start of the run: the server process exits with the seed's stderr in its error, and the launcher reports the tail of the server's stderr. A seed process that hangs leaves each seeded start waiting until its hook budget, without a message.
- The seed lives as long as the Vitest process, so in watch mode a rerun after an identity or storage schema change copies a database the old code created; restart Vitest after such a change.
- Module loading through tsx, about 2.2 seconds on Linux, remains in every start.
