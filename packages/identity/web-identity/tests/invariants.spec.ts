import { Context } from '@arx-ai/cordis'
import Registry from '@arx-ai/arx-invariants'
import { afterEach, describe, expect, it } from 'vitest'
import Journal from '@arx-ai/arx-identity-authority-journal'
import SqliteIdentity from '@arx-ai/arx-web-identity-sqlite'
import * as IdentityInvariant from '../src/invariant.ts'
import * as SqliteInvariant from '../../web-identity-sqlite/src/invariant.ts'
import * as JournalInvariant from '../../identity-authority-journal/src/invariant.ts'
import * as ResendInvariant from '../../web-identity-resend/src/invariant.ts'
import * as ApiInvariant from '../../../host/web-identity-api/src/invariant.ts'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'
let ctx: Context | undefined, fixture: Awaited<ReturnType<typeof identityHarness>> | undefined
afterEach(async () => { await ctx?.fiber.dispose(); ctx = undefined; await fixture?.close(); fixture = undefined })
describe('package-owned identity invariant lifecycle', () => {
  it('checks detached head contracts and disposes diagnostics through real Cordis effects', async () => {
    ctx = new Context()
    await ctx.plugin(Registry)
    const identity = ctx.plugin(IdentityInvariant)
    await identity
    for (const head of [{ sequence: 0, hash: '0'.repeat(64) }, { sequence: 1.5, hash: '0'.repeat(64) }, { sequence: 1, hash: 'bad' }])
      expect(() => { ctx!.emit('web-identity/projected', head) }).toThrow(/invalid durable authority head/)
    expect(() => { ctx!.emit('web-identity/projected', { sequence: 1, hash: '0'.repeat(64) }) }).not.toThrow()
    await identity.dispose()
    expect(() => { ctx!.emit('web-identity/projected', { sequence: 0, hash: 'bad' }) }).not.toThrow()
    await ctx.plugin(IdentityInvariant)
    await ctx.plugin(ResendInvariant)
    await ctx.plugin(ApiInvariant)
    await ctx.plugin(SqliteInvariant)
    await ctx.plugin(JournalInvariant)
    expect(() => { ctx!.emit('web-identity/projected', { sequence: 1, hash: '0'.repeat(64) }) }).not.toThrow()
  })
  it('independently compares real durable journal and SQLite heads and releases HMR registration', { timeout: 30000 }, async () => {
    fixture = await identityHarness()
    const { paths } = fixture
    await fixture.close(false)
    ctx = new Context()
    await ctx.plugin(Journal, { root: paths.journal, protectedRoots: [paths.state, paths.content] })
    await ctx.plugin(SqliteIdentity, { path: paths.database, privateKeyPath: paths.key, sessionIdleTtlMs: 1800000,
      recoveryOrigins: { user: 'https://user.fixture.test', admin: 'https://admin.fixture.test' },
      bootstrapAccount: { username: 'arxadmin', email: 'admin@centurionarx.com' },
      modules: [{ id: 'runtime', label: 'Runtime', operations: ['tools.execute'] }] })
    await ctx.plugin(Registry)
    const journal = ctx.plugin(JournalInvariant)
    await journal
    const head = ctx.webIdentity.authorityHead
    expect(() => { ctx!.emit('web-identity/projected', head) }).not.toThrow()
    expect(() => { ctx!.emit('web-identity/projected', { ...head, sequence: head.sequence + 1 }) }).toThrow(/durable journal/)
    expect(() => { ctx!.emit('web-identity/projected', { ...head, hash: 'f'.repeat(64) }) }).toThrow(/durable journal/)
    await journal.dispose()
    const sqlite = ctx.plugin(SqliteInvariant)
    await sqlite
    expect(() => { ctx!.emit('web-identity/projected', head) }).not.toThrow()
    expect(() => { ctx!.emit('web-identity/projected', { ...head, sequence: head.sequence + 1 }) }).toThrow(/SQLite projection/)
    expect(() => { ctx!.emit('web-identity/projected', { ...head, hash: 'f'.repeat(64) }) }).toThrow(/SQLite projection/)
    await sqlite.dispose()
  })
})
