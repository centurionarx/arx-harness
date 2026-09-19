import { mkdtemp, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { copyVerifiedSession, inspectSessionFile, inspectSessionSnapshot } from './session-migration.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const bytes = (version = 0, events: unknown[] = [{ type: 'external/note', seq: 0, time: 1, data: { note: 'preserved' }, ignorable: true }]): Buffer =>
  Buffer.from([JSON.stringify({ type: 'session', version, id: 'test-migration', createdAt: 1, delegationDepth: 0 }), ...events.map(event => JSON.stringify(event)), ''].join('\n'))
async function fixture(): Promise<{ root: string; source: string; destination: string }> {
  const root = await mkdtemp(join(tmpdir(), 'arx-migration-'))
  roots.push(root)
  const source = join(root, 'source.jsonl')
  await writeFile(source, bytes())
  return { root, source, destination: join(root, 'copy.jsonl') }
}

describe('safe session migration preflight', () => {
  it('validates current envelopes and preserves unknown explicitly ignorable events', () => {
    expect(inspectSessionSnapshot(bytes())).toMatchObject({ sourceVersion: 0, targetVersion: 0, conversion: 'identity', eventCount: 1, eventTypes: ['external/note'] })
  })
  it('refuses unsupported upstream versions, required events and torn tails', () => {
    expect(() => inspectSessionSnapshot(bytes(3))).toThrow('No reviewed migration adapter')
    expect(() => inspectSessionSnapshot(bytes(0, [{ type: 'external/required', seq: 0, time: 1, data: {} }]))).toThrow('Unsupported required event')
    expect(() => inspectSessionSnapshot(bytes().subarray(0, -1))).toThrow('newline-terminated')
  })
  it('refuses sequence gaps and retired or unknown header fields', () => {
    expect(() => inspectSessionSnapshot(bytes(0, [{ type: 'external/note', seq: 2, time: 1, data: {}, ignorable: true }]))).toThrow('contiguous')
    const value = bytes().toString().replace('"delegationDepth":0', '"delegationDepth":0,"approvalPolicy":"always"')
    expect(() => inspectSessionSnapshot(Buffer.from(value))).toThrow('Unrecognized session header field')
  })
  it('publishes exactly the reviewed bytes and leaves the original unchanged', async () => {
    const { root, source, destination } = await fixture()
    const before = await readFile(source)
    const inspection = await inspectSessionFile(source)
    await expect(copyVerifiedSession(source, destination, inspection.sourceSha256)).resolves.toEqual(inspection)
    expect(await readFile(destination)).toEqual(before)
    expect(await readFile(source)).toEqual(before)
    expect(await readdir(root)).toEqual(expect.arrayContaining(['source.jsonl', 'copy.jsonl']))
    expect((await readdir(root)).some(name => name.endsWith('.tmp'))).toBe(false)
  })
  it('refuses changed input and never overwrites an existing target', async () => {
    const { root, source, destination } = await fixture()
    const inspection = await inspectSessionFile(source)
    await writeFile(source, bytes(0, []))
    await expect(copyVerifiedSession(source, destination, inspection.sourceSha256)).rejects.toThrow('checksum')
    expect(await readdir(root)).toEqual(['source.jsonl'])
    await writeFile(source, bytes())
    await writeFile(destination, 'existing content')
    await expect(copyVerifiedSession(source, destination, inspection.sourceSha256)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(destination, 'utf8')).toBe('existing content')
    expect((await readdir(root)).some(name => name.endsWith('.tmp'))).toBe(false)
  })
  it('refuses self-copy, symbolic links and malformed checksums', async () => {
    const { root, source, destination } = await fixture()
    const inspection = await inspectSessionFile(source)
    await expect(copyVerifiedSession(source, source, inspection.sourceSha256)).rejects.toThrow('differ')
    await expect(copyVerifiedSession(source, destination, 'wrong')).rejects.toThrow('64 lowercase')
    const alias = join(root, 'alias.jsonl')
    try { await symlink(source, alias, 'file') } catch (error) {
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }
    await expect(inspectSessionFile(alias)).rejects.toThrow('symbolic link')
  })
})
