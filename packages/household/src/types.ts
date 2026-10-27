import type { MasterData } from '../../domain/src/master-data';
import type { PackCollection } from '../../domain/src/pack';
import type { Workout } from '../../domain/src/schema';
import type { SessionCorrection, SessionRecord } from '../../engine/src/records';

/**
 * The household's records as every backend stores and serves them: the server over SQLite, the static shape in
 * the browser. The shapes are the wire format of the household API (apps/server/src/routes.ts), so a client never
 * tells the two apart.
 */
export interface StoredWorkout { id: string; revision: number; origin: 'local' | 'imported'; createdAt: string; updatedAt: string; archivedAt?: string; document: Workout }
export interface SessionListItem extends Omit<SessionRecord, 'events' | 'workout'> { receivedAt: string }
/** One played session as stored: the record with its workout snapshot, the server-managed revision and its score corrections (DAT-05). */
export type StoredSession = SessionRecord & { workout: Workout; revision: number; receivedAt: string; corrections: SessionCorrection[] };
/** The single master-data document. Revision 0 means none was ever written. */
export interface MasterRow { revision: number; document: MasterData; updatedAt?: string }

export interface DeviceImport { deviceId: string; workouts: Workout[]; masterData: MasterData; sessions: SessionRecord[] }
export interface DeviceImportReport { workouts: { created: number; skipped: number; renamed: { from: string; to: string }[] }; sessions: { created: number; skipped: number; orphaned: number }; masterData: 'created' | 'merged' | 'unchanged' }
export type PackDecision = { action: 'copy' } | { action: 'skip' } | { action: 'replace'; id: string; expectedRevision: number };
export interface PackImport { workouts: Workout[]; collections: PackCollection[]; decisions: Record<string, PackDecision> }
export interface PackImportReport { created: { from: string; to: string }[]; replaced: string[]; skipped: number; collections: number; masterRevision: number }

/** The JSON export (GET /api/v1/export): everything in the household, labelled so a restore can recognise it. */
export interface ExportDocument {
  format: 'openwod.export';
  /** The shape of this document. A restore refuses a newer one. */
  formatVersion: number;
  exportedAt: string;
  /** The backend's storage version when it was written (the SQLite schema on the server). Informational only. */
  schemaVersion: number;
  workouts: StoredWorkout[];
  masterData: MasterRow;
  sessions: StoredSession[];
}
/** What a backup holds (summariseExport) and what a restore wrote. `workouts` counts the active ones, `archived` the rest. */
export interface ExportSummary { workouts: number; archived: number; sessions: number; corrections: number; masterRevision: number; exportedAt: string }
export interface RestoreReport extends ExportSummary { pruned?: number }
