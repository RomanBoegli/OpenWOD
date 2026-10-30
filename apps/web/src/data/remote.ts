import { sanitiseMasterData, type MasterData } from '../../../../packages/domain/src/master-data';
import type { PackCollection } from '../../../../packages/domain/src/pack';
import type { Workout } from '../../../../packages/domain/src/schema';
import type { SectionResult } from '../../../../packages/engine/src';
import type { SessionRecord } from '../../../../packages/engine/src/records';
import type { DeviceImportReport, ExportDocument, PackDecision, PackImportReport, RestoreReport, SessionListItem, StoredWorkout } from '../../../../packages/household/src/types';
import type { Backend, Ready } from './backend';
import { request } from './client';

/** Typed calls for every household API route (apps/server/src/routes.ts). The record shapes live in packages/household. */
export type { DeviceImportReport, PackDecision, PackImportReport, SessionListItem, StoredWorkout } from '../../../../packages/household/src/types';
export type { Ready } from './backend';

export const remote = {
  ready: () => request<Ready>('GET', '/health/ready', { timeoutMs: 4000 }),
  listWorkouts: (includeArchived = false) => request<{ workouts: StoredWorkout[] }>('GET', `/workouts${includeArchived ? '?includeArchived=1' : ''}`).then(result => result.workouts),
  getWorkout: (id: string) => request<StoredWorkout>('GET', `/workouts/${encodeURIComponent(id)}`),
  putWorkout: (document: Workout, ifMatch?: number) => request<{ id: string; revision: number; updatedAt: string }>('PUT', `/workouts/${encodeURIComponent(document.id)}`, { body: { document }, ifMatch }),
  archiveWorkout: (id: string, ifMatch?: number) => request<void>('DELETE', `/workouts/${encodeURIComponent(id)}`, { ifMatch }),
  // Read like any stored document: a server on an older build sends no fields it does not know, and the app relies on every field.
  getMasterData: () => request<{ revision: number; document: MasterData }>('GET', '/master-data').then(result => ({ ...result, document: sanitiseMasterData(result.document) })),
  putMasterData: (document: MasterData, ifMatch: number) => request<{ revision: number; updatedAt: string }>('PUT', '/master-data', { body: { document }, ifMatch }),
  listSessions: (query: { limit?: number; before?: string; workoutId?: string } = {}) => {
    const params = new URLSearchParams();
    if (query.limit) params.set('limit', String(query.limit));
    if (query.before) params.set('before', query.before);
    if (query.workoutId) params.set('workoutId', query.workoutId);
    const suffix = params.toString();
    return request<{ sessions: SessionListItem[] }>('GET', `/sessions${suffix ? `?${suffix}` : ''}`).then(result => result.sessions);
  },
  getSession: (id: string) => request<SessionRecord & { receivedAt: string }>('GET', `/sessions/${encodeURIComponent(id)}`),
  putSession: (record: SessionRecord) => request<{ id: string; stored: 'created' | 'existing' }>('PUT', `/sessions/${encodeURIComponent(record.id)}`, { body: record, timeoutMs: 20_000 }),
  correctSession: (id: string, results: SectionResult[], note: string | undefined, ifMatch: number) => request<{ revision: number }>('PATCH', `/sessions/${encodeURIComponent(id)}/results`, { body: { results, ...(note ? { note } : {}) }, ifMatch }),
  deleteSession: (id: string) => request<void>('DELETE', `/sessions/${encodeURIComponent(id)}`),
  importDevice: (payload: { deviceId: string; workouts: Workout[]; masterData: MasterData; sessions: unknown[] }) => request<DeviceImportReport>('POST', '/import/device', { body: payload, timeoutMs: 30_000 }),
  importPack: (payload: { workouts: Workout[]; collections: PackCollection[]; decisions: Record<string, PackDecision> }) => request<PackImportReport>('POST', '/import/pack', { body: payload, timeoutMs: 30_000 }),
  exportAll: () => request<ExportDocument>('GET', '/export', { timeoutMs: 60_000 }),
  restore: (document: unknown) => request<RestoreReport & { backup?: string }>('POST', '/import/restore', { body: document, timeoutMs: 120_000 }),
} satisfies Backend;
