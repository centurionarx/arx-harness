# Protected identity authority journal

This reference owns `ctx.identityAuthorityJournal`. Required config is a private absolute `root` outside every auth/content backup and worker volume; `protectedRoots` rejects accidental containment. `allowInitialize` defaults to false. Initialize a new authority only through an explicit operator/fixture action, and keep its journal and watermark current when restoring an older DB. [The identity definitions](../web-identity/README.md) own the shared service API.

Records are append-only, hash linked, newline bounded and fsynced before atomic, fsynced watermark publication. Events and returned records are detached and recursively frozen. A single exclusive writer is enforced. Missing/incomplete/corrupt journal, mismatched watermark, conflicting sequence or reused operation ID fails closed. A crashed writer lock requires operator verification before removal; there is no automatic PID-only lock stealing. Normal disposal releases the lock.

The journal includes credential verifiers, authorization changes, opaque ownership and tombstones, never project content, plaintext passwords or raw tokens. Protect it from workers and the MASTER web role, retain it for every recoverable backup, and exclude it from snapshot sets that can be rolled back. SHA-256 links detect corruption; they cannot defend against an operator with write access to the complete journal/watermark. Mode bits are a local configuration check, and a shared UID is insufficient.

The companion compares projected events with the current journal head. Journal commit precedes the [SQLite FULL projection](../web-identity-sqlite/README.md); this is a replayable protocol, not a two-phase transaction. ACK covers local crash durability, not loss of the authority disk. [The decision record](../../../.agents/notes/implemented/architecture/2026-10-08-native-web-identity-journal-and-audience.md) explains the restore boundary.

The journal exposes no model tools. [The keyless fixture](../../../examples/web-identity/README.md) uses an external synthetic directory; production authority placement and recovery require independent operator evidence.

## Model Experience

### Current administrative authority

#### What the model sees

`IdentityAuthorityJournal` persists authority decisions outside project histories. Journal records are not conversation events or model input.

#### Token effect

Zero direct request-token effect. Model-facing consumers retain ownership of their existing messages and schemas.

#### KV Cache effect

This package contributes no model-visible request prefix or cache-key mutation.

## Known Limitations and Deferred Work

- The journal and watermark require protected persistent storage and one writer. Filesystem durability does not provide replication or recovery after total authority-disk loss.
