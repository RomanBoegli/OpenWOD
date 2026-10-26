import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { emptyMasterData } from '../../packages/domain/src/master-data';
import { normaliseForComparison } from '../../packages/domain/src/pack';
import type { Workout } from '../../packages/domain/src/schema';
import { playedSession } from './helpers/session';
import { MIGRATIONS, SchemaNewerError } from '../../apps/server/src/db';
import { ApiError, ConflictError } from '../../apps/server/src/errors';
import { Store } from '../../apps/server/src/store';

const scratch = mkdtempSync(join(tmpdir(), 'openwod-store-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const own = (id: string, revision = 1): Workout => ({ ...bundledWorkout('fran'), id, revision, title: `Own ${id}`, sharing: undefined });
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('store: migrations', () => {
  it('creates the schema in memory and on disk, refuses a newer schema, and backs up before migrating an existing file', async () => {
    const memory = await Store.open(':memory:');
    expect(memory.migration).toEqual({ from: 0, to: 1 });
    expect(memory.store.schemaVersion).toBe(1);
    memory.store.close();

    const path = join(scratch, 'app.sqlite');
    const first = await Store.open(path, { appVersion: 'test' });
    expect(first.migration).toEqual({ from: 0, to: 1 });
    first.store.close();
    const again = await Store.open(path);
    expect(again.migration).toEqual({ from: 1, to: 1 });
    again.store.close();

    MIGRATIONS.push({ version: 2, name: 'test only', up: 'CREATE TABLE test_only (x INTEGER)' });
    try {
      const upgraded = await Store.open(path, { backupDir: join(scratch, 'backups') });
      expect(upgraded.migration.from).toBe(1);
      expect(upgraded.migration.to).toBe(2);
      expect(readdirSync(join(scratch, 'backups')).some(name => name.startsWith('pre-migration-v1-to-v2-'))).toBe(true);
      upgraded.store.close();
    } finally { MIGRATIONS.pop(); }
    await expect(Store.open(path)).rejects.toBeInstanceOf(SchemaNewerError);
  });
});

describe('store: documents', () => {
  it('creates, updates with the expected revision, refuses stale or mismatched revisions, and archives', async () => {
    const { store } = await Store.open(':memory:');
    try {
      expect(store.putWorkout(own('a'), undefined)).toMatchObject({ created: true, revision: 1 });
      expect(() => store.putWorkout(own('a', 2), undefined)).toThrow(ConflictError);
      expect(() => store.putWorkout(own('a', 3), 1)).toThrow(ApiError);
      expect(store.putWorkout(own('a', 2), 1)).toMatchObject({ created: false, revision: 2 });
      expect(() => store.putWorkout(own('a', 3), 1)).toThrow(ConflictError);
      expect(store.getWorkout('a')?.document.revision).toBe(2);
      expect(store.takenIds().has('fran')).toBe(true);
      store.archiveWorkout('a', 2);
      expect(store.listWorkouts().map(item => item.id)).toEqual([]);
      expect(store.listWorkouts(true)[0]?.archivedAt).toBeTruthy();
      expect(() => store.archiveWorkout('missing')).toThrow(ApiError);
      expect(store.putWorkout(own('a', 3), 2).created).toBe(false);
      expect(store.getWorkout('a')?.archivedAt).toBeUndefined();
    } finally { store.close(); }
  });

  it('keeps one master-data document with a server-managed revision', async () => {
    const { store } = await Store.open(':memory:');
    try {
      expect(store.getMasterData()).toEqual({ revision: 0, document: emptyMasterData() });
      const data = { ...emptyMasterData(), equipmentAliases: { 'kettle bell': 'Kettlebell' } };
      expect(store.putMasterData(data, 0).revision).toBe(1);
      expect(() => store.putMasterData(data, 0)).toThrow(ConflictError);
      expect(store.putMasterData({ ...data, committed: ['equipment:kettle bell'] }, 1).revision).toBe(2);
      expect(store.getMasterData().document.committed).toEqual(['equipment:kettle bell']);
    } finally { store.close(); }
  });
});

describe('store: sessions', () => {
  it('stores a session once, lists without the heavy fields, and keeps score corrections with their history', async () => {
    const { store } = await Store.open(':memory:');
    try {
      const session = playedSession('s1', bundledWorkout('fran'));
      expect(store.putSession(session)).toBe('created');
      expect(store.putSession(session)).toBe('existing');
      const listed = store.listSessions();
      expect(listed).toHaveLength(1);
      expect(listed[0]).not.toHaveProperty('workout');
      expect(listed[0]).not.toHaveProperty('events');
      const full = store.getSession('s1')!;
      expect(full.workout?.id).toBe('fran');
      expect(full.events.length).toBeGreaterThan(5);
      expect(full.revision).toBe(1);
      const corrected = full.results.map(result => ({ ...result, sectionMs: result.sectionMs + 1000 }));
      expect(() => store.correctSession('s1', corrected, 'typo', 2)).toThrow(ConflictError);
      expect(store.correctSession('s1', corrected, 'typo', 1)).toEqual({ revision: 2 });
      const after = store.getSession('s1')!;
      expect(after.results[0].sectionMs).toBe(full.results[0].sectionMs + 1000);
      expect(after.corrections).toHaveLength(1);
      expect(after.corrections?.[0].previousResults[0].sectionMs).toBe(full.results[0].sectionMs);
      expect(after.corrections?.[0].note).toBe('typo');
      expect(after.corrections?.[0].correctedAt).toMatch(/^\d{4}-/);
      expect(store.listSessions({ workoutId: 'cindy' })).toEqual([]);
      expect(store.listSessions({ before: '2026-01-01T00:00:00.000Z' })).toEqual([]);
    } finally { store.close(); }
  });
});

describe('store: imports', () => {
  it('moves a device library once: renames collisions, remaps sessions and collections, merges master data, skips repeats', async () => {
    const { store } = await Store.open(':memory:');
    try {
      store.putWorkout(own('kept'), undefined);
      const device = {
        deviceId: 'device-9',
        workouts: [{ ...own('kept', 2), title: 'Changed kept' }, { ...bundledWorkout('fran'), title: 'My Fran', sharing: undefined }, own('same')],
        masterData: { ...emptyMasterData(), collections: [{ id: 'mine', title: 'Mine', workoutIds: ['fran', 'kept'] }] },
        sessions: [{ ...playedSession('s-old', bundledWorkout('fran'), ''), workoutId: 'fran', workout: undefined, events: [] }, { ...playedSession('s-lost', own('ghost'), ''), workout: undefined, events: [] }],
      };
      store.putWorkout(own('same'), undefined);
      const report = store.importDevice(clean(device));
      expect(report.workouts).toEqual({ created: 2, skipped: 1, renamed: [{ from: 'kept', to: 'kept-2' }, { from: 'fran', to: 'fran-2' }] });
      expect(report.sessions).toEqual({ created: 1, skipped: 0, orphaned: 1 });
      expect(report.masterData).toBe('created');
      expect(store.getMasterData().document.collections[0].workoutIds).toEqual(['fran-2', 'kept-2']);
      expect(store.getSession('s-old')?.workoutId).toBe('fran-2');
      expect(store.getSession('s-old')?.deviceId).toBe('device-9');
      const repeat = store.importDevice(clean(device));
      expect(repeat.workouts.created).toBe(2);
      expect(repeat.sessions.skipped).toBe(1);
    } finally { store.close(); }
  });

  it('imports a pack with copy, skip and replace decisions, remaps collections, and preserves meaning (SHR-06)', async () => {
    const { store } = await Store.open(':memory:');
    try {
      store.putWorkout(own('mine'), undefined);
      const fran = bundledWorkout('fran');
      const cindy = bundledWorkout('cindy');
      const report = store.importPack({
        workouts: [fran, cindy, { ...bundledWorkout('karen'), id: 'karen' }],
        collections: [{ title: 'Girls', workoutIds: ['fran', 'cindy', 'karen'] }],
        decisions: { fran: { action: 'copy' }, cindy: { action: 'replace', id: 'mine', expectedRevision: 1 }, karen: { action: 'skip' } },
      });
      expect(report.created).toEqual([{ from: 'fran', to: 'fran-2' }]);
      expect(report.replaced).toEqual(['mine']);
      expect(report.skipped).toBe(1);
      expect(report.collections).toBe(1);
      const copy = store.getWorkout('fran-2')!;
      expect(copy.origin).toBe('imported');
      expect(copy.document.sharing).toEqual(fran.sharing);
      expect(normaliseForComparison(copy.document)).toEqual(normaliseForComparison(fran));
      expect(compileWorkout(copy.document).durationMs).toBe(compileWorkout(fran).durationMs);
      const replaced = store.getWorkout('mine')!;
      expect(replaced.revision).toBe(2);
      expect(normaliseForComparison(replaced.document)).toEqual(normaliseForComparison(cindy));
      expect(store.getMasterData().document.collections).toEqual([{ id: 'girls', title: 'Girls', workoutIds: ['fran-2', 'mine'] }]);
      expect(() => store.importPack({ workouts: [fran], collections: [], decisions: { fran: { action: 'replace', id: 'mine', expectedRevision: 1 } } })).toThrow(ConflictError);
    } finally { store.close(); }
  });
});

describe('store: export and backup', () => {
  it('exports everything as one labelled document and writes a consistent backup file', async () => {
    const { store } = await Store.open(':memory:');
    try {
      store.putWorkout(own('a'), undefined);
      store.putSession(playedSession('s1', bundledWorkout('fran')));
      const exported = store.exportAll() as { format: string; workouts: unknown[]; sessions: { workout?: unknown }[]; schemaVersion: number };
      expect(exported.format).toBe('openwod.export');
      expect(exported.schemaVersion).toBe(1);
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
});
