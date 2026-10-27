import type { MasterData } from '../../../../packages/domain/src/master-data';
import type { PackCollection } from '../../../../packages/domain/src/pack';
import type { Workout } from '../../../../packages/domain/src/schema';
import type { SectionResult } from '../../../../packages/engine/src';
import type { SessionRecord } from '../../../../packages/engine/src/records';
import type { DeviceImportReport, ExportDocument, PackDecision, PackImportReport, RestoreReport, SessionListItem, StoredWorkout } from '../../../../packages/household/src/types';
import { localBackend } from './local-backend';
import { DATA_MODE } from './mode';
import { remote } from './remote';

export interface Ready { status: string; persistence: boolean; schemaVersion?: number; version?: string }
export interface DeviceImportPayload { deviceId: string; workouts: Workout[]; masterData: MasterData; sessions: unknown[] }
export interface PackImportPayload { workouts: Workout[]; collections: PackCollection[]; decisions: Record<string, PackDecision> }
/** What the static shape can tell about its own storage; the server has no such call. */
export interface BackendCounts { workouts: number; archived: number; sessions: number }

/**
 * Where the household lives. Both implementations answer with the wire shapes of the household API and fail with
 * the client ApiError (status, code, path, payload), so the outbox and the library hook never tell them apart:
 * `remote` (remote.ts) is the server over HTTP and may also throw NetworkError; `localBackend` (local-backend.ts)
 * is this browser's IndexedDB and never does.
 */
export interface Backend {
  ready(): Promise<Ready>;
  listWorkouts(includeArchived?: boolean): Promise<StoredWorkout[]>;
  getWorkout(id: string): Promise<StoredWorkout>;
  /** `ifMatch` 0 (or absent) creates, otherwise it must equal the stored revision. */
  putWorkout(document: Workout, ifMatch?: number): Promise<{ id: string; revision: number; updatedAt: string }>;
  archiveWorkout(id: string, ifMatch?: number): Promise<void>;
  getMasterData(): Promise<{ revision: number; document: MasterData }>;
  putMasterData(document: MasterData, ifMatch: number): Promise<{ revision: number; updatedAt: string }>;
  listSessions(query?: { limit?: number; before?: string; workoutId?: string }): Promise<SessionListItem[]>;
  getSession(id: string): Promise<SessionRecord & { receivedAt: string }>;
  putSession(record: SessionRecord): Promise<{ id: string; stored: 'created' | 'existing' }>;
  correctSession(id: string, results: SectionResult[], note: string | undefined, ifMatch: number): Promise<{ revision: number }>;
  /** Deletes a session and its corrections for good; repeating it, or naming an id not stored yet, is fine (DAT-14). */
  deleteSession(id: string): Promise<void>;
  importDevice(payload: DeviceImportPayload): Promise<DeviceImportReport>;
  importPack(payload: PackImportPayload): Promise<PackImportReport>;
  /** Everything as one restorable JSON document (DAT-12). */
  exportAll(): Promise<ExportDocument>;
  /** Replaces the whole household with an export; `backup` names the server's pre-restore copy. */
  restore(document: unknown): Promise<RestoreReport & { backup?: string }>;
  counts?(): Promise<BackendCounts>;
}

/** The backend of this build, chosen once (mode.ts). */
export const backend: Backend = DATA_MODE === 'static' ? localBackend : remote;
