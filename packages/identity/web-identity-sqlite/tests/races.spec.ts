import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthorityRecord } from '@arx-ai/arx-web-identity'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'
let fixture: Awaited<ReturnType<typeof identityHarness>> | undefined
afterEach(async () => { vi.restoreAllMocks(); await fixture?.close(); fixture = undefined })
const password = (label: string) => 'Native-race-fixture-' + label + 'x'.repeat(20)
const linkToken = (link: string, purpose: string) => new URLSearchParams(new URL(link).hash.slice(1)).get(purpose)!
type QueueOwner = {
  run: (action: () => Promise<unknown>) => Promise<unknown>
}
async function holdQueue() {
  const { ctx, master, users } = fixture!, other = users[1]!, journal = ctx.identityAuthorityJournal, append = journal.append.bind(journal)
  let release!: () => void, entered!: () => void, record: AuthorityRecord | undefined
  const barrier = new Promise<void>((resolve) => { release = resolve }), began = new Promise<void>((resolve) => { entered = resolve })
  // Hold the real write section before append/fsync. Quiescence deliberately
  // runs outside this section and therefore cannot be used as a queue lock.
  const hook = vi.spyOn(journal, 'append').mockImplementationOnce(async (sequence, event) => {
    entered()
    await barrier
    record = await append(sequence, event)
    return record
  })
  const task = ctx.webIdentity.setModules(master!, other.userId, ['storage'])
  await began
  return async () => { release(); try {
    await task
    if (record === undefined)
      throw new Error('fixture journal commit missing')
    return { sequence: record.sequence, hash: record.hash }
  }
  finally {
    hook.mockRestore()
  } }
}
async function queued<T>(operation: () => Promise<T>) {
  const provider = fixture!.ctx.webIdentity as unknown as QueueOwner, run = provider.run.bind(provider)
  let entered!: () => void
  const began = new Promise<void>((resolve) => { entered = resolve })
  const hook = vi.spyOn(provider, 'run').mockImplementationOnce((action) => { const task = run(action); entered(); return task })
  const outcome = operation().then(value => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }))
  try {
    await Promise.race([began, outcome.then(() => { throw new Error('fixture operation did not enter the native queue') })])
  }
  finally {
    hook.mockRestore()
  }
  return { outcome }
}
async function whileHeld<T>(operation: () => Promise<T>, afterAdmission: () => void) {
  const release = await holdQueue()
  let admitted: Awaited<ReturnType<typeof queued<T>>> | undefined
  try {
    admitted = await queued(operation)
    afterAdmission()
    const head = await release()
    return { ...await admitted.outcome, head }
  }
  finally {
    await release()
    await admitted?.outcome
  }
}
describe('native authority admission after asynchronous password work', () => {
  it('rejects aborted login, password change and link consumption after real hashing but before journal admission', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ readyUsers: 2 })
    const { ctx, users, deliveries, master } = fixture, a = users[0]!
    await ctx.webIdentity.forgotPassword(a.username)
    await ctx.webIdentity.flushOutbox()
    const reset = linkToken(deliveries.at(-1)!.link, 'reset')
    const pending = await ctx.webIdentity.createUser(master!, { username: 'race-invited', email: 'race-invited@fixture.test' })
    await ctx.webIdentity.flushOutbox()
    const invite = linkToken(deliveries.findLast(mail => mail.to === pending.email)!.link, 'invite')
    const operations: readonly ((signal: AbortSignal) => Promise<unknown>)[] = [
      (signal: AbortSignal) => ctx.webIdentity.login(a.username, a.password, 'user', signal),
      (signal: AbortSignal) => ctx.webIdentity.changePassword(a.authority, a.password, password('change'), signal),
      (signal: AbortSignal) => ctx.webIdentity.resetPassword(reset, password('reset'), signal),
      (signal: AbortSignal) => ctx.webIdentity.acceptInvitation(invite, password('invite'), signal),
    ]
    for (const operation of operations) {
      const abort = new AbortController()
      // The spy delegates the real provider queue; the unrelated user's awaited
      // journal barrier holds it until native password work has finished and enqueued.
      const result = await whileHeld(() => operation(abort.signal), () => { abort.abort() })
      expect(result.error).toMatchObject({ code: 'AUTH_ABORTED', status: 499 })
      expect(ctx.webIdentity.authorityHead).toEqual(result.head)
    }
    expect((await ctx.webIdentity.authenticate(a.token, 'user')).principal.userId).toBe(a.userId)
  })
  it('rechecks current credentials and single-use links after hashing while the actual FIFO is blocked', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ readyUsers: 2 })
    const { ctx, paths, users, deliveries } = fixture, a = users[0]!, db = new DatabaseSync(paths.database)
    const hash = String(db.prepare('SELECT password_hash FROM users WHERE id=?').get(a.userId)!.password_hash)
    try {
      // This is a native projection corruption boundary, not a forged authority.
      const changed = await whileHeld(() => ctx.webIdentity.changePassword(a.authority, a.password, password('concurrent')), () => { db.prepare('UPDATE users SET password_hash=? WHERE id=?').run('corrupted-native-verifier', a.userId) })
      expect(changed.error).toMatchObject({ code: 'AUTH_INVALID', status: 401 })
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, a.userId)
      db.prepare('UPDATE users SET password_hash=NULL WHERE id=?').run(a.userId)
      await expect(ctx.webIdentity.changePassword(a.authority, a.password, password('missing'))).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_INVALID' })
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, a.userId)
      for (const fault of ['expired', 'used', 'missing', 'blocked'] as const) {
        await ctx.webIdentity.forgotPassword(a.username)
        await ctx.webIdentity.flushOutbox()
        const token = linkToken(deliveries.at(-1)!.link, 'reset')
        const row = db.prepare('SELECT id FROM auth_tokens WHERE used=0 AND user_id=?').get(a.userId)!
        const tokenId = row.id
        if (typeof tokenId !== 'string')
          throw new Error('fixture recovery token missing')
        const rejected = await whileHeld(() => ctx.webIdentity.resetPassword(token, password(fault)), () => {
          if (fault === 'expired')
            db.prepare('UPDATE auth_tokens SET expires_at=0 WHERE id=?').run(tokenId)
          if (fault === 'used')
            db.prepare('UPDATE auth_tokens SET used=1 WHERE id=?').run(tokenId)
          if (fault === 'missing') {
            db.prepare('DELETE FROM outbox WHERE token_id=?').run(tokenId)
            db.prepare('DELETE FROM auth_tokens WHERE id=?').run(tokenId)
          }
          if (fault === 'blocked')
            db.prepare("UPDATE users SET status='BLOCKED' WHERE id=?").run(a.userId)
        })
        expect(rejected.error).toMatchObject({ code: 'AUTH_TOKEN_INVALID', status: 400 })
        db.prepare("UPDATE users SET status='ACTIVE' WHERE id=?").run(a.userId)
      }
      await expect(ctx.webIdentity.resetPassword('bad-format', password('invalid'))).rejects.toMatchObject({ code: 'AUTH_TOKEN_INVALID' })
      await expect(ctx.webIdentity.resetPassword('A'.repeat(43), password('unknown'))).rejects.toMatchObject({ code: 'AUTH_TOKEN_INVALID' })
      for (const fault of ['status', 'revision', 'role'] as const) {
        if (fault === 'status')
          db.prepare("UPDATE users SET status='BLOCKED' WHERE id=?").run(a.userId)
        else if (fault === 'revision')
          db.prepare('UPDATE web_sessions SET revision=revision+1 WHERE id=?').run(a.authority.authSessionId)
        else
          db.prepare("UPDATE users SET role='MASTER_ADMIN' WHERE id=?").run(a.userId)
        await expect(ctx.webIdentity.authenticate(a.token, 'user')).rejects.toMatchObject({ code: 'AUTH_INVALID', status: 401 })
        db.prepare("UPDATE users SET status='ACTIVE',role='USER' WHERE id=?").run(a.userId)
        db.prepare('UPDATE web_sessions SET revision=? WHERE id=?').run(a.authority.revision, a.authority.authSessionId)
      }
    }
    finally {
      db.close()
    }
  })
  it('keeps owner tombstones and credentials closed when supervisor quiescence fails', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ readyUsers: 1 })
    const { ctx, users } = fixture, a = users[0]!, project = await ctx.webIdentity.createProject(a.authority)
    const off = ctx.on('web-identity/ownership-deleted', async () => { throw new Error('fixture-supervisor-unavailable') })
    try {
      await expect(ctx.webIdentity.deleteProject(a.authority, project)).rejects.toMatchObject({ code: 'AUTH_QUIESCENCE_FAILED', status: 503 })
    }
    finally {
      off()
    }
    expect((await ctx.webIdentity.authenticate(a.token, 'user')).revision).toBe(a.authority.revision)
    await expect(ctx.webIdentity.authorizeOwner(a.authority, { kind: 'project', projectId: project })).rejects.toMatchObject({ code: 'OWNER_FORBIDDEN' })
    const provider = ctx.webIdentity
    await fixture.close(false)
    await expect(provider.authenticate(a.token, 'user')).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
    expect(() => provider.authorityHead).toThrow('Identity unavailable')
  })
  it('refuses bootstrap collisions and rolls back a failed native projection while keeping journal intent closed', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ bootstrap: false })
    const { ctx, paths } = fixture, db = new DatabaseSync(paths.database)
    db.exec("INSERT INTO users VALUES('fixture-collision','arxadmin','arxadmin','collision@fixture.test','collision@fixture.test','USER','PENDING',NULL,1,1,1)")
    await expect(ctx.webIdentity.bootstrapMaster(password('collision'))).rejects.toMatchObject({ code: 'AUTH_BOOTSTRAP_COLLISION' })
    db.exec('DELETE FROM users')
    db.close()
    await ctx.webIdentity.bootstrapMaster(password('temporary'))
    const first = await ctx.webIdentity.login('arxadmin', password('temporary'), 'admin')
    const changed = await ctx.webIdentity.changePassword(await ctx.webIdentity.authenticate(first.token, 'admin'), password('temporary'), password('established'))
    const admin = await ctx.webIdentity.authenticate(changed.token, 'admin')
    const native = (ctx.webIdentity as unknown as {
        database: DatabaseSync
      }).database, prepare = native.prepare.bind(native)
    const fault = vi.spyOn(native, 'prepare').mockImplementation((sql) => {
      if (sql.startsWith('INSERT INTO audit'))
        throw new Error('fixture-native-projection-write-failure')
      return prepare(sql)
    })
    await expect(ctx.webIdentity.createUser(admin, { username: 'projection-failed', email: 'projection-failed@fixture.test' })).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
    fault.mockRestore()
    expect(native.prepare("SELECT count(*) AS n FROM users WHERE username='projection-failed'").get()!.n).toBe(0)
    await expect(ctx.webIdentity.revalidate(admin)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
  })
})
