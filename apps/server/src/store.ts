import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { MasterData } from '../../../packages/domain/src/master-data';
import type { Workout } from '../../../packages/domain/src/schema';
import type { SectionResult } from '../../../packages/engine/src';
import type { SessionCorrection, SessionRecord } from '../../../packages/engine/src/records';
import { Household, type HouseholdTables } from '../../../packages/household/src/core';
import { EXPORT_VERSION, parseExportDocument } from '../../../packages/household/src/export';
import type { DeviceImport, DeviceImportReport, ExportDocument, MasterRow, PackImport, PackImportReport, RestoreReport, SessionListItem, StoredSession, StoredWorkout } from '../../../packages/household/src/types';
import { backupTo, isMemory, migrate, openDatabase, schemaVersion } from './db';

export type { DeviceImport, DeviceImportReport, PackDecision, PackImport, PackImportReport, RestoreReport, SessionListItem, StoredWorkout } from '../../../packages/household/src/types';

interface WorkoutRow { id: string; revision: number; sharing_origin: 'local' | 'imported'; document: string; created_at: string; updated_at: string; archived_at: string | null }
interface SessionRow { id: string; workout_id: string; workout_revision: number; title: string; workout_document: string; started_at: string; finished_at: string; outcome: SessionRecord['outcome']; interrupted: number; modified: number; completion: number; active_ms: number; results: string; events: string; device_id: string; received_at: string; revision: number }

/** The household tables over SQLite (DAT-01). Only ever called inside Store.transaction. */
class SqliteTables implements HouseholdTables {
  constructor(private readonly db: DatabaseSync) {}

  private rowToWorkout(row: WorkoutRow): StoredWorkout {
    return { id: row.id, revision: row.revision, origin: row.sharing_origin, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.archived_at ? { archivedAt: row.archived_at } : {}), document: JSON.parse(row.document) as Workout };
  }

  private rowToSession(row: SessionRow): StoredSession;
  private rowToSession(row: SessionRow, full: false): SessionRecord & { receivedAt: string };
  private rowToSession(row: SessionRow, full = true): SessionRecord & { receivedAt: string } {
    const record: SessionRecord & { receivedAt: string } = {
      id: row.id, workoutId: row.workout_id, workoutRevision: row.workout_revision, title: row.title, startedAt: row.started_at, finishedAt: row.finished_at,
      outcome: row.outcome, interrupted: row.interrupted === 1, modified: row.modified === 1, completion: row.completion, activeMs: row.active_ms,
      results: JSON.parse(row.results) as SectionResult[], events: full ? JSON.parse(row.events) as SessionRecord['events'] : [], deviceId: row.device_id, revision: row.revision, receivedAt: row.received_at,
    };
    if (full) {
      record.workout = JSON.parse(row.workout_document) as Workout;
      record.corrections = this.corrections(row.id);
    }
    return record;
  }

  private corrections(id: string): SessionCorrection[] {
    const rows = this.db.prepare('SELECT corrected_at, previous_results, note FROM session_corrections WHERE session_id = ? ORDER BY id').all(id) as unknown as { corrected_at: string; previous_results: string; note: string | null }[];
    return rows.map((item): SessionCorrection => ({ correctedAt: item.corrected_at, previousResults: JSON.parse(item.previous_results) as SectionResult[], ...(item.note ? { note: item.note } : {}) }));
  }

  getWorkout(id: string): StoredWorkout | undefined {
    const row = this.db.prepare('SELECT * FROM workouts WHERE id = ?').get(id) as unknown as WorkoutRow | undefined;
    return row ? this.rowToWorkout(row) : undefined;
  }

  listWorkouts(includeArchived: boolean): StoredWorkout[] {
    const rows = this.db.prepare(`SELECT * FROM workouts ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY updated_at DESC, id`).all() as unknown as WorkoutRow[];
    return rows.map(row => this.rowToWorkout(row));
  }

  putWorkout(workout: StoredWorkout): void {
    this.db.prepare(`INSERT INTO workouts (id, revision, title, sharing_origin, document, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, title = excluded.title, sharing_origin = excluded.sharing_origin, document = excluded.document, created_at = excluded.created_at, updated_at = excluded.updated_at, archived_at = excluded.archived_at`)
      .run(workout.id, workout.revision, workout.document.title, workout.origin, JSON.stringify(workout.document), workout.createdAt, workout.updatedAt, workout.archivedAt ?? null);
  }

  getMaster(): MasterRow | undefined {
    const row = this.db.prepare('SELECT revision, document, updated_at FROM master_data WHERE id = 1').get() as unknown as { revision: number; document: string; updated_at: string } | undefined;
    return row ? { revision: row.revision, document: JSON.parse(row.document) as MasterData, updatedAt: row.updated_at } : undefined;
  }

  putMaster(row: MasterRow & { updatedAt: string }): void {
    this.db.prepare('INSERT INTO master_data (id, revision, document, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, document = excluded.document, updated_at = excluded.updated_at').run(row.revision, JSON.stringify(row.document), row.updatedAt);
  }

  hasSession(id: string): boolean { return Boolean(this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id)); }

  getSession(id: string): StoredSession | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as unknown as SessionRow | undefined;
    return row ? this.rowToSession(row) : undefined;
  }

  /** Writes the record and appends the corrections not yet stored; each correction row keeps the scores it set (the next one's previous, or the current). */
  putSession(session: StoredSession): void {
    this.db.prepare(`INSERT INTO sessions (id, workout_id, workout_revision, title, workout_document, started_at, finished_at, outcome, interrupted, modified, completion, active_ms, results, events, device_id, received_at, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET workout_id = excluded.workout_id, workout_revision = excluded.workout_revision, title = excluded.title, workout_document = excluded.workout_document, started_at = excluded.started_at,
        finished_at = excluded.finished_at, outcome = excluded.outcome, interrupted = excluded.interrupted, modified = excluded.modified, completion = excluded.completion, active_ms = excluded.active_ms,
        results = excluded.results, events = excluded.events, device_id = excluded.device_id, received_at = excluded.received_at, revision = excluded.revision`).run(
      session.id, session.workoutId, session.workoutRevision, session.title, JSON.stringify(session.workout), session.startedAt, session.finishedAt, session.outcome,
      session.interrupted ? 1 : 0, session.modified ? 1 : 0, session.completion, session.activeMs, JSON.stringify(session.results), JSON.stringify(session.events), session.deviceId, session.receivedAt, session.revision,
    );
    const stored = (this.db.prepare('SELECT COUNT(*) AS n FROM session_corrections WHERE session_id = ?').get(session.id) as { n: number }).n;
    const insert = this.db.prepare('INSERT INTO session_corrections (session_id, corrected_at, previous_results, results, note) VALUES (?, ?, ?, ?, ?)');
    session.corrections.forEach((correction, index) => {
      if (index < stored) return;
      const results = session.corrections[index + 1]?.previousResults ?? session.results;
      insert.run(session.id, correction.correctedAt, JSON.stringify(correction.previousResults), JSON.stringify(results), correction.note ?? null);
    });
  }

  listSessions({ limit, before, workoutId }: { limit: number; before?: string; workoutId?: string }): SessionListItem[] {
    const where = [before ? 'finished_at < ?' : '', workoutId ? 'workout_id = ?' : ''].filter(Boolean);
    const params = [before, workoutId].filter((value): value is string => Boolean(value));
    const rows = this.db.prepare(`SELECT * FROM sessions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY finished_at DESC, id LIMIT ?`).all(...params, limit) as unknown as SessionRow[];
    return rows.map(row => { const { events: _events, workout: _workout, ...item } = this.rowToSession(row, false); return item; });
  }

  allSessions(): StoredSession[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY finished_at DESC, id').all() as unknown as SessionRow[];
    return rows.map(row => this.rowToSession(row));
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM session_corrections WHERE session_id = ?').run(id);
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  isDeletedSession(id: string): boolean { return Boolean(this.db.prepare('SELECT 1 FROM deleted_sessions WHERE id = ?').get(id)); }

  putDeletedSession(row: { id: string; deletedAt: string }): void { this.db.prepare('INSERT INTO deleted_sessions (id, deleted_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING').run(row.id, row.deletedAt); }

  /** Everything but the tombstones in deleted_sessions, which outlive a restore (DAT-14). */
  clear(): void { this.db.exec('DELETE FROM session_corrections; DELETE FROM sessions; DELETE FROM master_data; DELETE FROM workouts;'); }
}

/**
 * The household datastore on SQLite: the semantics live in packages/household (Household), this class owns the
 * database file, its migrations and backups, and runs every operation in one transaction.
 */
export class Store {
  private depth = 0;
  private readonly core: Household;
  private constructor(readonly db: DatabaseSync, readonly path: string, private readonly now: () => Date, private readonly backupOption?: string) { this.core = new Household(new SqliteTables(db), now); }

  static async open(path: string, { appVersion = '0.0.0', backupDir, now = () => new Date() }: { appVersion?: string; backupDir?: string; now?: () => Date } = {}): Promise<{ store: Store; migration: { from: number; to: number; backup?: string } }> {
    const db = openDatabase(path);
    try {
      const migration = await migrate(db, { path, appVersion, backupDir, now });
      return { store: new Store(db, path, now, backupDir), migration };
    } catch (error) { db.close(); throw error; }
  }

  close() { this.db.close(); }
  get schemaVersion(): number { return schemaVersion(this.db); }
  /** Where pre-migration and pre-restore copies go: the `backupDir` option, else `backups/` beside the database file; empty in memory. */
  get backupDir(): string { return isMemory(this.path) ? '' : this.backupOption ?? join(dirname(this.path), 'backups'); }

  /** One transaction around a write; nested calls join the outer one, so an import is all or nothing. */
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) { this.depth++; try { return fn(); } finally { this.depth--; } }
    this.db.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } finally { this.depth = 0; }
  }

  listWorkouts(includeArchived = false): StoredWorkout[] { return this.transaction(() => this.core.listWorkouts(includeArchived)); }
  getWorkout(id: string): StoredWorkout | undefined { return this.transaction(() => this.core.getWorkout(id)); }
  /** All ids a new workout must avoid: stored (even archived) and bundled ones. */
  takenIds(): Set<string> { return this.transaction(() => this.core.takenIds()); }
  putWorkout(document: Workout, expectedRevision: number | undefined, origin: 'local' | 'imported' = 'local'): { created: boolean; revision: number; updatedAt: string } { return this.transaction(() => this.core.putWorkout(document, expectedRevision, origin)); }
  archiveWorkout(id: string, expectedRevision?: number): void { this.transaction(() => this.core.archiveWorkout(id, expectedRevision)); }

  getMasterData(): { revision: number; document: MasterData; updatedAt?: string } { return this.transaction(() => this.core.getMasterData()); }
  putMasterData(document: MasterData, expectedRevision: number | undefined): { revision: number; updatedAt: string } { return this.transaction(() => this.core.putMasterData(document, expectedRevision)); }

  /**
   * The household's settings (theme, sounds, names, units, equipment, difficulty): one document every device follows.
   * The last write wins, so there is no expected revision. A missing row reads as revision 0 with no document.
   */
  getSettings(): { revision: number; document?: Record<string, unknown>; updatedAt?: string } {
    const row = this.db.prepare('SELECT revision, document, updated_at FROM settings WHERE id = 1').get() as unknown as { revision: number; document: string; updated_at: string } | undefined;
    return row ? { revision: row.revision, document: JSON.parse(row.document) as Record<string, unknown>, updatedAt: row.updated_at } : { revision: 0 };
  }
  putSettings(document: Record<string, unknown>): { revision: number; updatedAt: string } {
    return this.transaction(() => {
      const revision = this.getSettings().revision + 1;
      const updatedAt = this.now().toISOString();
      this.db.prepare('INSERT INTO settings (id, revision, document, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, document = excluded.document, updated_at = excluded.updated_at').run(revision, JSON.stringify(document), updatedAt);
      return { revision, updatedAt };
    });
  }

  putSession(record: SessionRecord & { workout: Workout }): 'created' | 'existing' { return this.transaction(() => this.core.putSession(record)); }
  listSessions(query: { limit?: number; before?: string; workoutId?: string } = {}): SessionListItem[] { return this.transaction(() => this.core.listSessions(query)); }
  getSession(id: string): StoredSession | undefined { return this.transaction(() => this.core.getSession(id)); }
  correctSession(id: string, results: SectionResult[], note: string | undefined, expectedRevision: number | undefined): { revision: number } { return this.transaction(() => this.core.correctSession(id, results, note, expectedRevision)); }
  /** Deletes a session with its corrections and keeps a tombstone of the id (DAT-14). */
  deleteSession(id: string): 'deleted' | 'absent' { return this.transaction(() => this.core.deleteSession(id)); }

  importDevice(payload: DeviceImport): DeviceImportReport { return this.transaction(() => this.core.importDevice(payload)); }
  importPack(payload: PackImport): PackImportReport { return this.transaction(() => this.core.importPack(payload)); }

  /** The JSON export: one consistent read of everything. */
  exportAll(): ExportDocument { return this.transaction(() => this.core.exportAll(this.schemaVersion)); }

  /**
   * Replaces the household with a backup (DAT-11). The value is validated first; a file-backed database is then
   * copied to `pre-restore-<timestamp>.sqlite` under the backup directory before one transaction replaces everything.
   */
  async restore(value: unknown): Promise<RestoreReport & { backup?: string }> {
    const document = parseExportDocument(value, EXPORT_VERSION);
    let backup: string | undefined;
    if (!isMemory(this.path)) {
      backup = join(this.backupDir, `pre-restore-${this.now().toISOString().replace(/[:.]/g, '-')}.sqlite`);
      await this.backupTo(backup);
    }
    const report = this.transaction(() => this.core.restore(document));
    return { ...report, ...(backup ? { backup } : {}) };
  }

  backupTo(path: string): Promise<void> { return backupTo(this.db, path); }
}
