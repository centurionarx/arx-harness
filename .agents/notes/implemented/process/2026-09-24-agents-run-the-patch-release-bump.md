# Agent Note: agents run the patch release bump without a prompt

Status: implemented

## Problem

Every shipped change advances the arx patch version through `pnpm run release:arx patch` ([version cadence](../../../../docs/development.md#version-cadence)). An agent session in auto permission mode sends that command to the [auto mode classifier](https://code.claude.com/docs/en/auto-mode-config), which decided it differently across sessions: it ran the bump for most releases through 1.0.28, denied a bump command as `[Merge Without Review]` on 2026-09-23, and denied one as `[Modify Shared Resources]` on 2026-09-24. Each denial left a pull request without its release commit until the owner authorized the command in the conversation, and that authorization covers one attempt in one session.

## Decision

The repository's [`.claude/settings.json`](../../../../.claude/settings.json) allows exactly `Bash(pnpm run release:arx patch)`. Claude Code resolves a narrow Bash allow rule before the auto mode classifier runs, so an agent session in this repository runs the patch bump without a prompt or a classifier decision. A cloud session reads project settings from its checkout, so the rule reaches every session whose checkout contains the file. The file is tracked: `.gitignore` ignores `.claude/settings.local.json`, where Claude Code reads personal settings, in place of `.claude/settings.json`, which the initial snapshot ignored.

The rule matches only the patch bump. `minor`, `major`, and explicit versions, which the cadence reserves for the owner, stay under the classifier, as does the `git commit --amend` that adds attribution trailers to the release commit. The bump script rewrites the manifests and the lockfile and creates a local commit; it neither pushes nor tags, so every step that publishes the release still passes the ordinary permission checks.

## Alternatives considered

**Authorize each bump in the conversation.** The classifier honors the owner's explicit request for one action, but the owner has to send that request for every pull request, and it does not reach another session.

**A user-level rule in `~/.claude/settings.json`.** A cloud session's home directory belongs to a container that is discarded, so the rule would not reach the next session.

**An `autoMode.allow` entry.** The classifier does not read `autoMode` from project settings, so the entry could not live in the repository.

**A wildcard rule such as `Bash(pnpm run release:arx *)`.** It would also allow minor, major, and explicit-version bumps.

## Consequences

Every Claude Code session in this repository, including the owner's local sessions, runs the patch bump without asking, and the owner no longer authorizes it per pull request. An unwanted bump is a local commit that the pull request shows and a revert removes. Changing or removing the rule means editing `.claude/settings.json` and this note.

A clone that kept personal settings in the formerly ignored `.claude/settings.json` must move them to `.claude/settings.local.json` before its next sync. `git merge --ff-only` replaces an ignored file with the tracked one without reporting it, so the [clone sync](2026-09-22-a-merge-reaches-the-local-clones.md) would discard those settings; adding `--no-overwrite-ignore` makes the merge stop instead.
