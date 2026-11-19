/** Independent auth schema. The history schema-17 database is never opened. */
import { DatabaseSync } from 'node:sqlite'
import { identityFailure } from '@arx-ai/arx-web-identity'
/**
 * Version of the independent native identity schema, separate from history schema 17.
 */
export const IDENTITY_SCHEMA_VERSION = 2
/**
 * SQLite application identity used to refuse an unrelated database.
 */
export const IDENTITY_APPLICATION_ID = 0x41525849
/**
 * Independent STRICT auth, grant, ownership, encrypted-outbox and audit projection schema.
 */
export const SCHEMA_SQL = `
CREATE TABLE auth_meta (id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL,
 sequence INTEGER NOT NULL, hash TEXT NOT NULL) STRICT;
INSERT INTO auth_meta VALUES(1,${IDENTITY_SCHEMA_VERSION},0,'${'0'.repeat(64)}');
CREATE TABLE users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE,
 email TEXT NOT NULL, email_key TEXT NOT NULL UNIQUE,
 role TEXT NOT NULL CHECK(role IN ('MASTER_ADMIN','USER')),
 status TEXT NOT NULL CHECK(status IN ('PENDING','ACTIVE','BLOCKED','DELETED')),
 password_hash TEXT, must_change INTEGER NOT NULL CHECK(must_change IN (0,1)),
 revision INTEGER NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE web_sessions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_digest TEXT NOT NULL UNIQUE,
 audience TEXT NOT NULL CHECK(audience IN ('user','admin')), revision INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, idle_expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX web_sessions_user ON web_sessions(user_id);
CREATE TABLE auth_tokens (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), purpose TEXT NOT NULL CHECK(purpose IN ('invitation','reset')),
 token_digest TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX auth_tokens_user ON auth_tokens(user_id,purpose);
CREATE TABLE module_grants (
 user_id TEXT NOT NULL REFERENCES users(id), module_id TEXT NOT NULL, PRIMARY KEY(user_id,module_id)
) STRICT;
CREATE TABLE project_owners (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), deleted INTEGER NOT NULL DEFAULT 0) STRICT;
CREATE INDEX project_owners_user ON project_owners(user_id,id);
CREATE TABLE workspace_owners (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project_owners(id), deleted INTEGER NOT NULL DEFAULT 0) STRICT;
CREATE TABLE session_owners (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace_owners(id), deleted INTEGER NOT NULL DEFAULT 0) STRICT;
CREATE TABLE outbox (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_id TEXT NOT NULL REFERENCES auth_tokens(id),
 purpose TEXT NOT NULL, expires_at INTEGER NOT NULL, ciphertext TEXT,
 state TEXT NOT NULL CHECK(state IN ('pending','accepted','cancelled')), provider_id TEXT
) STRICT;
CREATE INDEX outbox_pending ON outbox(state,expires_at);
CREATE TABLE audit (sequence INTEGER PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL) STRICT;
CREATE TRIGGER project_owner_user BEFORE INSERT ON project_owners
 WHEN (SELECT role FROM users WHERE id=NEW.user_id) <> 'USER'
 BEGIN SELECT RAISE(ABORT,'user project owner required'); END;
`
/**
 * Recognize SQLite releases carrying the WAL-reset fix or its supported backports.
 * @param version - Measured driver sqlite_version() text.
 * @returns Whether the measured release includes the correction.
 */
export function fixedSqliteVersion(version: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    return false
  const parsed = version.split('.').map(Number)
  const [major = 0, minor = 0, patch = 0] = parsed
  return major > 3 || (major === 3 && (minor > 51 || (minor === 51 && patch >= 3)
        || (minor === 50 && patch >= 7) || (minor === 44 && patch >= 6)))
}
/**
 * Validate or explicitly initialize the independent identity DB and require corrected WAL with FULL durability.
 * @param db - Explicit native SQLite database connection.
 * @param initialize - Operator or fixture permission to create a new identity schema.
 */
export function configureDatabase(db: DatabaseSync, initialize: boolean): void {
  const row = (db.prepare('SELECT sqlite_version() AS version').get() as Record<string, import('node:sqlite').SQLOutputValue>)
  if (!fixedSqliteVersion(String(row.version)))
    identityFailure('AUTH_SQLITE_VERSION', 503, 'Corrected SQLite WAL implementation required')
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA mmap_size=0; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;')
  const current = Number((db.prepare('PRAGMA application_id').get() as Record<string, import('node:sqlite').SQLOutputValue>).application_id)
  if (current === 0) {
    const tables = Number((db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table'").get() as Record<string, import('node:sqlite').SQLOutputValue>).count)
    if (!initialize || tables !== 0)
      identityFailure('AUTH_SCHEMA', 503, 'Initialized identity database required')
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(SCHEMA_SQL)
      db.exec('PRAGMA application_id=' + String(IDENTITY_APPLICATION_ID) + '; PRAGMA user_version=' + String(IDENTITY_SCHEMA_VERSION) + '; COMMIT;')
    }
    catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  else if (current !== IDENTITY_APPLICATION_ID || Number((db.prepare('PRAGMA user_version').get() as Record<string, import('node:sqlite').SQLOutputValue>).user_version) !== IDENTITY_SCHEMA_VERSION) {
    identityFailure('AUTH_SCHEMA', 503, 'Identity database format refused')
  }
  const mode = String((db.prepare('PRAGMA journal_mode=WAL').get() as Record<string, import('node:sqlite').SQLOutputValue>).journal_mode)
  if (mode !== 'wal')
    identityFailure('AUTH_STORAGE', 503, 'Local durable identity database required')
  const foreignKeys = Number((db.prepare('PRAGMA foreign_keys').get() as Record<string, import('node:sqlite').SQLOutputValue>).foreign_keys)
  const synchronous = Number((db.prepare('PRAGMA synchronous').get() as Record<string, import('node:sqlite').SQLOutputValue>).synchronous)
  if (foreignKeys !== 1 || synchronous !== 2)
    identityFailure('AUTH_STORAGE', 503, 'Durable identity database settings required')
}
