import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { MasterData } from '../../../packages/domain/src/master-data';
import type { Workout } from '../../../packages/domain/src/schema';
import type { SectionResult, Status } from '../../../packages/engine/src';
import type { SessionCorrection, SessionRecord } from '../../../packages/engine/src/records';
import { Household, type HouseholdTables } from '../../../packages/household/src/core';
import { EXPORT_VERSION, parseExportDocument } from '../../../packages/household/src/export';
import type { DeviceImport, DeviceImportReport, ExportDocument, LiveCheckpoint, LiveProgress, LiveSession, LiveSessionAck, LiveSessionClaim, LiveSessionItem, LiveSessionList, LiveSessionPut, MasterRow, PackImport, PackImportReport, RestoreReport, SessionListItem, StoredSession, StoredWorkout } from '../../../packages/household/src/types';
import { backupTo, isMemory, migrate, openDatabase, schemaVersion } from './db';
import { ApiError, NotFoundError } from './errors';

export type { DeviceImport, DeviceImportReport, LiveSession, LiveSessionAck, LiveSessionClaim, LiveSessionItem, LiveSessionList, LiveSessionPut, PackDecision, PackImport, PackImportReport, RestoreReport, SessionListItem, StoredWorkout } from '../../../packages/household/src/types';

interface WorkoutRow { id: string; revision: number; sharing_origin: 'local' | 'imported'; document: string; created_at: string; updated_at: string; archived_at: string | null }
interface SessionRow { id: string; workout_id: string; workout_revision: number; title: string; workout_document: string; started_at: string; finished_at: string; outcome: SessionRecord['outcome']; interrupted: number; modified: number; completion: number; active_ms: number; results: string; events: string; device_id: string; received_at: string; revision: number }
/** A live session without its checkpoint, which is only read when a device asks for the bodies. */
interface LiveRow { id: string; workout_id: string; title: string; status: Status; active_ms: number; device_id: string; device_label: string; generation: number; revision: number; progress: string | null; saved_at: string; updated_at: string }
const LIVE_COLUMNS = 'id, workout_id, title, status, active_ms, device_id, device_label, generation, revision, progress, saved_at, updated_at';
/** A live session nobody has written to for this long is forgotten (ENG-15): its device is gone or the session was abandoned. */
export const LIVE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Whole milliseconds for the list; the snapshot is the player's own and is never trusted to hold a number. */
const wholeMs = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

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

  /**
   * Stores a finished session and ends its live row (ENG-15). An aborted record from a device that no longer controls
   * the live row is acknowledged but not stored: a device that was taken over and then ends its stale copy must not put
   * that where the continuing device's result will go (the id is stored once, DAT-03). A completed or capped record is
   * a workout somebody did finish, typically offline before another device took a stale copy over, and is kept.
   */
  putSession(record: SessionRecord & { workout: Workout }): 'created' | 'existing' {
    return this.transaction(() => {
      const live = this.liveRow(record.id);
      if (live && live.device_id !== record.deviceId && record.outcome === 'aborted') return 'existing';
      const stored = this.core.putSession(record);
      if (live) this.dropLive(record.id);
      return stored;
    });
  }
  listSessions(query: { limit?: number; before?: string; workoutId?: string } = {}): SessionListItem[] { return this.transaction(() => this.core.listSessions(query)); }
  getSession(id: string): StoredSession | undefined { return this.transaction(() => this.core.getSession(id)); }
  correctSession(id: string, results: SectionResult[], note: string | undefined, expectedRevision: number | undefined): { revision: number } { return this.transaction(() => this.core.correctSession(id, results, note, expectedRevision)); }
  /** Deletes a session with its corrections and keeps a tombstone of the id (DAT-14); a live row of that id goes with it. */
  deleteSession(id: string): 'deleted' | 'absent' { return this.transaction(() => { const result = this.core.deleteSession(id); this.dropLive(id); return result; }); }

  // ---- Live sessions (ENG-15) ------------------------------------------------------------------------------
  // Hand-over between devices, server shape only: like the settings these rows are plain SQL here and not part of the
  // household core, an export or a restore. One device controls a session; only it may write, any device may claim.

  private liveItem(row: LiveRow): LiveSessionItem {
    return { id: row.id, workoutId: row.workout_id, title: row.title, status: row.status, activeMs: row.active_ms, deviceId: row.device_id, deviceLabel: row.device_label, generation: row.generation, revision: row.revision, savedAt: row.saved_at, updatedAt: row.updated_at };
  }
  /** Forgets the rows no device has written to for 12 hours. Every live-session read runs it first, so no timer is needed. */
  private pruneLive(): void { this.db.prepare('DELETE FROM live_sessions WHERE updated_at < ?').run(new Date(this.now().getTime() - LIVE_SESSION_TTL_MS).toISOString()); }
  private liveRow(id: string): LiveRow | undefined {
    this.pruneLive();
    return this.db.prepare(`SELECT ${LIVE_COLUMNS} FROM live_sessions WHERE id = ?`).get(id) as unknown as LiveRow | undefined;
  }
  private dropLive(id: string): void { this.db.prepare('DELETE FROM live_sessions WHERE id = ?').run(id); }
  /** A session that was uploaded or deleted is over for good: no checkpoint of it is taken any more. */
  private refuseFinished(id: string): void {
    if (this.db.prepare('SELECT 1 FROM sessions WHERE id = ? UNION ALL SELECT 1 FROM deleted_sessions WHERE id = ?').get(id, id)) throw new ApiError(409, 'SESSION_FINISHED', 'This session is already finished.');
  }

  /** Every live session without its bodies, the one written to last first, with the server's clock to tell their age by. */
  listLiveSessions(): LiveSessionList {
    return this.transaction(() => {
      this.pruneLive();
      const rows = this.db.prepare(`SELECT ${LIVE_COLUMNS} FROM live_sessions ORDER BY updated_at DESC, id`).all() as unknown as LiveRow[];
      return { now: this.now().toISOString(), sessions: rows.map(row => this.liveItem(row)) };
    });
  }

  /** One live session with its checkpoint and, when one extends that checkpoint, its progress record. */
  getLiveSession(id: string): LiveSession | undefined {
    return this.transaction(() => {
      const row = this.liveRow(id);
      if (!row) return undefined;
      const { checkpoint } = this.db.prepare('SELECT checkpoint FROM live_sessions WHERE id = ?').get(id) as { checkpoint: string };
      return { ...this.liveItem(row), checkpoint: JSON.parse(checkpoint) as LiveCheckpoint, ...(row.progress ? { progress: JSON.parse(row.progress) as LiveProgress } : {}) };
    });
  }

  /**
   * Takes what the controlling device sends. The first checkpoint creates the row with its sender as the controller;
   * afterwards any other device gets SESSION_TAKEN_OVER with the controller's name, and a finished or deleted id gets
   * SESSION_FINISHED. A checkpoint saved before the stored one is ignored (requests may arrive out of order), unless
   * it carries a higher revision: after a hand-over the new controller's clock may be behind the old one's. A
   * progress record is kept only while it names the stored checkpoint revision, so the two are never combined wrongly.
   */
  putLiveSession(id: string, { deviceId, deviceLabel, checkpoint, progress }: LiveSessionPut): LiveSessionAck & { created: boolean } {
    return this.transaction(() => {
      this.refuseFinished(id);
      const stamp = this.now().toISOString();
      const row = this.liveRow(id);
      if (!row) {
        if (!checkpoint) throw new NotFoundError(`Live session "${id}"`);
        const kept = progress?.checkpointRevision === checkpoint.revision ? progress : undefined;
        this.db.prepare('INSERT INTO live_sessions (id, workout_id, title, status, active_ms, device_id, device_label, generation, revision, checkpoint, progress, saved_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)').run(
          id, checkpoint.workoutId, checkpoint.workout.title, checkpoint.status, Math.max(wholeMs(checkpoint.snapshot.activeMs), wholeMs(kept?.activeMs)), deviceId, deviceLabel, checkpoint.revision, JSON.stringify(checkpoint), kept ? JSON.stringify(kept) : null, checkpoint.savedAt, stamp,
        );
        return { id, generation: 1, revision: checkpoint.revision, savedAt: checkpoint.savedAt, created: true };
      }
      if (row.device_id !== deviceId) throw new ApiError(409, 'SESSION_TAKEN_OVER', `This session continues on ${row.device_label}.`, undefined, { controller: { deviceId: row.device_id, deviceLabel: row.device_label, generation: row.generation } });
      const fresh = checkpoint && !(checkpoint.savedAt < row.saved_at && checkpoint.revision <= row.revision) ? checkpoint : undefined;
      const revision = fresh?.revision ?? row.revision;
      const naming = (record?: LiveProgress) => record?.checkpointRevision === revision ? record : undefined;
      // The stored record extended the checkpoint it came with: a new checkpoint starts over, even at the same revision.
      const held = fresh || !row.progress ? undefined : naming(JSON.parse(row.progress) as LiveProgress);
      const sent = naming(progress);
      const kept = sent && held && sent.savedAt < held.savedAt ? held : sent ?? held;
      if (fresh) this.db.prepare('UPDATE live_sessions SET workout_id = ?, title = ?, status = ?, revision = ?, checkpoint = ?, saved_at = ? WHERE id = ?').run(fresh.workoutId, fresh.workout.title, fresh.status, fresh.revision, JSON.stringify(fresh), fresh.savedAt, id);
      this.db.prepare('UPDATE live_sessions SET active_ms = ?, device_label = ?, progress = ?, updated_at = ? WHERE id = ?').run(Math.max(fresh ? wholeMs(fresh.snapshot.activeMs) : row.active_ms, wholeMs(kept?.activeMs)), deviceLabel, kept ? JSON.stringify(kept) : null, stamp, id);
      return { id, generation: row.generation, revision, savedAt: fresh?.savedAt ?? row.saved_at, created: false };
    });
  }

  /**
   * Hands the session to the calling device: it becomes the controller, the generation goes up by one, and the stored
   * checkpoint and progress come back for it to continue from. The previous controller learns of it from its next
   * write. A device claiming what it already controls (a repeated request) changes nothing.
   */
  claimLiveSession(id: string, { deviceId, deviceLabel }: LiveSessionClaim): LiveSession {
    return this.transaction(() => {
      this.refuseFinished(id);
      const row = this.liveRow(id);
      if (!row) throw new NotFoundError(`Live session "${id}"`);
      this.db.prepare('UPDATE live_sessions SET device_id = ?, device_label = ?, generation = ?, updated_at = ? WHERE id = ?').run(deviceId, deviceLabel, row.device_id === deviceId ? row.generation : row.generation + 1, this.now().toISOString(), id);
      return this.getLiveSession(id)!;
    });
  }

  /**
   * Discards a live session. Idempotent; a session that still runs somewhere appears again with its next checkpoint.
   * Any device may discard. With `deviceId` the row goes only while that device controls it: a device ending its own
   * session without a record to upload must not remove the row of the device that has since taken it over.
   */
  deleteLiveSession(id: string, deviceId?: string): void {
    this.transaction(() => { if (deviceId === undefined) this.dropLive(id); else this.db.prepare('DELETE FROM live_sessions WHERE id = ? AND device_id = ?').run(id, deviceId); });
  }

  importDevice(payload: DeviceImport): DeviceImportReport { return this.transaction(() => this.core.importDevice(payload)); }
  importPack(payload: PackImport): PackImportReport { return this.transaction(() => this.core.importPack(payload)); }

  /** The JSON export: one consistent read of everything. */
  exportAll(): ExportDocument { return this.transaction(() => this.core.exportAll(this.schemaVersion)); }

  /**
   * Replaces the household with a backup (DAT-11). The value is validated first; a file-backed database is then
   * copied to `pre-restore-<timestamp>.sqlite` under the backup directory before one transaction replaces everything.
   * The live sessions go too (ENG-15): they belong to the household that was replaced.
   */
  async restore(value: unknown): Promise<RestoreReport & { backup?: string }> {
    const document = parseExportDocument(value, EXPORT_VERSION);
    let backup: string | undefined;
    if (!isMemory(this.path)) {
      backup = join(this.backupDir, `pre-restore-${this.now().toISOString().replace(/[:.]/g, '-')}.sqlite`);
      await this.backupTo(backup);
    }
    const report = this.transaction(() => { const restored = this.core.restore(document); this.db.exec('DELETE FROM live_sessions'); return restored; });
    return { ...report, ...(backup ? { backup } : {}) };
  }

  backupTo(path: string): Promise<void> { return backupTo(this.db, path); }
}
