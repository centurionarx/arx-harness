# Agent Note: GitHub is the source of truth after a merge

Status: implemented

## Problem

A merge lands on GitHub only. The repository required agents to bring the owner's long-lived local clone to the merged `master` and, for a clone serving the Web UI, to rebuild the official client and restart its service; an agent without access to the clone handed the owner the commands instead. The round closure procedure also transferred handoff files to a receiving environment and verified their hashes. A merged fix also looked unfixed in a clone that was not updated. The owner decided on 2026-11-03 that GitHub is the reference for the published source and that local clones are not synchronized, rebuilt, or restarted as part of a merge. Rules that name a clone to synchronize or a package to transfer create obligations that nothing reads and claims that no automated check verifies.

## Decision

After a merge, the agent verifies the result on GitHub: `master` contains the merge commit, and the CI result of that commit is read and reported. Agents do not synchronize, rebuild, or restart local clones as part of a merge, and they do not hand out sync commands. [AGENTS.md](../../../../AGENTS.md#after-a-merge-verify-on-github) carries the rule.

A round's handoff lives in what GitHub publishes and in the private receipts that the published entry document names. The [round closure procedure](../../../../docs/cookbook/closing-a-round.md) does not copy handoff files or evidence to another environment.

Where unaccepted AUTH code lives is a separate decision: [unaccepted AUTH code goes to a private repository](2026-11-03-unaccepted-auth-code-stays-private.md).

This decision consolidates the local-clone sync rule and the Web-serving clone build rule, whose notes it replaces. It partially supersedes [every round leaves a verifiable handoff](2026-10-10-every-round-leaves-a-verifiable-handoff.md), whose closure and publication obligations remain current apart from transferred copies.

## Alternatives considered

**Keep the fast-forward sync of the owner's clone.** The replaced rule ran `git fetch origin` and then `git merge --ff-only origin/master` on `master`, or `git fetch origin master:master` from another branch, which leaves that branch and its working tree alone. It stopped on a dirty tree or diverged `master` without stashing, resetting, or overwriting, reported the divergence to the owner, and had an agent without access to the clone end its report with those commands. It protected an owner who would otherwise test a stale tree, where a merged fix reads as a fix that did not work, but a cloud session could only report commands, never a verified sync. Inside that rule, three mechanisms were rejected: a GitHub Action or webhook pushing to the clone needed inbound access and credentials on the clone's machine, and its failures stayed invisible; `git pull` with its default merge or rebase hid divergence by creating a merge commit or replaying local commits; `git reset --hard origin/master` silently discarded local work.

**Keep rebuilding a Web-serving clone after each merge.** The replaced rule ran `pnpm install --frozen-lockfile`, then `pnpm run build:official`, then restarted the service, because agents that wrote the build command from memory served the unbranded client more than once and the owner reported the missing logo as a regression. Rebuilding and restarting a service are operating steps with their own authorization, not part of a merge. The build facts that remain true are listed under Consequences.

**Make `pnpm run build` produce the official client.** It would end the unbranded-build failure for every caller, but the unbranded default is deliberate: the official brand ships only under the official client profile, so a checkout carrying local changes never presents itself as the released product.

**Commit a sync script or a service unit for a Web-serving clone.** The service name, the remote name, and the checkout path are facts of one machine, and the repository would carry them for every clone.

**Keep transferring handoff packages and verifying their hashes.** The copies duplicate the published handoff and add a hash-verification step to every round, while the published entry document and the private receipts already identify the state.

## Consequences

- A merge is finished when GitHub shows the merge commit on `master` and its CI result is recorded; a pending, queued, cancelled, or failing post-merge result is reported as such.
- A merged fix can look unfixed in a checkout that its user has not updated; it is judged on `master` and its CI result.
- A local checkout reflects `master` only when its user updates it. A fast-forward update can replace an ignored file with a tracked one, as [the patch release bump note](2026-09-24-agents-run-the-patch-release-bump.md) records for `.claude/settings.json`.
- Whoever operates a checkout that serves the Web UI rebuilds it with `pnpm install --frozen-lockfile` and `pnpm run build:official` before restarting the service. A following `pnpm run build:web` would rebuild the Web output without the official values and leave the client build record describing artifacts that no longer exist ([development guide](../../../../docs/development.md), [client build environment](../architecture/2026-08-18-client-build-environment.md)). `pnpm run build` deliberately ships the unbranded client marked `ARX Local Build` and the commit hash.
- Round handoffs do not record transfer completion; publication and its CI result remain required.
