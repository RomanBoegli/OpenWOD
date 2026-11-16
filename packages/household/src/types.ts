import type { MasterData } from '../../domain/src/master-data';
import type { PackCollection } from '../../domain/src/pack';
import type { Workout } from '../../domain/src/schema';
import type { EngineSnapshot, Status } from '../../engine/src';
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
/** `pruned` counts the oldest sessions beyond a session limit, `deleted` the sessions a tombstone kept out (DAT-14). */
export interface RestoreReport extends ExportSummary { pruned?: number; deleted?: number }

// ---- Hand-over (ENG-15) ------------------------------------------------------------------------------------
// The wire shapes of `/api/v1/live-sessions`: a running session's device sends its checkpoints and progress records
// to the server, where another device can claim them and continue. Server shape only: none of this is part of the
// household core, an export or a restore, and the static shape has nobody to hand over to.

/** A session checkpoint as the player writes it on its device (apps/web/src/data/checkpoints.ts); the server never looks into the snapshot. */
export interface LiveCheckpoint { sessionId: string; workoutId: string; workoutRevision: number; workout: Workout; snapshot: EngineSnapshot; revision: number; status: Status; savedAt: string; startedAt?: string }
/** The clock offsets since a checkpoint, valid only on top of the checkpoint revision they name. */
export interface LiveProgress { sessionId: string; checkpointRevision: number; phaseMs: number; activeMs: number; sectionMs: number; savedAt: string }
/** The device that controls a live session. `generation` counts the hand-overs, starting at 1. */
export interface LiveController { deviceId: string; deviceLabel: string; generation: number }
/**
 * A live session without its bodies. `revision` and `savedAt` are those of the stored checkpoint (the device's
 * clock); `updatedAt` is when the server last heard from the controlling device (the server's clock).
 */
export interface LiveSessionItem extends LiveController { id: string; workoutId: string; title: string; status: Status; activeMs: number; revision: number; savedAt: string; updatedAt: string }
export interface LiveSession extends LiveSessionItem { checkpoint: LiveCheckpoint; progress?: LiveProgress }
/** `now` is the server's clock, so a device can tell the age of `updatedAt` without trusting its own. */
export interface LiveSessionList { now: string; sessions: LiveSessionItem[] }
/** PUT body: who sends, and what is new. The first checkpoint creates the row with the sender as its controller. */
export interface LiveSessionPut { deviceId: string; deviceLabel: string; checkpoint?: LiveCheckpoint; progress?: LiveProgress }
export interface LiveSessionClaim { deviceId: string; deviceLabel: string }
/** What the server holds after a PUT: the stored checkpoint's revision and time, which stay behind when a stale one was ignored. */
export interface LiveSessionAck { id: string; generation: number; revision: number; savedAt: string }
