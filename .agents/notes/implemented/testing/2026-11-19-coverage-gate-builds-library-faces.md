# Agent Note: The coverage aggregate builds the library faces its specs import

Status: implemented

## Problem

Fifteen AUTH specs import files that exist only under `lib/`. Twelve specs of `isolated-project-runtime` start a real worker Loader through [the native test supervisor](../../../../packages/host/isolated-project-runtime/tests/native-supervisor.ts); its `@arx-ai/arx-typert-loader` imports the `./typert` export of seven packages, and that export is the generated file `lib/typert.host.js`, which has no file under `src`. `runtime-lifetime-http.client.spec.ts` imports the generated `./remote` face, `native-graph.host.spec.ts` copies `@arx-ai/arx-client-slots/lib/index.js` into a temporary consumer, and `benchmark-native.spec.ts` starts the same worker. The `ci-coverage` aggregate ran on a checkout without `lib/`, so these specs failed there and the per-file gate reported about 280 uncovered statements, branches and functions in `isolated-project-runtime` and `project-storage`. The same gate passed on a development machine whose tree had been built earlier, which hid the dependency.

On the native Windows runner the temporary directory is `C:\Users\RUNNER~1\AppData\Local\Temp`. The identity authority journal refuses a root that differs from its `realpath`, and `fs/promises` `realpath` expands the 8.3 short name, so every fixture that created its root with `mkdtemp(join(tmpdir(), …))` failed to load with `Canonical authority directory required`.

## Decision

The `ci-coverage` aggregate starts with a `library-faces` gate that runs `pnpm run build:lib`, and both coverage gates declare `needs: ['library-faces']` in [run-gates.ts](../../../../scripts/run-gates.ts). `ci-primary` and `ci-windows-complete` already own a `build` gate; their coverage gates declare `needs: ['build']`. The build dependency is stated in the gate graph, as the [source and artifact plane rule](../../../../docs/development.md#typescript-project-layout) requires of a gate that consumes `lib/`. The Web frontend build is not part of the dependency: the fifteen specs pass with the library faces alone.

The AUTH fixtures create each temporary root as `realpath(await mkdtemp(…))`. The journal check and every other product file are unchanged.

## Alternatives considered

**Resolve the generated faces from source.** A Typert face is generator output and has no source file to point `tsconfig` paths at.

**Move the fifteen specs to the consumer job and merge its coverage into the gate.** The specs would run where a complete build already exists, but the per-file gate would need coverage blobs carried between two jobs and a job that waits for both.

**Exclude the specs, or exempt the uncovered source files.** Either lowers the per-file 100% gate.

**Make the journal accept a root that is not canonical.** That weakens a deliberate configuration check to accommodate test fixtures.

## Consequences

- The coverage job spends about two minutes on `build:lib` before its first test. In `ci-primary` and `ci-windows-complete` the instrumented coverage gate starts after `build` instead of beside it.
- A bare `pnpm run test` or `pnpm run test:coverage` on a checkout without `lib/` fails in these fifteen specs; `pnpm run build:lib` once makes them pass.
- A spec in the coverage gate may import `lib/` of the Host and Client faces. A spec that needs `apps/web/dist` belongs to the snapshot lanes.
- `vite-tsconfig-paths` still resolves bare workspace imports to `src`, so the instrumented code is the source, not the built copy.
- The AUTH file checks apply no mode or owner rule on `win32`: the private key and the Resend key, the identity database and its directory, and the authority journal's directory and files. `crypto.spec.ts` asserts the POSIX rejection of a key file that other accounts can read and, on `win32`, its acceptance. A Windows access-control rule for these seven checks is not implemented.
