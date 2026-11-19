# Agent Note: Native web authority and owned control-plane storage

Status: proposed

## Problem

An Internet-facing agent host needs account authorization and content isolation in addition to a browser-origin fence. An operator account must manage admission without obtaining project contents, while each USER needs durable history and multiple owned projects across devices. Restoring an older backup must not revive a blocked account, a consumed recovery link, a revoked grant, or deleted ownership. A shared process UID and path naming alone cannot establish those boundaries.

## Proposal

Keep local operator composition and native web composition explicit. Native requests use canonical serving origins, audience-specific HttpOnly cookies, an ephemeral CSRF verifier, and provider-issued immutable authority. The control gateway admits only the existing allowed USER protocol and never invokes shared-host interceptors or an operator fallback. A missing isolated supervisor leaves execution unavailable.

Use separate administrative identity and owner-content indices. Preserve the authoritative session-event artifacts, replay consumption, SDK formats, JSONL/Zstandard checksums, sandbox policy, and existing timeouts. The private content index may be rebuilt from authoritative owned logs and current ownership; it cannot establish ownership itself. Navigation DTOs contain opaque identifiers and names. A USER's explicit raw export preserves the original artifact, which can contain paths from that USER's volume.

The MASTER_ADMIN manages USER admission and a fixed operator-installed module catalog. The role does not read projects or history, execute tools, impersonate a USER, change an established USER password, or install arbitrary plugins or presets. Invitations establish the recipient's own password independently of account release. Initial MASTER provisioning is an explicit operator action; startup does not recreate deleted authority. Recovery links are single-use, expiring, and delivered through encrypted outbox state with a key outside database backups and worker mounts.

Keep the authorization journal and current watermark outside the database/content backup set. Commit journal records durably before the SQLite FULL projection and acknowledge only after affected operations confirm quiescence. Restoration replays current revisions and tombstones and invalidates historical browser sessions and invitation/reset tokens. Missing or inconsistent authority closes access; a database transaction and a journal append are not a two-phase commit.

Render native HTML from the original request through one request-renderer registration. Anonymous and administrative compositions contain only the neutral application graph. USER composition is a closed projection of current grants; an application composition provides owned project/history access even without execution permission. The browser confirms the authenticated state before factories are materialized, and a disposed boot cannot publish a late factory or response. The composition marker is a consistency view, never authorization. Native rendering does not run shared operator index injections or taps.

These boundaries extend the [browser trust decision](../../implemented/architecture/2026-07-28-api-browser-trust-boundary.md) without removing the local-origin policy, retain the [project session-directory layout](../../implemented/architecture/2026-07-24-project-session-directories.md), and retain [event-sourced history](../../implemented/architecture/2026-06-11-event-sourced-sessions.md). All three records remain active because their independent local transport, collision, and event-ordering rationale still applies.

## Alternatives considered

Browser-local authoritative storage loses cross-device continuity and makes server admission and revocation unenforceable. A database containing every source file, Git object, build artifact, and event chunk gives up the existing filesystem/tooling and replay contracts. A single same-UID host with owner labels leaves filesystem and process access outside the owner check. Giving MASTER an implicit project superuser role conflicts with administrative-only access. Reusing a restored database revision as current authority revives historical permissions and credentials. A public/admin shell with hidden project widgets still materializes privileged factories; a neutral composition avoids that dependency.

## Acceptance criteria

AUTH source and disposable fixtures must pass meaningful identity, owner, restore, durability, carrier, browser lifecycle, type, package, documentation, and independent-review checks without weakening existing assertions, snapshots, replay consumption, sandbox limits, or timeouts. New raw paging validates the containing Zstandard frame checksum before publishing a prefix. The approved benchmark compares equivalent durable operations on the same runtime, hardware, resources, filesystem, and instrumentation; the 500 ms list/open p95 and 10% comparable p95 regression limits remain blocking. A filesystem microbenchmark is not an equivalent end-to-end tool/worker result.

Public cutover requires separate authorization and evidence for independently isolated worker UIDs/volumes/mounts/network, protected operator storage, canonical HTTPS origins, email delivery, quotas, retention, restore objectives, and emergency access. Disposable HTTP/subprocess fixtures prove protocol authorization and cancellation only. Publication, Git mutation, real provisioning, real email, data migration, and service activation are distinct actions.

## Risks

A supervisor receipt is only as trustworthy as its independently verified process-tree control and isolation. A giant Zstandard frame requires decoding through its checksum even when the browser asks for a small prefix. Complete loss of current authority cannot be repaired by treating an older backup as current; access stays closed. Metadata and cookies can be protected while a preview still confuses the browser, so previews retain opaque sandboxing and strict messaging without shell credentials. Operational isolation and non-equivalent benchmark classes remain explicit cutover blockers.
