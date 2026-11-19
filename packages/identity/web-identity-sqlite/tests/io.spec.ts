import * as fs from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, lstat: vi.fn(actual.lstat) }
})
let fixture: Awaited<ReturnType<typeof identityHarness>> | undefined
afterEach(async () => { vi.restoreAllMocks(); await fixture?.close(); fixture = undefined })
describe('native identity database filesystem faults', () => {
  it('preserves a real access failure instead of treating it as an absent database eligible for initialization', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ bootstrap: false, delivery: false })
    const { paths } = fixture
    await fixture.close(false)
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(fs.lstat).mockImplementation(async (...args) => {
      if (args[0] === paths.database)
        throw Object.assign(new Error('fixture database access denied'), { code: 'EACCES' })
      return actual.lstat(...args)
    })
    await expect(identityHarness({ root: paths.root, initialize: false, bootstrap: false, delivery: false })).rejects.toMatchObject({ cause: { code: 'EACCES' } })
  })
})
