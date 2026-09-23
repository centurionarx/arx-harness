# Agent Note: the upstream sync manifest, triage, and import check

Status: implemented

## Problem

This repository was forked from an upstream harness as a snapshot with no shared history. Nothing recorded which upstream commit the snapshot reproduces, which upstream work this tree takes, or what upstream had decided since, so every question about an upstream change started from a fresh comparison. [The proposed sync phase](../../proposed/process/2026-09-05-ship-sync-integrate-then-translate.md#phase-2--the-upstream-sync-policy) specified the policy — a manifest, a core rule, keep and drop lists, an identifier map, and a triage of 70 upstream decisions — dated from a fork it placed on 26 August 2026.

That date was wrong. The upstream commit this repository's first commit reproduces is the release merge of 21 August, recorded as `forkBase` in the manifest:

- this repository's first commit carries the version that merge introduced, 0.1.1-rc.2;
- all 739 Agent Notes in the upstream tree at that merge are in this repository's first commit, and none of the three the next upstream merge adds is;
- the upstream tree at that merge shares more identical files with this repository's first commit than any other upstream commit that week.

Fifty-nine upstream notes landed between the true fork base and the 26 August snapshot, and the triage of 2026-09-05, which read notes dated 26 August or later, judged five of them.

Upstream pull-request titles and branch names are written in Chinese or carry the upstream vendor's name, and the owner's standing rule admits neither into this tree: no CJK text, and the vendor's name only where it configures model access, per [the brand naming note](2026-08-31-centurionarx-brand-naming.md) and [the vendor note](../architecture/2026-09-03-the-vendor-is-configuration-not-a-brand.md). A triage that copies upstream titles breaks both rules.

## Decision

[`scripts/upstream-sync.manifest.json`](../../../../scripts/upstream-sync.manifest.json) is the only file that spells upstream identifiers: the repository URL, the fork base, the drop list, the core paths, the identifier map, the name renames, the forbidden words, and the recorded verdicts. [`scripts/upstream-sync-manifest.ts`](../../../../scripts/upstream-sync-manifest.ts) validates it on every read. [The upstream sync reference](../../../../docs/upstream-sync.md) defines the policy in terms of the manifest's fields, and [the sync cookbook](../../../../docs/cookbook/syncing-from-upstream.md) imports one decision; neither names an upstream identifier.

[`scripts/gen-upstream-triage.ts`](../../../../scripts/gen-upstream-triage.ts) writes [the triage](../../../../docs/upstream-triage.md) from a local upstream clone named by `ARX_UPSTREAM_CHECKOUT`. One row per Agent Note added on the upstream first-parent history after the fork base carries the note's date and name, the upstream PR number, the landing commit, the areas that commit touched, and a class. Names pass through the manifest's `slugRenames`, whose entries replace the upstream product prefix and the vendor's name segment by segment. The generator refuses to write a page containing a CJK character or a `forbidden` word, so an unmapped name stops generation instead of landing. A recorded verdict sets a row's class; otherwise a row is `present` when a note with the same date, name, and status exists here, `drop` when every path its commit changed is drop-listed, `evaluate` when that commit changes a core source path or a `SessionEventMap` declaration body, and `untriaged` otherwise. The generator refuses a verdict that names no row or a note already present, so an import removes its verdict in the same change.

[`scripts/check-upstream-import.ts`](../../../../scripts/check-upstream-import.ts) scans a staged import. It fails on a drop-listed path, an added CJK character, or an added upstream identifier prefix the map covers, and it lists every added line holding a forbidden word for a person to confirm as model-access configuration. An imported note cites its origin as `upstream PR #N`; the manifest's repository resolves the number, so the citation never names the vendor.

The recorded verdicts carry the 2026-09-05 triage with three changes:

- The three core changes that triage evaluated and did not admit are recorded as `drop`, with the core-rule reason.
- `web-turn-rail-outline-jump` is recorded as `drop`: [the whole-session turn outline](../feature/2026-09-12-whole-session-turn-outline.md) implements its outline projection and jump paging here.
- The drop list gains the two upstream account sign-in packages added after that triage, by the same criterion as the vendor's other packages.

This implements sections 2a to 2d of the proposal; 2e, the first sync, remains proposed.

## Alternatives considered

**Merge upstream `master`, or add it as a subtree.** Without shared history a merge is one conflict per file. Either way it would also bring back what this tree removed on purpose: the vendor default model, the vendor first-run dialog, and the vendor packages.

**Copy upstream titles into the triage and translate them.** Hundreds of rows would need hand translation before every regeneration, and one missed title puts CJK text into the tree. Note names are English, stable, and already the upstream's own index of its decisions.

**Keep the manifest as tables in the reference page.** The generator and the check would parse Markdown, and the tables would spell upstream identifiers in prose. A JSON manifest validated on read follows the repository's other script manifests.

**Run the triage in `doc-sync`.** It needs the upstream clone, which CI does not have; the procedure regenerates the page on every sync instead.

**Class every remaining row as `import`.** That records a judgment nobody made: the 2026-09-05 triage dropped 15 of the 61 non-core decisions it read, for reasons no path check sees.

## Consequences

Measured on 2026-09-23 against upstream commit `00102833df`, the triage lists 495 notes: 3 present, 42 incorporate, 93 evaluate (6 recorded), 20 drop, 3 deferred, and 334 untriaged. The rows without a recorded verdict are the triage backlog: 54 of the 59 notes that landed between the fork base and the snapshot, and every note that landed after the 2026-09-05 triage.

Seven notes implemented here now sit under upstream's `rejected/`. The triage lists each as `untriaged` with both statuses, so an upstream reversal gets judged rather than missed.

The mechanical classes over-approximate on purpose. `evaluate` flags any change inside a core source path or a `SessionEventMap` declaration body, and a person's verdict decides.

What this gives up:

- A decision re-implemented here under another name has no row match; it is recorded as a `drop` verdict naming the local note.
- An import that renames its note beyond `slugRenames` would read `untriaged` again, so the procedure keeps the upstream name.
- The triage is fresh only as of its last regeneration, because no gate can check it without the upstream clone.
