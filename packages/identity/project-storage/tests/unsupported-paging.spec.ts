import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId, SESSION_FORMAT_VERSION, type SessionHeader } from '@arx-ai/arx-session'
import type { RequestAuthority } from '@arx-ai/arx-web-identity'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import { storageHarness } from './harness.ts'

let original: Awaited<ReturnType<typeof storageHarness>> | undefined
let restored: Awaited<ReturnType<typeof storageHarness>> | undefined
let root: string | undefined
let authority: RequestAuthority
let meta: SessionHeader

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'arx-storage-sqlite-fixture-')))
  original = await storageHarness({ root, initialize: true, readyUsers: 1 })
  const user = original.users[0]!
  const project = await original.ctx.projectStorage.createProject(user.authority, 'Original private project')
  const workspace = await original.ctx.projectStorage.createWorkspace(user.authority, project.projectId, 'Original private workspace')
  meta = await original.ctx.projectStorage.register(user.authority, workspace.workspaceId,
    { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
  await original.ctx.projectStorage.append(user.authority, meta.id, oneTurnLog())
  await original.close(false)
  restored = await storageHarness({ root, initialize: false, persistence: 'sqlite' })
  const login = await restored.ctx.webIdentity.login(user.username, user.password, 'user')
  authority = await restored.ctx.webIdentity.authenticate(login.token, 'user')
  // The current control index and journal remain authoritative. The replacement
  // is the genuine existing logical SQLite provider, not a JSONL capability shim.
  await restored.ctx.sessionPersistence.create(meta)
  await restored.ctx.sessionPersistence.append(meta.id, oneTurnLog())
})
afterEach(async () => {
  vi.restoreAllMocks()
  try { await restored?.close(false) } finally {
    try { await original?.close(false) } finally {
      if (root !== undefined) await rm(root, { recursive: true, force: true })
    }
  }
  original = undefined; restored = undefined; root = undefined
})
describe('restored owned history with an existing provider lacking raw pages', () => {
  it('rejects bounded reads by capability after valid authority and ownership without a full-log fallback', async () => {
    if (restored === undefined) throw new Error('real restored Loader missing')
    const { ctx } = restored
    expect(ctx.sessionPersistence.name).toBe('session-persistence-sqlite')
    expect(ctx.sessionPersistence.supportsRawArtifactPages).toBe(false)
    expect(await ctx.webIdentity.revalidate(authority)).toBe(authority)
    const scope = await ctx.webIdentity.authorizeOwner(authority, { kind: 'session', sessionId: meta.id })
    expect(scope).toMatchObject({ userId: authority.principal.userId })
    if (scope.workspaceId === undefined) throw new Error('real session owner workspace missing')
    expect((await ctx.sessionPersistence.readFrom(meta.id, 0)).meta).toEqual(meta)
    expect((await ctx.sessionPersistence.listSnapshots()).some(snapshot => snapshot.header.id === meta.id)).toBe(true)
    const readRaw = vi.spyOn(ctx.sessionPersistence, 'readRaw')
    const readRawPage = vi.spyOn(ctx.sessionPersistence, 'readRawPage')
    const readFrom = vi.spyOn(ctx.sessionPersistence, 'readFrom')
    await expect(ctx.projectStorage.read(authority, meta.id)).rejects.toMatchObject({ status: 503, code: 'HISTORY_UNAVAILABLE' })
    await expect(ctx.projectStorage.executionRawPage(authority, meta.id, { offset: 0, maxBytes: 1024 }))
      .rejects.toMatchObject({ status: 503, code: 'HISTORY_UNAVAILABLE' })
    expect(readRaw).not.toHaveBeenCalled()
    expect(readRawPage).not.toHaveBeenCalled()
    expect(readFrom).not.toHaveBeenCalled()
    expect((await ctx.projectStorage.list(authority, { kind: 'workspace', workspaceId: scope.workspaceId })).sessions.map(session => session.sessionId)).toEqual([meta.id])
  })
})
