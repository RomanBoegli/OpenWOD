import { bundledWorkouts } from '../../domain/src/bundled';
import { compileWorkout } from '../../domain/src/compiler';
import { freeWorkoutId, slugify } from '../../domain/src/library';
import { emptyMasterData, isEmptyMasterData, mergeMasterData, sanitiseMasterData, type Collection, type MasterData } from '../../domain/src/master-data';
import type { Workout } from '../../domain/src/schema';
import { parseWorkout } from '../../domain/src/validate';
import type { SectionResult } from '../../engine/src';
import type { SessionRecord } from '../../engine/src/records';
import { ConflictError, HouseholdError, NotFoundError } from './errors';
import { EXPORT_FORMAT, EXPORT_VERSION, summariseExport } from './export';
import type { DeviceImport, DeviceImportReport, ExportDocument, MasterRow, PackImport, PackImportReport, RestoreReport, SessionListItem, StoredSession, StoredWorkout } from './types';

/**
 * The storage a household lives in, reduced to the rows the semantics need. Every call is synchronous, so a backend
 * runs one whole operation between opening and committing its transaction (an import or a restore is all or
 * nothing). Rows go in and come out as values: a backend never hands back an object it keeps.
 */
export interface HouseholdTables {
  getWorkout(id: string): StoredWorkout | undefined;
  /** Every stored workout, archived ones included when asked, in any order. */
  listWorkouts(includeArchived: boolean): StoredWorkout[];
  /** Inserts or replaces the row of `workout.id`. */
  putWorkout(workout: StoredWorkout): void;
  getMaster(): MasterRow | undefined;
  putMaster(row: MasterRow & { updatedAt: string }): void;
  hasSession(id: string): boolean;
  getSession(id: string): StoredSession | undefined;
  /** Inserts or replaces the session; corrections only ever grow, so a backend may append the new ones. */
  putSession(session: StoredSession): void;
  /** Newest first by `finishedAt` (then id), at most `limit`, without the events, snapshot and corrections. */
  listSessions(query: { limit: number; before?: string; workoutId?: string }): SessionListItem[];
  /** Every session in full, newest first. */
  allSessions(): StoredSession[];
  /** Removes the session and its score corrections; nothing happens when it is not stored. */
  deleteSession(id: string): void;
  /** True when the session id was deleted once (a tombstone), so an upload of it is acknowledged and never stored again. */
  isDeletedSession(id: string): boolean;
  /** Records the tombstone of a deleted session id; writing one twice keeps the first. */
  putDeletedSession(row: { id: string; deletedAt: string }): void;
  /** Removes every row: workouts, master data, sessions and their corrections. The tombstones of deleted sessions stay. */
  clear(): void;
}

/** Key-sorted JSON, so two workouts compare by content and not by the order their fields were written. */
export const canonicalWorkout = (workout: Workout) => JSON.stringify(sortKeys(workout));
const sortKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(sortKeys) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortKeys(child)])) : value;
const bundledIds = new Set(bundledWorkouts.map(workout => workout.id));
/** The page size listSessions serves: 50 by default, clamped to 1 … 200. A backend that reads ahead uses the same number. */
export const sessionPageSize = (limit = 50) => Math.max(1, Math.min(200, Math.floor(limit)));
const newestFirst = (a: StoredSession, b: StoredSession) => a.finishedAt < b.finishedAt ? 1 : a.finishedAt > b.finishedAt ? -1 : a.id.localeCompare(b.id);

/**
 * The household semantics (DAT-01): workouts and master data as revisioned JSON documents, sessions as immutable
 * records with their workout snapshot, score corrections kept beside the record (DAT-05). The caller runs each
 * public method inside one transaction of its backend; methods call each other freely within it.
 */
export class Household {
  constructor(private readonly tables: HouseholdTables, private readonly now: () => Date = () => new Date()) {}

  // ---- Workouts --------------------------------------------------------------------------------------------

  listWorkouts(includeArchived = false): StoredWorkout[] {
    return this.tables.listWorkouts(includeArchived).sort((a, b) => a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  getWorkout(id: string): StoredWorkout | undefined { return this.tables.getWorkout(id); }

  /** All ids a new workout must avoid: stored (even archived) and bundled ones. */
  takenIds(): Set<string> { return new Set([...bundledIds, ...this.tables.listWorkouts(true).map(row => row.id)]); }

  /**
   * Creates (expected revision 0 or absent, document revision ≥ 1) or updates (expected = stored revision, document
   * revision = stored + 1). An archived workout written again comes back. The sharing origin flips to local when the
   * document carries a new sharing identity (a derivative).
   */
  putWorkout(document: Workout, expectedRevision: number | undefined, origin: 'local' | 'imported' = 'local'): { created: boolean; revision: number; updatedAt: string } {
    const stamp = this.now().toISOString();
    const existing = this.getWorkout(document.id);
    if (!existing) {
      if (expectedRevision !== undefined && expectedRevision !== 0) throw new ConflictError(expectedRevision, { revision: 0 });
      this.tables.putWorkout({ id: document.id, revision: document.revision, origin, createdAt: stamp, updatedAt: stamp, document });
      return { created: true, revision: document.revision, updatedAt: stamp };
    }
    if (expectedRevision === undefined || expectedRevision !== existing.revision) throw new ConflictError(expectedRevision, { revision: existing.revision, document: existing.document });
    if (document.revision !== existing.revision + 1) throw new HouseholdError(400, 'REVISION_MISMATCH', `The document revision must be ${existing.revision + 1} to replace revision ${existing.revision}.`, '/document/revision');
    const nextOrigin = existing.origin === 'imported' && document.sharing?.id !== existing.document.sharing?.id ? 'local' : existing.origin;
    this.tables.putWorkout({ id: document.id, revision: document.revision, origin: nextOrigin, createdAt: existing.createdAt, updatedAt: stamp, document });
    return { created: false, revision: document.revision, updatedAt: stamp };
  }

  archiveWorkout(id: string, expectedRevision?: number): void {
    const existing = this.getWorkout(id);
    if (!existing) throw new NotFoundError(`Workout "${id}"`);
    if (expectedRevision !== undefined && expectedRevision !== existing.revision) throw new ConflictError(expectedRevision, { revision: existing.revision, document: existing.document });
    this.tables.putWorkout({ ...existing, archivedAt: this.now().toISOString() });
  }

  // ---- Master data -----------------------------------------------------------------------------------------

  getMasterData(): { revision: number; document: MasterData; updatedAt?: string } {
    const row = this.tables.getMaster();
    return row ? { revision: row.revision, document: sanitiseMasterData(row.document), updatedAt: row.updatedAt } : { revision: 0, document: emptyMasterData() };
  }

  putMasterData(document: MasterData, expectedRevision: number | undefined): { revision: number; updatedAt: string } {
    const stamp = this.now().toISOString();
    const current = this.getMasterData();
    if ((expectedRevision ?? 0) !== current.revision) throw new ConflictError(expectedRevision, { revision: current.revision, document: current.document });
    const revision = current.revision + 1;
    this.tables.putMaster({ revision, document: sanitiseMasterData(document), updatedAt: stamp });
    return { revision, updatedAt: stamp };
  }

  // ---- Sessions --------------------------------------------------------------------------------------------

  /**
   * Idempotent by id (DAT-03): a repeated upload of the same session is acknowledged, never duplicated. A deleted
   * session's id is acknowledged the same way and stays deleted (DAT-14).
   */
  putSession(record: SessionRecord & { workout: Workout }): 'created' | 'existing' {
    if (this.tables.hasSession(record.id) || this.tables.isDeletedSession(record.id)) return 'existing';
    this.tables.putSession({
      id: record.id, workoutId: record.workoutId, workoutRevision: record.workoutRevision, title: record.title, startedAt: record.startedAt, finishedAt: record.finishedAt,
      outcome: record.outcome, interrupted: record.interrupted, modified: record.modified, completion: record.completion, activeMs: record.activeMs,
      results: record.results, events: record.events, deviceId: record.deviceId, revision: 1, receivedAt: this.now().toISOString(), workout: record.workout, corrections: [],
    });
    return 'created';
  }

  listSessions({ limit, before, workoutId }: { limit?: number; before?: string; workoutId?: string } = {}): SessionListItem[] {
    return this.tables.listSessions({ limit: sessionPageSize(limit), ...(before ? { before } : {}), ...(workoutId ? { workoutId } : {}) });
  }

  getSession(id: string): StoredSession | undefined { return this.tables.getSession(id); }

  /** Replaces the scores, keeping the previous value and the time of the correction (DAT-05). */
  correctSession(id: string, results: SectionResult[], note: string | undefined, expectedRevision: number | undefined): { revision: number } {
    const session = this.tables.getSession(id);
    if (!session) throw new NotFoundError(`Session "${id}"`);
    if (expectedRevision !== session.revision) throw new ConflictError(expectedRevision, { revision: session.revision });
    const correction = { correctedAt: this.now().toISOString(), previousResults: session.results, ...(note ? { note } : {}) };
    this.tables.putSession({ ...session, results, revision: session.revision + 1, corrections: [...session.corrections, correction] });
    return { revision: session.revision + 1 };
  }

  /**
   * Deletes a session with its score corrections and leaves a tombstone of its id (DAT-14), so a later upload of the
   * same id (an outbox retry, another device) is acknowledged without storing it. Repeating it is harmless, and an
   * id not stored yet gets its tombstone too: an upload still on its way then never lands.
   */
  deleteSession(id: string): 'deleted' | 'absent' {
    const stored = this.tables.hasSession(id);
    if (stored) this.tables.deleteSession(id);
    if (!this.tables.isDeletedSession(id)) this.tables.putDeletedSession({ id, deletedAt: this.now().toISOString() });
    return stored ? 'deleted' : 'absent';
  }

  // ---- Imports ---------------------------------------------------------------------------------------------

  /** Moves a device's pre-1.0 library; safe to repeat (ids and identical content are skipped). */
  importDevice(payload: DeviceImport): DeviceImportReport {
    const report: DeviceImportReport = { workouts: { created: 0, skipped: 0, renamed: [] }, sessions: { created: 0, skipped: 0, orphaned: 0 }, masterData: 'unchanged' };
    const remap = new Map<string, string>();
    const taken = this.takenIds();
    const moved = new Map<string, Workout>();
    for (const workout of payload.workouts) {
      const existing = this.getWorkout(workout.id);
      if (existing && canonicalWorkout(existing.document) === canonicalWorkout(workout)) { report.workouts.skipped++; moved.set(workout.id, existing.document); continue; }
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
  }

  /** Applies a pack import with the user's per-workout decisions (SHR-04). */
  importPack(payload: PackImport): PackImportReport {
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
  }

  // ---- Export and restore ----------------------------------------------------------------------------------

  /** Everything as one labelled document; `schemaVersion` is the backend's storage version, carried for information. */
  exportAll(schemaVersion: number): ExportDocument {
    return {
      format: EXPORT_FORMAT, formatVersion: EXPORT_VERSION, exportedAt: this.now().toISOString(), schemaVersion,
      workouts: this.listWorkouts(true), masterData: this.getMasterData(), sessions: this.tables.allSessions(),
    };
  }

  /**
   * Replaces the whole household with a parsed export (parseExportDocument): archived workouts, revisions, master
   * data and score corrections come back as they were. With a session limit the oldest sessions beyond it are left
   * out and counted as pruned. The tombstones survive the restore: a session deleted after the backup was made stays
   * deleted, left out and counted as `deleted` (DAT-14).
   */
  restore(document: ExportDocument, { sessionLimit }: { sessionLimit?: number } = {}): RestoreReport {
    const live = document.sessions.filter(session => !this.tables.isDeletedSession(session.id));
    const deleted = document.sessions.length - live.length;
    const sessions = live.sort(newestFirst);
    const kept = sessionLimit === undefined ? sessions : sessions.slice(0, Math.max(0, sessionLimit));
    this.tables.clear();
    for (const workout of document.workouts) this.tables.putWorkout(workout);
    const master = document.masterData;
    if (master.revision > 0 || !isEmptyMasterData(master.document)) this.tables.putMaster({ revision: Math.max(1, master.revision), document: sanitiseMasterData(master.document), updatedAt: master.updatedAt ?? document.exportedAt });
    for (const session of kept) this.tables.putSession(session);
    const pruned = sessions.length - kept.length;
    return { ...summariseExport({ ...document, sessions: kept }), masterRevision: this.getMasterData().revision, ...(pruned ? { pruned } : {}), ...(deleted ? { deleted } : {}) };
  }
}
