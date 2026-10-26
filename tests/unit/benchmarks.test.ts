import { describe, expect, it } from 'vitest';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { benchmarkWorkouts } from '../../packages/domain/src/fixtures/benchmarks';
import { parseWorkoutFile, serialiseWorkoutFile } from '../../packages/domain/src';

describe('CrossFit benchmark workouts', () => {
  it('number sixteen with unique ids, leaving Fran and Cindy to the bundled fixtures', () => {
    expect(benchmarkWorkouts).toHaveLength(16);
    const ids = benchmarkWorkouts.map(workout => workout.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('fran');
    expect(ids).not.toContain('cindy');
  });

  it.each(benchmarkWorkouts.map(workout => [workout.id, workout] as const))('%s compiles, is attributed, lists equipment and survives the file format', (_id, workout) => {
    const plan = compileWorkout(workout);
    expect(plan.occurrences.length).toBeGreaterThan(0);
    expect(workout.attribution?.sourceUrl).toMatch(/^https:\/\/www\.crossfit\.com\/benchmark\//);
    expect(workout.equipment.length).toBeGreaterThan(0);
    expect(parseWorkoutFile(serialiseWorkoutFile(workout))).toEqual(workout);
  });

  it('Karen compiles to a single manual task of 150 reps', () => {
    const karen = benchmarkWorkouts.find(workout => workout.id === 'karen')!;
    const plan = compileWorkout(karen);
    expect(plan.occurrences).toHaveLength(1);
    expect(plan.occurrences[0].timing).toBe('manual');
    expect(plan.occurrences[0].assignments?.A.reps).toBe(150);
  });

  it('Murph is capped and Nate is an AMRAP', () => {
    const murph = benchmarkWorkouts.find(workout => workout.id === 'murph')!;
    expect(compileWorkout(murph).durationKind).toBe('capped');
    const nate = benchmarkWorkouts.find(workout => workout.id === 'nate')!;
    expect(nate.sections[0].format).toBe('amrap');
  });
});
