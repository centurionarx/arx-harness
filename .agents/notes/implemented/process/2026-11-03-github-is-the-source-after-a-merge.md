# Agent Note: GitHub is the source after a merge

Status: implemented

## Problem

A merge lands on GitHub only. The repository required agents to bring the owner's long-lived local clone to the merged `master` and, for a clone serving the Web UI, to rebuild the official client and restart its service; an agent without access to the clone handed the owner the commands instead. The round closure procedure also transferred handoff files to a receiving environment and verified their hashes. The owner does not run from a synchronized clone: GitHub is the reference for the published source, local copies are working trees managed by their users, and unpublished AUTH work has its own private locations. Rules that name a clone to synchronize or a package to transfer create obligations without a consumer and claims that no gate checks.

## Decision

After a merge, the agent verifies the result on GitHub: `master` contains the merge commit, and the CI result of that commit is read and reported. Agents do not synchronize, rebuild, or restart local clones as part of a merge, and they do not hand out sync commands. [AGENTS.md](../../../../AGENTS.md#after-a-merge-verify-on-github) carries the rule.

A round's handoff lives in what GitHub publishes and in the private receipts that the published entry document names. The [round closure procedure](../../../../docs/cookbook/closing-a-round.md) does not copy handoff files or evidence to another environment.

In-progress AUTH code stays out of this public repository. It is kept in a separate private repository, and a local pre-push hook in the AUTH working clone refuses AUTH refs and commits toward this repository. This repository receives documentation pull requests and, at the end, the accepted AUTH pull request.

This decision consolidates the local-clone sync rule and the Web-serving clone build rule, whose notes it replaces. It partially supersedes [every round leaves a verifiable handoff](2026-10-10-every-round-leaves-a-verifiable-handoff.md), whose closure and publication obligations remain current.

## Alternatives considered

**Keep the fast-forward sync of the owner's clone.** The replaced rule ran `git fetch origin` and then `git merge --ff-only origin/master` on `master`, or `git fetch origin master:master` from another branch. It stopped on a dirty tree or diverged `master` without stashing, resetting, or overwriting, and an agent without access to the clone ended its report with those commands. It protected an owner who would otherwise test a stale tree, but the owner does not work from a synchronized clone, and a cloud session could only report commands, never a verified sync. Inside that rule, three mechanisms were rejected: a GitHub Action or webhook pushing to the clone needed inbound access and credentials on the clone's machine and failed silently; `git pull` with its default merge or rebase hid divergence by creating a merge commit or replaying local commits; `git reset --hard origin/master` discarded local work.

**Keep rebuilding a Web-serving clone after each merge.** The replaced rule ran `pnpm install --frozen-lockfile`, then `pnpm run build:official`, then restarted the service, because an agent that ran `pnpm run build` once left the served client unbranded. Rebuilding and restarting a service are operating steps with their own authorization, not part of a merge. The build facts that remain true are listed under Consequences.

**Keep transferring handoff packages and verifying their hashes.** The copies duplicate the published handoff and add a hash-verification step to every round, while the published entry document and the private receipts already identify the state.

## Consequences

- A merge is finished when GitHub shows the merge commit on `master` and its CI result is recorded; a pending or failing post-merge result is reported as such.
- A local checkout reflects `master` only when its user updates it. A fast-forward update can replace an ignored file with a tracked one, as [the patch release bump note](2026-09-24-agents-run-the-patch-release-bump.md) records for `.claude/settings.json`.
- Whoever operates a checkout that serves the Web UI rebuilds it with `pnpm install --frozen-lockfile` and `pnpm run build:official`, without a following `pnpm run build:web`, before restarting the service. `pnpm run build` deliberately ships the unbranded client marked `ARX Local Build` ([client build environment](../architecture/2026-08-18-client-build-environment.md)).
- Round handoffs do not record transfer completion; publication and its CI result remain required.
