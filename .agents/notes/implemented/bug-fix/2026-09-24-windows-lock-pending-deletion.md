# Agent Note: a Windows lock pending deletion is contention

Status: implemented

## Problem

`withFileLock` in [`arx-atomic-write`](../../../../packages/util/atomic-write/README.md) takes a writer lock by creating `<file>.lock` with `wx`, as [the settings write-path note](../architecture/2026-07-30-settings-write-path-integrity.md) records. It treated an `EPERM` from that create as contention only when a fresh `lstat` found the lock, and rethrew every other `EPERM` as a permission failure.

On Windows, a lock its holder has just removed stays pending deletion until the last handle to it closes. During that time the exclusive create fails with `EPERM`, and the deletion can complete before the `lstat` runs. The contender then saw `EPERM` with no lock path and failed a write that would have acquired the lock a moment later. Two providers writing one credentials document at once hit this on the native Windows lane, in the `credentials-local` case that keeps both records when two providers write concurrently.

## Decision

On Windows, an `EPERM` from the exclusive create is contention and backs off like `EEXIST`. Elsewhere, an `EPERM` stays contention only when `lstat` confirms the lock path, because no other supported platform has a pending-deletion state.

At the deadline, a contender whose last create failed with `EPERM` rethrows that error rather than the timed-out error. A genuine permission failure on the lock path therefore still surfaces with its own code.

## Alternatives considered

**Treating an `lstat` failure as contention on every platform.** Without a pending-deletion state, an `EPERM` with no lock path is a permission failure, and holding it for the whole wait would only delay the report.

**One immediate retry after an `EPERM` with no lock path.** The pending state lasts until the holder's last handle closes, which one retry cannot reliably outwait. The bounded backoff already exists to wait out a holder.

**Re-running the failing test.** The race is in the lock protocol, not in the test: any two writers of one file on Windows can hit it.

## Consequences

On Windows, a permission failure on the lock path surfaces after the acquisition wait instead of at once: 2 s by default, or the caller's `waitMs`. It still carries `EPERM`.

The package tests simulate Windows for both paths. An `EPERM` whose lock has already gone is retried and acquires the lock. An `EPERM` that outlasts the wait rejects with `EPERM`, not the timeout message.
