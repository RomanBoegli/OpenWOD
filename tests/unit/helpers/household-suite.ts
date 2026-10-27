import { describe, expect, it } from 'vitest';
import { bundledWorkout } from '../../../packages/domain/src/bundled';
import { compileWorkout } from '../../../packages/domain/src/compiler';
import { emptyMasterData } from '../../../packages/domain/src/master-data';
import { normaliseForComparison } from '../../../packages/domain/src/pack';
import type { Workout } from '../../../packages/domain/src/schema';
import type { Household } from '../../../packages/household/src/core';
import { EXPORT_FORMAT, EXPORT_VERSION, parseExportDocument } from '../../../packages/household/src/export';
import type { ExportDocument, RestoreReport } from '../../../packages/household/src/types';
import { playedSession } from './session';

type Methods = 'listWorkouts' | 'getWorkout' | 'putWorkout' | 'archiveWorkout' | 'getMasterData' | 'putMasterData' | 'putSession' | 'listSessions' | 'getSession' | 'correctSession' | 'importDevice' | 'importPack';
type Async<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never };
/** The household as any backend offers it: the core's methods, asynchronous, plus the export and a validating restore. */
export type HouseholdApi = Async<Pick<Household, Methods>> & { exportAll(): Promise<ExportDocument>; restore(document: unknown): Promise<RestoreReport> };
export type OpenHousehold = () => Promise<{ household: HouseholdApi; close: () => void | Promise<void> }>;

const own = (id: string, revision = 1): Workout => ({ ...bundledWorkout('fran'), id, revision, title: `Own ${id}`, sharing: undefined });
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const withoutStamp = ({ exportedAt: _exportedAt, ...rest }: ExportDocument) => rest;

/** Runs `fn` against a fresh household and closes it afterwards. */
async function using(open: OpenHousehold, fn: (household: HouseholdApi) => Promise<void>) {
  const { household, close } = await open();
  try { await fn(household); } finally { await close(); }
}

/** Fills a household with one of everything: an active and an archived workout, master data, a corrected session. */
async function seed(household: HouseholdApi) {
  await household.putWorkout(own('a'), undefined);
  await household.putWorkout(own('a', 2), 1);
  await household.putWorkout(own('gone'), undefined);
  await household.archiveWorkout('gone', 1);
  await household.putMasterData({ ...emptyMasterData(), collections: [{ id: 'mine', title: 'Mine', workoutIds: ['a'] }] }, 0);
  const session = playedSession('s1', bundledWorkout('fran'));
  await household.putSession(session);
  await household.putSession(playedSession('s2', own('a', 2)));
  await household.correctSession('s1', session.results.map(result => ({ ...result, sectionMs: result.sectionMs + 1000 })), 'typo', 1);
}

/**
 * The household semantics every backend must keep (DAT-01, DAT-03, DAT-05, SHR-04, SHR-06, DAT-12). The suite only
 * awaits the API and asserts errors by status and code, so it runs against SQLite on the server and IndexedDB in
 * the browser alike.
 */
export function describeHouseholdSemantics(name: string, open: OpenHousehold) {
  describe(`${name}: documents`, () => {
    it('creates, updates with the expected revision, refuses stale or mismatched revisions, and archives', () => using(open, async household => {
      expect(await household.putWorkout(own('a'), undefined)).toMatchObject({ created: true, revision: 1 });
      await expect(household.putWorkout(own('a', 2), undefined)).rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT' });
      await expect(household.putWorkout(own('a', 3), 1)).rejects.toMatchObject({ status: 400, code: 'REVISION_MISMATCH' });
      expect(await household.putWorkout(own('a', 2), 1)).toMatchObject({ created: false, revision: 2 });
      await expect(household.putWorkout(own('a', 3), 1)).rejects.toMatchObject({ status: 409 });
      expect((await household.getWorkout('a'))?.document.revision).toBe(2);
      await household.archiveWorkout('a', 2);
      expect((await household.listWorkouts()).map(item => item.id)).toEqual([]);
      expect((await household.listWorkouts(true))[0]?.archivedAt).toBeTruthy();
      await expect(household.archiveWorkout('missing')).rejects.toMatchObject({ status: 404 });
      expect((await household.putWorkout(own('a', 3), 2)).created).toBe(false);
      expect((await household.getWorkout('a'))?.archivedAt).toBeUndefined();
    }));

    it('keeps one master-data document with a managed revision', () => using(open, async household => {
      expect(await household.getMasterData()).toEqual({ revision: 0, document: emptyMasterData() });
      const data = { ...emptyMasterData(), equipmentAliases: { 'kettle bell': 'Kettlebell' } };
      expect((await household.putMasterData(data, 0)).revision).toBe(1);
      await expect(household.putMasterData(data, 0)).rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT' });
      expect((await household.putMasterData({ ...data, committed: ['equipment:kettle bell'] }, 1)).revision).toBe(2);
      expect((await household.getMasterData()).document.committed).toEqual(['equipment:kettle bell']);
    }));
  });

  describe(`${name}: sessions`, () => {
    it('stores a session once, lists without the heavy fields, and keeps score corrections with their history', () => using(open, async household => {
      const session = playedSession('s1', bundledWorkout('fran'));
      expect(await household.putSession(session)).toBe('created');
      expect(await household.putSession(session)).toBe('existing');
      const listed = await household.listSessions();
      expect(listed).toHaveLength(1);
      expect(listed[0]).not.toHaveProperty('workout');
      expect(listed[0]).not.toHaveProperty('events');
      const full = (await household.getSession('s1'))!;
      expect(full.workout?.id).toBe('fran');
      expect(full.events.length).toBeGreaterThan(5);
      expect(full.revision).toBe(1);
      const corrected = full.results.map(result => ({ ...result, sectionMs: result.sectionMs + 1000 }));
      await expect(household.correctSession('s1', corrected, 'typo', 2)).rejects.toMatchObject({ status: 409 });
      await expect(household.correctSession('missing', corrected, undefined, 1)).rejects.toMatchObject({ status: 404 });
      expect(await household.correctSession('s1', corrected, 'typo', 1)).toEqual({ revision: 2 });
      const after = (await household.getSession('s1'))!;
      expect(after.results[0].sectionMs).toBe(full.results[0].sectionMs + 1000);
      expect(after.corrections).toHaveLength(1);
      expect(after.corrections?.[0].previousResults[0].sectionMs).toBe(full.results[0].sectionMs);
      expect(after.corrections?.[0].note).toBe('typo');
      expect(after.corrections?.[0].correctedAt).toMatch(/^\d{4}-/);
      expect(await household.listSessions({ workoutId: 'cindy' })).toEqual([]);
      expect(await household.listSessions({ before: '2026-01-01T00:00:00.000Z' })).toEqual([]);
    }));

    it('lists newest first, filtered by workout and by time, within the clamped page size', () => using(open, async household => {
      await household.putSession(playedSession('s1', bundledWorkout('fran')));
      await household.putSession({ ...playedSession('s2', bundledWorkout('cindy')), finishedAt: '2026-10-26T11:00:00.000Z' });
      await household.putSession({ ...playedSession('s3', bundledWorkout('fran')), finishedAt: '2026-10-26T12:00:00.000Z' });
      expect((await household.listSessions()).map(item => item.id)).toEqual(['s3', 's2', 's1']);
      expect((await household.listSessions({ workoutId: 'fran' })).map(item => item.id)).toEqual(['s3', 's1']);
      expect((await household.listSessions({ before: '2026-10-26T12:00:00.000Z' })).map(item => item.id)).toEqual(['s2', 's1']);
      expect((await household.listSessions({ limit: 0 })).map(item => item.id)).toEqual(['s3']);
      expect((await household.listSessions())[0]).toMatchObject({ revision: 1, receivedAt: expect.stringMatching(/^\d{4}-/) });
    }));
  });

  describe(`${name}: imports`, () => {
    it('moves a device library once: renames collisions, remaps sessions and collections, merges master data, skips repeats', () => using(open, async household => {
      await household.putWorkout(own('kept'), undefined);
      const device = {
        deviceId: 'device-9',
        workouts: [{ ...own('kept', 2), title: 'Changed kept' }, { ...bundledWorkout('fran'), title: 'My Fran', sharing: undefined }, own('same')],
        masterData: { ...emptyMasterData(), collections: [{ id: 'mine', title: 'Mine', workoutIds: ['fran', 'kept'] }] },
        sessions: [{ ...playedSession('s-old', bundledWorkout('fran'), ''), workoutId: 'fran', workout: undefined, events: [] }, { ...playedSession('s-lost', own('ghost'), ''), workout: undefined, events: [] }],
      };
      await household.putWorkout(own('same'), undefined);
      const report = await household.importDevice(clean(device));
      expect(report.workouts).toEqual({ created: 2, skipped: 1, renamed: [{ from: 'kept', to: 'kept-2' }, { from: 'fran', to: 'fran-2' }] });
      expect(report.sessions).toEqual({ created: 1, skipped: 0, orphaned: 1 });
      expect(report.masterData).toBe('created');
      expect((await household.getMasterData()).document.collections[0].workoutIds).toEqual(['fran-2', 'kept-2']);
      expect((await household.getSession('s-old'))?.workoutId).toBe('fran-2');
      expect((await household.getSession('s-old'))?.deviceId).toBe('device-9');
      const repeat = await household.importDevice(clean(device));
      expect(repeat.workouts.created).toBe(2);
      expect(repeat.sessions.skipped).toBe(1);
    }));

    it('imports a pack with copy, skip and replace decisions, remaps collections, and preserves meaning (SHR-06)', () => using(open, async household => {
      await household.putWorkout(own('mine'), undefined);
      const fran = bundledWorkout('fran');
      const cindy = bundledWorkout('cindy');
      const report = await household.importPack({
        workouts: [fran, cindy, { ...bundledWorkout('karen'), id: 'karen' }],
        collections: [{ title: 'Girls', workoutIds: ['fran', 'cindy', 'karen'] }],
        decisions: { fran: { action: 'copy' }, cindy: { action: 'replace', id: 'mine', expectedRevision: 1 }, karen: { action: 'skip' } },
      });
      expect(report.created).toEqual([{ from: 'fran', to: 'fran-2' }]);
      expect(report.replaced).toEqual(['mine']);
      expect(report.skipped).toBe(1);
      expect(report.collections).toBe(1);
      const copy = (await household.getWorkout('fran-2'))!;
      expect(copy.origin).toBe('imported');
      expect(copy.document.sharing).toEqual(fran.sharing);
      expect(normaliseForComparison(copy.document)).toEqual(normaliseForComparison(fran));
      expect(compileWorkout(copy.document).durationMs).toBe(compileWorkout(fran).durationMs);
      const replaced = (await household.getWorkout('mine'))!;
      expect(replaced.revision).toBe(2);
      expect(normaliseForComparison(replaced.document)).toEqual(normaliseForComparison(cindy));
      expect((await household.getMasterData()).document.collections).toEqual([{ id: 'girls', title: 'Girls', workoutIds: ['fran-2', 'mine'] }]);
      await expect(household.importPack({ workouts: [fran], collections: [], decisions: { fran: { action: 'replace', id: 'mine', expectedRevision: 1 } } })).rejects.toMatchObject({ status: 409 });
      expect((await household.listWorkouts()).map(item => item.id).sort()).toEqual(['fran-2', 'mine']);
    }));
  });

  describe(`${name}: export and restore`, () => {
    it('exports everything as one labelled document that parses as a backup', () => using(open, async household => {
      await seed(household);
      const exported = await household.exportAll();
      expect(exported).toMatchObject({ format: EXPORT_FORMAT, formatVersion: EXPORT_VERSION, schemaVersion: expect.any(Number), exportedAt: expect.stringMatching(/^\d{4}-/) });
      expect(exported.workouts.map(item => [item.id, item.revision, Boolean(item.archivedAt)]).sort()).toEqual([['a', 2, false], ['gone', 1, true]]);
      expect(exported.masterData).toMatchObject({ revision: 1, document: { collections: [{ id: 'mine' }] } });
      expect(exported.sessions.map(item => item.id).sort()).toEqual(['s1', 's2']);
      const corrected = exported.sessions.find(item => item.id === 's1')!;
      expect(corrected).toMatchObject({ revision: 2, workout: { id: 'fran' }, receivedAt: expect.stringMatching(/^\d{4}-/) });
      expect(corrected.events.length).toBeGreaterThan(5);
      expect(corrected.corrections).toHaveLength(1);
      expect(withoutStamp(parseExportDocument(clean(exported)))).toEqual(withoutStamp(clean(exported)));
    }));

    it('restores by replacing everything, keeping archived workouts, revisions, master data and corrections', () => using(open, async source => {
      await seed(source);
      const exported = clean(await source.exportAll());
      await using(open, async target => {
        await target.putWorkout(own('other'), undefined);
        await target.putSession(playedSession('s9', bundledWorkout('cindy')));
        await target.putMasterData({ ...emptyMasterData(), hiddenMovements: ['thruster'] }, 0);
        await target.putMasterData({ ...emptyMasterData(), hiddenMovements: ['burpee'] }, 1);
        const report = await target.restore(exported);
        expect(report).toMatchObject({ workouts: 1, archived: 1, sessions: 2, corrections: 1, masterRevision: 1, exportedAt: exported.exportedAt });
        expect(report).not.toHaveProperty('pruned');
        expect(await target.getWorkout('other')).toBeUndefined();
        expect(await target.getSession('s9')).toBeUndefined();
        expect(clean(await target.listWorkouts(true))).toEqual(clean(await source.listWorkouts(true)));
        expect(clean(await target.getSession('s1'))).toEqual(clean(await source.getSession('s1')));
        expect(clean(await target.getMasterData())).toEqual(clean(await source.getMasterData()));
        expect(withoutStamp(clean(await target.exportAll()))).toEqual(withoutStamp(exported));
        // The restored household carries on where the backup left off.
        expect((await target.putWorkout(own('a', 3), 2)).revision).toBe(3);
        expect((await target.putWorkout(own('gone', 2), 1)).created).toBe(false);
        expect(await target.correctSession('s1', exported.sessions.find(item => item.id === 's1')!.corrections[0].previousResults, undefined, 2)).toEqual({ revision: 3 });
        expect((await target.getSession('s1'))?.corrections).toHaveLength(2);
        expect((await target.putMasterData(emptyMasterData(), 1)).revision).toBe(2);
      });
    }));

    it('refuses a foreign format, a newer format version or an invalid document without writing anything', () => using(open, async household => {
      await seed(household);
      const exported = clean(await household.exportAll());
      const before = withoutStamp(clean(await household.exportAll()));
      await expect(household.restore({ ...exported, format: 'something.else' })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED', path: '/format' });
      await expect(household.restore({ ...exported, formatVersion: EXPORT_VERSION + 1 })).rejects.toMatchObject({ status: 400, code: 'FORMAT_NEWER' });
      await expect(household.restore({ ...exported, sessions: [...exported.sessions, { ...exported.sessions[0], id: 's3', workout: { nonsense: true } }] })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED', path: expect.stringMatching(/^\/sessions\/2\/workout/) });
      await expect(household.restore({ ...exported, workouts: [...exported.workouts, exported.workouts[0]] })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED', path: '/workouts/2/id' });
      await expect(household.restore({ ...exported, masterData: { revision: 1, document: { extra: true } } })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
      await expect(household.restore(null)).rejects.toMatchObject({ status: 400 });
      expect(withoutStamp(clean(await household.exportAll()))).toEqual(before);
    }));
  });
}
