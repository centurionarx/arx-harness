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
  release?.(); release = undefined; clock?.mockRestore(); clock = undefined; vi.restoreAllMocks()
  await fixture?.close(); fixture = undefined
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
describe('partial native quiet expiry durability failure', () => {
  it('quiesces the durable prefix and awaits unavailable-provider disposal before closing', { timeout: 30000 }, async () => {
    const { h, a, b, a2, near } = await prepared()
    const nativeAppend = h.ctx.identityAuthorityJournal.append.bind(h.ctx.identityAuthorityJournal)
    let attempted = 0
    const failure = vi.spyOn(h.ctx.identityAuthorityJournal, 'append').mockImplementation(async (...args) => {
      if (++attempted === 2) throw new Error('fixture second authority append rejected')
      return nativeAppend(...args)
    })
    const expired: string[] = [], disposed: string[] = []
    const barrier = new Promise<void>((resolve) => { release = resolve })
    h.ctx.on('web-identity/session-expired', (_userId, sid) => { expired.push(sid) })
    h.ctx.on('web-identity/invalidated', async (userId, reason) => {
      if (reason !== 'disposed') return
      disposed.push(userId)
      if (userId === b.userId) await barrier
    })
    near(-80)
    await h.ctx.webIdentity.authenticate(a.token, 'user')
    const latest = Math.max(...rows().map(row => Number(row.idle_expires_at)))
    clock!.mockImplementation(() => latest + 1000)
    await vi.waitFor(() => { expect(attempted).toBe(2) }, { timeout: 5000 })
    const journal = (await readFile(join(h.paths.journal, 'authority.jsonl'), 'utf8')).trim().split('\n')
    const last = JSON.parse(journal.at(-1)!) as { payload: { session: { id: string; revoked: number } } }
    expect(last.payload.session.revoked).toBe(1)
    const authorities = [h.master!, a.authority, b.authority, a2]
    const committed = authorities.find(authority => authority.authSessionId === last.payload.session.id)!
    expect(stored(committed).revoked).toBe(1)
    for (const authority of authorities.filter(authority => authority !== committed)) expect(stored(authority).revoked).toBe(0)
    await vi.waitFor(() => { expect(expired).toEqual([last.payload.session.id]) }, { timeout: 5000 })
    await vi.waitFor(() => { expect(disposed).toContain(b.userId) }, { timeout: 5000 })
    await expect(h.ctx.webIdentity.revalidate(b.authority)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
    failure.mockRestore()
    let closed = false
    const closing = h.close(false).then(() => { closed = true })
    await new Promise(resolve => setImmediate(resolve))
    expect(closed).toBe(false)
    release!()
    await closing
    fixture = undefined
  })
  it('attempts every account disposal and keeps admission closed when one disposal listener rejects', { timeout: 30000 }, async () => {
    const { h, a, b, near } = await prepared()
    const disposed: string[] = [], barrier = new Promise<void>((resolve) => { release = resolve })
    h.ctx.on('web-identity/session-expired', () => { throw new Error('fixture expiry listener rejected') })
    h.ctx.on('web-identity/invalidated', async (userId, reason) => {
      if (reason !== 'disposed') return
      disposed.push(userId)
      if (userId === a.userId) throw new Error('fixture account disposal rejected')
      if (userId === b.userId) await barrier
    })
    near(-80)
    await h.ctx.webIdentity.authenticate(a.token, 'user')
    await vi.waitFor(() => { expect(disposed).toEqual(expect.arrayContaining([a.userId, b.userId, h.master!.principal.userId])) },
      { timeout: 5000 })
    await expect(h.ctx.webIdentity.revalidate(b.authority)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
    expect(stored(a.authority).revoked).toBe(1)
    expect(stored(b.authority).revoked).toBe(0)
    let closed = false
    const closing = h.close(false).finally(() => { closed = true })
    const settledClose = closing.catch(() => {})
    await new Promise(resolve => setImmediate(resolve))
    expect(closed).toBe(false)
    release!()
    await settledClose
    fixture = undefined
  })

})
