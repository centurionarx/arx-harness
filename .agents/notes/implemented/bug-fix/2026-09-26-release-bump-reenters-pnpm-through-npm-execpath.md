# Agent Note: the release bump re-enters pnpm through `npm_execpath`

Status: implemented

## Problem

`pnpm run release:arx patch` failed on a Windows workstation after it had rewritten every family manifest. [`bump.ts`](../../../../scripts/release/bump.ts) wrote the versions and then called `capture('pnpm', ['install', '--lockfile-only'])`, and [`process.ts`](../../../../scripts/release/process.ts) spawns without a shell. On Windows a shell-free spawn resolves a bare name only to a `.exe` or `.com`, while pnpm installed through npm or Corepack is a `.cmd` shim, so the lockfile step threw before the commit and left about 249 modified `package.json` files. [`pack.ts`](../../../../scripts/release/pack.ts) starts `pnpm pack` the same way; it runs on Linux CI, where the defect does not appear.

## Decision

Both release steps start pnpm with [`pnpmInvocation`](../../../../scripts/pnpm-invocation.ts), the shell-free re-entry rule that the [pnpm decision](../process/2026-06-16-pnpm-over-yarn.md) set for repository scripts: a `.js`, `.cjs`, or `.mjs` `npm_execpath` runs under the current Node executable, and a native executable runs directly. The bump runs the exact pnpm that launched `pnpm run release:*`, on every platform.

`applyVersions` in `bump.ts` resolves that invocation before its first write, so a launch outside `pnpm run` changes nothing. When the lockfile step fails, it writes the previous version back into every manifest it changed and rethrows. [`bump.spec.ts`](../../../../scripts/release/bump.spec.ts) runs a stand-in `.cjs` entrypoint as `npm_execpath` and covers the successful re-entry, the restore after a failed lockfile step, and the refusal outside a pnpm script.

## Alternatives considered

**Spawn through a shell on Windows.** The pnpm decision already rejects shell re-entry: it changes quoting and metacharacter expansion for every argument, and Node 24 deprecates passing arguments with `shell: true` (DEP0190).

**Use `execa` or `cross-spawn`.** Both resolve `.cmd` shims through `cmd.exe` with their own escaping. `cross-spawn` would add a direct dependency and delete no owned code. `execa` is asynchronous and would change the synchronous helpers' failure behavior. The existing helper already covers the npm shim, the Corepack shim, and `@pnpm/exe`.

**Require a clean tree and restore with git.** The bump never required a clean tree, and restoring through git would discard unrelated changes in the same files. The restore writes back only what this run changed.

## Consequences

The release scripts fail loudly with `npm_execpath is unavailable` when started directly with Node instead of through `pnpm run`; the documented commands are all `pnpm run release:*`. A failure in the later `git add` or `git commit` step still leaves the rewritten manifests staged, as before. `publish.ts` and `verify-packed-install.ts` still spawn a bare `npm`; they run only on Linux CI, and `npm_execpath` names pnpm rather than npm.
