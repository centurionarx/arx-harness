import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import { storageHarness } from './harness.ts'

const fixtures: Awaited<ReturnType<typeof storageHarness>>[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fixture of fixtures.splice(0)) await fixture.close()
})
async function owned() {
  const h = await storageHarness({ readyUsers: 1 }); fixtures.push(h)
  const authority = h.users[0]!.authority
  const project = await h.ctx.projectStorage.createProject(authority, 'Broker cancellation')
  const workspace = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Owned cancellation volume')
  const header = await h.ctx.projectStorage.register(authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1000 })
  return { h, authority, workspace, header }
}
function barrier() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}
describe('broker cancellation and durable control projection', () => {
  it('refuses cancelled registration and append before journal or log effects', async () => {
    const { h, authority, workspace, header } = await owned()
    const controller = new AbortController(), reason = new Error('cancelled fixture broker')
    controller.abort(reason)
    const id = SessionId(randomUUID())
    await expect(h.ctx.projectStorage.register(authority, workspace.workspaceId,
      { id, version: SESSION_FORMAT_VERSION, createdAt: 2000 }, controller.signal)).rejects.toBe(reason)
    await expect(h.ctx.webIdentity.authorizeOwner(authority, { kind: 'session', sessionId: id })).rejects.toMatchObject({ status: 403 })
    const append = vi.spyOn(h.ctx.sessionPersistence, 'append')
    await expect(h.ctx.projectStorage.append(authority, header.id, oneTurnLog(), controller.signal)).rejects.toBe(reason)
    expect(append).not.toHaveBeenCalled()
    expect(await h.ctx.sessionPersistence.listSnapshots()).toEqual([])
  })
  it('refuses a cancelled queued append after the preceding genuine fsync completes', async () => {
    const { h, authority, header } = await owned()
    const entered = barrier(), release = barrier(), controller = new AbortController()
    const reason = new Error('queued fixture broker cancelled')
    const original = h.ctx.sessionPersistence.append.bind(h.ctx.sessionPersistence)
    const append = vi.spyOn(h.ctx.sessionPersistence, 'append').mockImplementation(async (...args) => {
      entered.release(); await release.promise; await original(...args)
    })
    const events = oneTurnLog()
    const first = h.ctx.projectStorage.append(authority, header.id, events)
    void first.catch(() => undefined)
    try {
      await entered.promise
      const queued = h.ctx.projectStorage.append(authority, header.id, [], controller.signal)
      void queued.catch(() => undefined)
      controller.abort(reason); release.release()
      expect(await first).toEqual({ sessionId: header.id, nextSeq: events.length })
      await expect(queued).rejects.toBe(reason)
      expect(append).toHaveBeenCalledTimes(1)
      expect((await h.ctx.sessionPersistence.readFrom(header.id, 0)).events).toEqual(events)
    } finally { release.release(); await first.catch(() => undefined) }
  })
  it('finishes the FULL index after fsync despite cancellation and issues no saved receipt', async () => {
    const { h, authority, workspace, header } = await owned()
    const durable = barrier(), release = barrier(), controller = new AbortController()
    const reason = new Error('fixture broker cancelled after fsync')
    const original = h.ctx.sessionPersistence.append.bind(h.ctx.sessionPersistence)
    vi.spyOn(h.ctx.sessionPersistence, 'append').mockImplementation(async (...args) => {
      await original(...args); durable.release(); await release.promise
    })
    const events = oneTurnLog()
    const operation = h.ctx.projectStorage.append(authority, header.id, events, controller.signal)
    void operation.catch(() => undefined)
    try {
      await durable.promise; controller.abort(reason); release.release()
      await expect(operation).rejects.toBe(reason)
      expect((await h.ctx.sessionPersistence.readFrom(header.id, 0)).events).toEqual(events)
      const page = await h.ctx.projectStorage.list(authority, { kind: 'workspace', workspaceId: workspace.workspaceId })
      expect(page.sessions[0]!.nextSeq).toBe(events.length)
      const db = new DatabaseSync(h.index, { readOnly: true })
      try { expect(db.prepare('SELECT next_seq FROM history WHERE session=?').get(header.id)?.next_seq).toBe(events.length) }
      finally { db.close() }
    } finally { release.release(); await operation.catch(() => undefined) }
  })
})
