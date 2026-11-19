/** Real Loader composition shared by project storage and supervisor tests. */
import { mkdtemp, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import SessionStore from '@arx-ai/arx-session'
import JsonlPersistence from '@arx-ai/arx-session-persistence-jsonl'
import SqlitePersistence from '../../../session/session-persistence-sqlite/src/index.ts'
import CredentialsLocal from '@arx-ai/arx-credentials-local'
import { credentialRef } from '@arx-ai/arx-credentials'
import ProjectStorage from '../src/index.ts'
import * as ProjectStorageHttp from '../src/http.ts'
import IsolatedRuntime from '../../../host/isolated-project-runtime/src/index.ts'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'
export const FIXTURE_CREDENTIAL = 'ARX_SUPERVISOR_FIXTURE_KEY'
export async function storageHarness(options: { endpoint?: string
  http?: boolean
  apiAudience?: 'user' | 'admin'
  runtimeConfig?: Readonly<Record<string, unknown>>
  storageConfig?: Partial<import('../src/index.ts').Config>
  historyPageBytes?: number
  compression?: 'none' | 'zstd'
  persistence?: 'jsonl' | 'sqlite'
  root?: string
  initialize?: boolean
  readyUsers?: number
  accessMode?: 'local' | 'authenticated'
  packageBaseUrl?: string
  extraPlugins?: readonly { name: string
    plugin: unknown
    config?: unknown }[] } = {}) {
  const root = options.root ?? await realpath(await mkdtemp(join(tmpdir(), 'arx-project-fixture-')))
  const index = join(root, 'index', 'history.sqlite')
  const logRoot = join(root, 'content', 'history')
  const volumeRoot = join(root, 'content', 'volumes')
  const extraPlugins: { name: string
    plugin: unknown
    config?: unknown }[] = [
    { name: '@arx-ai/arx-session', plugin: SessionStore },
    ...(options.persistence === 'sqlite'
      ? [{ name: '@arx-ai/arx-session-persistence-sqlite', plugin: SqlitePersistence, config: { path: join(logRoot, 'sessions.sqlite') } }]
      : [{ name: '@arx-ai/arx-session-persistence-jsonl', plugin: JsonlPersistence, config: { root: logRoot,
        compression: options.compression ?? 'none' } }]),
    { name: '@arx-ai/arx-project-storage', plugin: ProjectStorage, config: { indexPath: index, logRoot, volumeRoot,
      maxPageBytes: 128 * 1024, pageSize: 50, historyPageBytes: options.historyPageBytes ?? 128 * 1024,
      appendBytes: 32 * 1024 * 1024, busyTimeoutMs: 5000, ...(options.storageConfig ?? {}) } },
    { name: '@arx-ai/arx-credentials-local', plugin: CredentialsLocal, config: { path: join(root, 'keys',
      'worker.yaml'), arxHome: join(root, 'keys'), watch: false } },
    { name: '@arx-ai/arx-isolated-project-runtime', plugin: IsolatedRuntime, config: {
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint, credentialRef: FIXTURE_CREDENTIAL, fixtureLoopback: true }),
      requestTimeoutMs: 5000, cancellationTimeoutMs: 5000, maxRequestBytes: 1024 * 1024,
      maxResponseBytes: 16 * 1024 * 1024, ...(options.runtimeConfig ?? {}) } },
    ...(options.http === true ? [{ name: '@arx-ai/arx-project-storage/http', plugin: ProjectStorageHttp,
      config: { maxRequestBytes: 1024 } }] : []),
    ...(options.extraPlugins ?? []),
  ]
  try {
    const fixture = await identityHarness({ root, initialize: options.initialize ?? options.root === undefined,
      readyUsers: options.readyUsers ?? (options.root === undefined ? 2 : 0),
      ...(options.http === true ? { api: options.apiAudience ?? 'user' } : {}),
      ...(options.accessMode === undefined ? {} : { accessMode: options.accessMode }),
      ...(options.packageBaseUrl === undefined ? {} : { packageBaseUrl: options.packageBaseUrl }), extraPlugins })
    await fixture.ctx.credentials.set(credentialRef(FIXTURE_CREDENTIAL), 'disposable-supervisor-fixture')
    return { ...fixture, index, logRoot, volumeRoot,
      async close(remove = options.root === undefined) { await fixture.close(false); if (remove) await rm(root,
        { recursive: true, force: true }) } }
  } catch (error) { if (options.root === undefined) await rm(root, { recursive: true, force: true }); throw error }
}

/**
 * One second before the earliest idle deadline among live sessions. Freezing time relative to the
 * acting user alone would expire an earlier fixture session (such as MASTER) when setup runs slowly.
 * @param path - Identity database of the fixture.
 * @returns Epoch milliseconds at which every live fixture session is still idle-valid.
 */
export function frozenBeforeIdle(path: string): number {
  const database = new DatabaseSync(path)
  try {
    const row = database.prepare('SELECT MIN(idle_expires_at) AS deadline FROM web_sessions WHERE revoked=0').get()
    if (row?.deadline == null) throw new Error('live session deadline missing')
    return Number(row.deadline) - 1000
  } finally { database.close() }
}
