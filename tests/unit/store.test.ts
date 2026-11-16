import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import type { Workout } from '../../packages/domain/src/schema';
import type { LiveCheckpoint, LiveProgress } from '../../packages/household/src/types';
import { describeHouseholdSemantics, type HouseholdApi } from './helpers/household-suite';
import { playedSession } from './helpers/session';
import { MIGRATIONS, SchemaNewerError } from '../../apps/server/src/db';
import { ApiError } from '../../apps/server/src/errors';
import { Store } from '../../apps/server/src/store';

const scratch = mkdtempSync(join(tmpdir(), 'openwod-store-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const own = (id: string, revision = 1): Workout => ({ ...bundledWorkout('fran'), id, revision, title: `Own ${id}`, sharing: undefined });
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The synchronous Store behind the suite's asynchronous API: a throw becomes a rejection. */
const METHODS = ['listWorkouts', 'getWorkout', 'putWorkout', 'archiveWorkout', 'getMasterData', 'putMasterData', 'putSession', 'listSessions', 'getSession', 'correctSession', 'deleteSession', 'importDevice', 'importPack', 'exportAll', 'restore'] as const;
const asAsync = (store: Store): HouseholdApi => Object.fromEntries(METHODS.map(name => [name, async (...args: unknown[]) => (store[name] as (...values: unknown[]) => unknown).apply(store, args)])) as unknown as HouseholdApi;

describeHouseholdSemantics('store', async () => {
  const { store } = await Store.open(':memory:');
  return { household: asAsync(store), close: () => store.close() };
});

describe('store: migrations', () => {
  it('creates the schema in memory and on disk, refuses a newer schema, and backs up before migrating an existing file', async () => {
    const memory = await Store.open(':memory:');
    expect(memory.migration).toEqual({ from: 0, to: 4 });
    expect(memory.store.schemaVersion).toBe(4);
    memory.store.close();

    const path = join(scratch, 'app.sqlite');
    const first = await Store.open(path, { appVersion: 'test' });
    expect(first.migration).toEqual({ from: 0, to: 4 });
    first.store.close();
    const again = await Store.open(path);
    expect(again.migration).toEqual({ from: 4, to: 4 });
    again.store.close();

    MIGRATIONS.push({ version: 5, name: 'test only', up: 'CREATE TABLE test_only (x INTEGER)' });
    try {
      const upgraded = await Store.open(path, { backupDir: join(scratch, 'backups') });
      expect(upgraded.migration.from).toBe(4);
      expect(upgraded.migration.to).toBe(5);
      expect(readdirSync(join(scratch, 'backups')).some(name => name.startsWith('pre-migration-v4-to-v5-'))).toBe(true);
      upgraded.store.close();
    } finally { MIGRATIONS.pop(); }
    await expect(Store.open(path)).rejects.toBeInstanceOf(SchemaNewerError);
  });
});

describe('store: migration 3 (deleted sessions)', () => {
  it('adds the tombstone table to a version-2 database, backs it up first, and keeps its sessions', async () => {
    const path = join(scratch, 'v2.sqlite');
    // A version-2 file: written by this build, then the migrations after the second taken back out.
    const seeded = await Store.open(path);
    seeded.store.putSession(playedSession('s1', bundledWorkout('fran')));
    seeded.store.putSession(playedSession('s2', bundledWorkout('cindy')));
    seeded.store.db.exec('DROP TABLE live_sessions; DROP TABLE deleted_sessions; DELETE FROM schema_migrations WHERE version >= 3;');
    expect(seeded.store.schemaVersion).toBe(2);
    seeded.store.close();
    const { store, migration } = await Store.open(path, { backupDir: join(scratch, 'v2-backups') });
    try {
      expect(migration).toMatchObject({ from: 2, to: 4, backup: expect.stringMatching(/pre-migration-v2-to-v4-.+\.sqlite$/) });
      expect(readdirSync(join(scratch, 'v2-backups')).filter(name => name.startsWith('pre-migration-v2-to-v4-'))).toHaveLength(1);
      expect(store.listSessions().map(item => item.id).sort()).toEqual(['s1', 's2']);
      expect(store.deleteSession('s1')).toBe('deleted');
      expect(store.putSession(playedSession('s1', bundledWorkout('fran')))).toBe('existing');
      expect(store.listSessions().map(item => item.id)).toEqual(['s2']);
    } finally { store.close(); }
  });

  it('removes the correction rows with the session and keeps the tombstone through a restore', async () => {
    const { store } = await Store.open(':memory:');
    try {
      const session = playedSession('s1', bundledWorkout('fran'));
      store.putSession(session);
      store.correctSession('s1', session.results, 'one', 1);
      store.correctSession('s1', session.results, 'two', 2);
      const count = (table: string) => (store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      expect(count('session_corrections')).toBe(2);
      store.deleteSession('s1');
      expect(count('session_corrections')).toBe(0);
      expect(count('sessions')).toBe(0);
      expect(store.db.prepare('SELECT id, deleted_at FROM deleted_sessions').all()).toEqual([{ id: 's1', deleted_at: expect.stringMatching(/^\d{4}-/) }]);
      store.deleteSession('s1');
      expect(count('deleted_sessions')).toBe(1);
      await store.restore(store.exportAll());
      expect(count('deleted_sessions')).toBe(1);
    } finally { store.close(); }
  });
});

/** A checkpoint as a player sends it. The snapshot is opaque to the store, which only reads its active time for the list. */
const checkpointOf = (sessionId: string, revision: number, savedAt: string, change: Partial<LiveCheckpoint> = {}): LiveCheckpoint => ({
  sessionId, workoutId: 'fran', workoutRevision: 1, workout: bundledWorkout('fran'), snapshot: { revision, activeMs: revision * 1000 } as LiveCheckpoint['snapshot'], revision, status: 'running', savedAt, ...change,
});
const progressOf = (sessionId: string, checkpointRevision: number, savedAt: string, activeMs = 5000): LiveProgress => ({ sessionId, checkpointRevision, phaseMs: activeMs, activeMs, sectionMs: activeMs, savedAt });
const IPAD = { deviceId: 'device-ipad', deviceLabel: 'iPad · home screen' };
const MAC = { deviceId: 'device-mac', deviceLabel: 'Mac · Safari' };
/** Seconds after ten o'clock, as the ISO stamps the devices and the server write. */
const at = (seconds: number) => new Date(Date.parse('2026-11-16T10:00:00.000Z') + seconds * 1000).toISOString();
const thrown = (fn: () => unknown): unknown => { try { fn(); } catch (error) { return error; } return undefined; };
/** A store whose clock the test moves. */
async function liveStore() {
  const clock = { seconds: 0 };
  const { store } = await Store.open(':memory:', { now: () => new Date(at(clock.seconds)) });
  return { store, clock, rows: () => (store.db.prepare('SELECT COUNT(*) AS n FROM live_sessions').get() as { n: number }).n };
}

describe('store: migration 4 (live sessions)', () => {
  it('adds the live-session table to a version-3 database, backs it up first, and keeps its sessions', async () => {
    const path = join(scratch, 'v3.sqlite');
    // A version-3 file: written by this build, then the fourth migration taken back out.
    const seeded = await Store.open(path);
    seeded.store.putSession(playedSession('s1', bundledWorkout('fran')));
    seeded.store.deleteSession('gone');
    seeded.store.db.exec('DROP TABLE live_sessions; DELETE FROM schema_migrations WHERE version = 4;');
    expect(seeded.store.schemaVersion).toBe(3);
    seeded.store.close();
    const { store, migration } = await Store.open(path, { backupDir: join(scratch, 'v3-backups') });
    try {
      expect(migration).toMatchObject({ from: 3, to: 4, backup: expect.stringMatching(/pre-migration-v3-to-v4-.+\.sqlite$/) });
      expect(readdirSync(join(scratch, 'v3-backups')).filter(name => name.startsWith('pre-migration-v3-to-v4-'))).toHaveLength(1);
      expect(store.listSessions().map(item => item.id)).toEqual(['s1']);
      expect(store.putSession(playedSession('gone', bundledWorkout('fran')))).toBe('existing');
      expect(store.listLiveSessions().sessions).toEqual([]);
      expect(store.putLiveSession('live', { ...IPAD, checkpoint: checkpointOf('live', 1, at(0)) })).toMatchObject({ created: true, generation: 1 });
      expect(store.listLiveSessions().sessions.map(item => item.id)).toEqual(['live']);
    } finally { store.close(); }
  });
});

describe('store: live sessions (ENG-15)', () => {
  it('creates the row for the first device, lists it without the bodies, and takes writes from that device only', async () => {
    const { store, clock } = await liveStore();
    try {
      expect(store.listLiveSessions()).toEqual({ now: at(0), sessions: [] });
      expect(store.getLiveSession('s1')).toBeUndefined();
      expect(thrown(() => store.putLiveSession('s1', { ...IPAD, progress: progressOf('s1', 3, at(0)) }))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
      expect(store.putLiveSession('s1', { ...IPAD, checkpoint: checkpointOf('s1', 3, at(0)) })).toEqual({ id: 's1', generation: 1, revision: 3, savedAt: at(0), created: true });
      clock.seconds = 4;
      const item = { id: 's1', workoutId: 'fran', title: 'Fran', status: 'running', activeMs: 3000, deviceId: 'device-ipad', deviceLabel: 'iPad · home screen', generation: 1, revision: 3, savedAt: at(0), updatedAt: at(0) };
      expect(store.listLiveSessions()).toEqual({ now: at(4), sessions: [item] });
      expect(store.getLiveSession('s1')).toEqual({ ...item, checkpoint: checkpointOf('s1', 3, at(0)) });
      const refused = thrown(() => store.putLiveSession('s1', { ...MAC, checkpoint: checkpointOf('s1', 4, at(4)) }));
      expect(refused).toBeInstanceOf(ApiError);
      expect(refused).toMatchObject({ status: 409, code: 'SESSION_TAKEN_OVER', extra: { controller: { deviceId: 'device-ipad', deviceLabel: 'iPad · home screen', generation: 1 } } });
      expect(thrown(() => store.putLiveSession('s1', { ...MAC, progress: progressOf('s1', 3, at(4)) }))).toMatchObject({ code: 'SESSION_TAKEN_OVER' });
      expect(store.getLiveSession('s1')).toEqual({ ...item, checkpoint: checkpointOf('s1', 3, at(0)) });
      // The controller's next write is taken, with its label of the moment and the server's time.
      expect(store.putLiveSession('s1', { deviceId: 'device-ipad', deviceLabel: 'iPad · Safari', checkpoint: checkpointOf('s1', 4, at(4), { status: 'paused' }) })).toEqual({ id: 's1', generation: 1, revision: 4, savedAt: at(4), created: false });
      expect(store.listLiveSessions().sessions).toEqual([{ ...item, status: 'paused', activeMs: 4000, deviceLabel: 'iPad · Safari', revision: 4, savedAt: at(4), updatedAt: at(4) }]);
      // Newest first by the server's time.
      clock.seconds = 6;
      store.putLiveSession('s2', { ...MAC, checkpoint: checkpointOf('s2', 1, at(6), { workout: bundledWorkout('cindy'), workoutId: 'cindy' }) });
      expect(store.listLiveSessions().sessions.map(entry => [entry.id, entry.title, entry.deviceLabel])).toEqual([['s2', 'Cindy', 'Mac · Safari'], ['s1', 'Fran', 'iPad · Safari']]);
    } finally { store.close(); }
  });

  it('ignores a checkpoint saved before the stored one and keeps a progress record only for the stored revision', async () => {
    const { store } = await liveStore();
    const stored = () => store.getLiveSession('s1')!;
    try {
      store.putLiveSession('s1', { ...IPAD, checkpoint: checkpointOf('s1', 3, at(10)), progress: progressOf('s1', 3, at(12), 5000) });
      expect(stored()).toMatchObject({ revision: 3, activeMs: 5000, progress: { checkpointRevision: 3, savedAt: at(12) } });
      // A record for another revision, or an older one for this revision, changes nothing.
      store.putLiveSession('s1', { ...IPAD, progress: progressOf('s1', 2, at(13), 9000) });
      store.putLiveSession('s1', { ...IPAD, progress: progressOf('s1', 4, at(13), 9000) });
      store.putLiveSession('s1', { ...IPAD, progress: progressOf('s1', 3, at(11), 4000) });
      expect(stored()).toMatchObject({ activeMs: 5000, progress: { savedAt: at(12), activeMs: 5000 } });
      store.putLiveSession('s1', { ...IPAD, progress: progressOf('s1', 3, at(14), 7000) });
      expect(stored()).toMatchObject({ activeMs: 7000, progress: { savedAt: at(14), activeMs: 7000 } });
      // A late arrival of an earlier checkpoint is acknowledged with what is stored, and its progress record is not combined with it.
      expect(store.putLiveSession('s1', { ...IPAD, checkpoint: checkpointOf('s1', 2, at(5)), progress: progressOf('s1', 2, at(6)) })).toEqual({ id: 's1', generation: 1, revision: 3, savedAt: at(10), created: false });
      expect(stored()).toMatchObject({ revision: 3, savedAt: at(10), checkpoint: { revision: 3 }, progress: { checkpointRevision: 3, savedAt: at(14) } });
      // A higher revision counts even with an earlier time: after a hand-over the new device's clock may be behind.
      expect(store.putLiveSession('s1', { ...IPAD, checkpoint: checkpointOf('s1', 4, at(8)) })).toMatchObject({ revision: 4, savedAt: at(8) });
      expect(stored()).toMatchObject({ revision: 4, savedAt: at(8), activeMs: 4000, checkpoint: { revision: 4 } });
      expect(stored()).not.toHaveProperty('progress');
      // A newer checkpoint replaces the stored one and drops the record that extended it.
      store.putLiveSession('s1', { ...IPAD, checkpoint: checkpointOf('s1', 5, at(20)), progress: progressOf('s1', 5, at(21), 6000) });
      expect(stored()).toMatchObject({ revision: 5, progress: { checkpointRevision: 5 } });
      store.putLiveSession('s1', { ...IPAD, checkpoint: checkpointOf('s1', 6, at(25)), progress: progressOf('s1', 5, at(26), 8000) });
      expect(stored()).toMatchObject({ revision: 6, activeMs: 6000 });
      expect(stored()).not.toHaveProperty('progress');
    } finally { store.close(); }
  });

  it('hands the session to a claiming device with its bodies and one generation up, and tells the old one who has it', async () => {
    const { store, clock } = await liveStore();
    try {
      expect(thrown(() => store.claimLiveSession('s1', MAC))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
      store.putLiveSession('s1', { ...IPAD, checkpoint: checkpointOf('s1', 3, at(0)), progress: progressOf('s1', 3, at(2)) });
      clock.seconds = 30;
      const claimed = store.claimLiveSession('s1', MAC);
      expect(claimed).toEqual({
        id: 's1', workoutId: 'fran', title: 'Fran', status: 'running', activeMs: 5000, deviceId: 'device-mac', deviceLabel: 'Mac · Safari', generation: 2, revision: 3, savedAt: at(0), updatedAt: at(30),
        checkpoint: checkpointOf('s1', 3, at(0)), progress: progressOf('s1', 3, at(2)),
      });
      // A repeated claim by the controller changes nothing.
      expect(store.claimLiveSession('s1', MAC)).toMatchObject({ deviceId: 'device-mac', generation: 2 });
      expect(thrown(() => store.putLiveSession('s1', { ...IPAD, checkpoint: checkpointOf('s1', 4, at(31)) }))).toMatchObject({ status: 409, code: 'SESSION_TAKEN_OVER', extra: { controller: { deviceId: 'device-mac', deviceLabel: 'Mac · Safari', generation: 2 } } });
      expect(store.putLiveSession('s1', { ...MAC, checkpoint: checkpointOf('s1', 4, at(32)) })).toMatchObject({ generation: 2, revision: 4, created: false });
      // Taking it back is one more hand-over.
      expect(store.claimLiveSession('s1', IPAD)).toMatchObject({ deviceId: 'device-ipad', generation: 3, checkpoint: { revision: 4 } });
      expect(thrown(() => store.putLiveSession('s1', { ...MAC, progress: progressOf('s1', 4, at(33)) }))).toMatchObject({ code: 'SESSION_TAKEN_OVER', extra: { controller: { generation: 3 } } });
    } finally { store.close(); }
  });

  it('ends the live row with the finished session and takes no checkpoint of a finished or deleted id', async () => {
    const { store, rows } = await liveStore();
    try {
      store.putLiveSession('s1', { ...IPAD, checkpoint: checkpointOf('s1', 3, at(0)) });
      expect(store.putSession(playedSession('s1', bundledWorkout('fran'), 'device-ipad'))).toBe('created');
      expect(rows()).toBe(0);
      expect(thrown(() => store.putLiveSession('s1', { ...IPAD, checkpoint: checkpointOf('s1', 4, at(5)) }))).toMatchObject({ status: 409, code: 'SESSION_FINISHED' });
      expect(thrown(() => store.putLiveSession('s1', { ...IPAD, progress: progressOf('s1', 3, at(5)) }))).toMatchObject({ status: 409, code: 'SESSION_FINISHED' });
      expect(thrown(() => store.claimLiveSession('s1', MAC))).toMatchObject({ status: 409, code: 'SESSION_FINISHED' });
      expect(rows()).toBe(0);
      // Deleting a session, stored or not, ends its live row and leaves the tombstone that refuses later checkpoints.
      store.putLiveSession('s2', { ...IPAD, checkpoint: checkpointOf('s2', 1, at(0)) });
      expect(store.deleteSession('s2')).toBe('absent');
      expect(rows()).toBe(0);
      expect(thrown(() => store.putLiveSession('s2', { ...IPAD, checkpoint: checkpointOf('s2', 2, at(5)) }))).toMatchObject({ status: 409, code: 'SESSION_FINISHED' });
      // A session that never had a live row (played offline) is stored as ever.
      expect(store.putSession(playedSession('s3', bundledWorkout('fran'), 'device-ipad'))).toBe('created');
    } finally { store.close(); }
  });

  it('acknowledges the final record of a device that was taken over without storing it, so one result is kept', async () => {
    const { store, rows } = await liveStore();
    try {
      store.putLiveSession('s1', { ...IPAD, checkpoint: checkpointOf('s1', 3, at(0)) });
      store.claimLiveSession('s1', MAC);
      expect(store.putSession({ ...playedSession('s1', bundledWorkout('fran'), 'device-ipad'), outcome: 'aborted' })).toBe('existing');
      expect(store.getSession('s1')).toBeUndefined();
      expect(store.listSessions()).toEqual([]);
      expect(store.getLiveSession('s1')).toMatchObject({ deviceId: 'device-mac', generation: 2 });
      expect(store.putSession(playedSession('s1', bundledWorkout('fran'), 'device-mac'))).toBe('created');
      expect(rows()).toBe(0);
      expect(store.putSession({ ...playedSession('s1', bundledWorkout('fran'), 'device-ipad'), outcome: 'aborted' })).toBe('existing');
      expect(store.listSessions().map(item => [item.id, item.deviceId, item.outcome])).toEqual([['s1', 'device-mac', 'completed']]);
    } finally { store.close(); }
  });

  it('forgets a live session twelve hours after its device last wrote, on the next read', async () => {
    const { store, clock, rows } = await liveStore();
    const hours = (count: number) => count * 3600;
    try {
      store.putLiveSession('s1', { ...IPAD, checkpoint: checkpointOf('s1', 3, at(0)) });
      store.putLiveSession('s2', { ...MAC, checkpoint: checkpointOf('s2', 1, at(0)) });
      clock.seconds = hours(11);
      store.putLiveSession('s2', { ...MAC, progress: progressOf('s2', 1, at(hours(11))) });
      clock.seconds = hours(12) - 1;
      expect(store.listLiveSessions().sessions.map(item => item.id)).toEqual(['s2', 's1']);
      clock.seconds = hours(12) + 1;
      expect(rows()).toBe(2);
      expect(store.listLiveSessions().sessions.map(item => item.id)).toEqual(['s2']);
      expect(rows()).toBe(1);
      expect(store.getLiveSession('s1')).toBeUndefined();
      expect(thrown(() => store.claimLiveSession('s1', MAC))).toMatchObject({ status: 404 });
      // Its device, back after a night, starts the row again with its next checkpoint and is nobody's stale copy.
      expect(store.putLiveSession('s1', { ...IPAD, checkpoint: checkpointOf('s1', 4, at(hours(12))) })).toMatchObject({ created: true, generation: 1 });
      clock.seconds = hours(23) + 2;
      expect(store.getLiveSession('s2')).toBeUndefined();
      expect(store.putSession(playedSession('s2', bundledWorkout('fran'), 'device-ipad'))).toBe('created');
      expect(store.listLiveSessions().sessions.map(item => item.id)).toEqual(['s1']);
    } finally { store.close(); }
  });

  it('discards idempotently, lets a session still running start its row again, and clears the table on a restore', async () => {
    const { store, rows } = await liveStore();
    try {
      store.deleteLiveSession('nothing');
      store.putLiveSession('s1', { ...IPAD, checkpoint: checkpointOf('s1', 3, at(0)) });
      // A device ending its own session removes the row only while it controls it.
      store.deleteLiveSession('s1', 'device-mac');
      expect(rows()).toBe(1);
      store.deleteLiveSession('s1', 'device-ipad');
      expect(rows()).toBe(0);
      store.putLiveSession('s1', { ...IPAD, checkpoint: checkpointOf('s1', 3, at(0)) });
      store.deleteLiveSession('s1');
      store.deleteLiveSession('s1');
      expect(rows()).toBe(0);
      expect(thrown(() => store.putLiveSession('s1', { ...IPAD, progress: progressOf('s1', 3, at(3)) }))).toMatchObject({ status: 404 });
      expect(store.putLiveSession('s1', { ...MAC, checkpoint: checkpointOf('s1', 3, at(0)) })).toMatchObject({ created: true, generation: 1 });
      store.putWorkout(own('a'), undefined);
      const exported = clean(store.exportAll());
      expect(exported).not.toHaveProperty('liveSessions');
      await store.restore(exported);
      expect(rows()).toBe(0);
      expect(store.listWorkouts().map(item => item.id)).toEqual(['a']);
    } finally { store.close(); }
  });
});

describe('store: SQLite specifics', () => {
  it('avoids stored and bundled ids, and raises the API error classes the server maps', async () => {
    const { store } = await Store.open(':memory:');
    try {
      store.putWorkout(own('a'), undefined);
      expect(store.takenIds().has('fran')).toBe(true);
      expect(store.takenIds().has('a')).toBe(true);
      expect(() => store.putWorkout(own('a', 3), 1)).toThrow(ApiError);
    } finally { store.close(); }
  });
});

describe('store: settings', () => {
  it('keeps one settings document for the household, where the last write wins, and keeps it through a restore', async () => {
    const { store } = await Store.open(':memory:');
    try {
      expect(store.getSettings()).toEqual({ revision: 0 });
      expect(store.putSettings({ theme: 'dark' }).revision).toBe(1);
      expect(store.putSettings({ theme: 'light' }).revision).toBe(2);
      expect(store.getSettings()).toMatchObject({ revision: 2, document: { theme: 'light' } });
      await store.restore(store.exportAll());
      expect(store.getSettings()).toMatchObject({ revision: 2, document: { theme: 'light' } });
    } finally { store.close(); }
  });
});

describe('store: export and backup', () => {
  it('exports everything as one labelled document and writes a consistent backup file', async () => {
    const { store } = await Store.open(':memory:');
    try {
      store.putWorkout(own('a'), undefined);
      store.putSession(playedSession('s1', bundledWorkout('fran')));
      const exported = store.exportAll();
      expect(exported.format).toBe('openwod.export');
      expect(exported.schemaVersion).toBe(4);
      expect(exported.workouts).toHaveLength(1);
      expect(exported.sessions[0].workout).toBeTruthy();
      const file = join(scratch, 'backup.sqlite');
      await store.backupTo(file);
      const copy = new DatabaseSync(file);
      expect((copy.prepare('SELECT COUNT(*) AS n FROM workouts').get() as { n: number }).n).toBe(1);
      expect((copy.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(1);
      copy.close();
    } finally { store.close(); }
  });

  it('restore writes pre-restore-*.sqlite with the old library before replacing it, and only for a valid backup', async () => {
    const dir = join(scratch, 'restore');
    const { store } = await Store.open(join(dir, 'app.sqlite'));
    try {
      store.putWorkout(own('old'), undefined);
      store.putSession(playedSession('s-old', bundledWorkout('fran')));
      const backups = () => readdirSync(join(dir, 'backups')).filter(name => name.startsWith('pre-restore-'));
      await expect(store.restore({ format: 'openwod.export', formatVersion: 99 })).rejects.toMatchObject({ status: 400, code: 'FORMAT_NEWER' });
      expect(() => backups()).toThrow();
      const { store: source } = await Store.open(':memory:');
      source.putWorkout(own('new'), undefined);
      const exported = clean(source.exportAll());
      source.close();
      const report = await store.restore(exported);
      expect(report).toMatchObject({ workouts: 1, archived: 0, sessions: 0, corrections: 0, masterRevision: 0 });
      expect(report.backup).toMatch(/[\\/]backups[\\/]pre-restore-.+\.sqlite$/);
      expect(backups()).toHaveLength(1);
      expect(store.listWorkouts().map(item => item.id)).toEqual(['new']);
      expect(store.listSessions()).toEqual([]);
      const copy = new DatabaseSync(report.backup!);
      expect(copy.prepare('SELECT id FROM workouts').all()).toEqual([{ id: 'old' }]);
      expect((copy.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(1);
      copy.close();
      const { store: memory } = await Store.open(':memory:');
      try { expect((await memory.restore(exported)).backup).toBeUndefined(); } finally { memory.close(); }
    } finally { store.close(); }
  });
});
