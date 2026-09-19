import { afterEach, expect, it, vi } from 'vitest'
import { FsTargetKey } from '@arx-ai/arx-fs'
import { readWholeBytes } from '../src/fsio.ts'

const { open } = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  open,
}))
afterEach(() => { vi.resetAllMocks() })
const target = { displayPath: '/workspace/report.txt', targetKey: FsTargetKey('/workspace/report.txt') }

it.each([
  ['ENOENT', 'FS_NOT_FOUND'],
  ['ELOOP', 'FS_STALE_VERSION'],
  ['EISDIR', 'FS_NOT_REGULAR_FILE'],
])('maps %s from the platform open without exposing content', async (code, expected) => {
  open.mockRejectedValueOnce(Object.assign(new Error('platform open failed'), { code }))
  await expect(readWholeBytes(target, undefined, 64)).rejects.toMatchObject({ code: expected })
  expect(open).toHaveBeenCalledTimes(1)
})

it.each([
  Object.assign(new Error('permission denied'), { code: 'EACCES' }),
  new Error('binding failure without a code'),
  'unclassified binding failure',
])('preserves unclassified open failures without relabeling them as stale files', async (failure) => {
  open.mockRejectedValueOnce(failure)
  await expect(readWholeBytes(target, undefined, 64)).rejects.toBe(failure)
})
