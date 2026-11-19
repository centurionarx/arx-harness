import { chmod, mkdir, mkdtemp, rm, symlink, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { configureHashQueueLimit, hashPassword, validatePassword, verifyPassword, readPrivateKey, safeEqual, csrf, encryptDelivery, decryptDelivery } from '../src/crypto.ts'
let root: string | undefined
afterEach(async () => { configureHashQueueLimit(16); if (root !== undefined)
  await rm(root, { recursive: true, force: true }); root = undefined })
describe('password work and bounded admission', () => {
  it('preserves Unicode and rejects truncation or weak policy', async () => {
    for (const value of ['short', 'x'.repeat(257)])
      expect(() => { validatePassword(value) }).toThrow()
    const password = 'Unicode-' + '€'.repeat(15) + '\0'
    const verifier = await hashPassword(password)
    expect(await verifyPassword(password, verifier)).toBe(true)
    expect(await verifyPassword(password + 'x', verifier)).toBe(false)
    expect(await verifyPassword(password, 'invalid')).toBe(false)
    expect(await verifyPassword('x'.repeat(1025), verifier)).toBe(false)
  })
  it('admits two native jobs, bounds pending work and removes abandoned waiters', async () => {
    configureHashQueueLimit(1)
    const first = hashPassword('fixture-first-' + 'a'.repeat(20))
    const second = hashPassword('fixture-second-' + 'b'.repeat(20))
    const abort = new AbortController()
    const pending = hashPassword('fixture-pending-' + 'c'.repeat(20), abort.signal)
    const abandoned = expect(pending).rejects.toMatchObject({ code: 'AUTH_ABORTED' })
    await expect(hashPassword('fixture-overflow-' + 'd'.repeat(20))).rejects.toMatchObject({ status: 429 })
    abort.abort()
    await abandoned
    await Promise.all([first, second])
    await expect(hashPassword('fixture-already-aborted-' + 'e'.repeat(20), abort.signal)).rejects.toMatchObject({ code: 'AUTH_ABORTED' })
    configureHashQueueLimit(16)
    expect(() => { configureHashQueueLimit(-1) }).toThrow()
  })
  it('reserves waiting work fairly and prevents cancelled active hashes from producing a verifier', async () => {
    configureHashQueueLimit(2)
    const first = hashPassword('Fixture-fair-first-' + 'a'.repeat(20))
    const second = hashPassword('Fixture-fair-second-' + 'b'.repeat(20))
    const controller = new AbortController()
    const pending = hashPassword('Fixture-fair-pending-' + 'c'.repeat(20), controller.signal)
    const done = expect(pending).rejects.toMatchObject({ code: 'AUTH_ABORTED' })
    await first
    controller.abort()
    await done
    await second
    const active = new AbortController()
    const hashing = hashPassword('Fixture-active-cancel-' + 'd'.repeat(20), active.signal)
    const canceled = expect(hashing).rejects.toMatchObject({ code: 'AUTH_ABORTED' })
    active.abort()
    await canceled
  })
  it('requires protected explicit keys and authenticates encrypted outbox records against their operation', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'arx-auth-private-key-')))
    const path = join(root, 'identity.key')
    for (const value of ['relative.key', join(root, '.env')])
      await expect(readPrivateKey(value)).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    await writeFile(path, Buffer.alloc(31), { mode: 0o600 })
    await expect(readPrivateKey(path)).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    await writeFile(path, Buffer.alloc(32, 7), { mode: 0o600 })
    await chmod(path, 0o644)
    await expect(readPrivateKey(path)).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    await chmod(path, 0o600)
    const linked = join(root, 'linked')
    await symlink(path, linked)
    await expect(readPrivateKey(linked)).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    const directory = join(root, 'directory')
    await mkdir(directory, { mode: 0o700 })
    await expect(readPrivateKey(directory)).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    const key = await readPrivateKey(path), mail = { operationId: 'fixture-op', to: 'user@fixture.test', purpose: 'reset' as const, link: 'https://user.fixture.test/reset#reset=synthetic', expiresAt: 1 }
    const encoded = encryptDelivery(key, mail)
    expect(encoded).not.toContain('synthetic')
    expect(decryptDelivery(key, mail.operationId, encoded)).toEqual(mail)
    expect(() => decryptDelivery(key, 'different-op', encoded)).toThrow()
    expect(safeEqual(csrf(key, 'session'), csrf(key, 'session'))).toBe(true)
    expect(safeEqual('different-size', 'x')).toBe(false)
    key.fill(0)
  })
})
