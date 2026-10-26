import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileWorkout } from '../../../packages/domain/src/compiler';
import { MasterDataSchema, sanitiseMasterData, type MasterData } from '../../../packages/domain/src/master-data';
import type { Workout } from '../../../packages/domain/src/schema';
import { compileSchema, issuesOf, parseWorkout, WorkoutValidationError } from '../../../packages/domain/src/validate';
import { SectionResultSchema, SessionRecordSchema, type SessionRecord } from '../../../packages/engine/src/records';
import { ApiError, NotFoundError } from './errors';
import type { PackDecision, Store } from './store';

const LARGE_BODY = 4 * 1_048_576;
const STAMP = Type.String({ minLength: 10, maxLength: 40 });

const DocumentBody = Type.Object({ document: Type.Unknown() }, { additionalProperties: false });
const CorrectionBody = Type.Object({ results: Type.Array(SectionResultSchema, { maxItems: 100 }), note: Type.Optional(Type.String({ maxLength: 500 })) }, { additionalProperties: false });
/** Pre-1.0 device records: no events, flags or snapshot. The server fills them in. */
const LegacySessionSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 120 }), workoutId: Type.String({ minLength: 1, maxLength: 120 }), title: Type.String({ minLength: 1, maxLength: 160 }),
  startedAt: STAMP, finishedAt: STAMP, outcome: Type.Union([Type.Literal('completed'), Type.Literal('capped'), Type.Literal('aborted')]),
  completion: Type.Number({ minimum: 0, maximum: 1 }), activeMs: Type.Integer({ minimum: 0 }), results: Type.Array(SectionResultSchema, { maxItems: 100 }),
  workoutRevision: Type.Optional(Type.Integer({ minimum: 1 })), interrupted: Type.Optional(Type.Boolean()), modified: Type.Optional(Type.Boolean()), deviceId: Type.Optional(Type.String({ maxLength: 80 })),
}, { additionalProperties: true });
const DeviceImportBody = Type.Object({ deviceId: Type.String({ minLength: 1, maxLength: 80 }), workouts: Type.Array(Type.Unknown(), { maxItems: 200 }), masterData: Type.Unknown(), sessions: Type.Array(LegacySessionSchema, { maxItems: 1000 }) }, { additionalProperties: false });
const PackDecisionSchema = Type.Union([
  Type.Object({ action: Type.Literal('copy') }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('skip') }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('replace'), id: Type.String({ minLength: 1, maxLength: 120 }), expectedRevision: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
]);
const PackImportBody = Type.Object({
  workouts: Type.Array(Type.Unknown(), { minItems: 1, maxItems: 200 }),
  collections: Type.Array(Type.Object({ title: Type.String({ minLength: 1, maxLength: 120 }), description: Type.Optional(Type.String({ maxLength: 500 })), workoutIds: Type.Array(Type.String({ maxLength: 120 }), { maxItems: 500 }) }, { additionalProperties: false }), { maxItems: 50 }),
  decisions: Type.Record(Type.String({ maxLength: 120 }), PackDecisionSchema),
}, { additionalProperties: false });

const validators = {
  document: compileSchema<{ document: unknown }>(DocumentBody),
  masterData: compileSchema<MasterData>(MasterDataSchema),
  session: compileSchema<SessionRecord>(SessionRecordSchema),
  correction: compileSchema<{ results: SessionRecord['results']; note?: string }>(CorrectionBody),
  deviceImport: compileSchema<{ deviceId: string; workouts: unknown[]; masterData: unknown; sessions: (Partial<SessionRecord> & { id: string; workoutId: string; title: string; startedAt: string; finishedAt: string; outcome: SessionRecord['outcome']; completion: number; activeMs: number; results: SessionRecord['results'] })[] }>(DeviceImportBody),
  packImport: compileSchema<{ workouts: unknown[]; collections: { title: string; description?: string; workoutIds: string[] }[]; decisions: Record<string, PackDecision> }>(PackImportBody),
};

function body<T>(validate: (value: unknown) => value is T, value: unknown, what: string): T {
  if (!validate(value)) throw new WorkoutValidationError([{ path: '/', message: `The ${what} body is invalid.` }, ...issuesOf(validate as Parameters<typeof issuesOf>[0], 'Invalid value.')]);
  return value;
}

/** Parses and compiles a workout document; invalid content never reaches the database. */
function workoutDocument(value: unknown): Workout {
  const workout = parseWorkout(value);
  compileWorkout(workout);
  return workout;
}

/** `If-Match: "3"` → 3; absent → undefined (create-only for documents). */
export function expectedRevision(request: FastifyRequest): number | undefined {
  const header = request.headers['if-match'];
  if (header === undefined) return undefined;
  const raw = String(Array.isArray(header) ? header[0] : header).trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new ApiError(400, 'BAD_IF_MATCH', 'If-Match must carry the expected revision as an integer.');
  return value;
}

export interface RouteContext { storeOf: (request: FastifyRequest) => Store | undefined; version: string }

export function registerRoutes(app: FastifyInstance, { storeOf, version }: RouteContext) {
  const need = (request: FastifyRequest): Store => {
    const store = storeOf(request);
    if (!store) throw new ApiError(503, 'NOT_READY', 'The datastore is not available.');
    return store;
  };

  app.get('/api/v1/health/live', async () => ({ status: 'ok', version }));
  app.get('/api/v1/health/ready', async (request, reply) => {
    const store = storeOf(request);
    if (!store) return reply.code(503).send({ status: 'starting', capabilities: ['timed-player'], persistence: false });
    return { status: 'ok', capabilities: ['timed-player', 'persistence'], persistence: true, schemaVersion: store.schemaVersion, version };
  });

  app.get<{ Querystring: { includeArchived?: string } }>('/api/v1/workouts', async request => ({ workouts: need(request).listWorkouts(request.query.includeArchived === '1') }));
  app.get<{ Params: { id: string } }>('/api/v1/workouts/:id', async request => {
    const workout = need(request).getWorkout(request.params.id);
    if (!workout) throw new NotFoundError(`Workout "${request.params.id}"`);
    return workout;
  });
  app.put<{ Params: { id: string } }>('/api/v1/workouts/:id', async (request, reply) => {
    const { document } = body(validators.document, request.body, 'workout');
    const workout = workoutDocument(document);
    if (workout.id !== request.params.id) throw new ApiError(400, 'ID_MISMATCH', 'The document id must match the path.', '/document/id');
    const result = need(request).putWorkout(workout, expectedRevision(request));
    return reply.code(result.created ? 201 : 200).send({ id: workout.id, revision: result.revision, updatedAt: result.updatedAt });
  });
  app.delete<{ Params: { id: string } }>('/api/v1/workouts/:id', async (request, reply) => {
    need(request).archiveWorkout(request.params.id, expectedRevision(request));
    return reply.code(204).send();
  });

  app.get('/api/v1/master-data', async request => need(request).getMasterData());
  app.put('/api/v1/master-data', async request => {
    const { document } = body(validators.document, request.body, 'master data');
    const data = body(validators.masterData, document, 'master data');
    return need(request).putMasterData(sanitiseMasterData(data), expectedRevision(request));
  });

  app.get<{ Querystring: { limit?: string; before?: string; workoutId?: string } }>('/api/v1/sessions', async request => ({
    sessions: need(request).listSessions({ limit: request.query.limit ? Number(request.query.limit) : undefined, before: request.query.before, workoutId: request.query.workoutId }),
  }));
  app.get<{ Params: { id: string } }>('/api/v1/sessions/:id', async request => {
    const session = need(request).getSession(request.params.id);
    if (!session) throw new NotFoundError(`Session "${request.params.id}"`);
    return session;
  });
  app.put<{ Params: { id: string } }>('/api/v1/sessions/:id', { bodyLimit: LARGE_BODY }, async (request, reply) => {
    const record = body(validators.session, request.body, 'session');
    if (record.id !== request.params.id) throw new ApiError(400, 'ID_MISMATCH', 'The session id must match the path.', '/id');
    if (!record.workout) throw new ApiError(400, 'VALIDATION_FAILED', 'A session upload must carry the workout as played.', '/workout');
    const workout = workoutDocument(record.workout);
    const stored = need(request).putSession({ ...record, workout });
    return reply.code(stored === 'created' ? 201 : 200).send({ id: record.id, stored });
  });
  app.patch<{ Params: { id: string } }>('/api/v1/sessions/:id/results', async request => {
    const { results, note } = body(validators.correction, request.body, 'correction');
    return need(request).correctSession(request.params.id, results, note, expectedRevision(request));
  });

  app.post('/api/v1/import/device', { bodyLimit: LARGE_BODY }, async request => {
    const payload = body(validators.deviceImport, request.body, 'device import');
    const workouts = payload.workouts.map(workoutDocument);
    const masterData = sanitiseMasterData(payload.masterData);
    const sessions: SessionRecord[] = payload.sessions.map(session => ({
      id: session.id, workoutId: session.workoutId, workoutRevision: session.workoutRevision ?? 1, title: session.title, startedAt: session.startedAt, finishedAt: session.finishedAt,
      outcome: session.outcome, interrupted: session.interrupted ?? false, modified: session.modified ?? false, completion: session.completion, activeMs: session.activeMs,
      results: session.results, events: session.events ?? [], deviceId: session.deviceId || payload.deviceId, ...(session.workout ? { workout: workoutDocument(session.workout) } : {}),
    }));
    return need(request).importDevice({ deviceId: payload.deviceId, workouts, masterData, sessions });
  });
  app.post('/api/v1/import/pack', { bodyLimit: LARGE_BODY }, async request => {
    const payload = body(validators.packImport, request.body, 'pack import');
    const workouts = payload.workouts.map(workoutDocument);
    return need(request).importPack({ workouts, collections: payload.collections, decisions: payload.decisions });
  });

  app.get('/api/v1/export', async (request, reply) => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return reply.header('Content-Disposition', `attachment; filename="openwod-export-${stamp}.json"`).type('application/json').send(JSON.stringify(need(request).exportAll(), null, 2));
  });
  app.get('/api/v1/backup', async (request, reply) => {
    const store = need(request);
    const dir = await mkdtemp(join(tmpdir(), 'openwod-backup-'));
    const file = join(dir, 'openwod.sqlite');
    try { await store.backupTo(file); } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const stream = createReadStream(file);
    stream.once('close', () => { void rm(dir, { recursive: true, force: true }); });
    return reply.header('Content-Disposition', `attachment; filename="openwod-${stamp}.sqlite"`).type('application/vnd.sqlite3').send(stream);
  });
}
