import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readWholeBytes, resolveLocalTarget } from '../src/fsio.ts'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'arx-pinned-read-')); roots.push(root)
  const inside = join(root, 'inside'); const outside = join(root, 'outside')
  await mkdir(inside); await mkdir(outside)
  await writeFile(join(inside, 'report.txt'), 'safe content')
  await writeFile(join(outside, 'report.txt'), 'secret')
  return { root, inside, outside }
}
it('refuses a final symlink swapped after preflight metadata', async () => {
  const { inside, outside } = await fixture()
  const target = await resolveLocalTarget(inside, 'report.txt')
  await expect(readWholeBytes(target, undefined, 64, { inspectReadBytesAfterStat: async () => {
    await rename(join(inside, 'report.txt'), join(inside, 'old.txt'))
    await symlink(join(outside, 'report.txt'), join(inside, 'report.txt'), 'file')
  } })).rejects.toThrow()
})
it('refuses an ancestor swap after containment before exposing its size', async () => {
  const { root, inside, outside } = await fixture()
  const target = await resolveLocalTarget(inside, 'report.txt')
  await writeFile(join(outside, 'report.txt'), 'secret'.repeat(1000))
  await rename(inside, join(root, 'old-inside'))
  await symlink(outside, inside, process.platform === 'win32' ? 'junction' : 'dir')
  await expect(readWholeBytes(target, undefined, 64)).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
})
it('reads exact byte bounds and observes cancellation before opening', async () => {
  const { inside } = await fixture(); const target = await resolveLocalTarget(inside, 'report.txt')
  expect(Buffer.from(await readWholeBytes(target, undefined, 12)).toString()).toBe('safe content')
  await expect(readWholeBytes(target, undefined, 11)).rejects.toMatchObject({ code: 'FS_TOO_LARGE' })
  const controller = new AbortController()
  await expect(readWholeBytes(target, controller.signal, 64, { inspectReadBytesAfterStat: () => { controller.abort() } })).rejects.toMatchObject({ code: 'FS_ABORTED' })
})
