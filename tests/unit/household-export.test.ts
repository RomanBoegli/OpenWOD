import { describe, expect, it } from 'vitest';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import { emptyMasterData } from '../../packages/domain/src/master-data';
import { EXPORT_FORMAT, EXPORT_VERSION, MAX_RESTORE_BYTES, parseExportDocument, summariseExport } from '../../packages/household/src/export';
import type { ExportDocument } from '../../packages/household/src/types';
import { playedSession } from './helpers/session';

const stored = (id: string, archivedAt?: string) => ({ id, revision: 1, origin: 'local' as const, createdAt: '2026-10-26T09:00:00.000Z', updatedAt: '2026-10-26T09:00:00.000Z', ...(archivedAt ? { archivedAt } : {}), document: { ...bundledWorkout('fran'), id, sharing: undefined } });
const backup = (): ExportDocument => JSON.parse(JSON.stringify({
  format: EXPORT_FORMAT, formatVersion: EXPORT_VERSION, exportedAt: '2026-10-27T08:00:00.000Z', schemaVersion: 1,
  workouts: [stored('a'), stored('b', '2026-10-26T10:00:00.000Z')],
  masterData: { revision: 2, document: { ...emptyMasterData(), hiddenMovements: ['thruster'] }, updatedAt: '2026-10-26T09:30:00.000Z' },
  sessions: [
    { ...playedSession('s1', bundledWorkout('fran')), revision: 2, receivedAt: '2026-10-26T10:30:00.000Z', corrections: [{ correctedAt: '2026-10-26T11:00:00.000Z', previousResults: [], note: 'typo' }] },
    playedSession('s2', bundledWorkout('cindy')),
  ],
})) as ExportDocument;

describe('household export: parseExportDocument', () => {
  it('accepts an export, fills the session defaults and returns an isolated copy', () => {
    const value = backup();
    const parsed = parseExportDocument(value);
    expect(parsed.workouts.map(item => item.id)).toEqual(['a', 'b']);
    expect(parsed.sessions[1]).toMatchObject({ id: 's2', revision: 1, receivedAt: '2026-10-27T08:00:00.000Z', corrections: [] });
    expect(parsed.masterData).toEqual(value.masterData);
    parsed.workouts[0].document.title = 'Changed';
    expect(value.workouts[0].document.title).not.toBe('Changed');
    expect(MAX_RESTORE_BYTES).toBe(32 * 1_048_576);
  });

  it('refuses another format, a newer version and invalid content, naming the field', () => {
    const fails = (value: unknown, supported?: number) => { try { parseExportDocument(value, supported); } catch (error) { return error as { status: number; code: string; path?: string }; } throw new Error('accepted'); };
    expect(fails({ ...backup(), format: 'openwod.pack' })).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', path: '/format' });
    expect(fails([])).toMatchObject({ status: 400, path: '/format' });
    expect(fails({ ...backup(), formatVersion: 2 })).toMatchObject({ status: 400, code: 'FORMAT_NEWER', path: '/formatVersion' });
    expect(fails(backup(), 0)).toMatchObject({ code: 'FORMAT_NEWER' });
    expect(fails({ ...backup(), extra: 1 })).toMatchObject({ code: 'VALIDATION_FAILED' });
    const broken = backup();
    broken.workouts[1].document = { ...broken.workouts[1].document, sections: [] };
    expect(fails(broken)).toMatchObject({ code: 'VALIDATION_FAILED', path: expect.stringMatching(/^\/workouts\/1\/document/) });
    const mismatched = backup();
    mismatched.workouts[0].document.id = 'other';
    expect(fails(mismatched)).toMatchObject({ path: '/workouts/0/document/id' });
    const twice = backup();
    twice.sessions[1].id = 's1';
    expect(fails(twice)).toMatchObject({ path: '/sessions/1/id' });
    const unplayed = backup();
    delete (unplayed.sessions[0] as { workout?: unknown }).workout;
    expect(fails(unplayed)).toMatchObject({ code: 'VALIDATION_FAILED', path: '/sessions/0' });
  });
});

describe('household export: summariseExport', () => {
  it('counts active and archived workouts, sessions, corrections, and carries the master revision and date', () => {
    expect(summariseExport(backup())).toEqual({ workouts: 1, archived: 1, sessions: 2, corrections: 1, masterRevision: 2, exportedAt: '2026-10-27T08:00:00.000Z' });
  });
});
