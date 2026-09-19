/**
 * Offline session migration preflight and non-destructive verified snapshot copy.
 * The current arx format is the only supported target; upstream format numbers
 * do not imply compatible event schemas.
 */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, realpath, link, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  decodeStorageRecord, KNOWN_SESSION_EVENT_TYPES, Session, SessionId, SESSION_FORMAT_VERSION,
} from '@arx-ai/arx-session'
import type { SessionEvent, SessionHeader } from '@arx-ai/arx-session'

const MAX_BYTES = 64 * 1024 * 1024

/** Evidence returned by preflight; the checksum binds a later copy to these exact bytes. */
export interface MigrationInspection {
  readonly sourceSha256: string
  readonly sourceBytes: number
  readonly sessionId: string
  readonly sourceVersion: number
  readonly targetVersion: number
  readonly eventCount: number
  readonly eventTypes: readonly string[]
  readonly conversion: 'identity'
}

/** Validate a complete current-format plaintext JSONL snapshot without repairing it. */
export function inspectSessionSnapshot(bytes: Buffer): MigrationInspection {
  if (bytes.length > MAX_BYTES) throw new Error('Session exceeds the 64 MiB offline migration limit')
  if (bytes.length === 0 || bytes.at(-1) !== 10) throw new Error('A complete newline-terminated JSONL snapshot is required; torn tails are not repaired')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const records = text.split('\n')
  records.pop()
  const firstLine = records.shift()
  if (firstLine === undefined) throw new Error('Session header is missing')
  const first: unknown = JSON.parse(firstLine)
  if (typeof first !== 'object' || first === null || Array.isArray(first)) throw new Error('Invalid session header')
  const header = first as Record<string, unknown>
  if (header.type !== 'session' || typeof header.id !== 'string' || !header.id) throw new Error('Invalid session header')
  if (header.version !== SESSION_FORMAT_VERSION) {
    throw new Error('No reviewed migration adapter from format ' + String(header.version) + ' to arx format ' + String(SESSION_FORMAT_VERSION))
  }
  const allowed = new Set(['type', 'version', 'id', 'createdAt', 'cwd', 'parentSession', 'seedLength', 'origin', 'delegationDepth', 'agentPreset'])
  for (const key of Object.keys(header)) if (!allowed.has(key)) throw new Error('Unrecognized session header field: ' + key)
  const events: SessionEvent[] = []
  const types = new Set<string>()
  for (const [index, line] of records.entries()) {
    if (!line.trim()) throw new Error('Empty committed record at line ' + String(index + 2))
    for (const event of decodeStorageRecord(JSON.parse(line))) {
      if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable !== true) {
        throw new Error('Unsupported required event: ' + event.type)
      }
      events.push(event)
      types.add(event.type)
    }
  }
  const { type: _tag, ...meta } = header
  // Validate through the same public restore boundary as persistence. The
  // detached Session may append its in-memory seed marker; copied bytes remain
  // the exact input and never serialize that validation-only marker.
  Session.fromRestore(SessionId(header.id), events, meta as unknown as SessionHeader)
  return {
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    sourceBytes: bytes.length, sessionId: header.id, sourceVersion: SESSION_FORMAT_VERSION,
    targetVersion: SESSION_FORMAT_VERSION, eventCount: events.length, eventTypes: [...types].sort(), conversion: 'identity',
  }
}

/** Read a bounded regular file; symlinks and concurrently changed reads are refused. */
async function readSnapshot(source: string): Promise<Buffer> {
  const before = await lstat(source)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Source must be a regular file, not a symbolic link')
  if (before.size > MAX_BYTES) throw new Error('Session exceeds the 64 MiB offline migration limit')
  const handle = await open(source, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.size > MAX_BYTES) {
      throw new Error('Source changed while opening')
    }
    const bytes = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (bytesRead === 0) throw new Error('Source changed while reading')
      offset += bytesRead
    }
    const after = await handle.stat()
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('Source changed while reading')
    return bytes
  } finally {
    await handle.close()
  }
}

/** Inspect one archive without writing to or repairing its source. */
export async function inspectSessionFile(source: string): Promise<MigrationInspection> {
  return inspectSessionSnapshot(await readSnapshot(resolve(source)))
}

/**
 * Publish a validated snapshot under a new path only when its checksum matches
 * the reviewed preflight. Source bytes and existing destinations are preserved.
 */
export async function copyVerifiedSession(source: string, destination: string, expectedSha256: string): Promise<MigrationInspection> {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('Expected SHA-256 must contain 64 lowercase hexadecimal digits')
  const sourcePath = resolve(source)
  const destinationPath = resolve(destination)
  const sourceReal = await realpath(sourcePath)
  const destinationParent = await realpath(dirname(destinationPath))
  const target = join(destinationParent, basename(destinationPath))
  if (target === sourceReal) throw new Error('Destination must differ from the source')
  const bytes = await readSnapshot(sourcePath)
  const inspection = inspectSessionSnapshot(bytes)
  if (inspection.sourceSha256 !== expectedSha256) throw new Error('Source checksum differs from the reviewed preflight')
  const temporary = join(destinationParent, '.arx-migration-' + randomUUID() + '.tmp')
  const staged = await open(temporary, 'wx', 0o600)
  try {
    try {
      await staged.writeFile(bytes)
      await staged.sync()
    } finally {
      await staged.close()
    }
    // Hard-link publication is atomic and fails if target already exists on
    // Windows and Unix. Same-directory staging guarantees one filesystem.
    await link(temporary, target)
  } finally {
    await unlink(temporary)
  }
  return inspection
}

/** CLI dispatch; prints metadata only, never transcript content. */
async function main(args: string[]): Promise<void> {
  const [command, source, destination, flag, checksum] = args
  if (command === 'inspect' && source && args.length === 2) {
    process.stdout.write(JSON.stringify(await inspectSessionFile(source), null, 2) + '\n')
    return
  }
  if (command === 'copy' && source && destination && flag === '--expect-sha256' && checksum && args.length === 5) {
    process.stdout.write(JSON.stringify(await copyVerifiedSession(source, destination, checksum), null, 2) + '\n')
    return
  }
  throw new Error('Usage: pnpm session:migration inspect <source.jsonl> | copy <source.jsonl> <new-target.jsonl> --expect-sha256 <hash>')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
    process.exitCode = 1
  })
}
