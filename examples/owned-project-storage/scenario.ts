/**
 * Runnable keyless AUTH-003B/005 example. Real Loader providers back every
 * operation; backup/restore touches disposable synthetic state only.
 */
import { mkdtemp, mkdir, rm, cp, readFile, writeFile, chmod, readdir, realpath } from 'node:fs/promises'
import { DatabaseSync, backup } from 'node:sqlite'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { oneTurnLog } from '../../packages/session/session-persistence/tests/contract.ts'
import { storageHarness } from '../../packages/identity/project-storage/tests/harness.ts'
import { supervisorFixture } from '../../packages/host/isolated-project-runtime/tests/supervisor.ts'

async function privateBackup(source: string, target: string) {
  const database = new DatabaseSync(source, { readOnly: true })
  try { await backup(database, target); await chmod(target, 0o600) } finally { database.close() }
}
async function files(root: string, current = root): Promise<{ path: string
  sha256: string }[]> {
  const result: { path: string
    sha256: string }[] = []
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name)
    if (entry.isSymbolicLink()) throw new Error('fixture backup refuses symlinks')
    if (entry.isDirectory()) result.push(...await files(root, path))
    else if (entry.isFile()) result.push({ path: relative(root, path),
      sha256: createHash('sha256').update(await readFile(path)).digest('hex') })
  }
  return result.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Answer host.describe and merge a host downlink over two workspaces through a disposable supervisor.
 * @returns Receipt lines naming workspaces A/B and sessions by label, never by id or path.
 */
async function runtimeReceipts(): Promise<string[]> {
  const supervisor = await supervisorFixture()
  try {
    const fixture = await storageHarness({ endpoint: supervisor.endpoint, readyUsers: 1 })
    try {
      const authority = present(fixture.users[0]).authority
      const runtime = fixture.ctx.isolatedProjectRuntime
      const project = await fixture.ctx.projectStorage.createProject(authority, 'Runtime project')
      const labels = new Map<string, string>()
      const workspaces = []
      for (const label of ['A', 'B']) {
        const workspace = await fixture.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Workspace ' + label)
        const header = await fixture.ctx.projectStorage.register(authority, workspace.workspaceId,
          { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
        labels.set(workspace.workspaceId, label); labels.set(header.id, 'session ' + label)
        supervisor.framesFor(workspace.workspaceId, [{ type: 'server-request', rpcId: randomUUID(), method: 'events.host',
          payload: { type: 'host/session-status', sessionId: header.id, running: true } }])
        workspaces.push(workspace.workspaceId)
      }
      const request = (method: string) => ({ type: 'client-request' as const, rpcId: RpcId(randomUUID()), method, payload: {} })
      const described = await runtime.invoke(authority, undefined, request('host.describe'))
      const describeRequests = supervisor.log.length
      const controller = new AbortController()
      const downlink = runtime.streamHost(authority, controller.signal)[Symbol.asyncIterator]()
      const frames: string[] = []
      for (const workspaceId of workspaces) {
        const next = downlink.next()
        await runtime.invoke(authority, { kind: 'workspace', workspaceId }, request('llm.providers'))
        const frame = await next
        if (frame.done === true || frame.value.payload.type !== 'host/session-status') throw new Error('fixture downlink frame')
        frames.push(present(labels.get(frame.value.payload.sessionId)))
      }
      const routed = supervisor.log.map(line => line.replace(/ (\S+)$/, (_, id: string) => ' ' + (labels.get(id) ?? id)))
      controller.abort()
      await downlink.return?.()
      return [
        '- Runtime host.describe: control answers ' + JSON.stringify(described) + ' with '
          + String(describeRequests) + ' supervisor requests.',
        '- Host downlink over two workspaces: opened idle; each first scoped request attached its sub-stream first ('
          + routed.join(', ') + '); merged frames: ' + frames.join(', ') + '; closing left '
          + String(supervisor.operations.size) + ' supervisor operations and cancelled '
          + String(supervisor.cancelled.length) + ' sub-leases.',
      ]
    } finally { await fixture.close() }
  } finally { await supervisor.close() }
}

/**
 * Run owner isolation, grouping, snapshot and restore without a production root.
 * @returns Safe normalized acceptance text containing no credential or raw path.
 */
export async function ownedStorageScenario(): Promise<string> {
  const fixture = await storageHarness()
  const snapshot = await realpath(await mkdtemp(join(tmpdir(), 'arx-owned-backup-fixture-')))
  let resumed: Awaited<ReturnType<typeof storageHarness>> | undefined
  let closed = false
  try {
    const owner = present(fixture.users[0]), second = present(fixture.users[1])
    const project = await fixture.ctx.projectStorage.createProject(owner.authority, 'My project')
    const workspace = await fixture.ctx.projectStorage.createWorkspace(owner.authority, project.projectId, 'My workspace')
    const header = await fixture.ctx.projectStorage.register(owner.authority, workspace.workspaceId,
      { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
    const commit = await fixture.ctx.projectStorage.append(owner.authority, header.id, oneTurnLog())
    const log = present(fixture.ctx.sessionPersistence.locate(header)).path
    await writeFile(join(present(header.cwd), 'keep.txt'), 'synthetic-owned-file')
    const rawBefore = await readFile(log)
    const page = await fixture.ctx.projectStorage.read(owner.authority, header.id)
    const metadata = await fixture.ctx.projectStorage.list(owner.authority, { kind: 'workspace', workspaceId: workspace.workspaceId })
    if (metadata.sessions.length !== 1 || commit.nextSeq !== 6
      || !page.content.includes('"turn/end"')) throw new Error('fixture durable history')
    try {
      await fixture.ctx.isolatedProjectRuntime.fetch(owner.authority, new Request('http://fixture/api/host.describe', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method: 'host.describe', payload: {} }),
      }))
      throw new Error('fixture endpoint fallback')
    } catch (error) { if ((error as { status?: number }).status !== 503) throw error }
    let denied = 0
    for (const actor of [second.authority, present(fixture.master)]) {
      try { await fixture.ctx.projectStorage.read(actor, header.id); throw new Error('fixture owner bypass') }
      catch (error) { if ((error as { status?: number }).status !== 403) throw error; denied++ }
    }
    await mkdir(join(snapshot, 'control'), { mode: 0o700 })
    await privateBackup(fixture.paths.database, join(snapshot, 'control', 'identity.sqlite'))
    await privateBackup(fixture.index, join(snapshot, 'control', 'history.sqlite'))
    await cp(fixture.logRoot, join(snapshot, 'history'), { recursive: true, dereference: false })
    await cp(fixture.volumeRoot, join(snapshot, 'volumes'), { recursive: true, dereference: false })
    const manifest = await files(snapshot)
    if (manifest.some(row => /credential|identity\.key|authority|worker\.yaml/.test(row.path))) throw new Error('fixture backup included authority material')
    const bytes = await readFile(join(snapshot, 'control', 'identity.sqlite'))
    for (const secret of [owner.token, second.token, owner.password, second.password, fixture.passwords.master]) {
      if (bytes.includes(Buffer.from(secret))) throw new Error('fixture backup included a plaintext credential')
    }
    await writeFile(join(snapshot, 'manifest.json'), JSON.stringify({ format: 'AUTH-005/fixture/v1',
      authorityHead: fixture.ctx.identityAuthorityJournal.head, files: manifest }) + '\n', { mode: 0o600 })
    await fixture.ctx.projectStorage.removeGrouping(owner.authority, workspace.workspaceId)
    if ((await fixture.ctx.projectStorage.workspaces(owner.authority,
      project.projectId)).workspaces.length !== 0) throw new Error('fixture grouping')
    await fixture.ctx.projectStorage.deleteSession(owner.authority, header.id)
    await fixture.ctx.webIdentity.setStatus(present(fixture.master), owner.userId, 'BLOCKED')
    const latestHead = fixture.ctx.identityAuthorityJournal.head
    await fixture.close(false); closed = true
    // Authority head/key stay outside the snapshot and are never restored.
    for (const path of [fixture.paths.database, fixture.index]) {
      await rm(path, { force: true }); await rm(path + '-wal', { force: true }); await rm(path + '-shm', { force: true })
    }
    await cp(join(snapshot, 'control', 'identity.sqlite'), fixture.paths.database); await chmod(fixture.paths.database, 0o600)
    await cp(join(snapshot, 'control', 'history.sqlite'), fixture.index); await chmod(fixture.index, 0o600)
    await cp(join(snapshot, 'history'), fixture.logRoot, { recursive: true, force: true })
    await cp(join(snapshot, 'volumes'), fixture.volumeRoot, { recursive: true, force: true })
    resumed = await storageHarness({ root: fixture.paths.root, initialize: false })
    if (resumed.ctx.identityAuthorityJournal.head.sequence < latestHead.sequence) throw new Error('fixture resurrected journal')
    for (const token of [owner.token, second.token]) {
      try { await resumed.ctx.webIdentity.authenticate(token, 'user'); throw new Error('fixture resurrected session') }
      catch (error) { if ((error as { status?: number }).status !== 401) throw error }
    }
    try { await resumed.ctx.webIdentity.login(owner.username, owner.password,
      'user'); throw new Error('fixture unblocked restored account') }
    catch (error) { if ((error as { status?: number }).status !== 401) throw error }
    const adminLogin = await resumed.ctx.webIdentity.login('arxadmin', fixture.passwords.master, 'admin')
    const master = await resumed.ctx.webIdentity.authenticate(adminLogin.token, 'admin')
    const restoredUsers = await resumed.ctx.webIdentity.listUsers(master)
    if (restoredUsers.users.find(user => user.userId === owner.userId)?.status !== 'BLOCKED') throw new Error('fixture restored blocked authority incorrectly')
    await resumed.ctx.webIdentity.setStatus(master, owner.userId, 'ACTIVE')
    const userLogin = await resumed.ctx.webIdentity.login(owner.username, owner.password, 'user')
    const current = await resumed.ctx.webIdentity.authenticate(userLogin.token, 'user')
    try { await resumed.ctx.projectStorage.recover(current, header.id); throw new Error('fixture resurrected tombstone') }
    catch (error) { if ((error as { status?: number }).status !== 403) throw error }
    if ((await resumed.ctx.projectStorage.list(current, { kind: 'project',
      projectId: project.projectId })).sessions.length !== 0) throw new Error('fixture stale index authorized a tombstone')
    if (!(await readFile(log)).equals(rawBefore) || await readFile(join(present(header.cwd), 'keep.txt'),
      'utf8') !== 'synthetic-owned-file') throw new Error('fixture lost own bytes')
    const legacy = { id: SessionId('unmapped-legacy-' + randomUUID()), version: SESSION_FORMAT_VERSION,
      createdAt: 1, cwd: present(header.cwd) }
    await resumed.ctx.sessionPersistence.create(legacy)
    await resumed.ctx.sessionPersistence.append(legacy.id, oneTurnLog())
    try { await resumed.ctx.projectStorage.recover(current, legacy.id); throw new Error('fixture inferred a legacy owner') }
    catch (error) { if ((error as { status?: number }).status !== 403) throw error }
    return [
      '# Owned project storage fixture',
      '',
      '- USER: projects and workspaces use generated opaque ids.',
      '- History: 6 durable events, one owned metadata row, original raw JSONL page.',
      '- USER_B and MASTER_ADMIN: both denied before history access.',
      '- Grouping removal: histories and own workspace files preserved.',
      '- Backup: private SQLite snapshots, histories and own volumes; keys and authority journal excluded.',
      '- Restore: old cookies revoked, blocked USER stayed blocked, deleted session stayed denied.',
      '- Legacy migration: unmapped logs denied; owner was never inferred from cwd.',
      '- Runtime without an operator endpoint: execution stays unavailable.',
      ...await runtimeReceipts(),
      '- Operational worker/UID/mount/network isolation and production restore remain separate gates.',
      '',
    ].join('\n')
  } finally {
    await resumed?.close(false)
    if (!closed) await fixture.close(false)
    await rm(snapshot, { recursive: true, force: true })
    await rm(fixture.paths.root, { recursive: true, force: true })
  }
}

function present<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('required native fixture value missing')
  return value
}
