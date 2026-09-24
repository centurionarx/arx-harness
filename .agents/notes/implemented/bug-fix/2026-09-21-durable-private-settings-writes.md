# Agent Note: private file replacement has a visible commit point

Status: implemented

## Problem

Settings, credentials, and preset metadata share atomic replacement, but atomic visibility alone does not flush data or directory entries. Node's POSIX mode argument also does not establish a private Windows DACL. Reporting a failed post-rename flush as a rejected write would leave a consumer's cached value behind the file readers already observe.

## Decision

The atomic-write utility creates an exclusive random sibling, writes and flushes its content, closes it, and only then publishes it. POSIX uses file and directory synchronization. Windows uses same-volume write-through publication; private mode `0600` creates a protected current-user-only DACL before content and rejects volumes without persistent ACL support before writing bytes. New Windows parents requested with `0700` receive a protected inheritable DACL; existing parent policies are unchanged. Native dependencies load only on Windows. This owner-only application-state policy is distinct from [workspace-file replacement](2026-07-19-windows-atomic-write-dacl-preservation.md), which preserves the target's user-defined DACL.

Windows readers that omit delete sharing can temporarily make `MoveFileExW` return access denied. Publication retries these access/sharing failures with a bounded 500 ms delay budget, without changing permissions or adding a copy fallback. A permanent refusal still rejects and retains the previous destination. The [native verification](../../../../packages/util/atomic-write/tests/win32-native.spec.ts) covers sharing denial and deferred publication.

Publication is the commit point. Earlier failures reject and attempt removal of the owned staging file without replacing the destination. After publication, a failed parent-directory flush or close emits `ATOMIC_WRITE_DURABILITY_UNCONFIRMED` and resolves so consumers publish the already-committed value. Cleanup failure emits `ATOMIC_WRITE_CLEANUP_FAILED` without masking the primary failure. Warnings contain neither file content nor arbitrary exception text.

## Alternatives considered

**Use Node mode bits as Windows permissions.** They do not install an owner-only ACL. The utility uses native security descriptors rather than describing a private policy the operating system does not enforce.

**Set permissions after writing or replacing.** This leaves a period in which the new content can inherit wider access. Security attributes are supplied at exclusive creation instead.

**Reject after a committed rename.** A rejection cannot undo publication and would encourage callers to retain stale state or retry an operation whose effects are visible. A distinct durability warning preserves that distinction.

**Add a filesystem plugin.** These consumers write their own local application state rather than agent workspace files. A new replaceable capability adds no current consumer requirement; the existing utility owns the OS-specific publication behavior.

## Consequences

Successful publication is not an unconditional guarantee against storage hardware failure. Operators must investigate durability warnings. Filesystems without persistent Windows ACLs reject private content, and existing directories must be secured separately. Administrative privileges and malicious modification of parent directories remain outside the file-level access policy. Orphaned writer locks still require operator recovery.

Focused tests cover pre-commit failures, post-commit warnings, cleanup errors, directory races, unavailable roots, native handle and allocation cleanup, partial UTF-8 writes, and unsupported ACL volumes. A real Windows test independently reads the resulting security descriptors and checks private replacements and new parents while confirming the existing parent's policy is unchanged. Native string storage is read directly with its UTF-16 length, not misinterpreted as a pointer-to-pointer. Settings and preset consumers exercise the shared write path without a subprocess in production.
