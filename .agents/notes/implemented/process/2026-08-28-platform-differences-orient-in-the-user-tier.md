# Agent Note: platform differences orient in the user tier, and stay owned by their packages

Status: implemented

English | [中文](2026-08-28-platform-differences-orient-in-the-user-tier.zh.md)

## Problem

Every Windows-specific contract was already documented, and none of it was findable.

The shell gating lived in the base bundle's README, the write-restricted token's edges in the ACL sandbox's, tree termination and console-wide interrupt in the local subprocess provider's, log materialization in the JSONL backend's, and the skipped credential-mode check in the local credential provider's. A person deciding whether to run the harness on Windows would have had to read five package READMEs and know in advance that those five were the ones to read. Nothing in the user tier mentioned Windows at all.

The obvious repair — writing what Windows does into the user guide — would have created a second home for five contracts that already had one, and the two copies would drift the first time a backend changed.

## Decision

[Platform support](../../../../docs/user/guide/platforms.md) is an orientation page, not a second home. It names what differs, groups the differences by the question a reader is actually asking (which shell, what is confined, what happens when I cancel, what is durable, what is not enforced), and links each one to the package that owns it. Every technical claim on the page is a link away from its authority.

The page is a reference, not a tutorial: it answers a lookup, and nothing on it needs to be read in order.

Two gaps found while writing it were filled at their own homes rather than on the page. The profile module fallback documented itself as "one symlink per package" when it creates a junction on Windows — the distinction is why installing needs no elevation, so it belongs in `app-boot`'s README. The credential and materialization differences were already stated at their homes and are only linked.

## Alternatives considered

**A `docs/subsystems/` page.** Subsystem pages are the reference tier and would have carried this comfortably. Rejected: the reader deciding on Windows is a product user, not someone changing `packages/`, and the subsystems tier is scoped to type definitions and semantics rather than deployment consequences.

**Per-platform sections inside each owning README.** They already exist, and that is the point — the missing thing was never the content but a page that assembles it. Adding more per-README text would have deepened the same problem.

**Leaving it to the root README.** The root README is the run-it-now page; a platform matrix there competes with the first command a reader needs.

## Consequences

A backend change now updates one package README and, only if the summary line it feeds is wrong, one linked sentence on the platform page. `verify-md-links` fails when a linked home is renamed or removed, so the page cannot outlive its authorities silently.

The page is bilingual and registered in [website/docs.ts](../../../../website/docs.ts) under the Guide section, so it carries the pairing cost of every user-tier page.

## Related

[The documentation standard](../../../../docs/AGENTS.md) owns the tier taxonomy this placement follows.
