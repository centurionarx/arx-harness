# Agent Note: third-party notices read the versions the lockfile resolves

Status: implemented

## Problem

[`scripts/gen-third-party-notices.ts`](../../../../scripts/gen-third-party-notices.ts) read license, repository, and Claude Agent SDK facts from the first `node_modules/.pnpm` directory whose name starts with `<scope>+<name>@`. A pnpm store keeps directories for versions an earlier lockfile resolved, and directory order is not version order. A clone whose store still held Claude Agent SDK 0.3.220 after `pnpm-lock.yaml` moved to 0.3.281 regenerated `THIRD_PARTY_NOTICES.md` with the 0.3.220 payload table in its pre-commit hook. PR #45 committed that file, and the freshness assertion in [`scripts/gen-third-party-notices.spec.ts`](../../../../scripts/gen-third-party-notices.spec.ts) failed on `master` from `c1c51264` on.

## Decision

The generator parses `pnpm-lock.yaml` once and accepts an installed manifest only at a version that the lockfile's `packages` map resolves for that name. `virtualManifest` reads prefix-named directories first and the rest of the store after them, because pnpm 11 truncates long directory names, and returns the first manifest at a resolved version. Directories left by earlier lockfiles are skipped.

The Claude distribution section describes one installed SDK and its platform payloads, so the generator fails when the lockfile resolves several `@anthropic-ai/claude-agent-sdk` versions. A package without a complete `OVERRIDES` entry that the lockfile does not resolve, or that the store holds only at other versions, fails with the existing error that asks for `pnpm install`. A Claude platform payload that the store lacks at its resolved version is skipped like any payload for another host, and the generator fails only when no SDK-declared payload is installed.

This note refines how [the generated notices](2026-07-30-generated-third-party-notices.md) read installed metadata; the tier policy and ownership recorded there are unchanged.

## Alternatives considered

**Clean the virtual store before regenerating.** Deleting the stale directories from `node_modules/.pnpm`, or removing `node_modules` and reinstalling, repairs one clone at a time, and the output would still depend on the state of each contributor's store. `pnpm store prune` does not help: it prunes the content-addressable store, not a project's `node_modules/.pnpm`.

**Take the highest version in the store.** A store can hold a version newer than the lockfile, for example after a branch returns to an older lockfile, so the highest version is not the resolved one.

**Fail when the store holds several versions of a package.** The lockfile itself resolves 117 packages at more than one version, including the Codex CLI at 0.147.0 and 0.156.1, so this would reject healthy installs.

## Consequences

Regenerating the notices gives the same file on every clone installed from the same lockfile, whatever older versions its store still holds. The generator reads the lockfile on each run, and it still requires the resolved versions to be installed.
