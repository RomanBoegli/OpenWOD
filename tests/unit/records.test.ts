import { describe, expect, it } from 'vitest';
import { compileSchema } from '../../packages/domain/src/validate';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { WorkoutEngine } from '../../packages/engine/src';
import { roundSessionTimes, sessionOutcome, SessionRecordSchema, type SessionRecord } from '../../packages/engine/src/records';

const validate = compileSchema<SessionRecord>(SessionRecordSchema);

function playFran(stepMs = 30_000): { engine: WorkoutEngine; now: number } {
  let now = 0; let id = 0;
  const engine = new WorkoutEngine(compileWorkout(bundledWorkout('fran')), () => now, 'session-1');
  const command = (type: Parameters<WorkoutEngine['command']>[0]['type']) => engine.command({ type, id: String(++id), occurrenceId: engine.occurrenceId });
  command('play'); now = 10_000; engine.tick();
  for (let i = 0; i < 6; i++) { now += stepMs; engine.tick(); command('done'); }
  return { engine, now };
}

describe('session records', () => {
  it('rounds fractional browser clock values for upload without changing engine events or results', () => {
    const { engine } = playFran(30_000.125);
    const projection = engine.project();
    const record: SessionRecord = {
      id: engine.sessionId, workoutId: 'fran', workoutRevision: 1, title: 'Fran', startedAt: '2026-10-26T10:00:00.000Z', finishedAt: '2026-10-26T10:05:00.000Z',
      outcome: sessionOutcome(projection.status, projection.results), interrupted: false, modified: projection.modified, completion: 1, activeMs: engine.readClocks().activeMs,
      results: projection.results, events: engine.events, workout: bundledWorkout('fran'), deviceId: 'device-1',
    };
    const before = structuredClone(record);
    expect(validate(record)).toBe(false);
    const rounded = roundSessionTimes(record);
    expect(validate(rounded), JSON.stringify(validate.errors)).toBe(true);
    expect(rounded.activeMs).toBe(180_001);
    expect(rounded.results[0].sectionMs).toBe(180_001);
    expect(rounded.events.every(event => Number.isInteger(event.activeMs))).toBe(true);
    expect(record).toEqual(before);
    expect(engine.readClocks().activeMs).toBe(180_000.75);
  });

  it('accepts a record built from the engine and rejects unknown keys and too many events', () => {
    const { engine } = playFran();
    const projection = engine.project();
    const record: SessionRecord = {
      id: engine.sessionId, workoutId: 'fran', workoutRevision: 1, title: 'Fran', startedAt: '2026-10-26T10:00:00.000Z', finishedAt: '2026-10-26T10:05:00.000Z',
      outcome: sessionOutcome(projection.status, projection.results), interrupted: false, modified: projection.modified, completion: 1, activeMs: engine.readClocks().activeMs,
      results: projection.results, events: engine.events, workout: bundledWorkout('fran'), deviceId: 'device-1',
    };
    expect(validate(record)).toBe(true);
    expect(record.outcome).toBe('completed');
    expect(validate({ ...record, extra: 1 })).toBe(false);
    expect(validate({ ...record, events: Array.from({ length: 20_001 }, (_, i) => ({ id: `s:${i}`, sequence: i, type: 'done', occurrenceId: 'x', activeMs: 0 })) })).toBe(false);
    expect(validate({ ...record, outcome: 'finished' })).toBe(false);
  });

  it('derives the outcome: aborted beats everything, a capped section makes the session capped', () => {
    expect(sessionOutcome('aborted', [])).toBe('aborted');
    expect(sessionOutcome('completed', [{ sectionId: 'a', format: 'amrap', outcome: 'capped', sectionMs: 1, unacknowledged: [] }])).toBe('capped');
    expect(sessionOutcome('completed', [{ sectionId: 'a', format: 'forTime', outcome: 'finished', sectionMs: 1, unacknowledged: [] }])).toBe('completed');
  });
});
