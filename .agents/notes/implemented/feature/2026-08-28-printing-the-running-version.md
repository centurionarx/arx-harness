# Agent Note: printing the running version

Status: implemented

English | [中文](2026-08-28-printing-the-running-version.zh.md)

## Problem

The sidebar named the product but never said which build was serving the page. A user comparing behavior across two checkouts, or reporting a defect, had nothing to quote.

`host.describe` already carried a `version` field, and it was hardcoded to `'0.0.1'` behind a `TODO` saying it should read `apps/cli`'s manifest. Every handshake sent that number to every client. Nothing rendered it, so a value that matched no release went unnoticed for as long as it was unread.

The repository also had a release mechanism with no stated cadence. `pnpm run release:arx` could bump and commit, but nothing said what a shipped fix owes the version, so the number moved when someone remembered rather than when the tree changed.

## Decision

The app version is a launcher fact, beside the command line and the bounded exit request that `provideCmdline` already provides. `apps/cli` reads its own manifest once in `bin.ts` — it already did, for `--version` — and hands the same string to `runProfile`, which provides it as `ctx.appVersion` before any tree entry mounts. No package below the launcher reads a manifest to learn what is running.

`host.describe` reads it per call rather than capturing it, for the same reason `requestExit` is read per call: the launcher provides it before the tree mounts, and the closure that answers `describe` outlives no generation it should speak for.

`ApiProxyDefaults.appVersion` is optional because a test tree provides none, and the wire field is not. That gap resolves at one named place: `UNDECLARED_APP_VERSION`, documented as the version of a tree nobody released. Leaving the wire field optional instead would push the same decision into every client, each free to render the absence differently.

The shell prints it under the wordmark. `.brandName` becomes a column — the wordmark row it already held, then the version — so "below the logo" is DOM order and not a positioned overlay. The version reads as a caption: smaller, secondary, code-family, never competing with the name above it.

Across a reconnect gap the row prints nothing. `hostDescription` publishes `undefined` while no generation is live, and the shell subscribes to the source rather than taking a snapshot prop, so the number leaves with the generation that owned it. A stale version outliving its connection would claim the running app is one it is not.

### Cadence

Every shipped change advances the version, which is what makes the printed number worth reading. Patch for each change or fix; minor when the implementer judges a patch understates the release; major only when the repository owner calls for it. The [development guide](../../../../docs/development.md#version-cadence) is the home of that rule; `AGENTS.md` links it.

## Alternatives considered

**A build-time constant in the client.** The brand fallback already reads `process.env.ARX_CLIENT_COMMIT_HASH`, so a version could have ridden the same channel with no wire change. Rejected: it would name the version the *client bundle* was built from, and the served client and the running host are separately deployable. The question a user asks is what is serving the page.

**Reading `apps/cli`'s manifest inside the gateway.** It is the literal thing the `TODO` proposed. Rejected: `packages/host/apiproxy` would have to resolve a path into an app that is not its dependency, and would answer for a launcher it does not know it has.

**Rendering `UNDECLARED_APP_VERSION` as an error state.** A tree with no launcher is a real composition, not a fault. Making the shell shout about it would put a warning in the product for a condition only test trees and embeddings reach.

## Consequences

`host.describe` now reports a released number, so anything reading it — this shell, and any client added later — names a tree that exists. The `0.0.1` it sent before matched no release in the repository's history.

Every launcher must supply one: `provideCmdline` takes `version` as a required field, so a new surface cannot reach the wire having forgotten it. The one composition that legitimately has no launcher resolves to `UNDECLARED_APP_VERSION` at a single named place.

Both benches that capture the brand row pin a fixed version of their own — `9.9.9-bench` in the sidebar DOM snapshots, `0.0.0-web-e2e` in the Web scaffold — so a release bump never rewrites a golden. The Web captures would not have seen it regardless: the brand identity row is `aria-hidden`.

## Related

[Private npm publication as three independent sequences](../process/2026-08-10-npm-release-sequences.md) owns how a bump is performed and what it publishes; this note owns when one is owed. [Stopping the harness from its own UI](2026-08-27-stopping-the-harness-from-its-own-ui.md) added the previous launcher-fact-backed control to the same shell.
