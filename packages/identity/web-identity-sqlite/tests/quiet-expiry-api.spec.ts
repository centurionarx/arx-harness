import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import type { RequestAuthority } from '@arx-ai/arx-web-identity'
import { AUTH_COOKIE_NAMES } from '@arx-ai/arx-web-identity/contract'
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
  fixture = await identityHarness({ api: 'user', apiConfig: { invalidationTimeoutMs: 200 }, readyUsers: 2, identityConfig: { sessionTtlMs: 60000, sessionIdleTtlMs: 10000 } })
  const h = fixture, a = h.users[0]!, b = h.users[1]!
  const second = await h.ctx.webIdentity.login(a.username, a.password, 'user')
  const a2 = await h.ctx.webIdentity.authenticate(second.token, 'user')
  let offset = Math.min(...rows().map(row => Number(row.idle_expires_at))) - realNow() - 1000
  clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset)
  for (const authority of [h.master!, a2, b.authority]) await h.ctx.webIdentity.revalidate(authority, { activity: true })
  const deadline = Number(stored(a.authority).idle_expires_at)
  return { h, a, b, a2, second, near: (milliseconds: number) => { offset = deadline - realNow() + milliseconds } }
}
describe('quiet expiry admission and HTTP publication', () => {
  it('finishes only the expired SID poll through the real timer before the unchanged poll deadline', { timeout: 30000 }, async () => {
    const { h, a, a2, second, near } = await prepared()
    const otherAbort = new AbortController()
    let otherSettled = false
    const poll = fetch(h.url! + '/auth/invalidation?generation=' + String(a.authority.revision),
      { headers: { cookie: AUTH_COOKIE_NAMES.user + '=' + a.token } })
    const other = fetch(h.url! + '/auth/invalidation?generation=' + String(a2.revision),
      { headers: { cookie: AUTH_COOKIE_NAMES.user + '=' + second.token }, signal: otherAbort.signal })
    const abandoned = other.then(() => { otherSettled = true; return 'settled' }, () => 'aborted')
    try {
      await new Promise(resolve => setTimeout(resolve, 25))
      near(-80)
      await h.ctx.webIdentity.authenticate(a.token, 'user')
      expect(await (await poll).json()).toMatchObject({ invalidated: true, generation: a.authority.revision, reason: 'expired' })
      expect(otherSettled).toBe(false)
      expect(stored(a.authority).revoked).toBe(1)
      expect(stored(a2).revoked).toBe(0)
    }
    finally { otherAbort.abort(); await abandoned }
    expect(await abandoned).toBe('aborted')
  })
  it('refuses the current admission as well as later admission after an injected native deadline-query failure', { timeout: 30000 }, async () => {
    const { h, a, b } = await prepared()
    const original = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, 'prepare')!.value as DatabaseSync['prepare']
    const failure = vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (this: DatabaseSync, sql: string) {
      if (sql === 'SELECT MIN(MIN(expires_at,idle_expires_at)) AS deadline FROM web_sessions WHERE revoked=0')
        throw new Error('fixture native scheduling query rejected')
      return original.call(this, sql)
    })
    try {
      await expect(h.ctx.webIdentity.authenticate(a.token, 'user')).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
    }
    finally { failure.mockRestore() }
    await expect(h.ctx.webIdentity.revalidate(b.authority)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' })
    expect(stored(a.authority).revoked).toBe(0)
    expect(stored(b.authority).revoked).toBe(0)
  })
})
