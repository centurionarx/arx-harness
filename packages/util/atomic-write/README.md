# arx-atomic-write

Atomic file replacement with pre-publication flushing, shared by the settings, credentials, and preset-metadata stores. Windows private writes use lazily loaded Koffi bindings to create protected current-user-only files before writing content.

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

## Model Experience

None, as this is a pure filesystem primitive; nothing here reaches a model request.

#### KV Cache effect

None; nothing here enters a request prefix.

## Known Limitations and Deferred Work

- **Post-commit durability can remain unconfirmed** — a successful return confirms publication, not an unconditional power-loss guarantee. Operators must investigate durability warnings; filesystem, storage hardware, and remote-volume guarantees still apply. Existing parents and operating-system administrators are outside the private-file policy; restrict the store directory as well.
- **String content only** — no `Buffer` or stream form until a consumer needs one.
- **Orphaned locks require operator recovery** — a process that exits while holding the lock can leave the sibling behind. Later writers time out without deleting it; an operator removes it only after verifying that no writer still owns it. File age alone is not safe evidence of abandonment.
