import { Type } from '@sinclair/typebox';
import { compileWorkout } from '../../../../packages/domain/src/compiler';
import { MasterDataSchema, sanitiseMasterData, type MasterData } from '../../../../packages/domain/src/master-data';
import type { Workout } from '../../../../packages/domain/src/schema';
import { compileSchema, issuesOf, parseWorkout, WorkoutValidationError } from '../../../../packages/domain/src/validate';
import type { SectionResult } from '../../../../packages/engine/src';
import { SectionResultSchema, SessionRecordSchema, type SessionRecord } from '../../../../packages/engine/src/records';
import { Household, sessionPageSize, type HouseholdTables } from '../../../../packages/household/src/core';
import { HouseholdError, NotFoundError } from '../../../../packages/household/src/errors';
import { parseExportDocument } from '../../../../packages/household/src/export';
import type { MasterRow, SessionListItem, StoredSession, StoredWorkout } from '../../../../packages/household/src/types';
import type { Backend, BackendCounts, DeviceImportPayload, PackImportPayload } from './backend';
import { ApiError } from './client';
import { IDB_VERSION, openIdb, settle, StorageUnavailableError, type HouseholdStoreName } from './idb';

/**
 * The household in this browser (static shape): the same semantics as the server (packages/household/src/core.ts)
 * over four IndexedDB stores (the fourth holds the tombstones of deleted sessions, DAT-14). Every call is one IndexedDB transaction: the rows the operation needs are read
 * first, then the core runs synchronously and its writes go into the same transaction, so an import or a restore
 * is all or nothing and a failure leaves nothing written. Errors come out as the client ApiError the server would
 * have sent, never as a NetworkError.
 */
export const STATIC_SESSION_LIMIT = 2000;
const STORES: HouseholdStoreName[] = ['workouts', 'master', 'sessions', 'deletedSessions'];
const MASTER_KEY = 1;

/** What an operation reads before the core runs: whole stores for workouts and master data, and as much of the sessions as it needs. */
interface Preload {
  workouts?: boolean;
  master?: boolean;
  sessions?: 'keys' | 'all' | { id: string } | { list: { limit: number; before?: string; workoutId?: string } };
  /** The ids of deleted sessions, for the operations that may meet one (an upload, an import, a restore, a delete). */
  deleted?: boolean;
}

type SessionKey = { id: string; finishedAt: string };
/** Newest first, ties by id like the server's `ORDER BY finished_at DESC, id`. */
const newestFirst = (a: SessionKey, b: SessionKey) => a.finishedAt < b.finishedAt ? 1 : a.finishedAt > b.finishedAt ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const oldestFirst = (a: SessionKey, b: SessionKey) => newestFirst(b, a);
const toListItem = ({ events: _events, workout: _workout, corrections: _corrections, ...rest }: StoredSession): SessionListItem => rest;

/**
 * Walks a sessions index in `direction` and returns the first `limit` rows in the server's order. Rows that share
 * the last row's finishing time are read too and ordered by id, so a tie never depends on the index's own order.
 * Only keys are read unless `values` asks for the records.
 */
function walk(source: IDBIndex, range: IDBKeyRange | null, direction: 'prev' | 'next', limit: number, values: boolean): Promise<(SessionKey & { value?: StoredSession })[]> {
  return new Promise((resolve, reject) => {
    const rows: (SessionKey & { value?: StoredSession })[] = [];
    const request = values ? source.openCursor(range, direction) : source.openKeyCursor(range, direction);
    const done = () => resolve(rows.sort(direction === 'prev' ? newestFirst : oldestFirst).slice(0, limit));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { done(); return; }
      const finishedAt = String(Array.isArray(cursor.key) ? cursor.key[1] : cursor.key);
      if (rows.length >= limit && finishedAt !== rows[rows.length - 1].finishedAt) { done(); return; }
      rows.push({ id: String(cursor.primaryKey), finishedAt, ...(values ? { value: (cursor as IDBCursorWithValue).value as StoredSession } : {}) });
      cursor.continue();
    };
    request.onerror = () => reject(new StorageUnavailableError(request.error?.message));
  });
}

/** The newest sessions first, by finishing time or within one workout, strictly before `before` when given. */
async function listRange(sessions: IDBObjectStore, { limit, before, workoutId }: { limit: number; before?: string; workoutId?: string }): Promise<StoredSession[]> {
  const rows = workoutId
    ? await walk(sessions.index('byWorkout'), IDBKeyRange.bound([workoutId], [workoutId, before ?? []], false, Boolean(before)), 'prev', limit, true)
    : await walk(sessions.index('byFinished'), before ? IDBKeyRange.upperBound(before, true) : null, 'prev', limit, true);
  return rows.map(row => row.value!);
}

const unread = (what: string) => new Error(`Local backend: ${what} were not read for this operation.`);

/**
 * HouseholdTables over one open transaction: the preloaded rows in memory, every write applied to them and issued
 * to the store at once. Reading something that was not preloaded is a programming error and says so.
 */
class IdbTables implements HouseholdTables {
  private workouts?: Map<string, StoredWorkout>;
  private master?: MasterRow;
  private masterLoaded = false;
  /** Every stored session id, when preloaded ('keys' or 'all'). */
  sessionIds?: Set<string>;
  private sessions = new Map<string, StoredSession>();
  /** Ids read one by one, found or not. */
  private loadedIds = new Set<string>();
  private listed?: SessionListItem[];
  private allLoaded = false;
  private deleted?: Set<string>;

  private constructor(private readonly tx: IDBTransaction) {}

  static async load(tx: IDBTransaction, preload: Preload): Promise<IdbTables> {
    const tables = new IdbTables(tx);
    const store = (name: HouseholdStoreName) => tx.objectStore(name);
    const reads: Promise<void>[] = [];
    if (preload.workouts) reads.push(settle(store('workouts').getAll() as IDBRequest<StoredWorkout[]>).then(rows => { tables.workouts = new Map(rows.map(row => [row.id, row])); }));
    if (preload.master) reads.push(settle(store('master').get(MASTER_KEY) as IDBRequest<(MasterRow & { id: number }) | undefined>).then(row => { tables.masterLoaded = true; if (row) { const { id: _id, ...rest } = row; tables.master = rest; } }));
    const sessions = preload.sessions;
    if (sessions === 'keys') reads.push(settle(store('sessions').getAllKeys()).then(keys => { tables.sessionIds = new Set(keys.map(String)); }));
    else if (sessions === 'all') reads.push(settle(store('sessions').getAll() as IDBRequest<StoredSession[]>).then(rows => { tables.allLoaded = true; tables.sessionIds = new Set(rows.map(row => row.id)); for (const row of rows) tables.sessions.set(row.id, row); }));
    else if (sessions && 'id' in sessions) reads.push(settle(store('sessions').get(sessions.id) as IDBRequest<StoredSession | undefined>).then(row => { tables.loadedIds.add(sessions.id); if (row) tables.sessions.set(row.id, row); }));
    else if (sessions) reads.push(listRange(store('sessions'), sessions.list).then(rows => { tables.listed = rows.map(toListItem); }));
    if (preload.deleted) reads.push(settle(store('deletedSessions').getAllKeys()).then(keys => { tables.deleted = new Set(keys.map(String)); }));
    await Promise.all(reads);
    return tables;
  }

  private need<T>(value: T | undefined, what: string): T {
    if (value === undefined) throw unread(what);
    return value;
  }
  private store(name: HouseholdStoreName) { return this.tx.objectStore(name); }

  getWorkout(id: string) { const row = this.need(this.workouts, 'workouts').get(id); return row && structuredClone(row); }
  listWorkouts(includeArchived: boolean) { return [...this.need(this.workouts, 'workouts').values()].filter(row => includeArchived || !row.archivedAt).map(row => structuredClone(row)); }
  putWorkout(workout: StoredWorkout) {
    const row = structuredClone(workout);
    this.need(this.workouts, 'workouts').set(row.id, row);
    this.store('workouts').put(row);
  }
  getMaster() {
    if (!this.masterLoaded) throw unread('master data');
    return this.master && structuredClone(this.master);
  }
  putMaster(row: MasterRow & { updatedAt: string }) {
    this.master = structuredClone(row);
    this.masterLoaded = true;
    this.store('master').put({ id: MASTER_KEY, ...this.master });
  }
  hasSession(id: string) {
    if (this.sessions.has(id)) return true;
    if (this.sessionIds) return this.sessionIds.has(id);
    if (this.loadedIds.has(id)) return false;
    throw unread('session ids');
  }
  getSession(id: string) {
    if (!this.sessions.has(id) && !this.loadedIds.has(id) && !this.allLoaded) throw unread(`session "${id}"`);
    const row = this.sessions.get(id);
    return row && structuredClone(row);
  }
  putSession(session: StoredSession) {
    const row = structuredClone(session);
    this.sessions.set(row.id, row);
    this.sessionIds?.add(row.id);
    this.store('sessions').put(row);
  }
  listSessions(query: { limit: number }) { return this.need(this.listed, 'session lists').slice(0, query.limit); }
  allSessions() {
    if (!this.allLoaded) throw unread('all sessions');
    return [...this.sessions.values()].sort(newestFirst).map(row => structuredClone(row));
  }
  deleteSession(id: string) {
    this.sessions.delete(id);
    this.sessionIds?.delete(id);
    this.loadedIds.add(id);
    this.store('sessions').delete(id);
  }
  isDeletedSession(id: string) { return this.need(this.deleted, 'deleted session ids').has(id); }
  putDeletedSession(row: { id: string; deletedAt: string }) {
    const deleted = this.need(this.deleted, 'deleted session ids');
    if (deleted.has(row.id)) return;
    deleted.add(row.id);
    this.store('deletedSessions').put({ ...row });
  }
  /** Everything but the tombstones, which outlive a restore (DAT-14). */
  clear() {
    for (const name of STORES) if (name !== 'deletedSessions') this.store(name).clear();
    this.workouts = new Map();
    this.master = undefined;
    this.masterLoaded = true;
    this.sessions.clear();
    this.sessionIds = new Set();
    this.listed = [];
    this.allLoaded = true;
  }
}

/** The structured errors the server would send, as the client raises them for a server reply (client.ts request). */
function toClientError(error: unknown): unknown {
  if (error instanceof HouseholdError) return new ApiError(error.status, error.code, error.message, error.path, { code: error.code, message: error.message, ...(error.path ? { path: error.path } : {}), ...error.extra });
  if (error instanceof WorkoutValidationError) {
    const path = error.issues[0]?.path;
    return new ApiError(400, 'VALIDATION_FAILED', 'The content is not a valid OpenWOD document.', path, { code: 'VALIDATION_FAILED', message: 'The content is not a valid OpenWOD document.', ...(path ? { path } : {}), issues: error.issues });
  }
  return error;
}

/** Runs the checks that precede a transaction; what they throw comes out as the server's reply would. */
function local<T>(fn: () => T): T {
  try { return fn(); } catch (error) { throw toClientError(error); }
}

/** Parses and compiles a workout document; invalid content never reaches the store (as on the server). */
function workoutDocument(value: unknown): Workout {
  const workout = parseWorkout(value);
  compileWorkout(workout);
  return workout;
}
const CorrectionSchema = Type.Object({ results: Type.Array(SectionResultSchema, { maxItems: 100 }), note: Type.Optional(Type.String({ maxLength: 500 })) }, { additionalProperties: false });
let validators: { masterData: (value: unknown) => boolean; session: (value: unknown) => boolean; correction: (value: unknown) => boolean } | undefined;
function check(name: 'masterData' | 'session' | 'correction', value: unknown, what: string) {
  validators ??= { masterData: compileSchema(MasterDataSchema), session: compileSchema(SessionRecordSchema), correction: compileSchema(CorrectionSchema) };
  const validate = validators[name];
  if (!validate(value)) throw new WorkoutValidationError([{ path: '/', message: `The ${what} is invalid.` }, ...issuesOf(validate as Parameters<typeof issuesOf>[0], 'Invalid value.')]);
}

/** Pre-1.0 records carry no events, flags or snapshot; filled in the way the server's device import does. */
function deviceSessions(payload: DeviceImportPayload): SessionRecord[] {
  return (payload.sessions as (Partial<SessionRecord> & Pick<SessionRecord, 'id' | 'workoutId' | 'title' | 'startedAt' | 'finishedAt' | 'outcome' | 'completion' | 'activeMs' | 'results'>)[]).map(session => ({
    id: session.id, workoutId: session.workoutId, workoutRevision: session.workoutRevision ?? 1, title: session.title, startedAt: session.startedAt, finishedAt: session.finishedAt,
    outcome: session.outcome, interrupted: session.interrupted ?? false, modified: session.modified ?? false, completion: session.completion, activeMs: session.activeMs,
    results: session.results, events: session.events ?? [], deviceId: session.deviceId || payload.deviceId, ...(session.workout ? { workout: workoutDocument(session.workout) } : {}),
  }));
}

export interface LocalBackendOptions {
  /** Sessions kept at most; the oldest beyond it are pruned on every write and on restore. */
  sessionLimit?: number;
  now?: () => Date;
  /** The database to use (tests open their own); the app's shared connection by default. */
  database?: () => Promise<IDBDatabase>;
}

export function createLocalBackend({ sessionLimit = STATIC_SESSION_LIMIT, now = () => new Date(), database = openIdb }: LocalBackendOptions = {}) {
  /**
   * Runs one operation in one transaction: preload, the core synchronously, then pruning, then commit. Nothing
   * but this transaction's own requests is awaited in between, so it never commits early and an error aborts it.
   */
  async function run<T>(mode: IDBTransactionMode, preload: Preload, fn: (household: Household, tables: IdbTables) => T): Promise<T> {
    const db = await database();
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction(STORES, mode); } catch (error) { reject(new StorageUnavailableError(String(error))); return; }
      let result: T;
      let failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? new StorageUnavailableError(tx.error?.message ?? 'The transaction was aborted.'));
      (async () => {
        const tables = await IdbTables.load(tx, preload);
        result = fn(new Household(tables, now), tables);
        if (mode === 'readwrite') await prune(tx, tables);
      })().catch(error => {
        failure = toClientError(error);
        try { tx.abort(); } catch { /* already finished */ }
        reject(failure);
      });
    });
  }

  /** Deletes the oldest sessions beyond the limit, inside the operation's transaction. */
  async function prune(tx: IDBTransaction, tables: IdbTables) {
    const excess = (tables.sessionIds?.size ?? 0) - sessionLimit;
    if (excess <= 0) return;
    const sessions = tx.objectStore('sessions');
    const oldest = await walk(sessions.index('byFinished'), null, 'next', excess, false);
    for (const { id } of oldest) { sessions.delete(id); tables.sessionIds?.delete(id); }
  }

  const all: Preload = { workouts: true, master: true };
  return {
    async ready() {
      await database();
      return { status: 'ok', persistence: true, schemaVersion: IDB_VERSION, version: __OPENWOD_VERSION__ };
    },
    listWorkouts: (includeArchived = false) => run('readonly', { workouts: true }, household => household.listWorkouts(includeArchived)),
    getWorkout: (id: string) => run('readonly', { workouts: true }, household => household.getWorkout(id) ?? notFound(`Workout "${id}"`)),
    putWorkout: async (document: Workout, ifMatch?: number) => {
      const workout = local(() => workoutDocument(document));
      return run('readwrite', { workouts: true }, household => { const result = household.putWorkout(workout, ifMatch); return { id: workout.id, revision: result.revision, updatedAt: result.updatedAt, created: result.created }; });
    },
    archiveWorkout: (id: string, ifMatch?: number) => run('readwrite', { workouts: true }, household => household.archiveWorkout(id, ifMatch)),
    getMasterData: () => run('readonly', { master: true }, household => household.getMasterData()),
    putMasterData: async (document: MasterData, ifMatch: number) => {
      local(() => check('masterData', document, 'master data'));
      return run('readwrite', { master: true }, household => household.putMasterData(sanitiseMasterData(document), ifMatch));
    },
    listSessions: (query: { limit?: number; before?: string; workoutId?: string } = {}) => {
      const list = { limit: sessionPageSize(query.limit), ...(query.before ? { before: query.before } : {}), ...(query.workoutId ? { workoutId: query.workoutId } : {}) };
      return run('readonly', { sessions: { list } }, household => household.listSessions(list));
    },
    getSession: (id: string): Promise<StoredSession> => run('readonly', { sessions: { id } }, household => household.getSession(id) ?? notFound(`Session "${id}"`)),
    putSession: async (record: SessionRecord) => {
      const workout = local(() => {
        check('session', record, 'session');
        if (!record.workout) throw new HouseholdError(400, 'VALIDATION_FAILED', 'A session must carry the workout as played.', '/workout');
        return workoutDocument(record.workout);
      });
      return run('readwrite', { sessions: 'keys', deleted: true }, household => ({ id: record.id, stored: household.putSession({ ...record, workout }) }));
    },
    deleteSession: (id: string) => run('readwrite', { sessions: 'keys', deleted: true }, household => { household.deleteSession(id); }),
    correctSession: async (id: string, results: SectionResult[], note: string | undefined, ifMatch: number) => {
      local(() => check('correction', { results, ...(note ? { note } : {}) }, 'correction'));
      return run('readwrite', { sessions: { id } }, household => household.correctSession(id, results, note, ifMatch));
    },
    importDevice: async (payload: DeviceImportPayload) => {
      const { workouts, sessions, masterData } = local(() => ({ workouts: payload.workouts.map(workoutDocument), sessions: deviceSessions(payload), masterData: sanitiseMasterData(payload.masterData) }));
      return run('readwrite', { ...all, sessions: 'keys', deleted: true }, household => household.importDevice({ deviceId: payload.deviceId, workouts, masterData, sessions }));
    },
    importPack: async (payload: PackImportPayload) => {
      const workouts = local(() => payload.workouts.map(workoutDocument));
      return run('readwrite', all, household => household.importPack({ workouts, collections: payload.collections, decisions: payload.decisions }));
    },
    exportAll: () => run('readonly', { ...all, sessions: 'all' }, household => household.exportAll(IDB_VERSION)),
    restore: async (value: unknown) => {
      const document = local(() => parseExportDocument(value));
      return run('readwrite', { deleted: true }, household => household.restore(document, { sessionLimit }));
    },
    counts: (): Promise<BackendCounts> => run('readonly', { workouts: true, sessions: 'keys' }, (household, tables) => {
      const workouts = household.listWorkouts(true);
      const archived = workouts.filter(item => item.archivedAt).length;
      return { workouts: workouts.length - archived, archived, sessions: tables.sessionIds?.size ?? 0 };
    }),
  } satisfies Backend;
}

function notFound(what: string): never { throw new NotFoundError(what); }

/** The static shape's household (backend.ts picks it when DATA_MODE is 'static'). */
export const localBackend = /* @__PURE__ */ createLocalBackend();
