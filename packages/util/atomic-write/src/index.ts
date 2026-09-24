/**
 * Atomic, flushed file replacement and cross-process writer coordination.
 * Private Windows files use native protected DACLs, not Node's POSIX mode bits.
 * @module @arx-ai/arx-atomic-write
 */

import { randomBytes } from 'node:crypto'
import { lstat, mkdir, open, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createDirectoryWin32, openPrivateFileWin32, publishWin32 } from './win32.ts'
import type { PrivateFileWin32 } from './win32.ts'

/** Filesystem permissions for the replacement and newly created directories. */
export interface WriteFileAtomicOptions {
  /**
   * POSIX inode mode, subject to umask. On Windows, 0600 creates a protected
   * current-user-only DACL before any content; other modes retain Node semantics.
   */
  mode: number
  /**
   * Mode for new parents only, subject to umask on POSIX. Windows 0700 creates
   * protected current-user-only directories. Existing parents are not hardened.
   */
  dirMode?: number
}

function warnDurability(operation: string): void {
  process.emitWarning(
    'atomic-write: replacement committed, but ' + operation + ' failed; crash durability is unconfirmed (no rollback)',
    { code: 'ATOMIC_WRITE_DURABILITY_UNCONFIRMED' },
  )
}

function warnCleanup(): void {
  process.emitWarning('atomic-write: staging cleanup failed; a private temporary file or handle may remain', {
    code: 'ATOMIC_WRITE_CLEANUP_FAILED',
  })
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    if ((await stat(path)).isDirectory()) return true
    throw Object.assign(new Error('atomic-write: parent is not a directory: ' + path), { code: 'ENOTDIR' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function ensureDirectoryWin32(path: string, mode: number | undefined): Promise<void> {
  if (await directoryExists(path)) return
  const parent = dirname(path)
  if (parent === path) {
    throw Object.assign(new Error('atomic-write: filesystem root is unavailable: ' + path), { code: 'ENOENT' })
  }
  await ensureDirectoryWin32(parent, mode)
  const staging = join(parent, '.arx-mkdir-' + randomBytes(12).toString('hex'))
  await createDirectoryWin32(staging, mode === 0o700)
  try {
    await publishWin32(staging, path, false)
  } catch (error) {
    try {
      await rmdir(staging)
    } catch {
      // A failed cleanup must not replace the publication error.
      warnCleanup()
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST' && await directoryExists(path)) return
    throw error
  }
}

async function ensureDirectoryPosix(path: string, mode: number | undefined): Promise<void> {
  const firstCreated = await mkdir(path, { recursive: true, ...mode === undefined ? {} : { mode } })
  if (firstCreated === undefined) return
  const stop = dirname(firstCreated)
  // Every newly created ancestor entry must reach its own parent before commit.
  for (let current = dirname(path); ; current = dirname(current)) {
    const handle = await open(current, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (current === stop) return
  }
}

/**
 * Publish complete UTF-8 content through an exclusive random sibling. POSIX
 * syncs the file before rename and its open parent directory after rename;
 * Windows flushes the file and uses same-volume write-through replacement.
 * Mode 0600 on Windows requires persistent ACL support and grants only the
 * current process user access, without inheriting a permissive parent DACL.
 *
 * Rejection before publication leaves the target unchanged and attempts staging
 * cleanup. Once renamed, failures of parent sync or close emit the content-free
 * ATOMIC_WRITE_DURABILITY_UNCONFIRMED process warning and resolve: callers must
 * publish committed state, not report rollback. Fulfillment confirms visibility;
 * crash durability additionally requires all flushes to succeed and filesystem
 * support. Existing parents must be durable and trusted against hostile changes.
 * @param filename - final path; a target symlink is replaced, never followed.
 * @param content - complete next file content.
 * @param options - explicit permissions for the replacement and new parents.
 */
export async function writeFileAtomic(filename: string, content: string, options: WriteFileAtomicOptions): Promise<void> {
  const target = resolve(filename)
  const parent = dirname(target)
  const windows = process.platform === 'win32'
  if (windows) await ensureDirectoryWin32(parent, options.dirMode)
  else await ensureDirectoryPosix(parent, options.dirMode)
  const temp = join(parent, '.arx-write-' + randomBytes(12).toString('hex') + '.tmp')
  let directory: FileHandle | undefined
  let file: FileHandle | PrivateFileWin32 | undefined
  let ownedTemp = false
  let committed = false
  try {
    if (!windows) {
      directory = await open(parent, 'r')
      await directory.sync() // Reject unsupported directory syncing before replacing the target.
    }
    file = windows && options.mode === 0o600
      ? await openPrivateFileWin32(temp)
      : await open(temp, 'wx', options.mode)
    ownedTemp = true
    await file.writeFile(content)
    await file.sync()
    await file.close()
    file = undefined
    if (windows) await publishWin32(temp, target, true)
    else await rename(temp, target)
    committed = true
    if (directory !== undefined) {
      try {
        await directory.sync()
      } catch {
        // Publication already changed readers' state; a sync error cannot roll it back.
        warnDurability('parent directory sync')
      }
    }
  } finally {
    if (file !== undefined) {
      try {
        await file.close()
      } catch {
        // Preserve the write, sync, or close failure that triggered cleanup.
        warnCleanup()
      }
    }
    if (ownedTemp && !committed) {
      try {
        await rm(temp, { force: true })
      } catch {
        // Keep the pre-commit error authoritative when staging removal also fails.
        warnCleanup()
      }
    }
    if (directory !== undefined) {
      try {
        await directory.close()
      } catch {
        // Never turn a published replacement into a rejected write.
        if (committed) warnDurability('parent directory close')
        else warnCleanup()
      }
    }
  }
}

/** Whether an exclusive create found an existing lock. */
async function isLockContention(error: unknown, lockPath: string): Promise<boolean> {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'EEXIST') return true
  if (code !== 'EPERM') return false
  try {
    await lstat(lockPath)
    return true
  } catch {
    // Keep the original EPERM authoritative when lock existence is unproven.
    return false
  }
}

/**
 * Retry cadence for a contended lock. These stay robustness invariants of the
 * cross-process write protocol rather than deployment tunables: they govern how
 * often a contender asks, which no caller has a reason to vary.
 */
const LOCK_RETRY_INITIAL_MS = 20
const LOCK_RETRY_MAX_MS = 200

/**
 * How long a contender waits when the caller states no limit — sized for the
 * render-and-rename cycle every call site had when this package was written.
 * Expiry fails the contender rather than guessing whether the existing lock
 * still has an owner. How long is *worth* waiting is a property of the
 * operation the lock holder runs, which is why {@link FileLockOptions.waitMs}
 * exists; the value here is the floor for an operation that does file work
 * alone.
 */
const DEFAULT_LOCK_WAIT_MS = 2_000

/** Options for one {@link withFileLock} acquisition. */
export interface FileLockOptions {
  /**
   * Maximum time to wait for the lock, in milliseconds. State one when the
   * holder's operation legitimately runs longer than file work — a credential
   * mutation that refreshes a token performs a network round trip while
   * holding the lock, and leaving the default in place would fail every other
   * writer of the same file for the duration. Waiting is productive: a
   * contender that acquires the lock afterwards re-reads the committed state.
   */
  waitMs?: number
}

/**
 * Hold the cross-process writer lock for `filename` around one operation. The
 * lock is a `wx`-created sibling (`<filename>.lock`); paired with the
 * rename-based commit of {@link writeFileAtomic}, readers stay lock-free and
 * only writers contend. `EEXIST` is contention directly; an `EPERM` is
 * contention only when a fresh `lstat` confirms the lock path exists, covering
 * Windows exclusive-create behavior without hiding an unrelated permission
 * failure. Contention backs off exponentially and fails with a timed-out error
 * after the deadline. The contender never removes an existing lock because
 * file age cannot prove that its owner stopped; orphan recovery is an operator
 * action. The parent directory must exist.
 * @param filename - the file whose writers this lock serializes.
 * @param operation - the read-render-commit cycle to run while holding the lock.
 * @param options - acquisition options; omitted waits {@link DEFAULT_LOCK_WAIT_MS}.
 * @returns the operation's result; the lock releases on both outcomes.
 */
export async function withFileLock<T>(
  filename: string,
  operation: () => Promise<T>,
  options?: FileLockOptions,
): Promise<T> {
  const lockPath = `${filename}.lock`
  const deadline = Date.now() + (options?.waitMs ?? DEFAULT_LOCK_WAIT_MS)
  let delay = LOCK_RETRY_INITIAL_MS
  for (;;) {
    try {
      await writeFile(lockPath, `${process.pid}\n`, { mode: 0o600, flag: 'wx' })
      break
    } catch (error) {
      if (!await isLockContention(error, lockPath)) throw error
    }
    if (Date.now() >= deadline) {
      throw new Error(`atomic-write: timed out waiting for the writer lock at ${lockPath}`)
    }
    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS)
  }
  try {
    return await operation()
  } finally {
    await rm(lockPath, { force: true })
  }
}
