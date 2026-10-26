import { describe, expect, it } from 'vitest';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { backSquatFives, cindy, fixtureWorkouts, fightGoneBad, fran, formatWorkouts, hyroxDoublesCircuit, hyroxEngineEmom, hyroxPaceIntervals, mixedSession, partnerEmom16, partnerSprints, rowBurpeeEmom, runSledRun, tabataThis } from '../../packages/domain/src/fixtures';
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
    for (const workout of fixtureWorkouts.slice(0, 8)) expect(compileWorkout(workout).durationKind).toBe('exact');
  });

  it('bound the manual formats by their caps and mark open-ended ones', () => {
    const kinds = (workout: typeof cindy) => { const plan = compileWorkout(workout); return [plan.durationMs, plan.durationKind] as const; };
    expect(kinds(cindy)).toEqual([1_200_000, 'capped']);
    expect(kinds(fran)).toEqual([600_000, 'capped']);
    expect(kinds(partnerEmom16)).toEqual([960_000, 'exact']);
    expect(kinds(partnerSprints)).toEqual([720_000, 'capped']);
    expect(kinds(runSledRun)).toEqual([0, 'open']);
    expect(kinds(backSquatFives)).toEqual([4 * 120_000, 'open']);
    expect(kinds(mixedSession)).toEqual([180_000 + 2 * 90_000 + 600_000, 'open']);
    expect(compileWorkout(mixedSession).sections.map(section => section.durationKind)).toEqual(['exact', 'open', 'capped']);
    const emom = compileWorkout(partnerEmom16);
    expect(emom.occurrences).toHaveLength(16);
    expect(emom.occurrences[0].interval).toEqual({ index: 1, count: 16 });
    expect(emom.occurrences[1].assignments?.A.name).toBe('Burpees');
    expect(emom.occurrences[2].rounds).toEqual([{ nodeId: 'emom16-minutes', iteration: 2, count: 8 }]);
    expect(compileWorkout(cindy).occurrences[0].tasks?.map(item => item.assignments.A.reps)).toEqual([5, 10, 15]);
    for (const workout of formatWorkouts) expect(workout.attribution?.author, workout.id).toBeTruthy();
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
