import { createUserMessage } from '@centurionarx/cxh-llm'
/**
 * Keyless real-Loader-path smoke for the combined SQLite session-query service.
 *
 * @module @centurionarx/cxh-session-query-sqlite/tests/load-path
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@centurionarx/cordis'
import Loader from '@centurionarx/cordis-plugin-loader'
import { SESSION_FORMAT_VERSION, SessionId } from '@centurionarx/cxh-session'
import SessionStore from '@centurionarx/cxh-session'
import SqliteSessionPersistence from '@centurionarx/cxh-session-persistence-sqlite'
import SqliteSessionQueryEngine, * as queryModule from '@centurionarx/cxh-session-query-sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const temporaryDirectories: string[] = []

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function temporaryPath(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'cxh-session-search-loader-'))
  temporaryDirectories.push(directory)
  return join(directory, name)
}

describe('cxh-session-query-sqlite real Loader path', () => {
  it('unwraps, mounts, and searches the real persistence backend', async () => {
    const persistencePath = await temporaryPath('canonical.db')
    const searchPath = await temporaryPath('derived.db')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const persistence = await ctx.plugin(SqliteSessionPersistence, { path: persistencePath })

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(queryModule) as Parameters<Context['plugin']>[0]
    expect(unwrapped).toBe(SqliteSessionQueryEngine)
    const query = await ctx.plugin(unwrapped, { path: searchPath })

    const id = SessionId('loader-path')
    await ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id, createdAt: 10 })
    await ctx.sessionPersistence.append(id, [{
      type: 'user/message',
      seq: 0,
      time: 10,
      data: createUserMessage({
        content: [{ type: 'text', text: 'real Loader needle' }], source: { kind: 'user' },
      }),
      surfaceOp: 'append',
    }])

    await expect(ctx.sessionQuery.searchSessions({ query: 'Loader needle' }))
      .resolves.toMatchObject({ items: [{ header: { id }, persisted: true, live: false }] })
    await expect(ctx.sessionQuery.listSessions())
      .resolves.toMatchObject([{ header: { id }, persisted: true, live: false }])
    await query.dispose()
    await persistence.dispose()
  })
})
