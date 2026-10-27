import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import type { Workout } from '../../packages/domain/src/schema';
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
    expect(memory.migration).toEqual({ from: 0, to: 3 });
    expect(memory.store.schemaVersion).toBe(3);
    memory.store.close();

    const path = join(scratch, 'app.sqlite');
    const first = await Store.open(path, { appVersion: 'test' });
    expect(first.migration).toEqual({ from: 0, to: 3 });
    first.store.close();
    const again = await Store.open(path);
    expect(again.migration).toEqual({ from: 3, to: 3 });
    again.store.close();

    MIGRATIONS.push({ version: 4, name: 'test only', up: 'CREATE TABLE test_only (x INTEGER)' });
    try {
      const upgraded = await Store.open(path, { backupDir: join(scratch, 'backups') });
      expect(upgraded.migration.from).toBe(3);
      expect(upgraded.migration.to).toBe(4);
      expect(readdirSync(join(scratch, 'backups')).some(name => name.startsWith('pre-migration-v3-to-v4-'))).toBe(true);
      upgraded.store.close();
    } finally { MIGRATIONS.pop(); }
    await expect(Store.open(path)).rejects.toBeInstanceOf(SchemaNewerError);
  });
});

describe('store: migration 3 (deleted sessions)', () => {
  it('adds the tombstone table to a version-2 database, backs it up first, and keeps its sessions', async () => {
    const path = join(scratch, 'v2.sqlite');
    // A version-2 file: written by this build, then the third migration taken back out.
    const seeded = await Store.open(path);
    seeded.store.putSession(playedSession('s1', bundledWorkout('fran')));
    seeded.store.putSession(playedSession('s2', bundledWorkout('cindy')));
    seeded.store.db.exec('DROP TABLE deleted_sessions; DELETE FROM schema_migrations WHERE version = 3;');
    expect(seeded.store.schemaVersion).toBe(2);
    seeded.store.close();
    const { store, migration } = await Store.open(path, { backupDir: join(scratch, 'v2-backups') });
    try {
      expect(migration).toMatchObject({ from: 2, to: 3, backup: expect.stringMatching(/pre-migration-v2-to-v3-.+\.sqlite$/) });
      expect(readdirSync(join(scratch, 'v2-backups')).filter(name => name.startsWith('pre-migration-v2-to-v3-'))).toHaveLength(1);
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
      expect(exported.schemaVersion).toBe(3);
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
