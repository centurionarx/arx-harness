# arx-atomic-write

Atomic file replacement with pre-publication flushing, shared by the settings, credentials, and preset-metadata stores, plus the [private access check](#private-access-check) the identity packages run at startup. Windows private writes use lazily loaded Koffi bindings to create protected current-user-only files before writing content.

## Surface

```ts
import { withFileLock, writeFileAtomic } from '@arx-ai/arx-atomic-write'

declare const text: string
declare const render: (previous: string) => string

await writeFileAtomic('/home/u/.arx/settings.yaml', text, { mode: 0o600 })

// Read-modify-write against the same file from several processes.
await withFileLock('/home/u/.arx/settings.yaml', async () => {
  await writeFileAtomic('/home/u/.arx/settings.yaml', render(text), { mode: 0o600 })
})
```

`writeFileAtomic` commits one already-rendered string. The contract, in the order failures would exploit it:

- **Exclusive-create staging** uses a random sibling pathname and refuses an existing file or symlink. POSIX permissions are subject to umask. On Windows, mode `0600` creates a protected DACL granting only the current user full access, before any content is written; volumes without persistent ACLs reject private writes. Other Windows modes retain Node's permission semantics.
- **Content is flushed before publication.** POSIX writes use a file handle and `sync()`; Windows private writes use `FlushFileBuffers`. A failed write, flush, or pre-publication close leaves the destination unchanged and attempts staging cleanup.
- **Same-directory replacement** replaces a symlink itself rather than its referent. POSIX publication uses `rename`; Windows uses same-volume `MoveFileExW` with write-through. Cross-volume copying is never permitted. Windows access/sharing denials receive at most 500 ms of retry delay for short-lived readers or scanners; permissions are not changed and a persistent denial still rejects.
- New parent directories are created. `dirMode: 0700` requests protected current-user-only directories on Windows; existing directory access policies are not changed. POSIX creation flushes parent entries, and replacement flushes the destination's parent directory.
- Once replacement commits, a later directory flush or close failure cannot mean rollback. The operation resolves so callers publish the committed value, and emits `ATOMIC_WRITE_DURABILITY_UNCONFIRMED` without content. Pre-commit failures reject; failed staging cleanup additionally emits `ATOMIC_WRITE_CLEANUP_FAILED`.

`withFileLock` serializes the writers of one file across processes, for the read-render-commit cycles a bare atomic commit cannot make safe on its own. The lock is a `wx`-created `<filename>.lock` sibling, so readers never contend; waiters back off exponentially and fail with a timeout rather than block forever. `EEXIST` identifies contention directly. `EPERM` does so on Windows, which reports a lock pending deletion that way, and elsewhere only when a fresh `lstat` confirms that the lock path exists. At the deadline, a waiter whose last create failed with `EPERM` rethrows that error, so a permission failure still surfaces with its code; any other waiter fails with the timeout. A contender never removes the existing lock: age cannot distinguish a crashed owner from a paused live writer.

How long a contender waits is a property of the operation the holder runs, so it is stated per call through `waitMs`. The default is sized for file work alone; a holder whose cycle includes a network round trip — a credential mutation that refreshes an expired token — states a longer one, because leaving the default would fail every other writer of that file for the duration. The retry cadence stays fixed: it governs how often a contender asks, which no caller has a reason to vary.

## Private access check

`privateAccessViolation(path, info, { posixOwner })` reports why an existing file or directory is reachable by a principal other than the process user, or returns `undefined`. The caller passes its own `lstat` result and has already rejected symbolic links and wrong entry types, because the Windows read follows a final link. The identity key files, the identity database and its directory, and the authority journal use it at startup.

- **POSIX** rejects any group or other mode bit and, with `posixOwner: true`, an owner other than the process user.
- **Windows** reads the owner and DACL with `GetFileSecurityW`. It rejects an owner other than the process user, SYSTEM, or Administrators; a missing or null DACL; an access-allowed entry for any other principal, whatever its mask or inheritance flags; and any entry type other than access-allowed or access-denied. Deny entries are ignored, and an empty DACL passes. A violation names the principal's SID and the entry's access mask, so an operator knows which entry to remove.
- **Failure is closed.** A malformed descriptor is a violation; a failed native read rejects the returned promise.

The check verifies; it never changes a permission. On POSIX the type and the mode come from the same `lstat`. On Windows the access read looks the path up again and follows a final link, so an entry replaced between the `lstat` and that read is judged by its replacement. Replacing it requires write access to the parent directory, which already allows replacing the entry between the check and the caller's later open.

## Model Experience

None, as this is a pure filesystem primitive; nothing here reaches a model request.

#### KV Cache effect

None; nothing here enters a request prefix.

## Known Limitations and Deferred Work

- **Post-commit durability can remain unconfirmed** — a successful return confirms publication, not an unconditional power-loss guarantee. Operators must investigate durability warnings; filesystem, storage hardware, and remote-volume guarantees still apply. Existing parents and operating-system administrators are outside the private-file policy; restrict the store directory as well.
- **Volumes without persistent ACLs fail the Windows access check** — FAT-class volumes report a synthesized descriptor that grants Everyone access, so private identity files cannot live there.
- **String content only** — no `Buffer` or stream form until a consumer needs one.
- **Orphaned locks require operator recovery** — a process that exits while holding the lock can leave the sibling behind. Later writers time out without deleting it; an operator removes it only after verifying that no writer still owns it. File age alone is not safe evidence of abandonment.
