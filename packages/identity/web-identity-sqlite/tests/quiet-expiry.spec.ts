import { DatabaseSync } from 'node:sqlite'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import type { RequestAuthority } from '@arx-ai/arx-web-identity'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'

let fixture: Awaited<ReturnType<typeof identityHarness>> | undefined
let clock: MockInstance<() => number> | undefined
let release: (() => void) | undefined
const realNow = Date.now.bind(Date)
afterEach(async () => {
  release?.(); release = undefined; clock?.mockRestore(); clock = undefined; await fixture?.close(); fixture = undefined
})
function rows() {
  const db = new DatabaseSync(fixture!.paths.database)
  try { return db.prepare('SELECT * FROM web_sessions WHERE revoked=0').all() }
  finally { db.close() }
}
function stored(authority: RequestAuthority) {
  const db = new DatabaseSync(fixture!.paths.database)
  try { return db.prepare('SELECT * FROM web_sessions WHERE id=?').get(authority.authSessionId)! }
  finally { db.close() }
}
async function prepared() {
  fixture = await identityHarness({ readyUsers: 2, identityConfig: { sessionTtlMs: 60000, sessionIdleTtlMs: 10000 } })
  const h = fixture, a = h.users[0]!, b = h.users[1]!
  const second = await h.ctx.webIdentity.login(a.username, a.password, 'user')
  const a2 = await h.ctx.webIdentity.authenticate(second.token, 'user')
  let offset = Math.min(...rows().map(row => Number(row.idle_expires_at))) - realNow() - 1000
  clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset)
  for (const authority of [h.master!, a2, b.authority]) await h.ctx.webIdentity.revalidate(authority, { activity: true })
  const deadline = Number(stored(a.authority).idle_expires_at)
  return { h, a, b, a2, second, near: (milliseconds: number) => { offset = deadline - realNow() + milliseconds } }
}
describe('native quiet authentication expiry', () => {
  it('durably revokes only the due SID without new traffic and waits for its real public listener', { timeout: 30000 }, async () => {
    const { h, a, b, a2, second, near } = await prepared()
    const observed: string[] = [], barrier = new Promise<void>((resolve) => { release = resolve })
    const userRevision = a.authority.revision
    h.ctx.on('web-identity/session-expired', async (userId, sid) => {
      expect(userId).toBe(a.userId)
      expect(sid).toBe(a.authority.authSessionId)
      expect(stored(a.authority).revoked).toBe(1)
      const journal = (await readFile(join(h.paths.journal, 'authority.jsonl'), 'utf8')).trim().split('\n')
      const last = JSON.parse(journal.at(-1)!) as { payload: { session: { id: string; revoked: number; revision: number } } }
      expect(last.payload.session).toMatchObject({ id: sid, revoked: 1, revision: userRevision })
      expect(journal.at(-1)).not.toContain(a.token)
      observed.push(sid)
      await barrier
    })
    near(-80)
    await h.ctx.webIdentity.authenticate(a.token, 'user') // Reschedules only; no idle write.
    const head = h.ctx.webIdentity.authorityHead
    await vi.waitFor(() => { expect(observed).toEqual([a.authority.authSessionId]) }, { timeout: 5000 })
    expect(h.ctx.webIdentity.authorityHead.sequence).toBe(head.sequence + 1)
    await expect(h.ctx.webIdentity.authenticate(a.token, 'user')).rejects.toMatchObject({ code: 'AUTH_INVALID' })
    expect(await h.ctx.webIdentity.authenticate(second.token, 'user')).toMatchObject({ authSessionId: a2.authSessionId, revision: userRevision })
    expect(await h.ctx.webIdentity.revalidate(b.authority)).toBe(b.authority)
    let closed = false
    const closing = h.close(false).then(() => { closed = true })
    await new Promise(resolve => setImmediate(resolve))
    expect(closed).toBe(false)
    release!()
    await closing
    fixture = undefined
  })
  it('fails admission closed after a real expiry listener rejects, without revoking a different SID', { timeout: 30000 }, async () => {
    const { h, a, b, near } = await prepared()
    let entered = false
    h.ctx.on('web-identity/session-expired', () => { entered = true; throw new Error('fixture quiescence rejected') })
    near(-50)
    await h.ctx.webIdentity.authenticate(a.token, 'user')
    await vi.waitFor(() => { expect(entered).toBe(true) }, { timeout: 5000 })
    await vi.waitFor(async () => { await expect(h.ctx.webIdentity.revalidate(b.authority)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' }) }, { timeout: 5000 })
    expect(stored(a.authority).revoked).toBe(1)
    expect(stored(b.authority).revoked).toBe(0)
  })
  it('rechecks durable deadlines after a backwards wall-clock adjustment rather than expiring early', { timeout: 30000 }, async () => {
    const { h, a, near } = await prepared()
    const observed: string[] = []
    h.ctx.on('web-identity/session-expired', (_userId, sid) => { observed.push(sid) })
    near(-30)
    await h.ctx.webIdentity.authenticate(a.token, 'user')
    near(-1000)
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(observed).toEqual([])
    expect(stored(a.authority).revoked).toBe(0)
    near(-30)
    await h.ctx.webIdentity.authenticate(a.token, 'user')
    await vi.waitFor(() => { expect(observed).toEqual([a.authority.authSessionId]) }, { timeout: 5000 })
  })
})
