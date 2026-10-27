import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import type { Workout } from '../../packages/domain/src/schema';
import { ApiError } from '../../apps/web/src/data/client';
import { closeIdb, idbGet, IDB_NAME, IDB_VERSION, openDatabase } from '../../apps/web/src/data/idb';
import { createLocalBackend } from '../../apps/web/src/data/local-backend';
import { classifyFailure } from '../../apps/web/src/data/outbox';
import { describeHouseholdSemantics, type HouseholdApi } from './helpers/household-suite';
import { playedSession } from './helpers/session';

type LocalBackend = ReturnType<typeof createLocalBackend>;
const own = (id: string, revision = 1): Workout => ({ ...bundledWorkout('fran'), id, revision, title: `Own ${id}`, sharing: undefined });
const missing = (error: unknown) => { if (error instanceof ApiError && error.status === 404) return undefined; throw error; };

/** The backend behind the suite's API: the same calls, with "not found" as undefined and the session store result unwrapped. */
const asHousehold = (backend: LocalBackend): HouseholdApi => ({
  listWorkouts: includeArchived => backend.listWorkouts(includeArchived),
  getWorkout: id => backend.getWorkout(id).catch(missing),
  putWorkout: (document, expectedRevision) => backend.putWorkout(document, expectedRevision),
  archiveWorkout: (id, expectedRevision) => backend.archiveWorkout(id, expectedRevision),
  getMasterData: () => backend.getMasterData(),
  putMasterData: (document, expectedRevision) => backend.putMasterData(document, expectedRevision ?? 0),
  putSession: record => backend.putSession(record).then(result => result.stored),
  listSessions: query => backend.listSessions(query),
  getSession: id => backend.getSession(id).catch(missing),
  correctSession: (id, results, note, expectedRevision) => backend.correctSession(id, results, note, expectedRevision ?? 0),
  // The backend answers like the server's 204; whether a row was there is read before.
  deleteSession: async id => { const had = await backend.getSession(id).then(() => true, missing).then(Boolean); await backend.deleteSession(id); return had ? 'deleted' : 'absent'; },
  importDevice: payload => backend.importDevice(payload),
  importPack: payload => backend.importPack(payload),
  exportAll: () => backend.exportAll(),
  restore: document => backend.restore(document),
});

// Every household gets its own database, so the suite can hold two at once (restore from one into another).
describeHouseholdSemantics('local backend', async () => {
  const opened = openDatabase(new IDBFactory());
  const backend = createLocalBackend({ database: () => opened });
  return { household: asHousehold(backend), close: async () => (await opened).close() };
});

/** Played sessions with distinct finishing times, a minute apart from `start`, alternating Fran and Cindy. */
function sessions(count: number, start = Date.parse('2026-01-01T00:00:00.000Z')) {
  const fran = playedSession('base-fran', bundledWorkout('fran'));
  const cindy = playedSession('base-cindy', bundledWorkout('cindy'));
  return Array.from({ length: count }, (_, index) => ({ ...(index % 2 ? cindy : fran), id: `s${String(index).padStart(3, '0')}`, finishedAt: new Date(start + index * 60_000).toISOString() }));
}

describe('local backend: IndexedDB specifics', () => {
  beforeEach(async () => { await closeIdb(); globalThis.indexedDB = new IDBFactory(); });
  afterEach(() => closeIdb());

  it('pages sessions newest first with the clamped size, before and the workout filter', async () => {
    const backend = createLocalBackend();
    const all = sessions(120);
    for (const record of all) await backend.putSession(record);
    const newest = all.map(item => item.id).reverse();
    const first = await backend.listSessions();
    expect(first.map(item => item.id)).toEqual(newest.slice(0, 50));
    expect(first[0]).not.toHaveProperty('events');
    expect(first[0]).not.toHaveProperty('workout');
    expect(first[0]).not.toHaveProperty('corrections');
    const second = await backend.listSessions({ before: first[49].finishedAt });
    expect(second.map(item => item.id)).toEqual(newest.slice(50, 100));
    expect((await backend.listSessions({ before: second[49].finishedAt })).map(item => item.id)).toEqual(newest.slice(100));
    expect(await backend.listSessions({ limit: 500 })).toHaveLength(120);
    expect(await backend.listSessions({ limit: 0 })).toHaveLength(1);
    const cindy = newest.filter(id => Number(id.slice(1)) % 2 === 1);
    const byWorkout = await backend.listSessions({ workoutId: 'cindy', limit: 10 });
    expect(byWorkout.map(item => item.id)).toEqual(cindy.slice(0, 10));
    expect((await backend.listSessions({ workoutId: 'cindy', limit: 10, before: byWorkout[9].finishedAt })).map(item => item.id)).toEqual(cindy.slice(10, 20));
    expect(await backend.listSessions({ workoutId: 'nothing' })).toEqual([]);
    expect(await backend.counts()).toEqual({ workouts: 0, archived: 0, sessions: 120 });
  });

  it('orders sessions that finished at the same time by id, as the server does', async () => {
    const backend = createLocalBackend();
    const [a, b, c] = sessions(3).map(item => ({ ...item, finishedAt: '2026-02-01T00:00:00.000Z' }));
    for (const record of [c, a, b]) await backend.putSession(record);
    expect((await backend.listSessions({ limit: 2 })).map(item => item.id)).toEqual([a.id, b.id]);
  });

  it('prunes the oldest sessions beyond the limit on every write and on restore', async () => {
    const backend = createLocalBackend({ sessionLimit: 3 });
    const all = sessions(5);
    for (const record of [all[2], all[0], all[3], all[1]]) await backend.putSession(record);
    expect((await backend.listSessions()).map(item => item.id)).toEqual([all[3].id, all[2].id, all[1].id]);
    await expect(backend.getSession(all[0].id)).rejects.toMatchObject({ status: 404 });
    await backend.putSession(all[4]);
    expect((await backend.listSessions()).map(item => item.id)).toEqual([all[4].id, all[3].id, all[2].id]);
    // An older session than all kept ones is stored and pruned at once.
    expect((await backend.putSession(all[0])).stored).toBe('created');
    expect(await backend.counts()).toMatchObject({ sessions: 3 });

    const elsewhere = openDatabase(new IDBFactory());
    const unlimited = createLocalBackend({ database: () => elsewhere });
    for (const record of all) await unlimited.putSession(record);
    const report = await backend.restore(await unlimited.exportAll());
    expect(report).toMatchObject({ sessions: 3, pruned: 2 });
    expect((await backend.listSessions()).map(item => item.id)).toEqual([all[4].id, all[3].id, all[2].id]);
    (await elsewhere).close();
  });

  it('raises a revision conflict as the client ApiError with the current document, which the outbox classifies as a conflict', async () => {
    const backend = createLocalBackend();
    await backend.putWorkout(own('a'), 0);
    const error = await backend.putWorkout(own('a'), 0).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'REVISION_CONFLICT', payload: { current: { revision: 1, document: { id: 'a' } } } });
    expect(classifyFailure(error)).toBe('conflict');
    const invalid = await backend.putWorkout({ ...own('b'), title: '' }, 0).catch((caught: unknown) => caught);
    expect(invalid).toBeInstanceOf(ApiError);
    expect(invalid).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(classifyFailure(invalid)).toBe('rejected');
    expect((await backend.listWorkouts()).map(item => item.id)).toEqual(['a']);
  });

  it('writes nothing of an import that fails halfway', async () => {
    const backend = createLocalBackend();
    const failure = backend.importPack({ workouts: [bundledWorkout('fran'), bundledWorkout('cindy')], collections: [{ title: 'Girls', workoutIds: ['fran', 'cindy'] }], decisions: { cindy: { action: 'replace', id: 'missing', expectedRevision: 1 } } });
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 404 });
    expect(await backend.listWorkouts(true)).toEqual([]);
    expect((await backend.getMasterData()).revision).toBe(0);
    const report = await backend.importPack({ workouts: [bundledWorkout('fran')], collections: [], decisions: {} });
    expect(report.created).toEqual([{ from: 'fran', to: 'fran-2' }]);
  });

  it('upgrades a version-2 database to version 3 with the tombstone store and keeps its sessions (DAT-14)', async () => {
    const stored = { ...playedSession('kept', bundledWorkout('fran')), revision: 1, receivedAt: '2026-10-26T10:30:00.000Z', corrections: [] };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(IDB_NAME, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const [name, keyPath] of [['checkpoints', 'sessionId'], ['progress', 'sessionId'], ['outbox', 'id'], ['cache', 'key'], ['meta', 'key'], ['workouts', 'id'], ['master', 'id']] as const) db.createObjectStore(name, { keyPath });
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('byFinished', 'finishedAt');
        sessions.createIndex('byWorkout', ['workoutId', 'finishedAt']);
        sessions.put(stored);
      };
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
    const backend = createLocalBackend();
    expect((await backend.listSessions()).map(item => item.id)).toEqual(['kept']);
    await backend.deleteSession('kept');
    expect(await backend.putSession(playedSession('kept', bundledWorkout('fran')))).toEqual({ id: 'kept', stored: 'existing' });
    expect(await backend.listSessions()).toEqual([]);
    expect(await backend.counts()).toMatchObject({ sessions: 0 });
    await closeIdb();
    const db = await openDatabase(indexedDB);
    expect(db.version).toBe(3);
    expect(await new Promise(resolve => { const request = db.transaction('deletedSessions').objectStore('deletedSessions').getAll(); request.onsuccess = () => resolve(request.result); })).toEqual([{ id: 'kept', deletedAt: expect.stringMatching(/^\d{4}-/) }]);
    db.close();
  });

  it('upgrades a version-1 database to the current version and keeps its rows', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('checkpoints', { keyPath: 'sessionId' }).createIndex('byWorkout', 'workoutId');
        db.createObjectStore('progress', { keyPath: 'sessionId' });
        db.createObjectStore('outbox', { keyPath: 'id' }).createIndex('byState', 'state');
        db.createObjectStore('cache', { keyPath: 'key' });
        db.createObjectStore('meta', { keyPath: 'key' });
        request.transaction!.objectStore('checkpoints').put({ sessionId: 'running', workoutId: 'fran', status: 'running' });
        request.transaction!.objectStore('meta').put({ key: 'migration', value: 'done' });
      };
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
    expect(await idbGet('checkpoints', 'running')).toMatchObject({ workoutId: 'fran' });
    expect(await idbGet('meta', 'migration')).toMatchObject({ value: 'done' });
    const backend = createLocalBackend();
    await backend.putWorkout(own('a'), 0);
    expect((await backend.listWorkouts()).map(item => item.id)).toEqual(['a']);
    await closeIdb();
    const db = await openDatabase(indexedDB);
    expect(db.version).toBe(IDB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(['cache', 'checkpoints', 'deletedSessions', 'master', 'meta', 'outbox', 'progress', 'sessions', 'workouts']);
    expect([...db.transaction('sessions').objectStore('sessions').indexNames].sort()).toEqual(['byFinished', 'byWorkout']);
    db.close();
  });

  it('reports itself ready with its storage version and the version of this build', async () => {
    const local = createLocalBackend();
    expect(await local.ready()).toMatchObject({ status: 'ok', persistence: true, schemaVersion: IDB_VERSION, version: expect.any(String) });
    // A backup names the storage schema of the backend that wrote it, the same number Settings shows.
    expect(await local.exportAll()).toMatchObject({ formatVersion: 1, schemaVersion: IDB_VERSION });
  });
});
