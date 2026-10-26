import { describe, expect, it } from 'vitest';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { fixtureWorkouts, fightGoneBad, hyroxDoublesCircuit, hyroxEngineEmom, hyroxPaceIntervals, rowBurpeeEmom, tabataThis } from '../../packages/domain/src/fixtures';
import { summariseWorkout } from '../../packages/domain/src/library';
import { parseWorkoutFile, serialiseWorkoutFile } from '../../packages/domain/src';

describe('bundled example workouts', () => {
  it('compile to their hand-calculated active durations', () => {
    expect(compileWorkout(tabataThis).durationMs).toBe((8 * 20 + 7 * 10) * 5 * 1000 + 4 * 60_000); // 23:10
    expect(compileWorkout(fightGoneBad).durationMs).toBe(3 * 300_000 + 2 * 60_000); // 17:00
    expect(compileWorkout(rowBurpeeEmom).durationMs).toBe(20 * 60_000); // 20:00
    expect(compileWorkout(hyroxPaceIntervals).durationMs).toBe(8 * 180_000 + 8 * 120_000 + 15 * 30_000); // 47:30
    expect(compileWorkout(hyroxDoublesCircuit).durationMs).toBe(2 * (180_000 + 2 * (2 * 45_000 + 2 * 15_000))); // 14:00
    expect(compileWorkout(hyroxEngineEmom).durationMs).toBe(24 * 60_000); // 24:00
  });

  it('carry attribution, round-trip through the YAML file format and include solo sessions', () => {
    for (const workout of fixtureWorkouts) {
      expect(parseWorkoutFile(serialiseWorkoutFile(workout))).toEqual(workout);
      if (workout.attribution?.sourceUrl) expect(workout.attribution.sourceUrl).toMatch(/^https:\/\//);
    }
    expect(new Set(fixtureWorkouts.map(workout => workout.id)).size).toBe(fixtureWorkouts.length);
    expect(fixtureWorkouts.filter(workout => workout.participants === 1).length).toBeGreaterThanOrEqual(4);
    expect(tabataThis.attribution?.author).toBe('CrossFit');
    expect(hyroxDoublesCircuit.attribution?.notes).toMatch(/not.*official/i);
  });

  it('spread across the difficulty scale and the doubles circuit swaps columns each round', () => {
    const labels = new Set(fixtureWorkouts.map(workout => summariseWorkout(workout).difficulty.label));
    expect(labels.size).toBeGreaterThanOrEqual(2);
    const plan = compileWorkout(hyroxDoublesCircuit);
    const first = plan.occurrences.find(item => item.anchor === 'doubles-1-skierg' && item.rounds[0]?.iteration === 1)!;
    const second = plan.occurrences.find(item => item.anchor === 'doubles-1-skierg' && item.rounds[0]?.iteration === 2)!;
    expect(first.assignments?.A.name).toBe('SkiErg');
    expect(second.assignments?.A.name).toBe('Sled push');
  });
});
