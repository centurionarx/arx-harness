import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureDatabase, fixedSqliteVersion, IDENTITY_APPLICATION_ID, SCHEMA_SQL } from '../src/schema.ts'
let root: string | undefined, db: DatabaseSync | undefined
afterEach(async () => { vi.restoreAllMocks(); db?.close(); db = undefined; if (root !== undefined)
  await rm(root, { recursive: true, force: true }); root = undefined })
async function database() { root = await mkdtemp(join(tmpdir(), 'arx-auth-schema-')); db = new DatabaseSync(join(root, 'auth.sqlite')); return db }
describe('independent auth schema and native SQLite durability', () => {
  it('rejects uninitialized or unrelated/history schemas and uses the measured corrected driver', async () => {
    const sqlite = await database()
    expect(fixedSqliteVersion('4.0.0')).toBe(true)
    for (const version of ['', '3', '3.51.3-extra', '3.51.3.99', 'garbage'])
      expect(fixedSqliteVersion(version)).toBe(false)
    await expect(async () => { configureDatabase(sqlite, false) }).rejects.toMatchObject({ code: 'AUTH_SCHEMA' })
    sqlite.exec('CREATE TABLE old_history(id INTEGER); PRAGMA user_version=17')
    expect(() => { configureDatabase(sqlite, true) }).toThrow(/Initialized identity database/)
    sqlite.exec('DROP TABLE old_history; PRAGMA application_id=17')
    expect(() => { configureDatabase(sqlite, true) }).toThrow(/format refused/)
    sqlite.exec('PRAGMA application_id=' + String(IDENTITY_APPLICATION_ID) + '; PRAGMA user_version=17')
    expect(() => { configureDatabase(sqlite, true) }).toThrow(/format refused/)
  })
  it('creates and reopens the private schema with WAL, FULL, foreign keys and MASTER ownership rejected', async () => {
    const sqlite = await database()
    configureDatabase(sqlite, true)
    configureDatabase(sqlite, false)
    expect(sqlite.prepare('PRAGMA application_id').get()!.application_id).toBe(IDENTITY_APPLICATION_ID)
    expect(sqlite.prepare('PRAGMA synchronous').get()!.synchronous).toBe(2)
    expect(sqlite.prepare('PRAGMA foreign_keys').get()!.foreign_keys).toBe(1)
    expect(sqlite.prepare('PRAGMA journal_mode').get()!.journal_mode).toBe('wal')
    expect(sqlite.prepare('PRAGMA user_version').get()!.user_version).toBe(2)
    sqlite.exec('PRAGMA user_version=1')
    expect(() => { configureDatabase(sqlite, false) }).toThrow(/format refused/)
    sqlite.exec('PRAGMA user_version=2')
    sqlite.exec("INSERT INTO users VALUES('fixture-master','arxadmin','arxadmin','admin@fixture.test','admin@fixture.test','MASTER_ADMIN','ACTIVE',NULL,1,1,1)")
    expect(() => sqlite.prepare('INSERT INTO project_owners VALUES(?,?,0)').run('fixture-project', 'fixture-master')).toThrow(/user project owner required/)
  })
  it('refuses an unfixed SQLite runtime and a non-local memory journal', async () => {
    const sqlite = await database()
    sqlite.function('sqlite_version', () => '3.51.2')
    expect(() => { configureDatabase(sqlite, true) }).toThrow(/Corrected SQLite WAL/)
    const memory = new DatabaseSync(':memory:')
    try {
      expect(() => { configureDatabase(memory, true) }).toThrow(/Local durable identity database/)
    }
    finally {
      memory.close()
    }
  })
  it('rolls back initialization on a native I/O failure and verifies actual durable settings independently', async () => {
    const sqlite = await database(), execute = sqlite.exec.bind(sqlite)
    const fault = vi.spyOn(sqlite, 'exec').mockImplementation((sql) => {
      if (sql === SCHEMA_SQL)
        throw new Error('fixture-database-io-failure')
      execute(sql)
    })
    expect(() => { configureDatabase(sqlite, true) }).toThrow('fixture-database-io-failure')
    fault.mockRestore()
    expect(sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()!.n).toBe(0)
    configureDatabase(sqlite, true)
    const prepare = sqlite.prepare.bind(sqlite)
    for (const broken of ['PRAGMA foreign_keys', 'PRAGMA synchronous']) {
      const read = vi.spyOn(sqlite, 'prepare').mockImplementation((sql) => {
        const statement = prepare(sql)
        if (sql === broken)
          vi.spyOn(statement, 'get').mockImplementation(() => ({ foreign_keys: 0, synchronous: 0 }))
        return statement
      })
      expect(() => { configureDatabase(sqlite, false) }).toThrow(/Durable identity database settings/)
      read.mockRestore()
    }
  })
})
