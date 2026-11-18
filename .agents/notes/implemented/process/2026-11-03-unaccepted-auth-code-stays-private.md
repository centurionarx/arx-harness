# Agent Note: Unaccepted AUTH code goes to a private repository

Status: implemented

## Problem

The AUTH implementation is security-sensitive and has not passed integrated acceptance or independent review, while this GitHub repository is public. Its tracked files also reference private evidence that exists only on the development machine. The [round handoff note](2026-10-10-every-round-leaves-a-verifiable-handoff.md) has each phase publish its source: publishing unaccepted AUTH code here exposes it before review, and keeping it only on the development machine leaves a single copy.

## Decision

In-progress AUTH code goes only to a separate private repository. Each AUTH phase pushes its integration branches there, including FAIL and BLOCKED phases, after a secrets scan of the pushed content, and records the pushed commits and known failures; that push does not require passing checks. This public repository receives documentation pull requests and, at the end, the accepted AUTH pull request after integrated acceptance and independent reviews pass.

A local pre-push hook in the AUTH working clone refuses, for this repository's URL, any ref name containing `auth-gl4/` and any pushed commit that contains the AUTH staging snapshot commit or the AUTH integration commit. Documentation pull requests are prepared from a separate clone that holds no AUTH objects.

## Alternatives considered

**Publish AUTH phases to this repository as branches or draft pull requests.** CI would run on every phase, but unaccepted authentication code and its private evidence references would become public before review.

**Keep the AUTH code only on the development machine.** Nothing is exposed, but the work has a single copy without remote history.

**Guard the push with a lefthook job.** Lefthook skipped the job when it found no push files, and `LEFTHOOK=0` skips every lefthook job, so the guard is a plain Git hook, chained before lefthook where lefthook manages the hooks.

## Consequences

- `git push --no-verify` bypasses every client hook. The owner's instruction for AUTH pushes forbids it, the [pre-push workflow](../../../skills/arx-pre-push-checks/SKILL.md) otherwise allows a hook bypass only with explicit user agreement, and documentation pull requests come from a clone without AUTH objects.
- The guard recognizes two fixed commit ids and the ref name, so a rebased or cherry-picked AUTH commit under another ref name passes it; preparing documentation pull requests in a clone without AUTH objects is the compensating control.
- For AUTH code, the per-phase source publication of the round handoff note targets the private repository; handoffs and version advances still publish here.
- The accepted AUTH pull request merges only after integrated acceptance and independent reviews pass.
