# Handoff: make the native Windows lane block `all checks passed`

Paused 2026-11-25 ~12:55 America/Sao_Paulo at the owner's request. Session: https://claude.ai/code/session_016mZELZTydb8PAonL2vZFDn

## Done before this task

- PR #172 (freeze `Date` in the project driver-provenance test) merged as `902051a6` (1.0.72). `windows node 24 / native complete` was green on its head `3da23439` (job 139294319906, 33 min 10 s). Master CI for `902051a6` was still running at the time of the pause.

## Current task (from the master session, approved by the owner)

Add `windows-native` to `all-checks-passed.needs` in `.github/workflows/ci.yml`, with version bump, Agent Note, independent review, and the PR's own CI as proof.

## State

- Branch `ci/require-windows-native-lane`, based on `origin/master` `902051a6`, pushed. Work commit: `3a1066e8` (`ci: make the native Windows lane block all checks passed`). This `HANDOFF.md` sits in a separate commit on top; delete it with `git rm HANDOFF.md` in a new commit before opening the PR.
- No PR opened yet. No version bump yet.
- Files in `3a1066e8` (11):
  - `.github/workflows/ci.yml`: `windows-native` added to `needs`; comments above `windows-native` and `all-checks-passed` updated.
  - `scripts/ci-workflow.spec.ts`: requires `windows-native` in `needs`; new loop asserts every needed job has `if: github.event_name == 'pull_request'` (the verdict fails on a skipped dependency).
  - New note `.agents/notes/implemented/process/2026-11-25-native-windows-lane-blocks-the-merge.md` (reverses the non-blocking choice of the 2026-08-08 note).
  - Stale "independent native job" facts updated in notes 2026-07-21, 2026-07-22, 2026-07-23, 2026-07-26 (runbook and pnpm), 2026-08-08, plus `.github/AGENTS.md` and a comment in `ci-master.yml`. Sentences rewritten there now name the `windows-2025` runner instead of the stale `arx-windows-2025-16core`.

## Evidence so far

- `pnpm exec vitest run scripts/ci-workflow.spec.ts`: 15/15 pass.
- Rejection proofs (each reverted): removing `windows-native` from `needs` fails the spec; changing `python-sdk`'s `if` fails the new loop with a `python-sdk` message.
- `pnpm run verify-agent-note-format`: 713 notes conform.
- Event analysis: `ci.yml` triggers only on `pull_request`; every job, including `windows-native`, has the same `if`; drafts are not filtered, so no job is skipped on any PR event. Dependabot PRs run `windows-native` on hosted `windows-2025`.

## Next steps

1. Run `pnpm run doc-sync` (it was interrupted; partial log showed passes up to "type equivalence", no failure seen).
2. `git rm HANDOFF.md` and commit, then `pnpm run release:arx 1.0.74` (commits without `Co-Authored-By`, keep the `Claude-Session` line) (1.0.73 is taken by open PRs #169 and #173; the script commits the bump itself).
3. Secret scan, push `ci/require-windows-native-lane`, open the PR with the Portuguese template, `Related to #164`, labels `kind/cleanup` or `kind/testing` plus `area/windows`, `area/infra`.
4. Independent review (agent with the `arx-code-review` skill, given the code, not the conclusion); record it as a PR comment.
5. Proof: the PR's `all checks passed` must wait for and depend on `windows node 24 / native complete`.
6. Run `node .arx/integrations/graphify/refresh.mjs` before the final report. On this container Chromium 1228 is missing: set `PLAYWRIGHT_BROWSERS_PATH` to a directory with symlinks to `/opt/pw-browsers/*` plus `chromium_headless_shell-1228 -> /opt/pw-browsers/chromium_headless_shell-1243`. The Graphify venv is `.cache/graphify-venv` (pinned 0.9.74).

## Trade-off to state in the PR

The verdict now waits about 20 minutes longer (12 min 26 s for the slowest Linux job vs 33 min 10 s native on #172), and a hosted Windows outage blocks every merge until `ARX_CI_FAILOVER_WINDOWS=selfhosted` is set; Dependabot PRs stay on the hosted runner even then.
