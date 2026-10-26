import { compileWorkout } from '../../../packages/domain/src/compiler';
import type { Workout } from '../../../packages/domain/src/schema';
import { WorkoutEngine } from '../../../packages/engine/src';
import { sessionOutcome, type SessionRecord } from '../../../packages/engine/src/records';

/** Plays a workout through the engine with Done taps and returns the record the player would upload. */
export function playedSession(id: string, workout: Workout, deviceId = 'device-1'): SessionRecord & { workout: Workout } {
  let now = 0; let count = 0;
  const engine = new WorkoutEngine(compileWorkout(workout), () => now, id);
  const command = (type: Parameters<WorkoutEngine['command']>[0]['type']) => engine.command({ type, id: `${id}:${++count}`, occurrenceId: engine.occurrenceId });
  command('play'); now = 10_000; engine.tick();
  for (let i = 0; i < 6 && engine.project().status !== 'completed'; i++) { now += 30_000; engine.tick(); command('done'); }
  const projection = engine.project();
  return {
    id, workoutId: workout.id, workoutRevision: workout.revision, title: workout.title, startedAt: '2026-10-26T10:00:00.000Z', finishedAt: `2026-10-26T10:${String(10 + count).padStart(2, '0')}:00.000Z`,
    outcome: sessionOutcome(projection.status, projection.results), interrupted: false, modified: projection.modified, completion: 1, activeMs: engine.readClocks().activeMs,
    results: projection.results, events: engine.events, workout, deviceId,
  };
}

