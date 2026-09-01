# Agent Note: CI runs on runners this organization actually has

Status: implemented

## Problem

Every pull request in `centurionarx/arx-harness` was unmergeable, and the reason did not look like a runner problem.

The four heaviest required jobs — `node 24 / static`, `node 24 / coverage`, `node 24 / snapshots and artifacts`, and `windows node 24 / native complete` — named the hosted larger-runner pools `arx-ubuntu-24-04-16core` and `arx-windows-2025-16core`. Those pools are defined in the upstream organization and came along with the fork. This organization has no pool by either name.

GitHub does not reject a job whose `runs-on` label matches nothing. It queues it. The job sits until the 24-hour limit expires and is then reported as failed with a duration of `24h0m0s`. On a pull request the reviewer sees four required gates pending for a day and then red, with no log and no message naming a runner — which reads as a broken build, not a missing pool. Thirteen open pull requests had accumulated behind it, including every Dependabot bump.

## Decision

The four jobs run on GitHub's standard hosted runners: `ubuntu-24.04` and `windows-2025`.

The failover expressions are untouched. `ARX_CI_FAILOVER_LINUX` and `ARX_CI_FAILOVER_WINDOWS` still retarget onto the in-house self-hosted pools, and only the fallback arm of each expression changed. An organization that later defines a larger-runner pool edits one label per job to take it.

`ci-master.yml` keeps its private pool names. Its `larger-runner-benchmark` job exists to compare those pools across core counts and is `workflow_dispatch`-only, so it blocks nothing; repointing it at a standard runner would delete the measurement it exists to take.

`scripts/ci-workflow.spec.ts` pins the Windows label. The gate is not that a particular pool is used — it is that reintroducing a private pool name is a deliberate edit rather than a silent stall, because the failure mode costs a day per attempt and names nothing.

## Alternatives considered

**Defining the pools in this organization.** It preserves the upstream's tuning, and the benchmark job exists precisely because that tuning was measured. Rejected as the default: it requires organization-level setup outside the repository, so the repository would stay red until someone performed it, and a fork that never does it inherits the same day-long stall.

**Removing the failover expressions.** With one hosted pool per platform the expressions look like indirection with nothing behind it. Rejected: the self-hosted arm is the documented recovery path when hosted capacity is unavailable, and it is a repository variable away from being needed.

## Consequences

Standard runners are smaller than the pools these jobs were tuned for, so the coverage and consumer lanes take longer in wall-clock. They are within GitHub's per-job limit, and a slower gate that reports is worth more than a faster one that never starts.

Master-push jobs in `ci-master.yml` still target `self-hosted` pools this organization has not registered, so those runs stall the same way. They gate no pull request, so they are left as they are; an organization that wants that signal registers the pools or retires the jobs.

## Related

[CI failover runbook](2026-07-26-ci-failover-runbook.md) owns the failover variables and what to do when a pool is unavailable. [Native Windows pull-request CI](2026-08-08-native-windows-pull-request-ci.md) owns why the Windows native job is non-blocking.
