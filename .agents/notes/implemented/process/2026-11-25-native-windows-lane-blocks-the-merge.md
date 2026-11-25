# Agent Note: the native Windows lane blocks the merge

Status: implemented

## Problem

`windows node 24 / native complete` ran on every pull request but stayed out of `all checks passed`, as the [dual Windows decision](2026-08-08-native-windows-pull-request-ci.md) chose so that merges would not wait for the slowest job or for Windows capacity. Its result therefore could not stop a merge. Red results accumulated unnoticed: the lane failed on every pull request from the AUTH merge on 2026-11-19 ([#164](https://github.com/centurionarx/arx-harness/issues/164)), and returning it to green on 2026-11-25 took four pull requests (#165, #168, #170, #172) that fixed Windows-only defects in specs and in the identity file-access checks. Those defects merged because the only real Windows-kernel result could not block the merge.

## Decision

`windows-native` is a dependency of `all-checks-passed` in [ci.yml](../../../../.github/workflows/ci.yml), next to the Wine `windows` job. A failed, cancelled, or skipped native result makes the verdict fail, and the verdict waits for the native job to finish.

The job keeps its triggers, runner selection, `ARX_CI_FAILOVER_WINDOWS` switch, 120-minute timeout, and gate inventory. Workspace build, production-site, and 100%-per-file coverage failures still fail the job; the static, documentation, package, built-artifact, lint, and snapshot inventories in it stay observational, because Linux owns their blocking verdict.

Every job in `all-checks-passed.needs` runs under the same `github.event_name == 'pull_request'` condition as the verdict, so no event can skip a needed job and leave the verdict red. [scripts/ci-workflow.spec.ts](../../../../scripts/ci-workflow.spec.ts) asserts both the native dependency and that shared condition for every needed job.

## Alternatives considered

**Keep the lane independent.** Merge latency stays at the slowest Linux job, but the record since #164 shows a non-blocking red result does not get fixed before the next merge.

**Require the native check directly in branch protection.** That adds a second required check name outside the repository, while the stable single verdict exists so that branch protection never enumerates jobs.

**Block only on the native coverage gate.** The build and production-site gates fail the job for Windows-only reasons too, and a split job would duplicate the install and build.

**Mark other jobs `continue-on-error` to compensate for the added latency.** That masks their conclusions, which the dual Windows decision already rejects for the native job.

## Consequences

The verdict waits for the slowest job. On #172 the slowest previously required job, `node 24 / coverage`, took 12 minutes 26 seconds, and the native job took 33 minutes 10 seconds on the standard `windows-2025` runner, so a green verdict arrives about 20 minutes later.

A hosted Windows capacity outage now blocks every merge. `ARX_CI_FAILOVER_WINDOWS=selfhosted` retargets the job onto the in-house pool per the [failover runbook](2026-07-26-ci-failover-runbook.md); Dependabot pull requests stay on the hosted runner even then and wait for it.

A Windows-only failure in a product check or a test can no longer merge. Fix it or show that it is not the pull request's own, under the existing rule that no test is skipped to get green.
