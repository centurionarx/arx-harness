# Agent Note: retire the upstream sync tooling

Status: implemented

## Problem

This repository began as a snapshot of another harness, with no shared history. On 2026-09-23 a manifest, a triage page, and an import check were added so that work from the original project could enter one decision at a time. In the two months since, no import ran. The triage stopped on 2026-09-22 with 334 of its 495 rows never judged: 3 `present`, 42 `incorporate`, 93 `evaluate` (6 with a recorded verdict), 20 `drop`, 3 `deferred`, and the rest `untriaged`. The manifest was also the one path that [`verify-vendor-name`](../../../../scripts/verify-vendor-name.ts) skipped, because it spelled the original repository URL and package scope, so every other file was held to the [vendor naming rule](2026-08-31-centurionarx-brand-naming.md) while this one was not.

## Decision

The tooling is removed:

- `scripts/upstream-sync.manifest.json`, `scripts/upstream-sync-manifest.ts`, `scripts/gen-upstream-triage.ts`, and `scripts/check-upstream-import.ts`, each with its spec;
- the pages `docs/upstream-sync.md`, `docs/upstream-triage.md`, and `docs/cookbook/syncing-from-upstream.md`;
- the `gen-upstream-triage` and `check-upstream-import` commands of `package.json`.

`verify-vendor-name` exempts no path. Its spec proves that the former manifest path, license files, and vendored sources are all scanned.

Corrections from the original project have no systematic tracking. A one-off review, when one is wanted, runs outside this public tree. The vendored Cordis sources in `vendor/` and their [sync procedure](../../../../vendor/README.md) are unchanged, and so are `LICENSE` and `THIRD_PARTY_NOTICES`. Git history keeps every removed file; restoring the tooling is a revert of the retiring commit.

## Alternatives considered

**Keep the tooling dormant.** The manifest's exemption in the vendor-name gate, the 334-row backlog, and three documents that read as live procedure all stay, in exchange for an import nobody has run.

**Move the manifest out of the gate's reach and keep the rest.** The gate would still need a path exemption or a manifest that avoids the original repository URL, and the triage would still need a local clone of the original project that CI never has.

**Finish the backlog first.** Judging 334 rows costs more than the changes it admits are likely to be worth to a tree that has diverged on providers, the brand, and the session store.

## Consequences

The vendor-name gate has no path exemption, and the exception list is brand forms, access forms, and access terms.

What the retired tooling recorded, for anyone who revives a sync:

- The snapshot reproduces the original project's release merge of 2026-08-21, not the rebrand of 2026-08-26 that an earlier proposal assumed: the first commit carries the 0.1.1-rc.2 version of that merge, holds all 739 of its Agent Notes, and shares more identical files with it than with any other commit that week. Fifty-nine notes landed between that merge and the rebrand.
- Merging the original `master` or adding it as a subtree is one conflict per file and would bring back what this tree removed on purpose: the vendor default model, the first-run dialog, and the vendor packages.
- The original project's pull-request titles and branch names are in Chinese or carry the vendor's name, so a triage that copies them breaks the no-CJK and vendor-name rules; note names are English and stable, so they were the index, renamed through a map.
- Seven notes implemented here sit under the original project's `rejected/`: a reversal there is a decision to judge, not a row to import.

What this gives up: upstream fixes reach this tree only when someone notices them, and nothing records which original-project decision was taken, dropped, or never read. The [first-sync section of the release proposal](../../proposed/process/2026-09-05-ship-sync-integrate-then-translate.md#phase-2--the-upstream-sync-policy) is abandoned with the tooling.
