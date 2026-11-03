import type { Context } from '@arx-ai/cordis'
import { SessionId } from '@arx-ai/arx-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'
let fixture: Awaited<ReturnType<typeof identityHarness>> | undefined
afterEach(async () => { vi.restoreAllMocks(); await fixture?.close(); fixture = undefined })
function barrier() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}
describe('native writer and lifecycle quiescence', () => {
  it('lets queued owner work reject and fresh writers progress before restore acknowledges quiescence', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ readyUsers: 1 })
    const { ctx, users } = fixture, a = users[0]!, provider = ctx.webIdentity
    const project = await provider.createProject(a.authority), scope = await provider.createWorkspace(a.authority, project)
    const entered = barrier(), receipt = barrier()
    let acknowledged = false
    const off = ctx.on('web-identity/invalidated', async (userId, reason) => {
      if (userId !== a.userId || reason !== 'restore')
        return
      const rejected = await provider.registerSession(a.authority, scope, SessionId('restore-rejected-owner-job')).then(() => undefined, (error: unknown) => error)
      expect(rejected).toMatchObject({ code: 'AUTH_INVALID', status: 401 })
      entered.release()
      await receipt.promise
    })
    const restoring = provider.restoreFence().then(() => { acknowledged = true })
    const outcome = restoring.catch((error: unknown) => error)
    try {
      await Promise.race([entered.promise, outcome.then(() => { throw new Error('restore did not reach its quiescence receipt') })])
      expect(acknowledged).toBe(false)
      await expect(provider.authenticate(a.token, 'user')).rejects.toMatchObject({ code: 'AUTH_INVALID' })
      const fresh = await provider.login(a.username, a.password, 'user'), authority = await provider.authenticate(fresh.token, 'user')
      expect((await provider.authorizeOwner(authority, { kind: 'workspace', workspaceId: scope.workspaceId })).projectId).toBe(project)
      expect(await provider.createProject(authority)).not.toBe(project)
      expect(acknowledged).toBe(false)
      receipt.release()
      await restoring
      expect(acknowledged).toBe(true)
    }
    finally {
      receipt.release()
      await outcome
      off()
    }
  })
  it('drains a started durable commit and rejects queued admissions while provider disposal waits for quiescence', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ readyUsers: 1 })
    const { ctx, users } = fixture, a = users[0]!, provider = ctx.webIdentity, journal = ctx.identityAuthorityJournal
    const project = await provider.createProject(a.authority), scope = await provider.createWorkspace(a.authority, project)
    const append = journal.append.bind(journal), started = barrier(), commit = barrier(), entered = barrier(), receipt = barrier()
    const hook = vi.spyOn(journal, 'append').mockImplementationOnce(async (sequence, event) => {
      started.release()
      await commit.promise
      return append(sequence, event)
    })
    const creating = provider.createProject(a.authority), created = creating.catch((error: unknown) => error)
    let disposed = false
    let disposal: Promise<void> | undefined
    let settled: Promise<unknown> | undefined
    let job: Promise<unknown> | undefined
    const off = ctx.on('web-identity/invalidated', async (userId, reason) => {
      if (userId !== a.userId || reason !== 'disposed')
        return
      expect(await job).toMatchObject({ code: 'AUTHORITY_UNAVAILABLE', status: 503 })
      entered.release()
      await receipt.promise
    })
    try {
      await started.promise
      job = provider.registerSession(a.authority, scope, SessionId('disposed-rejected-owner-job')).then(() => undefined, (error: unknown) => error)
      // Dispose the actual Loader provider fiber so the real journal and root
      // listener survive until the identity provider has completed its barrier.
      const owner = (provider as unknown as {
        ownerCtx: Context
      }).ownerCtx
      disposal = owner.fiber.dispose().then(() => { disposed = true })
      settled = disposal.catch((error: unknown) => error)
      commit.release()
      expect(await creating).not.toBe(project)
      await Promise.race([entered.promise, settled.then(() => { throw new Error('disposal did not reach its quiescence receipt') })])
      expect(disposed).toBe(false)
      await expect(provider.authenticate(a.token, 'user')).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE', status: 503 })
      await expect(provider.createProject(a.authority)).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE', status: 503 })
      expect(provider.authorityHead.sequence).toBe(journal.head.sequence)
      receipt.release()
      await disposal
      expect(disposed).toBe(true)
      expect(() => provider.authorityHead).toThrow('Identity unavailable')
    }
    finally {
      commit.release()
      receipt.release()
      await created
      await job
      await settled
      hook.mockRestore()
      off()
    }
  })
})

describe('caller cancellation before durable owner registration', () => {
  it('rejects cancelled admissions while completing an ownership commit once journal append has started',
    { timeout: 30000 }, async () => {
      fixture = await identityHarness({ readyUsers: 1 })
      const user = fixture.users[0]
      if (user === undefined) throw new Error('ready USER fixture missing')
      const { ctx } = fixture, provider = ctx.webIdentity, journal = ctx.identityAuthorityJournal
      const project = await provider.createProject(user.authority)
      const scope = await provider.createWorkspace(user.authority, project)
      const initial = provider.authorityHead.sequence
      const cancelled = new AbortController()
      cancelled.abort()
      await expect(provider.registerSession(user.authority, scope, SessionId('aborted-before-queue'), cancelled.signal))
        .rejects.toMatchObject({ name: 'AbortError' })
      expect(provider.authorityHead.sequence).toBe(initial)

      const append = journal.append.bind(journal), started = barrier(), continueCommit = barrier()
      const hook = vi.spyOn(journal, 'append').mockImplementationOnce(async (sequence, event) => {
        started.release()
        await continueCommit.promise
        return append(sequence, event)
      })
      const blocking = provider.createProject(user.authority)
      const blockingOutcome = blocking.catch((error: unknown) => error)
      const queuedAbort = new AbortController()
      let queued: Promise<unknown> | undefined
      try {
        await started.promise
        queued = provider.registerSession(user.authority, scope, SessionId('aborted-in-queue'), queuedAbort.signal)
          .then(() => undefined, (error: unknown) => error)
        queuedAbort.abort()
        continueCommit.release()
        await blocking
        expect(await queued).toMatchObject({ name: 'AbortError' })
        expect(provider.authorityHead.sequence).toBe(initial + 1)
        await expect(provider.authorizeOwner(user.authority, { kind: 'session', sessionId: SessionId('aborted-in-queue') }))
          .rejects.toMatchObject({ code: 'OWNER_FORBIDDEN' })
      } finally {
        continueCommit.release()
        await blockingOutcome
        await queued
        hook.mockRestore()
      }

      const admission = provider.authorizeOwner.bind(provider), admitted = barrier(), continueAdmission = barrier()
      const duringAdmission = new AbortController()
      const admissionHook = vi.spyOn(provider, 'authorizeOwner').mockImplementationOnce(async (...args) => {
        const actual = await admission(...args)
        admitted.release()
        await continueAdmission.promise
        return actual
      })
      const precommit = provider.registerSession(user.authority, scope, SessionId('aborted-before-journal'), duringAdmission.signal)
        .then(() => undefined, (error: unknown) => error)
      try {
        await admitted.promise
        duringAdmission.abort()
        continueAdmission.release()
        expect(await precommit).toMatchObject({ name: 'AbortError' })
        expect(provider.authorityHead.sequence).toBe(initial + 1)
      } finally { continueAdmission.release(); await precommit; admissionHook.mockRestore() }

      const enteredAppend = barrier(), releaseAppend = barrier(), afterStart = new AbortController()
      const durableHook = vi.spyOn(journal, 'append').mockImplementationOnce(async (sequence, event) => {
        enteredAppend.release()
        await releaseAppend.promise
        return append(sequence, event)
      })
      const committedId = SessionId('aborted-after-journal-start')
      const committing = provider.registerSession(user.authority, scope, committedId, afterStart.signal)
      const commitOutcome = committing.catch((error: unknown) => error)
      try {
        await enteredAppend.promise
        afterStart.abort()
        releaseAppend.release()
        await expect(committing).resolves.toBeUndefined()
        expect(provider.authorityHead.sequence).toBe(initial + 2)
        expect(journal.head).toEqual(provider.authorityHead)
        expect(await provider.authorizeOwner(user.authority, { kind: 'session', sessionId: committedId })).toMatchObject(scope)
      } finally { releaseAppend.release(); await commitOutcome; durableHook.mockRestore() }
    })
})
