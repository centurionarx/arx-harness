# Agent Note: The source-mode workflow worker runs a bundle, not TypeScript loader hooks

Status: implemented

## Problem

`arx-workflow-worker-thread` runs each workflow script in its own worker. Built output spawns `lib/worker.cjs`. Source mode, which every unit test and the source launch use, spawned a `data:` URL bootstrap that registered tsx's ESM and CommonJS hooks inside the worker and then imported `src/worker.ts`, so the worker loaded 56 modules through those hooks.

On the `windows node 24 / native complete` lane the worker-thread spec lost its Vitest fork in 2 of 44 looped runs ([measurement](../testing/2026-09-30-windows-lane-tests-shed-measured-work.md)). The process exited with `0xC0000005`, an access violation, with no stderr and no Node fatal-error report. Every test in the spec ends in `dispose()`, which terminates the worker soon after a short script settles, and a terminated worker that tsx had just loaded crashed its host process.

## Decision

The engine resolves its worker entry in `[Service.init]`, before the service becomes active, through `src/entry.ts`. Built output keeps `lib/worker.cjs`. Source mode bundles `src/worker.ts` and its workspace imports with esbuild into one ES module for the running Node version, and every run of that engine instance spawns the bundle from a `data:` URL. The worker installs no loader hooks.

- Workspace imports resolve through each source file's nearest `tsconfig.json`, so the bundle does not depend on the host's working directory or on `TSX_TSCONFIG_PATH`.
- A `data:` URL has no location of its own. An esbuild plugin replaces each module's `import.meta.url` with that module's source file URL before parsing, which keeps `arx-llm`'s `createRequire(import.meta.url)('../package.json')` pointed at its own manifest. Any other `import.meta` use fails the bundle through esbuild's `empty-import-meta` diagnostic, raised to an error.
- A bundling failure fails the plugin load. The bundle holds the sources as they were when the engine loaded; edits to worker sources take effect at the next load.
- Both shapes spawn with `env: {}` and `execArgv: []`, like the code-runtime worker. `TSX_TSCONFIG_PATH` and the Windows `TMP`/`TEMP` injection existed only for tsx, whose path mapping and transform cache needed them.
- `esbuild` replaces `tsx` as the package's devDependency. Only source mode resolves it, through `import.meta.resolve`.

### Measurements

A standalone driver on `windows-2025` with Node 24.21.0 spawned a worker and called `worker.terminate()` when its `ready` message arrived, with two drivers running concurrently:

| Worker | Process crashes |
|---|---|
| tsx bootstrap, the former source shape | 9 of 4 800, in two runs |
| tsx bootstrap with tsx's IPC named-pipe connection stubbed out | 8 of 3 000 |
| tsx bootstrap, host started with V8 `--single-threaded` | 0 of 3 000 |
| tsx bootstrap that closes `parentPort` and exits without `terminate()` | 0 of 2 400 |
| esbuild CommonJS bundle of `src/worker.ts` | 0 of 4 000 |
| plain worker opening a named pipe to a missing server | 0 of 5 000 |
| `bundleWorkerSource` output, the shipped source shape | 0 of 6 000 |

At the tsx bootstrap's rate of about 0.19%, zero crashes has a probability of about 0.4% in 3 000 terminations and below 0.01% in 6 000. The crash needs V8 work on background threads at the moment of termination, which `--single-threaded` removes; a tsx-hooked worker boots in about 330 ms on that runner and leaves such work in flight right after `ready`, while the bundle boots in about 85 ms. Windows Error Reporting's local dumps produced no dump file, so no native stack is recorded.

Looping the worker-thread spec under instrumented coverage in two concurrent copies, which lost the fork in 2 of 44 runs with the tsx bootstrap, passed 226 of 226 runs with the bundle, at a median of 23.6 s per run.

On Linux with Node 22 the worker-thread spec takes 11.3–11.6 s instead of 24.3–24.8 s, because each worker boots in about 65 ms instead of about 400 ms.

## Alternatives considered

- **Let the worker exit on its own instead of terminating it.** It removed the crash with tsx hooks (0 of 2 400), but each exit took about 0.9 s longer than a termination on the runner, it needs a new protocol message, and the cancellation grace must still terminate a script that ignores cancellation, so a termination right after loading stays reachable.
- **Disable V8 background threads.** `--single-threaded` applies to the whole process; a Worker's `execArgv` does not accept V8 options, and the host would lose concurrent compilation and garbage collection.
- **Keep tsx and remove the activity it starts after loading.** Stubbing its IPC pipe left the rate unchanged (8 of 3 000), as did `TSX_DISABLE_CACHE=1` (5 of 1 600).
- **Bundle synchronously in `start()`.** esbuild runs plugins only through its asynchronous API, the `import.meta.url` pin is a plugin, and `start()` is synchronous under the workflow seam. Bundling at engine load keeps `start()` synchronous.
- **Bundle once per process.** A reloaded engine would keep spawning the previous sources; bundling per load costs 60–130 ms on Linux.
- **Write the bundle to a file.** Every module's `import.meta.url` would then name the bundle instead of its source, and concurrent processes would race on the path.

## Consequences

Source-mode workers load like built workers: one prebuilt module, no loader hooks. Unit tests do not exercise tsx inside the worker, and stack frames from engine code inside the worker point into the bundle, as they do in built mode.

Engine load in source mode pays one esbuild build and starts esbuild's service process, which esbuild keeps unreferenced for the life of the host.

The engine still terminates workers in `dispose()` and after the cancellation grace. The bundle removes the load-time background work that exposed the race, not the race: a worker that leaves enough V8 background work in flight at termination can reopen it, built workers included, although none crashed in these measurements. Without a native stack the crash is not reported upstream.
