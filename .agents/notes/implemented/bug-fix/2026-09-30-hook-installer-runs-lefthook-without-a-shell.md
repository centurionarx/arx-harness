# Agent Note: the hook installer runs Lefthook without a shell

Status: implemented

## Problem

On Windows, [`install-lefthook.mjs`](../../../../scripts/install-lefthook.mjs) started `node_modules/.bin/lefthook.cmd` with `shell: true` and an argument list, because Node refuses to spawn a `.cmd` shim without a shell (CVE-2024-27980). Node 24 and later emit the DEP0190 runtime deprecation for that call, so every `pnpm install` on a Windows workstation printed it from the root `postinstall`; the hooks still installed. The call also broke the shell-free re-entry rule that the [pnpm decision](../process/2026-06-16-pnpm-over-yarn.md) sets for repository scripts.

## Decision

The installer locates the entry that its own `lefthook` dependency declares in `bin.lefthook`, under the checkout's `node_modules/lefthook`, and runs it with the current Node executable and no shell on every platform. A checkout without that file skips hook installation. Lefthook's entry starts the platform binary itself, and the generated hooks are byte-identical to the ones the `.bin` shim produced. [`install-lefthook.spec.ts`](../../../../scripts/install-lefthook.spec.ts) installs its fake Lefthook at the same entry path in each fixture checkout. The [release bump](2026-09-26-release-bump-reenters-pnpm-through-npm-execpath.md) applies the same rule to pnpm.

## Alternatives considered

**Pass one pre-quoted command string with `shell: true`.** It silences DEP0190 but keeps `cmd.exe` parsing of the paths and arguments, which the pnpm decision rejects.

**Spawn the platform binary directly.** It duplicates Lefthook's platform and architecture lookup in its `get-exe.js`.

**Use `cross-spawn`.** It adds a direct dependency, still runs `.cmd` shims through `cmd.exe`, and deletes no owned code.

## Consequences

The installer no longer reads `node_modules/.bin`. CI jobs skip the installer through `CI` or `GITHUB_ACTIONS`, so the native Windows lane exercises the Windows spawn only through `install-lefthook.spec.ts`, which runs the real installer against the fake entry and fails when its output reports DEP0190.
