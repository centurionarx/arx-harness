/**
 * Protected append-only identity authority. Journal and watermark must remain
 * outside every database/content restore set; mode bits are not VM isolation.
 * @module @arx-ai/arx-identity-authority-journal
 */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { createInterface } from 'node:readline'
import { Context, Service } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import { IdentityAuthorityJournal, identityFailure } from '@arx-ai/arx-web-identity'
import type { AuthorityEvent, AuthorityHead, AuthorityRecord } from '@arx-ai/arx-web-identity'
const GENESIS = '0'.repeat(64)
/**
 * Canonical protected authority storage and explicit initialization/record-capacity policy.
 */
export interface Config {
  /**
   * Absolute protected authority directory holding the current journal and watermark outside rollback backups and
   * worker mounts.
   */
  root: string
  /**
   * Explicit operator or fixture permission to create an authority genesis; absent authority otherwise fails normal
   * startup closed.
   */
  allowInitialize?: boolean
  /**
   * Storage or backup roots that must not contain, or be contained by, the external current authority directory.
   */
  protectedRoots?: string[]
  /**
   * Byte ceiling for one serialized authority record before it can be appended or replayed.
   */
  maxRecordBytes?: number
}
function immutable<T>(value: T): T {
  const detached = JSON.parse(JSON.stringify(value)) as T
  const freeze = (entry: unknown): void => {
    if (typeof entry !== 'object' || entry === null)
      return
    for (const child of Object.values(entry))
      freeze(child)
    Object.freeze(entry)
  }
  freeze(detached)
  return detached
}
function hash(record: Omit<AuthorityRecord, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex')
}
/**
 * Single-writer hash-linked authority journal with fsync and an external current watermark.
 */
export class FileIdentityAuthorityJournal extends IdentityAuthorityJournal {
  static Config: z<Config> = z.object({
    root: z.string().required(), allowInitialize: z.boolean().default(false),
    protectedRoots: z.array(String).default([]), maxRecordBytes: z.natural().min(1024).default(1048576),
  })
  readonly root: string
  private handle: FileHandle | undefined
  private readonly records: AuthorityRecord[] = []
  private current: AuthorityHead = Object.freeze({ sequence: 0, hash: GENESIS })
  private poisoned = false
  private queue: Promise<unknown> = Promise.resolve()
  private locked = false
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    this.root = config.root
    ctx.effect(() => () => this.close(), 'identity-authority-journal: durable handle and exclusive owner')
  }
  get head(): AuthorityHead {
    if (this.poisoned || this.handle === undefined)
      identityFailure('AUTHORITY_UNAVAILABLE', 503, 'Identity authority unavailable')
    return this.current
  }
  protected async [Service.init](): Promise<void> {
    if (!isAbsolute(this.root) || (this.config.protectedRoots ?? []).some((root) => {
      if (!isAbsolute(root))
        return true
      const rel = relative(root, this.root)
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    }))
      identityFailure('AUTH_CONFIGURATION', 503, 'Authority journal must be outside restored roots')
    if (this.config.allowInitialize === true)
      await mkdir(this.root, { recursive: true, mode: 0o700 })
    const info = await lstat(this.root)
    if (!info.isDirectory() || info.isSymbolicLink()
            || (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))) {
      identityFailure('AUTH_CONFIGURATION', 503, 'Private authority directory required')
    }
    if (await realpath(this.root) !== this.root)
      identityFailure('AUTH_CONFIGURATION', 503, 'Canonical authority directory required')
    const lock = await open(join(this.root, 'writer.lock'), 'wx', 0o600)
    this.locked = true
    try {
      await lock.writeFile(String(process.pid))
      await lock.sync()
    }
    finally {
      await lock.close()
    }
    const file = join(this.root, 'authority.jsonl')
    const watermark = join(this.root, 'watermark.json')
    let existing = true
    try {
      await lstat(file)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
      existing = false
    }
    if (!existing && this.config.allowInitialize !== true)
      identityFailure('AUTHORITY_UNAVAILABLE', 503, 'Current identity authority required')
    if (!existing) {
      try {
        await lstat(watermark)
        identityFailure('AUTHORITY_UNAVAILABLE', 503, 'Current identity authority required')
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw error
      }
      this.handle = await open(file, 'wx+', 0o600)
      await this.handle.sync()
      await this.publishHead(this.current)
    }
    else {
      const fileInfo = await lstat(file)
      if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || (process.platform !== 'win32' && ((fileInfo.mode & 0o077) !== 0 || fileInfo.uid !== process.getuid?.()))) {
        identityFailure('AUTHORITY_UNAVAILABLE', 503, 'Private identity authority required')
      }
      this.handle = await open(file, 'a+', 0o600)
      if (fileInfo.size !== 0) {
        const tail = Buffer.alloc(1)
        await this.handle.read(tail, 0, 1, fileInfo.size - 1)
        if (tail[0] !== 10)
          identityFailure('AUTHORITY_UNAVAILABLE', 503, 'Incomplete identity authority')
      }
      const input = createReadStream(file)
      const lines = createInterface({ input, crlfDelay: Infinity })
      try {
        for await (const line of lines) {
          if (Buffer.byteLength(line) > (this.config.maxRecordBytes ?? 1048576))
            throw new Error('authority record capacity')
          const parsed = JSON.parse(line) as AuthorityRecord
          const body = { sequence: parsed.sequence, operationId: parsed.operationId, kind: parsed.kind,
            payload: parsed.payload, recordedAt: parsed.recordedAt, previousHash: parsed.previousHash }
          if (parsed.sequence !== this.current.sequence + 1 || parsed.previousHash !== this.current.hash || hash(body) !== parsed.hash) {
            identityFailure('AUTHORITY_UNAVAILABLE', 503, 'Identity authority integrity failure')
          }
          this.records.push(immutable(parsed))
          this.current = Object.freeze({ sequence: parsed.sequence, hash: parsed.hash })
        }
      }
      finally {
        lines.close()
        input.destroy()
      }
      const watermarkInfo = await lstat(watermark)
      if (!watermarkInfo.isFile() || watermarkInfo.isSymbolicLink()
                || (process.platform !== 'win32' && ((watermarkInfo.mode & 0o077) !== 0 || watermarkInfo.uid !== process.getuid?.()))) {
        identityFailure('AUTHORITY_UNAVAILABLE', 503, 'Private authority watermark required')
      }
      const actual = JSON.parse(await readFile(watermark, 'utf8')) as AuthorityHead
      if (actual.sequence !== this.current.sequence || actual.hash !== this.current.hash) {
        identityFailure('AUTHORITY_UNAVAILABLE', 503, 'Current identity authority watermark required')
      }
    }
  }
  recordsAfter(sequence: number): Promise<readonly AuthorityRecord[]> {
    return new Promise((resolve) => {
      const head = this.head
      if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > head.sequence) {
        identityFailure('AUTHORITY_UNAVAILABLE', 503, 'Invalid identity authority watermark')
      }
      resolve(Object.freeze(this.records.slice(sequence)))
    })
  }
  append(expectedSequence: number, event: AuthorityEvent): Promise<AuthorityRecord> {
    const snapshot = immutable(event)
    const task = this.queue.then(async () => {
      const head = this.head
      if (expectedSequence !== head.sequence || this.records.some(record => record.operationId === snapshot.operationId)) {
        identityFailure('AUTHORITY_CONFLICT', 503, 'Identity authority changed')
      }
      const body = { sequence: head.sequence + 1, operationId: snapshot.operationId, kind: snapshot.kind,
        payload: snapshot.payload, recordedAt: Date.now(), previousHash: head.hash }
      const record: AuthorityRecord = immutable({ ...body, hash: hash(body) })
      const line = JSON.stringify(record) + '\n'
      if (Buffer.byteLength(line) > (this.config.maxRecordBytes ?? 1048576))
        identityFailure('AUTH_CAPACITY', 503, 'Authority record capacity exceeded')
      try {
        await (this.handle as Awaited<ReturnType<typeof open>>).write(line)
        await (this.handle as Awaited<ReturnType<typeof open>>).sync()
        await this.publishHead(record)
        this.records.push(record)
        this.current = Object.freeze({ sequence: record.sequence, hash: record.hash })
        return record
      }
      catch {
        this.poisoned = true
        identityFailure('AUTHORITY_UNAVAILABLE', 503, 'Identity authority unavailable')
      }
    })
    this.queue = task.catch(() => { })
    return task
  }
  private async publishHead(head: AuthorityHead): Promise<void> {
    const temp = join(this.root, '.watermark-' + randomUUID())
    const handle = await open(temp, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify({ sequence: head.sequence, hash: head.hash }) + '\n')
      await handle.sync()
    }
    finally {
      await handle.close()
    }
    await rename(temp, join(this.root, 'watermark.json'))
    if (process.platform !== 'win32') {
      const directory = await open(this.root, 'r')
      try {
        await directory.sync()
      }
      finally {
        await directory.close()
      }
    }
  }
  private async close(): Promise<void> {
    await this.queue
    try {
      await this.handle?.close()
    }
    finally {
      this.handle = undefined
      if (this.locked) {
        this.locked = false
        await unlink(join(this.root, 'writer.lock'))
      }
    }
  }
}
export default FileIdentityAuthorityJournal
