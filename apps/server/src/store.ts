import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { bundledWorkouts } from '../../../packages/domain/src/bundled';
import { compileWorkout } from '../../../packages/domain/src/compiler';
import { freeWorkoutId, slugify } from '../../../packages/domain/src/library';
import { emptyMasterData, isEmptyMasterData, mergeMasterData, sanitiseMasterData, type Collection, type MasterData } from '../../../packages/domain/src/master-data';
import type { PackCollection } from '../../../packages/domain/src/pack';
import type { Workout } from '../../../packages/domain/src/schema';
import { parseWorkout } from '../../../packages/domain/src/validate';
import type { SectionResult } from '../../../packages/engine/src';
import type { SessionCorrection, SessionRecord } from '../../../packages/engine/src/records';
import { backupTo, isMemory, migrate, openDatabase, schemaVersion } from './db';
import { ApiError, ConflictError, NotFoundError } from './errors';

export interface StoredWorkout { id: string; revision: number; origin: 'local' | 'imported'; createdAt: string; updatedAt: string; archivedAt?: string; document: Workout }
export interface SessionListItem extends Omit<SessionRecord, 'events' | 'workout'> { receivedAt: string }
export interface DeviceImport { deviceId: string; workouts: Workout[]; masterData: MasterData; sessions: SessionRecord[] }
export interface DeviceImportReport { workouts: { created: number; skipped: number; renamed: { from: string; to: string }[] }; sessions: { created: number; skipped: number; orphaned: number }; masterData: 'created' | 'merged' | 'unchanged' }
export type PackDecision = { action: 'copy' } | { action: 'skip' } | { action: 'replace'; id: string; expectedRevision: number };
export interface PackImport { workouts: Workout[]; collections: PackCollection[]; decisions: Record<string, PackDecision> }
export interface PackImportReport { created: { from: string; to: string }[]; replaced: string[]; skipped: number; collections: number; masterRevision: number }

const canonical = (workout: Workout) => JSON.stringify(sortKeys(workout));
const sortKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(sortKeys) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortKeys(child)])) : value;
const bundledIds = new Set(bundledWorkouts.map(workout => workout.id));

interface WorkoutRow { id: string; revision: number; sharing_origin: 'local' | 'imported'; document: string; created_at: string; updated_at: string; archived_at: string | null }
interface SessionRow { id: string; workout_id: string; workout_revision: number; title: string; workout_document: string; started_at: string; finished_at: string; outcome: SessionRecord['outcome']; interrupted: number; modified: number; completion: number; active_ms: number; results: string; events: string; device_id: string; received_at: string; revision: number }

/**
 * The household datastore (DAT-01): workouts and master data as revisioned JSON documents, sessions as immutable
 * records with their workout snapshot, score corrections kept beside the record (DAT-05). Every multi-row write is
 * one transaction.
 */
export class Store {
  private depth = 0;
  private constructor(readonly db: DatabaseSync, readonly path: string, private readonly now: () => Date) {}

  static async open(path: string, { appVersion = '0.0.0', backupDir, now = () => new Date() }: { appVersion?: string; backupDir?: string; now?: () => Date } = {}): Promise<{ store: Store; migration: { from: number; to: number; backup?: string } }> {
    const db = openDatabase(path);
    try {
      const migration = await migrate(db, { path, appVersion, backupDir, now });
      return { store: new Store(db, path, now), migration };
    } catch (error) { db.close(); throw error; }
  }

  close() { this.db.close(); }
  get schemaVersion(): number { return schemaVersion(this.db); }
  get backupDir(): string { return isMemory(this.path) ? '' : join(dirname(this.path), 'backups'); }

  /** One transaction around a write; nested calls join the outer one, so an import is all or nothing. */
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) { this.depth++; try { return fn(); } finally { this.depth--; } }
    this.db.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } finally { this.depth = 0; }
  }

  // ---- Workouts --------------------------------------------------------------------------------------------

  private rowToWorkout(row: WorkoutRow): StoredWorkout {
    return { id: row.id, revision: row.revision, origin: row.sharing_origin, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.archived_at ? { archivedAt: row.archived_at } : {}), document: JSON.parse(row.document) as Workout };
  }

  listWorkouts(includeArchived = false): StoredWorkout[] {
    const rows = this.db.prepare(`SELECT * FROM workouts ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY updated_at DESC, id`).all() as unknown as WorkoutRow[];
    return rows.map(row => this.rowToWorkout(row));
  }

  getWorkout(id: string): StoredWorkout | undefined {
    const row = this.db.prepare('SELECT * FROM workouts WHERE id = ?').get(id) as unknown as WorkoutRow | undefined;
    return row ? this.rowToWorkout(row) : undefined;
  }

  /** All ids a new workout must avoid: stored (even archived) and bundled ones. */
  takenIds(): Set<string> {
    const rows = this.db.prepare('SELECT id FROM workouts').all() as unknown as { id: string }[];
    return new Set([...bundledIds, ...rows.map(row => row.id)]);
  }

  /**
   * Creates (expected revision 0 or absent, document revision ≥ 1) or updates (expected = stored revision, document
   * revision = stored + 1). An archived workout written again comes back. The sharing origin flips to local when the
   * document carries a new sharing identity (a derivative).
   */
  putWorkout(document: Workout, expectedRevision: number | undefined, origin: 'local' | 'imported' = 'local'): { created: boolean; revision: number; updatedAt: string } {
    const stamp = this.now().toISOString();
    return this.transaction(() => {
      const existing = this.getWorkout(document.id);
      if (!existing) {
        if (expectedRevision !== undefined && expectedRevision !== 0) throw new ConflictError(expectedRevision, { revision: 0 });
        this.db.prepare('INSERT INTO workouts (id, revision, title, sharing_origin, document, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)').run(document.id, document.revision, document.title, origin, JSON.stringify(document), stamp, stamp);
        return { created: true, revision: document.revision, updatedAt: stamp };
      }
      if (expectedRevision === undefined || expectedRevision !== existing.revision) throw new ConflictError(expectedRevision, { revision: existing.revision, document: existing.document });
      if (document.revision !== existing.revision + 1) throw new ApiError(400, 'REVISION_MISMATCH', `The document revision must be ${existing.revision + 1} to replace revision ${existing.revision}.`, '/document/revision');
      const nextOrigin = existing.origin === 'imported' && document.sharing?.id !== existing.document.sharing?.id ? 'local' : existing.origin;
      this.db.prepare('UPDATE workouts SET revision = ?, title = ?, sharing_origin = ?, document = ?, updated_at = ?, archived_at = NULL WHERE id = ?').run(document.revision, document.title, nextOrigin, JSON.stringify(document), stamp, document.id);
      return { created: false, revision: document.revision, updatedAt: stamp };
    });
  }

  archiveWorkout(id: string, expectedRevision?: number): void {
    this.transaction(() => {
      const existing = this.getWorkout(id);
      if (!existing) throw new NotFoundError(`Workout "${id}"`);
      if (expectedRevision !== undefined && expectedRevision !== existing.revision) throw new ConflictError(expectedRevision, { revision: existing.revision, document: existing.document });
      this.db.prepare('UPDATE workouts SET archived_at = ? WHERE id = ?').run(this.now().toISOString(), id);
    });
  }

  // ---- Master data -----------------------------------------------------------------------------------------

  getMasterData(): { revision: number; document: MasterData; updatedAt?: string } {
    const row = this.db.prepare('SELECT revision, document, updated_at FROM master_data WHERE id = 1').get() as unknown as { revision: number; document: string; updated_at: string } | undefined;
    return row ? { revision: row.revision, document: sanitiseMasterData(JSON.parse(row.document)), updatedAt: row.updated_at } : { revision: 0, document: emptyMasterData() };
  }

  putMasterData(document: MasterData, expectedRevision: number | undefined): { revision: number; updatedAt: string } {
    const stamp = this.now().toISOString();
    return this.transaction(() => {
      const current = this.getMasterData();
      if ((expectedRevision ?? 0) !== current.revision) throw new ConflictError(expectedRevision, { revision: current.revision, document: current.document });
      const revision = current.revision + 1;
      this.db.prepare('INSERT INTO master_data (id, revision, document, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, document = excluded.document, updated_at = excluded.updated_at').run(revision, JSON.stringify(sanitiseMasterData(document)), stamp);
      return { revision, updatedAt: stamp };
    });
  }

  // ---- Sessions --------------------------------------------------------------------------------------------

  private rowToSession(row: SessionRow, full: boolean): SessionRecord & { receivedAt: string } {
    const record: SessionRecord & { receivedAt: string } = {
      id: row.id, workoutId: row.workout_id, workoutRevision: row.workout_revision, title: row.title, startedAt: row.started_at, finishedAt: row.finished_at,
      outcome: row.outcome, interrupted: row.interrupted === 1, modified: row.modified === 1, completion: row.completion, activeMs: row.active_ms,
      results: JSON.parse(row.results) as SectionResult[], events: full ? JSON.parse(row.events) as SessionRecord['events'] : [], deviceId: row.device_id, revision: row.revision, receivedAt: row.received_at,
    };
    if (full) {
      record.workout = JSON.parse(row.workout_document) as Workout;
      const corrections = this.db.prepare('SELECT corrected_at, previous_results, note FROM session_corrections WHERE session_id = ? ORDER BY id').all(row.id) as unknown as { corrected_at: string; previous_results: string; note: string | null }[];
      record.corrections = corrections.map((item): SessionCorrection => ({ correctedAt: item.corrected_at, previousResults: JSON.parse(item.previous_results) as SectionResult[], ...(item.note ? { note: item.note } : {}) }));
    }
    return record;
  }

  /** Idempotent by id (DAT-03): a repeated upload of the same session is acknowledged, never duplicated. */
  putSession(record: SessionRecord & { workout: Workout }): 'created' | 'existing' {
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(record.id)) return 'existing';
      this.db.prepare(`INSERT INTO sessions (id, workout_id, workout_revision, title, workout_document, started_at, finished_at, outcome, interrupted, modified, completion, active_ms, results, events, device_id, received_at, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
        record.id, record.workoutId, record.workoutRevision, record.title, JSON.stringify(record.workout), record.startedAt, record.finishedAt, record.outcome,
        record.interrupted ? 1 : 0, record.modified ? 1 : 0, record.completion, record.activeMs, JSON.stringify(record.results), JSON.stringify(record.events), record.deviceId, this.now().toISOString(),
      );
      return 'created';
    });
  }

  listSessions({ limit = 50, before, workoutId }: { limit?: number; before?: string; workoutId?: string } = {}): SessionListItem[] {
    const size = Math.max(1, Math.min(200, Math.floor(limit)));
    const where = [before ? 'finished_at < ?' : '', workoutId ? 'workout_id = ?' : ''].filter(Boolean);
    const params = [before, workoutId].filter((value): value is string => Boolean(value));
    const rows = this.db.prepare(`SELECT * FROM sessions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY finished_at DESC, id LIMIT ?`).all(...params, size) as unknown as SessionRow[];
    return rows.map(row => { const { events: _events, workout: _workout, ...item } = this.rowToSession(row, false); return item; });
  }

  getSession(id: string): (SessionRecord & { receivedAt: string }) | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as unknown as SessionRow | undefined;
    return row ? this.rowToSession(row, true) : undefined;
  }

  /** Replaces the scores, keeping the previous value and the time of the correction (DAT-05). */
  correctSession(id: string, results: SectionResult[], note: string | undefined, expectedRevision: number | undefined): { revision: number } {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT revision, results FROM sessions WHERE id = ?').get(id) as unknown as { revision: number; results: string } | undefined;
      if (!row) throw new NotFoundError(`Session "${id}"`);
      if (expectedRevision !== row.revision) throw new ConflictError(expectedRevision, { revision: row.revision });
      this.db.prepare('INSERT INTO session_corrections (session_id, corrected_at, previous_results, results, note) VALUES (?, ?, ?, ?, ?)').run(id, this.now().toISOString(), row.results, JSON.stringify(results), note ?? null);
      this.db.prepare('UPDATE sessions SET results = ?, revision = revision + 1 WHERE id = ?').run(JSON.stringify(results), id);
      return { revision: row.revision + 1 };
    });
  }

  // ---- Imports ---------------------------------------------------------------------------------------------

  /** Moves a device's pre-1.0 library in one transaction; safe to repeat (ids and identical content are skipped). */
  importDevice(payload: DeviceImport): DeviceImportReport {
    return this.transaction(() => {
      const report: DeviceImportReport = { workouts: { created: 0, skipped: 0, renamed: [] }, sessions: { created: 0, skipped: 0, orphaned: 0 }, masterData: 'unchanged' };
      const remap = new Map<string, string>();
      const taken = this.takenIds();
      const moved = new Map<string, Workout>();
      for (const workout of payload.workouts) {
        const existing = this.getWorkout(workout.id);
        if (existing && canonical(existing.document) === canonical(workout)) { report.workouts.skipped++; moved.set(workout.id, existing.document); continue; }
        let id = workout.id;
        if (existing || bundledIds.has(id)) { id = freeWorkoutId(workout.id, taken); if (!remap.has(workout.id)) remap.set(workout.id, id); report.workouts.renamed.push({ from: workout.id, to: id }); }
        const document: Workout = { ...workout, id, revision: Math.max(1, workout.revision) };
        this.putWorkout(document, 0, 'local');
        taken.add(id);
        moved.set(workout.id, document);
        report.workouts.created++;
      }
      for (const session of payload.sessions) {
        const workoutId = remap.get(session.workoutId) ?? session.workoutId;
        const document = moved.get(session.workoutId) ?? session.workout ?? this.getWorkout(workoutId)?.document ?? bundledWorkouts.find(item => item.id === workoutId);
        if (!document) { report.sessions.orphaned++; continue; }
        const stored = this.putSession({ ...session, workoutId, workout: document, deviceId: session.deviceId || payload.deviceId });
        if (stored === 'created') report.sessions.created++; else report.sessions.skipped++;
      }
      const incoming = sanitiseMasterData({ ...payload.masterData, collections: payload.masterData.collections.map(collection => ({ ...collection, workoutIds: collection.workoutIds.map(id => remap.get(id) ?? id) })) });
      if (!isEmptyMasterData(incoming)) {
        const current = this.getMasterData();
        const merged = current.revision === 0 ? incoming : mergeMasterData(current.document, incoming);
        if (JSON.stringify(merged) !== JSON.stringify(current.document)) { this.putMasterData(merged, current.revision); report.masterData = current.revision === 0 ? 'created' : 'merged'; }
      }
      return report;
    });
  }

  /** Applies a pack import with the user's per-workout decisions in one transaction (SHR-04). */
  importPack(payload: PackImport): PackImportReport {
    return this.transaction(() => {
      const report: PackImportReport = { created: [], replaced: [], skipped: 0, collections: 0, masterRevision: this.getMasterData().revision };
      const taken = this.takenIds();
      const remap = new Map<string, string>();
      for (const workout of payload.workouts) {
        const decision = payload.decisions[workout.id] ?? { action: 'copy' };
        if (decision.action === 'skip') { report.skipped++; continue; }
        const clean = parseWorkout(workout);
        compileWorkout(clean);
        if (decision.action === 'replace') {
          const target = this.getWorkout(decision.id);
          if (!target) throw new NotFoundError(`Workout "${decision.id}"`);
          this.putWorkout({ ...clean, id: decision.id, revision: decision.expectedRevision + 1 }, decision.expectedRevision, 'imported');
          remap.set(workout.id, decision.id);
          report.replaced.push(decision.id);
          continue;
        }
        const id = freeWorkoutId(workout.id, taken);
        this.putWorkout({ ...clean, id, revision: 1 }, 0, 'imported');
        taken.add(id);
        remap.set(workout.id, id);
        report.created.push({ from: workout.id, to: id });
      }
      if (payload.collections.length) {
        const current = this.getMasterData();
        const collectionIds = new Set(current.document.collections.map(collection => collection.id));
        const collections: Collection[] = [...current.document.collections];
        let changed = false;
        for (const collection of payload.collections) {
          const workoutIds = collection.workoutIds.map(id => remap.get(id)).filter((id): id is string => Boolean(id));
          if (!workoutIds.length) continue;
          // A collection of the same title already here (an earlier import of the pack) takes the new copies instead of a duplicate.
          const existing = collections.find(item => item.title.trim().toLowerCase() === collection.title.trim().toLowerCase());
          if (existing) { existing.workoutIds = [...new Set([...existing.workoutIds, ...workoutIds])]; changed = true; continue; }
          const id = freeWorkoutId(slugify(collection.title), collectionIds);
          collectionIds.add(id);
          collections.push({ id, title: collection.title, ...(collection.description ? { description: collection.description } : {}), workoutIds });
          report.collections++;
          changed = true;
        }
        if (changed) report.masterRevision = this.putMasterData({ ...current.document, collections: collections.map(item => ({ ...item })) }, current.revision).revision;
      }
      return report;
    });
  }

  // ---- Export and backup -----------------------------------------------------------------------------------

  exportAll(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY finished_at DESC').all() as unknown as SessionRow[];
    return {
      format: 'openwod.export', formatVersion: 1, exportedAt: this.now().toISOString(), schemaVersion: this.schemaVersion,
      workouts: this.listWorkouts(true), masterData: this.getMasterData(), sessions: rows.map(row => this.rowToSession(row, true)),
    };
  }

  backupTo(path: string): Promise<void> { return backupTo(this.db, path); }
}
