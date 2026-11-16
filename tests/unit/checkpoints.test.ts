import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { WorkoutEngine } from '../../packages/engine/src';
import { adoptSession, applyProgress, lastSaved, listRecoveries, writeCheckpoint, writeProgress, type Checkpoint, type Progress } from '../../apps/web/src/data/checkpoints';
import { closeIdb, idbGet, idbGetAll } from '../../apps/web/src/data/idb';

const fran = bundledWorkout('fran');
const plan = compileWorkout(fran);

/**
 * Fran as a device holds it mid-session: the checkpoint after `pauses` pause-and-resume pairs (each moves the engine's
 * revision on) and the progress record three seconds later.
 */
function held(sessionId: string, pauses: number, savedAt: string): { checkpoint: Checkpoint; progress: Progress } {
  let now = 0;
  const engine = new WorkoutEngine(plan, () => now, sessionId);
  const command = (type: 'play' | 'pause' | 'resume') => engine.command({ type, id: `${sessionId}:${type}:${now}`, occurrenceId: engine.occurrenceId });
  command('play'); now = 12_000; engine.tick();
  for (let count = 0; count < pauses; count++) { now += 4000; command('pause'); now += 1000; command('resume'); }
  const checkpoint: Checkpoint = { sessionId, workoutId: fran.id, workoutRevision: fran.revision, workout: fran, snapshot: engine.toJSON(), revision: engine.revision, status: engine.project().status, savedAt, startedAt: '2026-11-16T10:00:00.000Z' };
  return { checkpoint, progress: { sessionId, checkpointRevision: engine.revision, ...engine.offsets(now + 3000), savedAt } };
}

describe('checkpoints: adopting a session from another device (ENG-15)', () => {
  beforeEach(async () => { await closeIdb(); globalThis.indexedDB = new IDBFactory(); });
  afterEach(() => closeIdb());

  it('writes the claimed checkpoint and its progress record, which the ordinary recovery finds and restores paused', async () => {
    const claimed = held('s1', 1, '2026-11-16T10:05:00.000Z');
    expect(claimed.checkpoint.status).toBe('running');
    await adoptSession(claimed.checkpoint, claimed.progress);
    expect(await listRecoveries()).toEqual([claimed]);
    const [recovery] = await listRecoveries();
    const engine = WorkoutEngine.fromSnapshot(plan, applyProgress(structuredClone(recovery.checkpoint.snapshot), recovery.progress), () => 0);
    expect(engine.project()).toMatchObject({ sessionId: 's1', status: 'paused', pauseReason: 'recovered' });
    expect(engine.readClocks().activeMs).toBe(claimed.progress.activeMs);
    expect(claimed.progress.activeMs).toBe(claimed.checkpoint.snapshot.activeMs + 3000);
  });

  it("replaces this device's copy of the session and drops a progress record that does not extend the claimed checkpoint", async () => {
    // This device ran the session before it was continued elsewhere: its checkpoint and progress are from then.
    const own = held('s1', 1, '2026-11-16T10:05:00.000Z');
    const other = held('s2', 0, '2026-11-16T09:00:00.000Z');
    await writeCheckpoint(own.checkpoint); await writeProgress(own.progress);
    await writeCheckpoint(other.checkpoint); await writeProgress(other.progress);
    const claimed = held('s1', 3, '2026-11-16T10:20:00.000Z');
    expect(claimed.checkpoint.revision).toBeGreaterThan(own.checkpoint.revision);

    await adoptSession(claimed.checkpoint);
    expect(await idbGet<Checkpoint>('checkpoints', 's1')).toEqual(claimed.checkpoint);
    expect(await idbGet('progress', 's1')).toBeUndefined();
    expect(await listRecoveries()).toEqual([{ checkpoint: claimed.checkpoint }, other]);

    // A record of another revision or another session is no better than none.
    await writeProgress(own.progress);
    await adoptSession(claimed.checkpoint, own.progress);
    expect(await idbGet('progress', 's1')).toBeUndefined();
    await adoptSession(claimed.checkpoint, { ...claimed.progress, sessionId: 's2' });
    expect(await idbGet('progress', 's1')).toBeUndefined();
    expect(await idbGet('progress', 's2')).toEqual(other.progress);

    await adoptSession(claimed.checkpoint, claimed.progress);
    expect(await idbGet('progress', 's1')).toEqual(claimed.progress);
    // Taking the session back later replaces the record again.
    const later = held('s1', 4, '2026-11-16T10:30:00.000Z');
    await adoptSession(later.checkpoint, later.progress);
    expect(await listRecoveries()).toEqual([later, other]);
    expect(await idbGetAll('checkpoints')).toHaveLength(2);
  });

  it('keeps the note of where the session came from with the checkpoint, and tells the last save from either record', async () => {
    const claimed = held('s1', 1, '2026-11-16T10:05:00.000Z');
    const handover = { from: 'iPad · home screen', savedAt: '2026-11-16T10:05:03.000Z' };
    await adoptSession({ ...claimed.checkpoint, handover }, claimed.progress);
    const [recovery] = await listRecoveries();
    expect(recovery.checkpoint.handover).toEqual(handover);
    expect(recovery.progress).toEqual(claimed.progress);
    // The last save is the progress record's when it extends the checkpoint and is the later of the two.
    const later = { ...claimed.progress, savedAt: '2026-11-16T10:05:09.000Z' };
    expect(lastSaved({ checkpoint: claimed.checkpoint })).toBe('2026-11-16T10:05:00.000Z');
    expect(lastSaved({ checkpoint: claimed.checkpoint, progress: later })).toBe('2026-11-16T10:05:09.000Z');
    expect(lastSaved({ checkpoint: claimed.checkpoint, progress: { ...later, savedAt: '2026-11-16T10:04:00.000Z' } })).toBe('2026-11-16T10:05:00.000Z');
    expect(lastSaved({ checkpoint: claimed.checkpoint, progress: { ...later, checkpointRevision: claimed.checkpoint.revision + 1 } })).toBe('2026-11-16T10:05:00.000Z');
  });

  it('writes nothing when one of the two records cannot be stored', async () => {
    const own = held('s1', 1, '2026-11-16T10:05:00.000Z');
    await writeCheckpoint(own.checkpoint); await writeProgress(own.progress);
    const claimed = held('s1', 3, '2026-11-16T10:20:00.000Z');
    // IndexedDB refuses a value that cannot be cloned; the checkpoint written just before it must not stay.
    const unstorable = { ...claimed.progress, poison: () => undefined } as Progress;
    await expect(adoptSession(claimed.checkpoint, unstorable)).rejects.toBeTruthy();
    expect(await idbGet<Checkpoint>('checkpoints', 's1')).toEqual(own.checkpoint);
    expect(await idbGet<Progress>('progress', 's1')).toEqual(own.progress);
    expect(await listRecoveries()).toEqual([own]);
  });
});
