import { DatabaseSync } from 'node:sqlite'
import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@arx-ai/arx-session'
import { ModuleId, WebUserId } from '@arx-ai/arx-web-identity'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'
import { encryptDelivery } from '../src/crypto.ts'
let fixture: Awaited<ReturnType<typeof identityHarness>> | undefined
afterEach(async () => { vi.restoreAllMocks(); await fixture?.close(); fixture = undefined })
const password = (label: string) => 'Private-fixture-' + label + 'x'.repeat(20)
const token = (link: string, purpose: string) => new URLSearchParams(new URL(link).hash.slice(1)).get(purpose)!
describe('administrative authority and credential lifecycle', () => {
  it('bounds administrative power and preserves single-use invitation ownership', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ readyUsers: 1 })
    const { ctx, master, users, deliveries } = fixture, admin = master!, a = users[0]!
    expect((await ctx.webIdentity.moduleCatalog(admin)).modules.map(row => row.id)).toEqual(['runtime', 'storage'])
    await expect(ctx.webIdentity.moduleCatalog(a.authority)).rejects.toMatchObject({ status: 403 })
    await expect(ctx.webIdentity.createUser(admin, { username: '!', email: 'valid@fixture.test' })).rejects.toMatchObject({ code: 'INVALID_USERNAME' })
    await expect(ctx.webIdentity.createUser(admin, { username: 'valid-name', email: 'invalid' })).rejects.toMatchObject({ code: 'INVALID_EMAIL' })
    await expect(ctx.webIdentity.createUser(admin, { username: a.username, email: 'other@fixture.test' })).rejects.toMatchObject({ status: 409 })
    await expect(ctx.webIdentity.setStatus(admin, WebUserId('00000000-0000-4000-8000-000000000000'), 'ACTIVE')).rejects.toMatchObject({ status: 404 })
    await expect(ctx.webIdentity.setStatus(admin, a.userId, 'PENDING' as never)).rejects.toMatchObject({ code: 'INVALID_STATUS' })
    await expect(ctx.webIdentity.setModules(admin, a.userId, ['storage', 'storage'])).rejects.toMatchObject({ code: 'INVALID_MODULE' })
    await expect(ctx.webIdentity.resendInvitation(admin, a.userId)).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' })
    const pending = await ctx.webIdentity.createUser(admin, { username: 'pending-user', email: 'pending@fixture.test' })
    await ctx.webIdentity.flushOutbox()
    const old = token(deliveries.at(-1)!.link, 'invite')
    await expect(ctx.webIdentity.correctInvitationEmail(admin, pending.userId, a.username + '@fixture.test')).rejects.toMatchObject({ code: 'ACCOUNT_CONFLICT' })
    const corrected = await ctx.webIdentity.correctInvitationEmail(admin, pending.userId, 'corrected@fixture.test')
    expect(corrected.email).toBe('corrected@fixture.test')
    await ctx.webIdentity.flushOutbox()
    await expect(ctx.webIdentity.acceptInvitation(old, password('obsolete'))).rejects.toMatchObject({ code: 'AUTH_TOKEN_INVALID' })
    await ctx.webIdentity.resendInvitation(admin, pending.userId)
    await ctx.webIdentity.flushOutbox()
    const invite = token(deliveries.at(-1)!.link, 'invite')
    const newPassword = password('invited')
    await ctx.webIdentity.acceptInvitation(invite, newPassword)
    await expect(ctx.webIdentity.login('pending-user', newPassword, 'user')).rejects.toMatchObject({ code: 'AUTH_INVALID' })
    await ctx.webIdentity.setStatus(admin, pending.userId, 'ACTIVE')
    const established = await ctx.webIdentity.login('PENDING-USER', newPassword, 'user')
    const authority = await ctx.webIdentity.authenticate(established.token, 'user')
    const project = await ctx.webIdentity.createProject(authority)
    await expect(ctx.webIdentity.authorizeOwner(authority, { kind: 'project', projectId: project }, ModuleId('storage'))).rejects.toMatchObject({ code: 'MODULE_FORBIDDEN' })
    const scope = await ctx.webIdentity.createWorkspace(authority, project)
    const session = SessionId('lifecycle-delete-session')
    await ctx.webIdentity.registerSession(authority, scope, session)
    await ctx.webIdentity.deleteSession(authority, session)
    await expect(ctx.webIdentity.authorizeOwner(authority, { kind: 'session', sessionId: session })).rejects.toMatchObject({ status: 403 })
    await ctx.webIdentity.setStatus(admin, pending.userId, 'DELETED')
    await expect(ctx.webIdentity.setStatus(admin, pending.userId, 'ACTIVE')).rejects.toMatchObject({ status: 403 })
    const first = await ctx.webIdentity.listUsers(admin, { limit: 1 })
    expect(first.nextCursor).toBeDefined()
    if (first.nextCursor === undefined)
      throw new Error('fixture user cursor missing')
    expect((await ctx.webIdentity.listUsers(admin, { cursor: first.nextCursor, limit: 100 })).users).toHaveLength(2)
    const p2 = await ctx.webIdentity.createProject(a.authority), p3 = await ctx.webIdentity.createProject(a.authority)
    const page = await ctx.webIdentity.listOwnedProjects(a.authority, { limit: 1 })
    expect(page.nextCursor).toBeDefined()
    if (page.nextCursor === undefined)
      throw new Error('fixture project cursor missing')
    expect((await ctx.webIdentity.listOwnedProjects(a.authority, { cursor: page.nextCursor })).projectIds).toHaveLength(1)
    expect(new Set([p2, p3]).size).toBe(2)
    await ctx.webIdentity.bootstrapMaster(password('ignored-bootstrap'))
    await expect(ctx.webIdentity.login('arxadmin', fixture.passwords.bootstrap, 'admin')).rejects.toMatchObject({ status: 401 })
    expect((await ctx.webIdentity.login('arxadmin', fixture.passwords.master, 'admin')).state.principal.mustChangePassword).toBe(false)
  })
  it('requires first-password change and rejects expired or ambiguous authentication', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ bootstrap: false })
    const { ctx, paths } = fixture
    const initial = password('temporary'), changed = password('changed')
    await ctx.webIdentity.bootstrapMaster(initial)
    const login = await ctx.webIdentity.login('arxadmin', initial, 'admin'), restricted = await ctx.webIdentity.authenticate(login.token, 'admin')
    await expect(ctx.webIdentity.listUsers(restricted)).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' })
    await expect(ctx.webIdentity.createProject(restricted)).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' })
    await expect(ctx.webIdentity.changePassword(restricted, 'incorrect-password', changed)).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_INVALID' })
    await expect(ctx.webIdentity.changePassword(restricted, initial, initial)).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_INVALID' })
    const abort = new AbortController()
    abort.abort()
    await expect(ctx.webIdentity.login('arxadmin', initial, 'admin', abort.signal)).rejects.toMatchObject({ code: 'AUTH_ABORTED' })
    await expect(ctx.webIdentity.changePassword(restricted, initial, changed, abort.signal)).rejects.toMatchObject({ code: 'AUTH_ABORTED' })
    const result = await ctx.webIdentity.changePassword(restricted, initial, changed), authority = await ctx.webIdentity.authenticate(result.token, 'admin')
    const db = new DatabaseSync(paths.database)
    db.prepare('UPDATE web_sessions SET expires_at=0 WHERE id=?').run(authority.authSessionId)
    await expect(ctx.webIdentity.revalidate(authority)).rejects.toMatchObject({ status: 401 })
    await expect(ctx.webIdentity.authenticate(result.token, 'admin')).rejects.toMatchObject({ status: 401 })
    db.close()
    await expect(ctx.webIdentity.authenticate('invalid', 'admin')).rejects.toMatchObject({ status: 401 })
  })
  it('cancels stale encrypted mail, bounds retries and clears accepted secrets', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ readyUsers: 1, identityConfig: { resetTtlMs: 1000, deliveryTimeoutMs: 10 } })
    const { ctx, paths, users } = fixture, a = users[0]!
    fixture.unregisterDelivery()
    await ctx.webIdentity.forgotPassword(a.username)
    await ctx.webIdentity.flushOutbox()
    const db = new DatabaseSync(paths.database)
    const row = db.prepare("SELECT * FROM outbox WHERE state='pending'").get()!
    const rowId = row.id
    if (typeof rowId !== 'string')
      throw new Error('fixture pending operation missing')
    expect(String(row.ciphertext)).not.toContain(a.username)
    const now = Date.now()
    const time = vi.spyOn(Date, 'now').mockReturnValue(now + 1100)
    let sent = 0
    const dispose = ctx.webIdentity.registerDelivery({ async send() { sent++; return { providerId: 'fixture-expired' } } })
    await ctx.webIdentity.flushOutbox()
    expect(sent).toBe(0)
    expect(db.prepare('SELECT ciphertext,state FROM outbox WHERE id=?').get(rowId)!).toMatchObject({ ciphertext: null, state: 'cancelled' })
    dispose()
    time.mockRestore()
    await ctx.webIdentity.forgotPassword(a.username)
    const rejecting = ctx.webIdentity.registerDelivery({ async send() { throw new Error('private-fixture-provider-message') } })
    await expect(ctx.webIdentity.flushOutbox()).rejects.toThrow('private-fixture-provider-message')
    expect(db.prepare("SELECT state FROM outbox WHERE state='pending'").get()!.state).toBe('pending')
    rejecting()
    const pending = db.prepare("SELECT * FROM outbox WHERE state='pending'").get()!
    const pendingId = pending.id
    if (typeof pendingId !== 'string')
      throw new Error('fixture retry operation missing')
    const key = await readFile(paths.key)
    const bad = encryptDelivery(key, { operationId: pendingId, to: 'wrong@fixture.test', purpose: 'reset', link: 'https://user.fixture.test/reset#reset=synthetic', expiresAt: Number(pending.expires_at) })
    db.prepare('UPDATE outbox SET ciphertext=? WHERE id=?').run(bad, pendingId)
    const accept = ctx.webIdentity.registerDelivery({ async send() { return { providerId: 'fixture-accepted' } } })
    await expect(ctx.webIdentity.flushOutbox()).rejects.toMatchObject({ code: 'AUTH_DELIVERY' })
    accept()
    db.close()
    key.fill(0)
  })
  it('awaits revocation quiescence and fails closed while execution acknowledgement is pending', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ readyUsers: 1 })
    const { ctx, master, users } = fixture, a = users[0]!
    let release!: () => void, entered!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const began = new Promise<void>((resolve) => { entered = resolve })
    const off = ctx.on('web-identity/invalidated', async (userId) => { if (userId === a.userId) {
      entered()
      await barrier
      throw new Error('fixture-supervisor-unavailable')
    } })
    let completed = false
    const revoked = ctx.webIdentity.setStatus(master!, a.userId, 'BLOCKED').finally(() => { completed = true })
    const outcome = revoked.then(value => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }))
    try {
      await began
      expect(completed).toBe(false)
      await expect(ctx.webIdentity.authenticate(a.token, 'user')).rejects.toMatchObject({ status: 401 })
      release()
      expect((await outcome).error).toMatchObject({ code: 'AUTH_QUIESCENCE_FAILED', status: 503 })
    }
    finally {
      release()
      await outcome
      off()
    }
    await ctx.webIdentity.restoreFence()
    await expect(ctx.webIdentity.revalidate(master!)).rejects.toMatchObject({ status: 401 })
  })
})
