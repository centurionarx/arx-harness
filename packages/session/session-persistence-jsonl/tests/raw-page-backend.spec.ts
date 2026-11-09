import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SessionStore from '@arx-ai/arx-session'
import type { SessionId } from '@arx-ai/arx-session'
import type { SessionPersistence } from '@arx-ai/arx-session-persistence'
import { JsonlSessionPersistence } from '../src/index.ts'
import { logPath } from '../src/format.ts'
import { meta, oneTurnLog } from '../../session-persistence/tests/contract.ts'

// Every read-only open of `path` (existence probes included) is handed to `hook`;
// each hook fires its change once across those handles.
const opened = vi.hoisted(() => ({
  path: undefined as string | undefined,
  hook: undefined as ((file: FileHandle) => void) | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args)
      if (String(args[0]) === opened.path && args[1] === 'r') opened.hook?.(file)
      return file
    },
  }
})

const roots: string[] = []
const disposers: (() => Promise<void>)[] = []
const page = { offset: 0, maxBytes: 64 * 1024 }
afterEach(async () => {
  opened.path = undefined
  opened.hook = undefined
  for (const dispose of disposers.splice(0)) await dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function persisted(construct: 'plugin' | 'programmatic' = 'plugin') {
  const root = await mkdtemp(join(tmpdir(), 'arx-jsonl-raw-page-backend-')); roots.push(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  let persistence: SessionPersistence
  if (construct === 'plugin') {
    const fiber = await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    disposers.push(async () => { await fiber.dispose() })
    persistence = ctx.sessionPersistence
  } else {
    // Programmatic wrappers skip Schemastery normalization, so raw-page bounds stay unset.
    persistence = new JsonlSessionPersistence(ctx, { root, compression: 'none' })
  }
  const header = meta('raw-page-backend')
  await persistence.create(header)
  await persistence.append(header.id, oneTurnLog())
  const path = logPath(root, header.cwd, header.id, 'none')
  opened.path = path
  return { persistence, id: header.id, path }
}

/** Moves the artifact's mtime so its revision changes without changing its bytes. */
async function touch(path: string) {
  const later = new Date(Date.now() + 60_000)
  await utimes(path, later, later)
}

function changeAfterFirstRead(path: string, fail: boolean) {
  let changed = false
  opened.hook = (file) => {
    const original = file.read.bind(file)
    vi.spyOn(file, 'read').mockImplementation(async (...args) => {
      const result = await Reflect.apply(original, file, args) as Awaited<ReturnType<FileHandle['read']>>
      if (!changed) {
        changed = true
        await touch(path)
        if (fail) throw new Error('torn raw-page read')
      }
      return result
    })
  }
}

async function readPage(persistence: SessionPersistence, id: SessionId, revision?: string) {
  return persistence.readRawPage(id, revision === undefined ? page
    : { ...page, revision: revision as NonNullable<Parameters<SessionPersistence['readRawPage']>[1]['revision']> })
}

describe('JSONL bounded raw pages over a changing artifact', () => {
  it.each([false, true])('retries an unpinned page when the artifact changes around the read (read fails: %s)', async (fail) => {
    const { persistence, id, path } = await persisted()
    const before = await readPage(persistence, id)
    changeAfterFirstRead(path, fail)
    // A page from the first pass would carry the pre-change revision.
    const after = await readPage(persistence, id)
    expect(after?.content).toBe(before?.content)
    expect(after?.revision).not.toBe(before?.revision)
  })

  it.each([false, true])('rejects a pinned continuation when the artifact changes around the read (read fails: %s)', async (fail) => {
    const { persistence, id, path } = await persisted()
    const first = await readPage(persistence, id)
    changeAfterFirstRead(path, fail)
    await expect(readPage(persistence, id, first?.revision)).rejects.toThrow('raw artifact revision changed')
  })

  it('rejects an artifact whose size exceeds safe byte offsets', async () => {
    const { persistence, id } = await persisted()
    opened.hook = (file) => {
      const original = file.stat.bind(file)
      vi.spyOn(file, 'stat').mockImplementation((async (options?: { bigint?: boolean }) => {
        const identity = await original(options as { bigint: true })
        return { ...identity, size: BigInt(Number.MAX_SAFE_INTEGER) + 1n }
      }) as FileHandle['stat'])
    }
    await expect(readPage(persistence, id)).rejects.toThrow('raw artifact exceeds safe byte offsets')
  })

  it('rejects a page whose stored header names another session', async () => {
    const { persistence, id, path } = await persisted()
    const bytes = await readFile(path, 'utf8')
    const newline = bytes.indexOf('\n')
    await writeFile(path, bytes.slice(0, newline).replace(`"id":"${id}"`, '"id":"another-session"') + bytes.slice(newline))
    await expect(readPage(persistence, id)).rejects.toThrow('corrupt session log: invalid raw-page header')
  })

  it('applies the default raw-page bounds when a programmatic backend leaves them unset', async () => {
    const { persistence, id } = await persisted('programmatic')
    const result = await readPage(persistence, id)
    expect(result?.meta.id).toBe(id)
    expect(result?.content.length).toBeGreaterThan(0)
  })
})
