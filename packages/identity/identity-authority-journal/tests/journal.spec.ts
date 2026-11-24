import { chmod, mkdtemp, mkdir, readFile, rm, writeFile, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@arx-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import Journal from '../src/index.ts'
let ctx: Context | undefined, root: string | undefined
afterEach(async () => { await ctx?.fiber.dispose(); ctx = undefined; if (root !== undefined)
  await rm(root, { recursive: true, force: true }); root = undefined })
async function load(path: string, allowInitialize = false, extra: Record<string, unknown> = {}) {
  const context = new Context()
  try {
    await context.plugin(Journal, { root: path, allowInitialize, ...extra })
    return context
  }
  catch (error) {
    await context.fiber.dispose()
    throw error
  }
}
describe('protected authority outside restored data', () => {
  it('never initializes implicitly, preserves a hash-linked watermark and releases its writer on disposal', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'arx-journal-fixture-')))
    const path = join(root, 'authority')
    await expect(load(path)).rejects.toBeDefined()
    ctx = await load(path, true)
    const first = await ctx.identityAuthorityJournal.append(0, { operationId: 'fixture-first', kind: 'owner', payload: { resource: 'fixture' } })
    expect(ctx.identityAuthorityJournal.head).toEqual({ sequence: 1, hash: first.hash })
    await expect(ctx.identityAuthorityJournal.append(0, { operationId: 'fixture-conflict', kind: 'owner', payload: {} })).rejects.toMatchObject({ code: 'AUTHORITY_CONFLICT' })
    await expect(ctx.identityAuthorityJournal.recordsAfter(2)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
    await ctx.fiber.dispose()
    ctx = undefined
    ctx = await load(path)
    expect((await ctx.identityAuthorityJournal.recordsAfter(0))[0]!.operationId).toBe('fixture-first')
    await ctx.fiber.dispose()
    ctx = undefined
    const watermark = join(path, 'watermark.json')
    await writeFile(watermark, JSON.stringify({ sequence: 0, hash: '0'.repeat(64) }), { mode: 0o600 })
    await expect(load(path)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
    const raw = await readFile(join(path, 'authority.jsonl'), 'utf8')
    expect(raw).toContain('fixture-first')
  })
  it('rejects restored-root placement and public directory permissions', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'arx-journal-policy-')))
    ctx = new Context()
    await expect(ctx.plugin(Journal, { root: join(root, 'nested'), allowInitialize: true, protectedRoots: [root] })).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    await ctx.fiber.dispose()
    ctx = undefined
    const path = join(root, 'public')
    await mkdir(path, { mode: 0o700 })
    // The journal applies no mode or owner check on win32, so the rejection of a path that other accounts can reach holds only on POSIX.
    if (process.platform !== 'win32') {
      await chmod(path, 0o755)
      await expect(load(path, true)).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    }
  })
  it('captures caller payload before queuing and prevents mutation of cached records', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'arx-journal-immutable-')))
    ctx = await load(join(root, 'authority'), true)
    const payload = { nested: { items: ['original'], optional: null } }
    const pending = ctx.identityAuthorityJournal.append(0, { operationId: 'snapshot', kind: 'owner', payload })
    payload.nested.items[0] = 'changed-after-call'
    const record = await pending
    expect(record.payload.nested).toEqual({ items: ['original'], optional: null })
    expect(Object.isFrozen(record.payload)).toBe(true)
    expect(Object.isFrozen((record.payload.nested as {
      items: string[]
    }).items)).toBe(true)
    expect(() => { (record.payload.nested as {
      items: string[]
    }).items[0] = 'forged' }).toThrow()
    expect(Object.isFrozen(await ctx.identityAuthorityJournal.recordsAfter(0))).toBe(true)
    await expect(ctx.identityAuthorityJournal.append(1, { operationId: 'snapshot', kind: 'owner', payload: {} })).rejects.toMatchObject({ code: 'AUTHORITY_CONFLICT' })
    for (const sequence of [-1, 0.5, 2])
      await expect(ctx.identityAuthorityJournal.recordsAfter(sequence)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
  })
  it('refuses partial records, changed chain, oversized records and non-private authority files', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'arx-journal-corrupt-')))
    const path = join(root, 'authority')
    ctx = await load(path, true)
    await ctx.identityAuthorityJournal.append(0, { operationId: 'valid', kind: 'owner', payload: {} })
    await ctx.fiber.dispose()
    ctx = undefined
    const file = join(path, 'authority.jsonl'), original = await readFile(file, 'utf8')
    for (const content of [original.slice(0, -1), JSON.stringify({ ...JSON.parse(original), sequence: 2 }) + '\n',
      JSON.stringify({ ...JSON.parse(original), hash: 'f'.repeat(64) }) + '\n',
      JSON.stringify({ ...JSON.parse(original), payload: { large: 'x'.repeat(2000) } }) + '\n']) {
      await writeFile(file, content, { mode: 0o600 })
      await expect(load(path, false, { maxRecordBytes: 1024 })).rejects.toBeDefined()
    }
    await writeFile(file, original, { mode: 0o600 })
    const watermark = join(path, 'watermark.json')
    // The journal applies no mode or owner check on win32, so the rejection of a path that other accounts can reach holds only on POSIX.
    if (process.platform !== 'win32') {
      await chmod(file, 0o644)
      await expect(load(path)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
      await chmod(file, 0o600)
      await chmod(watermark, 0o644)
      await expect(load(path)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
      await chmod(watermark, 0o600)
    }
    const external = join(root, 'external')
    await writeFile(external, original, { mode: 0o600 })
    await rm(file)
    await symlink(external, file)
    await expect(load(path)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
  })
  it('requires explicit genesis, canonical roots, an exclusive writer and available watermark storage', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'arx-journal-config-')))
    const path = join(root, 'authority')
    await mkdir(path, { mode: 0o700 })
    await expect(load(path)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
    await writeFile(join(path, 'watermark.json'), '{}', { mode: 0o600 })
    await expect(load(path, true)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
    await rm(join(path, 'watermark.json'))
    await expect(load('relative-authority', true)).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    await expect(load(path, true, { protectedRoots: ['relative-restored-root'] })).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    ctx = await load(path, true)
    await ctx.fiber.dispose()
    ctx = undefined
    ctx = await load(path)
    expect(ctx.identityAuthorityJournal.head.sequence).toBe(0)
    await expect(load(path)).rejects.toBeDefined()
    await ctx.fiber.dispose()
    ctx = undefined
    const alias = join(root, 'alias')
    await symlink(root, alias, 'dir')
    await expect(load(join(alias, 'authority'))).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    ctx = await load(path, false, { maxRecordBytes: 1024 })
    await expect(ctx.identityAuthorityJournal.append(0, { operationId: 'too-large', kind: 'owner', payload: { data: 'x'.repeat(2000) } })).rejects.toMatchObject({ code: 'AUTH_CAPACITY' })
    expect(ctx.identityAuthorityJournal.head.sequence).toBe(0)
    // A directory at the watermark path fails the next publication on every platform while the journal stays open.
    const watermark = join(path, 'watermark.json')
    await rm(watermark)
    await mkdir(watermark)
    await expect(ctx.identityAuthorityJournal.append(0, { operationId: 'storage-failed', kind: 'owner', payload: {} })).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
    expect(() => ctx!.identityAuthorityJournal.head).toThrow(/unavailable/)
  })
})
