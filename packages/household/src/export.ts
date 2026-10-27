import { Type } from '@sinclair/typebox';
import { compileWorkout } from '../../domain/src/compiler';
import { MasterDataSchema, sanitiseMasterData, type MasterData } from '../../domain/src/master-data';
import type { Workout } from '../../domain/src/schema';
import { compileSchema, issuesOf, parseWorkout, WorkoutValidationError } from '../../domain/src/validate';
import { SessionCorrectionSchema, SessionRecordSchema, type SessionRecord } from '../../engine/src/records';
import { HouseholdError } from './errors';
import type { ExportDocument, ExportSummary, StoredSession, StoredWorkout } from './types';

/**
 * The JSON export as a restorable backup. `format` names the document, `formatVersion` its shape: a restore reads
 * every version up to its own and refuses a newer one, so an older build never half-reads a newer backup. The
 * backend's `schemaVersion` travels along for information only.
 */
export const EXPORT_FORMAT = 'openwod.export';
export const EXPORT_VERSION = 1;
export const MAX_RESTORE_BYTES = 32 * 1_048_576;
export const EXPORT_WORKOUT_LIMIT = 200;
export const EXPORT_SESSION_LIMIT = 5000;

const STAMP = Type.String({ minLength: 10, maxLength: 40 });
const StoredWorkoutSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 120 }), revision: Type.Integer({ minimum: 1 }), origin: Type.Union([Type.Literal('local'), Type.Literal('imported')]),
  createdAt: STAMP, updatedAt: STAMP, archivedAt: Type.Optional(STAMP), document: Type.Unknown(),
}, { additionalProperties: false });
/** A session as exported: the record schema with its snapshot required (checked as a workout below) and the server's receipt time. */
const StoredSessionSchema = Type.Object({
  ...SessionRecordSchema.properties, workout: Type.Unknown(), receivedAt: Type.Optional(STAMP), corrections: Type.Optional(Type.Array(SessionCorrectionSchema, { maxItems: 100 })),
}, { additionalProperties: false });
export const ExportDocumentSchema = Type.Object({
  format: Type.Literal(EXPORT_FORMAT), formatVersion: Type.Integer({ minimum: 1 }), exportedAt: STAMP, schemaVersion: Type.Integer({ minimum: 0 }),
  workouts: Type.Array(StoredWorkoutSchema, { maxItems: EXPORT_WORKOUT_LIMIT }),
  masterData: Type.Object({ revision: Type.Integer({ minimum: 0 }), document: MasterDataSchema, updatedAt: Type.Optional(STAMP) }, { additionalProperties: false }),
  sessions: Type.Array(StoredSessionSchema, { maxItems: EXPORT_SESSION_LIMIT }),
}, { additionalProperties: false });

let validator: ReturnType<typeof compileSchema> | undefined;
const invalid = (message: string, path: string, extra: Record<string, unknown> = {}) => new HouseholdError(400, 'VALIDATION_FAILED', message, path, extra);

/** Parses and compiles a workout at `path`; a failure names the field inside the backup. */
function workoutAt(value: unknown, path: string): Workout {
  try {
    const workout = parseWorkout(value);
    compileWorkout(workout);
    return workout;
  } catch (error) {
    if (!(error instanceof WorkoutValidationError)) throw error;
    const issues = error.issues.map(issue => ({ ...issue, path: `${path}${issue.path === '/' ? '' : issue.path}` }));
    throw invalid('The backup holds a workout that is not a valid OpenWOD document.', issues[0]?.path ?? path, { issues });
  }
}

/**
 * Checks that a value is a restorable export (DAT-12): the right format, a version this build reads, every workout
 * and session snapshot valid and compilable, unique ids. Returns an isolated, normalised copy. Nothing is written,
 * so a refused backup leaves the library as it was.
 */
export function parseExportDocument(value: unknown, supportedFormatVersion = EXPORT_VERSION): ExportDocument {
  const raw = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  if (raw.format !== EXPORT_FORMAT) throw invalid('This file is not an OpenWOD export.', '/format');
  if (typeof raw.formatVersion === 'number' && raw.formatVersion > supportedFormatVersion) {
    throw new HouseholdError(400, 'FORMAT_NEWER', `This backup was written by a newer OpenWOD (format version ${raw.formatVersion}, this build reads up to ${supportedFormatVersion}). Update first, then restore it.`, '/formatVersion', { found: raw.formatVersion, supported: supportedFormatVersion });
  }
  validator ??= compileSchema(ExportDocumentSchema);
  if (!validator(raw)) {
    const issues = issuesOf(validator, 'Invalid value.');
    throw invalid('The backup is not a valid OpenWOD export.', issues[0]?.path || '/', { issues });
  }
  const document = raw as unknown as ExportDocument & { sessions: (SessionRecord & { workout: unknown; receivedAt?: string })[] };
  const workoutIds = new Set<string>();
  const workouts = document.workouts.map((item, index): StoredWorkout => {
    if (workoutIds.has(item.id)) throw invalid(`Workout "${item.id}" appears twice.`, `/workouts/${index}/id`);
    workoutIds.add(item.id);
    const parsed = workoutAt(item.document, `/workouts/${index}/document`);
    if (parsed.id !== item.id) throw invalid('The workout document id must match its entry.', `/workouts/${index}/document/id`);
    return { ...structuredClone(item), document: parsed };
  });
  const sessionIds = new Set<string>();
  const sessions = document.sessions.map((item, index): StoredSession => {
    if (sessionIds.has(item.id)) throw invalid(`Session "${item.id}" appears twice.`, `/sessions/${index}/id`);
    sessionIds.add(item.id);
    const workout = workoutAt(item.workout, `/sessions/${index}/workout`);
    return { ...structuredClone(item), workout, revision: item.revision ?? 1, receivedAt: item.receivedAt ?? document.exportedAt, corrections: structuredClone(item.corrections ?? []) };
  });
  const masterData = { revision: document.masterData.revision, document: sanitiseMasterData(document.masterData.document) as MasterData, ...(document.masterData.updatedAt ? { updatedAt: document.masterData.updatedAt } : {}) };
  return { format: EXPORT_FORMAT, formatVersion: document.formatVersion, exportedAt: document.exportedAt, schemaVersion: document.schemaVersion, workouts, masterData, sessions };
}

/** The counts a restore confirmation shows, and the export date. */
export function summariseExport(document: ExportDocument): ExportSummary {
  const archived = document.workouts.filter(item => item.archivedAt).length;
  return {
    workouts: document.workouts.length - archived, archived, sessions: document.sessions.length,
    corrections: document.sessions.reduce((sum, session) => sum + (session.corrections?.length ?? 0), 0), masterRevision: document.masterData.revision, exportedAt: document.exportedAt,
  };
}
