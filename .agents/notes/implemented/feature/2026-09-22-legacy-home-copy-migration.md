# Agent Note: the pre-rename home is copied forward, once

Status: implemented

## Problem

[The rebrand](../../../../packages/util/home-paths/README.md) moved the harness home from `~/.cxh` (`$CXH_HOME`) to `~/.arx` (`$ARX_HOME`) and left the old directory where it was. Nothing reads it. An upgrading user's settings document, managed credentials, profile `cordis.patch.yml` layers, and every past session stayed on disk and became invisible in one launch.

What that looks like is not an error message. The harness boots against an empty home, finds no configured provider and no model, and [the composer blocks](../../../../packages/client/ui-model-selection/src/client/service.ts) — so a user whose profile patch layer configured a route now has no route, no selection, and no explanation. The data is intact and unreachable, which is the worst shape a migration gap can take: nothing warns, and a user who reinstalls to recover has nothing to recover from.

## Decision

`migrateLegacyHome` copies the legacy tree into the current home on the launch that finds the current home absent, before anything reads either one. `apps/cli/src/bin.ts` calls it ahead of `loadLayeredEnv`, which reads `$ARX_HOME/.env`, and ahead of `--dump-config`, which reads the home patch layer.

**It copies and never moves.** The legacy directory is left byte-identical, so a user who upgrades, dislikes the result, and reinstalls the older build still has everything. Deleting it is theirs to do, and the notice says so. The cost is that the data exists twice until they act.

**The current home existing is the whole idempotence rule.** A second launch, a launch after an interrupted first one, and a home the user created by hand all take the same branch and copy nothing. There is no flag, no version counter, and no comparison of directory contents — one `stat` decides.

**The copy is published by rename.** `fs.cp` writes into a sibling `\<home\>.migrating-\<random\>` staged by `mkdtemp`, the marker lands inside it, and a single `rename` makes it the home. An interrupted or failed copy therefore never leaves a half-populated `$ARX_HOME` that the next launch would mistake for a migrated one, which is exactly the state the idempotence rule cannot distinguish. Staging left by an earlier interrupted run is removed at the start of the next attempt, matched by this module's own prefix so a user's `~/.arx-backup` is never touched.

**Symlinks cross as symlinks.** A profile's flat module fallback (`profiles/node_modules`) is a tree of them; resolving each would copy the whole installation into the user's home.

**A present legacy home that cannot be copied fails the launch**, naming the escape in the error: create the current home yourself — an empty directory skips the copy — or point `ARX_HOME` elsewhere. Booting into an empty home instead would hide data the user still has, which is the defect this note exists to remove.

**Only `$CXH_HOME` / `~/.cxh` is honoured.** That is the one home this product wrote before it was arx. `~/.dsh` belongs to a differently-composed harness whose settings namespaces this one does not own, and copying it would import sections nothing here registers.

The copy is reported, not just performed. `ctx.homeMigration` joins `ctx.appVersion` and `ctx.appExit` as a launcher fact carrying display forms only — `~/.cxh` or `$CXH_HOME`, never an absolute path — and `host.describe.homeMigration` serves it to the browser. A second `settings.onboarding` step, ordered after the welcome notice, shows the user what moved and acknowledges by recording the copy's own instant.

That instant is the notice's version, which is why [the notice store](../../../../packages/client/ui-settings-models/src/client/notice-store.ts) reads its version per comparison rather than capturing it: the Host fact arrives after the binding is made. Generalizing that store is what let a second notice exist at all — it differed from the welcome notice only in which field holds the acknowledgement and which string counts as current.

The step completes without rendering when a description that arrived carries no copy. Absence of a description is not absence of a copy — the source reports none while reconnecting — so only an arrived description settles the question; otherwise a reconnect would retire the step for a user who never saw the notice.

## Alternatives considered

- **Move the directory instead of copying it.** One step, no duplication, and no deletion left to the user. Rejected: a move is unrecoverable from inside the product. An upgrade that goes wrong, or a user who wants the previous build back, has nothing to return to, and the failure mode of a partial move is a home split across two locations with no record of which half is authoritative.
- **Symlink `~/.arx` to `~/.cxh`.** Zero duplication and instantly consistent. Rejected: it makes the old path load-bearing forever, on Windows it needs a privilege ordinary users lack, and every later write silently edits a directory the product no longer claims.
- **Read the legacy home as a fallback at every resolution.** No copy at all. Rejected: it spreads the rename across every consumer of the home, forever, and leaves two directories that can both hold a `settings.yaml` with no rule for which wins.
- **Migrate `~/.dsh` as well.** It is the upstream product's home and some users may have one. Rejected: its documents name settings namespaces this composition does not register (`llm-deepseek`, `web-search-deepseek`, and the rest of [the drop-list](../../proposed/process/2026-09-05-ship-sync-integrate-then-translate.md)), so the copy would import sections nothing reads and credentials for routes nothing serves.
- **Skip silently when the copy fails.** A launch always succeeds. Rejected by [the fail-loud rule](../../../../AGENTS.md): the whole point is that silently booting into an empty home is the defect, and doing it after finding the old home is worse than doing it by accident.
- **Ask the user before copying.** Rejected for the first launch specifically: the question arrives before any surface exists to ask it from, and the honest default is that a user upgrading one product wants their own settings.

## Consequences

A user upgrading across the rename keeps their configuration and is told where it came from. `~/.cxh` survives until they remove it, so disk holds both copies — `sessions/` and `storages/` included, which for a long-lived install is the bulk of it.

The marker `$ARX_HOME/.migrated-from.json` is what a later launch reports from, so deleting it stops the notice from ever appearing again; that is its only effect. It is not a settings namespace, so the settings file provider never rewrites it.

A user who already made `~/.arx` by hand — including an empty one — is never migrated, and nothing tells them why. That is the documented escape from a failing copy, and it is the same branch, so the escape and the silent skip cannot be separated without giving up the one-`stat` rule.

`ctx.homeMigration` is provided on every launch, absent or not, so a consumer reads one answer. `host.describe` gained an optional field; it carries no absolute path, and the notice substitutes the Host's symbolic names into its copy rather than formatting a path of its own.
