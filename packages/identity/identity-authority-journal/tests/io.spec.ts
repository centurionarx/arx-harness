import { Context, Service } from '@arx-ai/cordis'
import { mkdtemp, rm, realpath } from 'node:fs/promises'
import * as fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Journal from '../src/index.ts'
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, lstat: vi.fn(actual.lstat) }
})
let ctx: Context | undefined, root: string | undefined
afterEach(async () => { vi.restoreAllMocks(); await ctx?.fiber.dispose(); ctx = undefined; if (root !== undefined)
  await rm(root, { recursive: true, force: true }); root = undefined })
async function direct(path: string, initialize: boolean) {
  const context = new Context()
  try {
    await context.plugin({ name: 'journal-direct-config-fixture', async apply(child: Context) {
      const journal = new Journal(child, { root: path, allowInitialize: initialize })
      await (journal as unknown as {
        [Service.init]: () => Promise<void>
      })[Service.init]()
    } })
    return context
  }
  catch (error) {
    await context.fiber.dispose()
    throw error
  }
}
describe('native authority I/O failure boundaries', () => {
  it('supports minimal direct configuration and the platform-specific directory flush branch without a fake journal', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'arx-journal-minimal-')))
    const path = join(root, 'authority')
    ctx = await direct(path, true)
    // Only the publication runs as win32: on another platform the startup access check would read a Windows ACL.
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      await ctx.identityAuthorityJournal.append(0, { operationId: 'fixture-platform', kind: 'owner', payload: {} })
    }
    finally {
      Object.defineProperty(process, 'platform', platform)
    }
    await ctx.fiber.dispose()
    ctx = undefined
    ctx = await direct(path, false)
    expect((await ctx.identityAuthorityJournal.recordsAfter(0))[0]!.operationId).toBe('fixture-platform')
  })
  it('propagates native lstat failure rather than treating it as absent authority', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'arx-journal-native-failure-')))
    const path = join(root, 'authority'), native = vi.mocked(fsPromises.lstat).getMockImplementation()!
    vi.mocked(fsPromises.lstat).mockImplementation(async (...args) => {
      if (String(args[0]) === join(path, 'authority.jsonl'))
        throw Object.assign(new Error('fixture-native-io-failure'), { code: 'EACCES' })
      return native(...args)
    })
    await expect(direct(path, true)).rejects.toMatchObject({ code: 'EACCES' })
  })
})
