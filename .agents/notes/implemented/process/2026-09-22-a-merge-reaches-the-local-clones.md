# Agent Note: a merge reaches the owner's local clones

Status: implemented

## Problem

The owner runs the harness from two long-lived clones: a notebook at `C:\DESENVOLVIMENTO\projetos-centurionarx\Projeto-arx-ai\arx-harness` and an Azure VM at `azureuser@dev-01:~/dev/arx-harness`. A merge lands on GitHub and nowhere else. Nothing in the process says who brings those clones forward, so after a merge the owner can keep running, testing, and reporting against a tree that no longer matches `master` — a fix merged but never pulled reads as a fix that did not work.

## Decision

After a PR merges into `master`, both clones are brought to the merged `master`, recorded as a hard rule in [AGENTS.md](../../../../AGENTS.md#after-a-merge-sync-the-local-clones). In each clone, `git fetch origin` is followed by `git merge --ff-only origin/master` while `master` is checked out, or by `git fetch origin master:master` while another branch is, which leaves that branch and its working tree alone.

The sync is fast-forward only. A clone with uncommitted changes or a `master` that has diverged from `origin/master` is not synced; the divergence is reported to the owner, and nothing is stashed, reset, or overwritten.

An agent running on one of the two machines performs the sync for that clone. An agent that cannot reach a clone, such as a cloud session, does not claim the sync happened; it ends its report with the exact commands for each clone.

## Alternatives considered

- **Push from GitHub to the machines on merge (Action or webhook).** It would make the sync automatic, but it needs inbound access and credentials on a personal notebook and a VM, and a failure there is invisible until someone looks.
- **`git pull` with its default merge or rebase.** Either can succeed on a diverged clone by creating a merge commit or replaying local commits, which hides the divergence the owner needs to decide about.
- **`git reset --hard origin/master`.** Always reaches `master`, and silently discards any local work in the clone.

## Consequences

A merge is not finished for the owner until both clones report the merged `master`, or report why they could not reach it. A cloud session cannot satisfy the rule itself; its obligation is the instructions.

The two machine locations live in the repository's agent instructions. Moving a clone or replacing a machine means editing [AGENTS.md](../../../../AGENTS.md) and this note.
