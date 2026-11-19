import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'
import type { IdentityDelivery, IdentityDeliveryProvider } from '@arx-ai/arx-web-identity'
let fixture: Awaited<ReturnType<typeof identityHarness>> | undefined
afterEach(async () => { vi.restoreAllMocks(); await fixture?.close(); fixture = undefined })
function rendezvous() {
  let arrive!: (mail: IdentityDelivery) => void, release!: () => void
  const entered = new Promise<IdentityDelivery>((resolve) => { arrive = resolve })
  const barrier = new Promise<void>((resolve) => { release = resolve })
  const provider: IdentityDeliveryProvider = { async send(mail) { arrive(mail); await barrier; return { providerId: 'fixture-controlled-' + mail.operationId } } }
  return { provider, entered, release }
}
describe('encrypted outbox race and disposal boundaries', () => {
  it('rechecks cancellation and cipher presence, rejects duplicate providers and stops an aborted courier', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ readyUsers: 2 })
    const { ctx, paths, master, users } = fixture, a = users[0]!, b = users[1]!
    await expect(async () => ctx.webIdentity.registerDelivery({ async send() { return { providerId: 'duplicate' } } })).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    fixture.unregisterDelivery()
    const scheduler = vi.spyOn(ctx.webIdentity as unknown as {
      scheduleDelivery: () => void
    }, 'scheduleDelivery').mockImplementation(() => { })
    const db = new DatabaseSync(paths.database)
    let dispose: (() => void) | undefined
    try {
      await ctx.webIdentity.forgotPassword(a.username)
      await ctx.webIdentity.forgotPassword(b.username)
      const first = rendezvous()
      dispose = ctx.webIdentity.registerDelivery(first.provider)
      const pump = ctx.webIdentity.flushOutbox(), mail = await first.entered
      const other = mail.to === a.username + '@fixture.test' ? b : a
      // Both rows were selected before the external delivery yielded. Revoking the
      // other account must skip its old selected row on the next iteration.
      await ctx.webIdentity.setStatus(master!, other.userId, 'BLOCKED')
      first.release()
      await pump
      expect(db.prepare('SELECT state,ciphertext FROM outbox WHERE id=?').get(mail.operationId)!).toMatchObject({ state: 'accepted', ciphertext: null })
      expect(db.prepare("SELECT count(*) AS n FROM outbox WHERE user_id=? AND state='pending'").get(other.userId)!.n).toBe(0)
      dispose()
      dispose = undefined
      await ctx.webIdentity.setStatus(master!, other.userId, 'ACTIVE')
      await ctx.webIdentity.forgotPassword(a.username)
      await ctx.webIdentity.forgotPassword(b.username)
      const second = rendezvous()
      dispose = ctx.webIdentity.registerDelivery(second.provider)
      const pending = ctx.webIdentity.flushOutbox(), selected = await second.entered
      // Cancellation after send has begun wins over its later accepted response.
      await ctx.webIdentity.setStatus(master!, selected.to === a.username + '@fixture.test' ? a.userId : b.userId, 'BLOCKED')
      second.release()
      await pending
      expect(db.prepare('SELECT state,ciphertext,provider_id FROM outbox WHERE id=?').get(selected.operationId)!).toMatchObject({ state: 'cancelled', ciphertext: null, provider_id: null })
      dispose()
      dispose = undefined
      const stillActive = selected.to === a.username + '@fixture.test' ? b : a
      await ctx.webIdentity.forgotPassword(stillActive.username)
      const orphan = db.prepare("SELECT id FROM outbox WHERE state='pending'").get()!
      const orphanId = orphan.id
      if (typeof orphanId !== 'string')
        throw new Error('fixture pending operation missing')
      db.prepare('UPDATE outbox SET ciphertext=NULL WHERE id=?').run(orphanId)
      let sent = 0
      dispose = ctx.webIdentity.registerDelivery({ async send() { sent++; return { providerId: 'must-not-send-null-cipher' } } })
      await ctx.webIdentity.flushOutbox()
      expect(sent).toBe(0)
      dispose()
      dispose = undefined
      await ctx.webIdentity.forgotPassword(stillActive.username)
      const preAborted = new AbortController()
      preAborted.abort()
      dispose = ctx.webIdentity.registerDelivery({ async send() { sent++; return { providerId: 'must-not-send-aborted' } } })
      await ctx.webIdentity.flushOutbox(preAborted.signal)
      expect(sent).toBe(0)
      dispose()
      dispose = undefined
    }
    finally {
      dispose?.()
      scheduler.mockRestore()
      db.close()
    }
  })
  it('aborts active external delivery on deadline, caller abort and disposal without resurrecting secret payloads', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ readyUsers: 1, identityConfig: { deliveryTimeoutMs: 10 } })
    const { ctx, paths, users } = fixture, a = users[0]!
    fixture.unregisterDelivery()
    const scheduler = vi.spyOn(ctx.webIdentity as unknown as {
      scheduleDelivery: () => void
    }, 'scheduleDelivery').mockImplementation(() => { })
    const db = new DatabaseSync(paths.database)
    let dispose: (() => void) | undefined
    const provider: IdentityDeliveryProvider = { async send(_mail, signal) {
      await new Promise<void>((resolve) => { if (signal.aborted)
        resolve()
      else
        signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      return { providerId: 'late-after-abort' }
    } }
    try {
      await ctx.webIdentity.forgotPassword(a.username)
      dispose = ctx.webIdentity.registerDelivery(provider)
      await expect(ctx.webIdentity.flushOutbox()).rejects.toThrow('delivery interrupted')
      expect(db.prepare("SELECT state FROM outbox WHERE state='pending'").get()!.state).toBe('pending')
      dispose()
      dispose = undefined
      // A manually invoked flush exercises its explicit abort contract; the
      // fixture scheduler is deferred, while crypto and journal stay real.
      const caller = new AbortController()
      let began!: () => void
      const entered = new Promise<void>((resolve) => { began = resolve })
      dispose = ctx.webIdentity.registerDelivery({ async send(mail, signal) { began(); return provider.send(mail, signal) } })
      const pumping = ctx.webIdentity.flushOutbox(caller.signal), outcome = pumping.then(() => undefined, (error: unknown) => error)
      await entered
      caller.abort()
      expect(await outcome).toBeInstanceOf(Error)
      dispose()
      dispose = undefined
      const closing = new Promise<void>((resolve) => { began = resolve })
      dispose = ctx.webIdentity.registerDelivery({ async send(mail, signal) { began(); return provider.send(mail, signal) } })
      const finishing = ctx.webIdentity.flushOutbox(), failure = finishing.catch(() => { })
      await closing
      await ctx.fiber.dispose()
      await failure
      expect(db.prepare("SELECT count(*) AS n FROM outbox WHERE state='accepted' AND provider_id='late-after-abort'").get()!.n).toBe(0)
    }
    finally {
      dispose?.()
      scheduler.mockRestore()
      db.close()
    }
  })
})
