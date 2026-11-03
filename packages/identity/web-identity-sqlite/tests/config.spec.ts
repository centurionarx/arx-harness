import { Context, Service } from '@arx-ai/cordis'
import { DatabaseSync } from 'node:sqlite'
import { chmod, rename, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Journal from '@arx-ai/arx-identity-authority-journal'
import Identity from '../src/index.ts'
import type { Config } from '../src/index.ts'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'
let ctx: Context | undefined, fixture: Awaited<ReturnType<typeof identityHarness>> | undefined
afterEach(async () => { vi.restoreAllMocks(); await ctx?.fiber.dispose(); ctx = undefined; await fixture?.close(); fixture = undefined })
function configuration(paths: Awaited<ReturnType<typeof identityHarness>>['paths']): Config {
  return { path: paths.database, privateKeyPath: paths.key, sessionIdleTtlMs: 1800000, recoveryOrigins: { user: 'https://user.fixture.test', admin: 'https://admin.fixture.test' },
    modules: [{ id: 'runtime', label: 'Runtime', operations: ['tools.execute'] }, { id: 'storage', label: 'Storage', operations: ['projects.create'] }] }
}
async function load(paths: Awaited<ReturnType<typeof identityHarness>>['paths'], override: Partial<Config> = {}) {
  const next = new Context()
  try {
    await next.plugin(Journal, { root: paths.journal, protectedRoots: [paths.state, paths.content] })
    await next.plugin(Identity, { ...configuration(paths), ...override })
    return next
  }
  catch (error) {
    await next.fiber.dispose()
    throw error
  }
}
describe('identity projection closed configuration and recovery', () => {
  it('requires an explicit bounded idle policy even for a directly constructed provider', { timeout: 30000 }, async () => {
    fixture = await identityHarness()
    for (const sessionIdleTtlMs of [0, 999, 86400001, Number.NaN, Number.POSITIVE_INFINITY, 1000.5]) {
      const independent = new Context()
      try {
        expect(() => new Identity(independent, { ...configuration(fixture!.paths), sessionIdleTtlMs }))
          .toThrow(/Explicit bounded session idle policy/)
      }
      finally { await independent.fiber.dispose() }
    }
  })
  it('rejects unsafe catalogs, origins, filesystem placement and public storage', { timeout: 30000 }, async () => {
    fixture = await identityHarness()
    const { paths } = fixture
    await fixture.close(false)
    for (const override of [{ modules: [{ id: 'runtime', label: '', operations: ['tools.execute'] }] },
      { modules: [{ id: 'runtime', label: 'Runtime', operations: ['same', 'same'] }] },
      { modules: [{ id: 'runtime', label: 'Runtime', operations: ['same'] }, { id: 'runtime', label: 'Duplicate', operations: ['other'] }] },
      { modules: [{ id: 'runtime', label: 'Runtime', operations: ['same'] }, { id: 'storage', label: 'Storage', operations: ['same'] }] },
      { modules: [{ id: 'runtime', label: 'Runtime', operations: [''] }] },
      { recoveryOrigins: { user: 'http://user.fixture.test', admin: 'https://admin.fixture.test' } },
      { path: 'relative.sqlite' }, { privateKeyPath: join(paths.state, 'key') }])
      await expect(load(paths, override)).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    await chmod(paths.state, 0o755)
    await expect(load(paths)).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    await chmod(paths.state, 0o700)
    await chmod(paths.database, 0o644)
    await expect(load(paths)).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    await chmod(paths.database, 0o600)
    const alias = join(paths.root, 'alias')
    await symlink(paths.root, alias, 'dir')
    await expect(load(paths, { path: join(alias, 'state', 'identity.sqlite') })).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    const saved = join(paths.root, 'saved.sqlite')
    await rename(paths.database, saved)
    await symlink(saved, paths.database)
    await expect(load(paths)).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    await rm(paths.database)
    await rename(saved, paths.database)
    await expect(load(paths, { path: join(paths.state, 'missing.sqlite') })).rejects.toMatchObject({ code: 'AUTH_SCHEMA' })
  })
  it('refuses a database ahead of authority, same-head hash mismatch or changed prefix', { timeout: 30000 }, async () => {
    fixture = await identityHarness()
    const { paths } = fixture
    await fixture.close(false)
    const db = new DatabaseSync(paths.database), meta = db.prepare('SELECT sequence,hash FROM auth_meta').get()!
    const sequence = meta.sequence
    if (typeof sequence !== 'number')
      throw new Error('fixture authority sequence missing')
    db.prepare('UPDATE auth_meta SET sequence=?').run(sequence + 1)
    db.close()
    await expect(load(paths)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
    const same = new DatabaseSync(paths.database)
    same.prepare('UPDATE auth_meta SET sequence=?,hash=?').run(sequence, 'f'.repeat(64))
    same.close()
    await expect(load(paths)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
    const prefix = new DatabaseSync(paths.database)
    prefix.prepare('UPDATE auth_meta SET sequence=1,hash=?').run('f'.repeat(64))
    prefix.close()
    await expect(load(paths)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
  })
  it('uses optional constructor defaults without a second auth implementation and refuses stale live projection', { timeout: 30000 }, async () => {
    fixture = await identityHarness()
    const { paths, passwords } = fixture
    await fixture.close(false)
    ctx = new Context()
    await ctx.plugin(Journal, { root: paths.journal })
    let provider!: Identity
    await ctx.plugin({ name: 'identity-direct-config-fixture', inject: ['identityAuthorityJournal'], async apply(child: Context) {
      provider = new Identity(child, configuration(paths))
      await (provider as unknown as {
        [Service.init]: () => Promise<void>
      })[Service.init]()
    } })
    const master = await provider.login('arxadmin', passwords.master, 'admin')
    expect(master.state.authenticated).toBe(true)
    await expect(provider.login('x'.repeat(255), 'no-such-password', 'admin')).rejects.toMatchObject({ status: 401 })
    await expect(provider.changePassword(await provider.authenticate(master.token, 'admin'), 'bad-password', 'New-fixture-' + 'x'.repeat(20))).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_INVALID' })
    const db = new DatabaseSync(paths.database), head = provider.authorityHead
    db.prepare('UPDATE auth_meta SET hash=?').run('f'.repeat(64))
    await expect(provider.authenticate(master.token, 'admin')).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
    db.prepare('UPDATE auth_meta SET hash=?').run(head.hash)
    db.close()
    const fresh = await provider.authenticate(master.token, 'admin')
    const pending = await provider.createUser(fresh, { username: 'direct-config-user', email: 'direct@fixture.test' })
    expect(pending.status).toBe('PENDING')
    await provider.forgotPassword('arxadmin')
    const dispose = provider.registerDelivery({ async send() { return { providerId: 'fixture-direct-config' } } })
    await provider.flushOutbox()
    dispose()
    await provider.logout(fresh)
    await expect(provider.revalidate(fresh)).rejects.toMatchObject({ status: 401 })
  })
  it('keeps durable intent closed after SQLite lock failure and replays before allowing administration', { timeout: 30000 }, async () => {
    fixture = await identityHarness()
    const { paths, master, passwords } = fixture
    const blocker = new DatabaseSync(paths.database)
    blocker.exec('BEGIN IMMEDIATE')
    const failure = fixture.ctx.webIdentity.createUser(master!, { username: 'durable-unacked', email: 'unacked@fixture.test' })
    await expect(failure).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
    blocker.exec('ROLLBACK')
    blocker.close()
    await expect(fixture.ctx.webIdentity.revalidate(master!)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
    await fixture.close(false)
    ctx = await load(paths)
    const current = await ctx.webIdentity.login('arxadmin', passwords.master, 'admin')
    const authority = await ctx.webIdentity.authenticate(current.token, 'admin')
    expect((await ctx.webIdentity.listUsers(authority)).users.some(user => user.username === 'durable-unacked')).toBe(true)
    await expect(ctx.webIdentity.createUser(authority, { username: 'durable-unacked', email: 'unacked@fixture.test' })).rejects.toMatchObject({ code: 'ACCOUNT_CONFLICT' })
    const db = new DatabaseSync(paths.database)
    expect(db.prepare("SELECT count(*) AS n FROM outbox WHERE state='pending'").get()!.n).toBe(0)
    expect(db.prepare('SELECT count(*) AS n FROM auth_tokens WHERE used=0').get()!.n).toBe(0)
    db.close()
  })
})
