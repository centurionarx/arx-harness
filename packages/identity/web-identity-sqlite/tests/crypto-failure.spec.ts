import { describe, expect, it, vi } from 'vitest'
import * as crypto from 'node:crypto'
import { configureHashQueueLimit, hashPassword } from '../src/crypto.ts'
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, scrypt: vi.fn(actual.scrypt) }
})
describe('native hash error and late cancellation boundaries', () => {
  it('releases admission after a native scrypt error while subsequent real work remains usable', async () => {
    vi.mocked(crypto.scrypt).mockImplementationOnce((...args) => {
      const callback = args.at(-1) as (error: Error, result: Buffer) => void
      queueMicrotask(() => { callback(new Error('fixture-native-scrypt-error'), Buffer.alloc(0)) })
    })
    await expect(hashPassword('Native-failure-fixture-' + 'x'.repeat(20))).rejects.toThrow('fixture-native-scrypt-error')
    expect(await hashPassword('Native-success-fixture-' + 'y'.repeat(20))).toMatch(/^scrypt\$/)
  })
  it('tolerates an already-reserved waiter receiving a late abort notification', async () => {
    configureHashQueueLimit(1)
    const first = hashPassword('First-native-fixture-' + 'x'.repeat(20)), second = hashPassword('Second-native-fixture-' + 'y'.repeat(20))
    const controller = new AbortController(), listeners: EventListener[] = []
    const add = controller.signal.addEventListener.bind(controller.signal)
    const installed = vi.spyOn(controller.signal, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'abort' && typeof listener === 'function')
        listeners.push(listener)
      add(type, listener, options)
    })
    const pending = hashPassword('Waiting-native-fixture-' + 'z'.repeat(20), controller.signal)
    await first
    for (const listener of listeners)
      listener(new Event('abort'))
    await Promise.all([second, pending])
    installed.mockRestore()
    configureHashQueueLimit(16)
  })
})
