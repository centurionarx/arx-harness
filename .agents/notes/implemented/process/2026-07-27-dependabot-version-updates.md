# Agent Note: Dependabot version updates with a 30-day cooldown

Status: implemented

## Problem

Maintained registry and GitHub Actions dependencies need a regular update path. Adopting every release immediately increases exposure to compromised releases and early regressions, while leaving updates entirely manual lets dependency drift accumulate. Vendored Cordis sources cannot be treated like registry dependencies, and workspaces sharing one lockfile must be updated through the same package tree.

## Decision

The default branch carries [`.github/dependabot.yml`](../../../../.github/dependabot.yml) with daily version-update checks at 04:00 Asia/Shanghai for the root pnpm workspace, including `native/landlock-run`, the `python/sdk` uv project, and GitHub Actions. Every entry sets `cooldown.default-days` to `30`, so a version release becomes eligible only after it is at least 30 days old and is proposed on the next daily check.

Packages released in lockstep move in one grouped pull request: the `@opentelemetry/*` packages, `shiki` with `@shikijs/*`, and the `actions/upload-artifact` and `actions/download-artifact` pair. Separate pull requests for one family left versions that must match on different review timelines. Major updates of `@types/node` are ignored, because the type definitions track the oldest Node major in the root `package.json` engines, not the newest Node release. The [Issue policy](../../../../.github/issue-management/policy.mjs) exempts pull requests opened by bots and treats a referenced number that is not an Issue of this repository as no reference, so the upstream `#N` references quoted in Dependabot release notes do not fail the check. The [in-repository Landlock release decision](2026-08-06-in-repository-landlock-release.md) owns the shared-workspace boundary.

The root pnpm version-update scan excludes `vendor/**`, whose source and manifests move only through the [vendoring procedure](../../../../vendor/README.md). GitHub applies `exclude-paths` only to version updates; a security pull request that touches a vendored manifest is replaced through the vendoring procedure instead of being merged as generated. Dependabot pull requests receive the repository's `kind/dependency` kind and `area/infra` area labels, run the normal pull-request checks, and remain subject to maintainer review; this automation does not merge them.

Repository settings enable dependency vulnerability alerts and Dependabot security updates. GitHub does not apply version-update cooldowns to those security updates, so security fixes remain eligible immediately. A generated pnpm security pull request can still fail the repository's lockfile release-age verification when dependency resolution selects unrelated fresh transitive versions; that pull request waits or is narrowed instead of weakening the policy. The repository's coordinated fresh-release exceptions are not copied into Dependabot's cooldown exclusions: automated version updates use the uniform 30-day wait, while an explicitly reviewed manual update can still follow its owning release procedure.

The pnpm entry keeps the unified workspace on its pinned pnpm 11 instead of introducing an automation-only downgrade. The current Dependabot updater installs the version requested by the root `packageManager` and reads the root lockfile format `9.0`; the provider-run update job remains the integration check.

## Alternatives considered

- **Immediate version updates.** Rejected because they remove the requested release-age quarantine and make the project an early consumer of every upstream release.
- **Automatic merging after CI.** Rejected because dependency changes can alter runtime, build, and release behavior; the normal review decision remains part of accepting an update.
- **A separate native npm scan.** Rejected because the Landlock manifests belong to the root workspace and lockfile; splitting their update would recreate an ownership boundary the package manager no longer has. The root scan excludes only vendored manifests.
- **Renovate or a scheduled agent.** Both can propose aged updates, but Dependabot is the requested service and the repository's CI already recognizes its pull requests as an untrusted dependency source.
- **One group for every update in an ecosystem.** Rejected because one incompatible update, such as a CI action major that breaks the test lanes, would hold back every unrelated update in the same pull request.
- **Cooldown exemptions for coordinated fresh releases.** Rejected for the automated path because those releases require an explicit synchronization or model-catalog decision rather than a generic update proposal.

## Consequences

- Routine dependency updates arrive in small reviewable pull requests after the quarantine instead of requiring periodic manual discovery.
- A release normally appears 30 or 31 days after publication because eligibility is evaluated daily.
- A grouped pull request replaces the individual pull requests it supersedes, so a family reaches review as one change.
- Dependabot does not delay security proposals; repository checks can still block unrelated fresh transitives, and review preserves the vendoring boundary.
- Maintainers still decide whether to merge each update and diagnose any provider limitation reported by the pnpm 11 update job.
