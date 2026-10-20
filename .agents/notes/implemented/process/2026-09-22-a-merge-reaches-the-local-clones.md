# Agent Note: a merge reaches the owner's local clone

Status: implemented

## Problem

The owner runs the harness from one long-lived local clone at `C:\Desenvolvimento\arx-harness`. A merge lands on GitHub and nowhere else. Nothing in the process says who brings the clone forward, so after a merge the owner can keep running, testing, and reporting against a tree that no longer matches `master`: a fix merged but never pulled reads as a fix that did not work.

## Decision

After a PR merges into `master`, the local clone is brought to the merged `master`, recorded as a hard rule in [AGENTS.md](../../../../AGENTS.md#after-a-merge-sync-the-local-clone). In the clone, `git fetch origin` is followed by `git merge --ff-only origin/master` while `master` is checked out, or by `git fetch origin master:master` while another branch is, which leaves that branch and its working tree alone.

The sync is fast-forward only. A clone with uncommitted changes or a `master` that has diverged from `origin/master` is not synced; the divergence is reported to the owner, and nothing is stashed, reset, or overwritten.

An agent running on the machine that holds the clone performs the sync. An agent that cannot reach the clone, such as a cloud session, does not claim the sync happened; it ends its report with the exact commands.

## Alternatives considered

- **Push from GitHub to the machine on merge (Action or webhook).** It would make the sync automatic, but it needs inbound access and credentials on the machine that holds the clone, and a failure there is invisible until someone looks.
- **`git pull` with its default merge or rebase.** Either can succeed on a diverged clone by creating a merge commit or replaying local commits, which hides the divergence the owner needs to decide about.
- **`git reset --hard origin/master`.** Always reaches `master`, and silently discards any local work in the clone.

## Consequences

A merge is not finished for the owner until the local clone reports the merged `master`, or reports why it could not reach it. A cloud session cannot satisfy the rule itself; its obligation is the instructions.

The clone's location lives in the repository's agent instructions. Moving the clone or adding another copy means editing [AGENTS.md](../../../../AGENTS.md) and this note.
