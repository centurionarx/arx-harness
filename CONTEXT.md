# Project context and continuation

This is the operational entry document for another developer. Read the [root instructions](AGENTS.md), [architecture](docs/architecture.md), and [round closure procedure](docs/cookbook/closing-a-round.md) before resuming work. Every phase publishes its changes with a shared version advance and an updated handoff.

## Source and authority

The private staging directory /home/azureuser/dev/arx-harness-auth-20261008 on dev-01 contains the original AUTH implementation over arx-harness 1.0.40 at commit 1e5309f133c8a09599fc90cfc003a1556677895b and has no Git metadata. arx-harness 1.0.45 carries the documentation and phased-release policy and no AUTH runtime code. AUTH work continues on the integrated working source /home/azureuser/dev/arx-harness-auth-gl4-int-src-20261103, an export without Git metadata that applies the staging implementation to arx-harness 1.0.48 at commit 1be3cc52c3f5da88118c53f6f092fccd508e9a2e.

The local clone /home/azureuser/dev/arx-harness-auth-gl4-int-git-20261103 records that source on branch auth-gl4/integrated-20261103: integration commit 4e3f65184358513c20107b0c0612be4bf8319ad6, applied from staging snapshot commit a022762f9ec6b7721b1d183ac883cf7b75c88ddb on branch auth-gl4/staging-snapshot-20261103, followed by type-correction commit f0204ac58cd6249625f7b6817612190ee3d4594d. The commits omit the gitignored binary native/landlock-run/packages/linux-x64/bin/landlock-run (SHA-256 a752bc72f111fcc573c3e61fb90fa544541dac0ca498d2e279e1630d7c659b31), which the working source contains unchanged.

No AUTH implementation branch (`auth-gl4/*`) and no commit containing the AUTH staging snapshot or integration commits is pushed to this public repository; the AUTH documentation history is public. In-progress AUTH code goes to a separate private repository ([decision](.agents/notes/implemented/process/2026-11-03-unaccepted-auth-code-stays-private.md)); a local pre-push hook in the local clone above refuses AUTH refs and commits toward this repository, and the staging status records the private push state and the secrets scan. The integrated source's tracked files reference private .gauntlet evidence. Any publication of the integrated commits to this repository requires merging the current master and aligning the nine added package manifests with the family version.

GitHub holds the published source; the [merge rule](AGENTS.md#after-a-merge-verify-on-github) requires verifying merges there.

The owner authorizes AUTH-GL4 execution, preservation of previous results, and versioned Git publication of each phase's documentation and version advance in this repository. Service activation or restart, public hosting or network changes, real logins or account bootstrap, secret configuration, real database migration or restore, and real Resend delivery retain separate operating authorization. Repository development authority does not change application roles.

Private evidence and fixtures are not part of this publication. An authorized developer needs access to the staging directory on dev-01; the handoff lives in this published document and the staging receipts it names. On the VM, the staging CONTEXT.md, .gauntlet/STATUS-AUTH-GL4-20261010.md and .gauntlet/GL_PLAN.md lead to the current status, task and execution receipts; integrated-source receipts are in .gauntlet/evidence/AUTH-001-20261008/AUTH-GL4-20261010/GL4-INT-20261103 within staging. These locations and the dev-01 source directories above are environment paths, not files in the published clone.

## Current AUTH round

AUTH-GL3 has a terminal BLOCKED result. AUTH-GL4 is an owner-approved corrective round; approval does not waive the original acceptance thresholds or erase R1 REVISE, R2 BLOCKED, or GL3 BLOCKED. Current execution evidence lives in .gauntlet/evidence/AUTH-001-20261008/AUTH-GL4-20261010 within staging. The preparation checkpoint and GL3 receipts remain preserved under the same evidence root.

Fingerprints use the AUTH-source-fingerprint/v5 method; .gauntlet/evidence/AUTH-001-20261008/fingerprint-source-root.py within staging computes it for any source root. The verified execution starting source has 6,738 fingerprinted files and SHA-256 bc76813835cefd5c7dc8d88e03a2b3b0e6292cea07a8c6fe24f6039799ff75f4. This is the starting identity, not a claim about later changed source. The integrated working source has 6,740 fingerprinted files and SHA-256 df019a6f99512771e843b35a5f3e332347a05081bd1751c51f63c92d90cffbce. BUILD16 and its 226-entry sealed backup identify the historical compiled application; runtime acceptance must exercise the final compiled source.

The current work order is lifecycle and storage correction, frontend and composer correction, coverage and persistence performance, documentation/catalog/lint/dependency checks, a coordinated official build, integrated acceptance, and independent code and design execution reviews. The next developer reads the current staging status before running a check or modifying source; agents coordinate CPU-heavy work and built artifacts.

On the integrated source, the frontend correction (GL4-03) passes its 75 paired and 16 adjacent focused tests, and `pnpm run typecheck` passes after the owner-authorized correction that declares the `model/selection` session event in the type-only agent event face. The integrated source has the same lint, knip unused-devDependency, generated-catalog and test-environment failures as the staging source. The owner authorized assertion-preserving corrections for them, behavior-preserving adjustments to canonical drivers and fixtures, and verification-only re-runs of passing packets that do not count as correction attempts; the staging status lists the details.

Preserve assertions, goldens, replay consumption, sandbox and Landlock, timeouts, model routes, integrations, and durability settings. Native persistence uses the original 200 operations and p95 candidate/baseline limit of 1.10, with the integrated source's exact base commit as the baseline, recorded in each measurement receipt. Selected frontend files and the worker boundary retain their required coverage thresholds. Final code and design reviewers execute the application independently before reading the diff. A further round after a terminal safety failure requires an owner decision.

## Product decisions and remaining operation

Identity, authorization, and indexes live in the server database. Session histories use private JSONL logs, and each project has persistent isolated filesystem storage on the server. A USER accesses their own projects and content. MASTER-ADMIN creates and releases users and modules without access to user project contents. Resend is the selected recovery-email provider. The bootstrap administrator account is fixed in the integrated source and must become a validated configuration value before AUTH code is published to this repository.

AUTH is not accepted or activated by this documentation phase. Remaining work is recorded in the staging status, plan and receipts. The accepted AUTH implementation reaches this repository only through a final pull request after integrated acceptance and independent reviews pass. Public access, real account bootstrap, mail delivery, migration, deployment, and physical worker isolation remain operating steps with their own evidence and authority.

## Resume and close a phase

1. Confirm the live branch, version, source identity, current AUTH status and receipts, existing modifications, and applicable instructions.
2. Follow the approved packet and its original check. Preserve sealed evidence and write a new receipt identifier; distinguish diagnostics, failures, skips, and acceptance results.
3. Update the owning documentation and this entry document when a published phase changes the current stopping point. Publish the phase through the version workflow and record the actual commit, pull request, CI result, remaining work, and operating authority.
4. Complete the pertinent documentation checks, link verification, and mandatory Graphify refresh after delegates settle. Report documentation closure separately from the product verdict.
