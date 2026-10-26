import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

/**
 * The SQLite datastore (DAT-01) and its versioned migrations (DAT-08). Every migration runs in its own transaction;
 * a database written by a newer schema is refused rather than reinterpreted, and an existing file is backed up with
 * the SQLite backup API before any migration touches it (DAT-07).
 */
export interface Migration { version: number; name: string; up: string }

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'workouts, master data, sessions, corrections',
    up: `
      CREATE TABLE workouts (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        title TEXT NOT NULL,
        sharing_origin TEXT NOT NULL DEFAULT 'local',
        document TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE INDEX workouts_updated ON workouts(updated_at DESC);
      CREATE TABLE master_data (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL,
        document TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        workout_id TEXT NOT NULL,
        workout_revision INTEGER NOT NULL,
        title TEXT NOT NULL,
        workout_document TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'capped', 'aborted')),
        interrupted INTEGER NOT NULL DEFAULT 0,
        modified INTEGER NOT NULL DEFAULT 0,
        completion REAL NOT NULL,
        active_ms INTEGER NOT NULL,
        results TEXT NOT NULL,
        events TEXT NOT NULL,
        device_id TEXT NOT NULL,
        received_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX sessions_finished ON sessions(finished_at DESC);
      CREATE INDEX sessions_workout ON sessions(workout_id, finished_at DESC);
      CREATE TABLE session_corrections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        corrected_at TEXT NOT NULL,
        previous_results TEXT NOT NULL,
        results TEXT NOT NULL,
        note TEXT
      );
    `,
  },
];
export const latestSchemaVersion = () => MIGRATIONS[MIGRATIONS.length - 1].version;

export class SchemaNewerError extends Error {
  constructor(readonly found: number, readonly supported: number) {
    super(`The database was written by a newer OpenWOD (schema version ${found}; this build supports up to ${supported}). Update the image, or restore the pre-migration backup from /data/backups before rolling back.`);
    this.name = 'SchemaNewerError';
  }
}

export const isMemory = (path: string) => path === ':memory:' || path.startsWith('file::memory:');

export function openDatabase(path: string): DatabaseSync {
  if (!isMemory(path)) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (!isMemory(path)) db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

export function schemaVersion(db: DatabaseSync): number {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!table) return 0;
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
  return row.version ?? 0;
}

export async function backupTo(db: DatabaseSync, path: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await backup(db, path);
}

export interface MigrateOptions { path: string; appVersion: string; backupDir?: string; now?: () => Date }

/** Brings the database to the latest schema, backing up an existing file first. Returns the versions it went from and to. */
export async function migrate(db: DatabaseSync, { path, appVersion, backupDir, now = () => new Date() }: MigrateOptions): Promise<{ from: number; to: number; backup?: string }> {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL, app_version TEXT NOT NULL)');
  const latest = latestSchemaVersion();
  const from = schemaVersion(db);
  if (from > latest) throw new SchemaNewerError(from, latest);
  const pending = MIGRATIONS.filter(migration => migration.version > from);
  if (!pending.length) return { from, to: from };
  let backupPath: string | undefined;
  if (from > 0 && !isMemory(path)) {
    backupPath = join(backupDir ?? join(dirname(path), 'backups'), `pre-migration-v${from}-to-v${latest}-${now().toISOString().replace(/[:.]/g, '-')}.sqlite`);
    await backupTo(db, backupPath);
  }
  for (const migration of pending) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.up);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at, app_version) VALUES (?, ?, ?, ?)').run(migration.version, migration.name, now().toISOString(), appVersion);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return { from, to: latest, ...(backupPath ? { backup: backupPath } : {}) };
}
