import { describe, expect, it } from 'vitest';
import { builderToWorkout, workoutToBuilder } from '../../packages/domain/src/builder';
import { bundledWorkout, bundledWorkouts } from '../../packages/domain/src/bundled';
import { compileWorkout } from '../../packages/domain/src/compiler';
import type { Workout } from '../../packages/domain/src';

/** The total of every timed step, and the transitions after the workout's last work, which the editor drops. */
const total = (workout: Workout) => compileWorkout(workout).occurrences.reduce((sum, item) => sum + item.durationMs, 0);
function finalTransitions(workout: Workout) {
  const occurrences = compileWorkout(workout).occurrences;
  const lastWork = occurrences.map(item => item.phase).lastIndexOf('work');
  return occurrences.slice(lastWork + 1).filter(item => item.phase === 'transition').reduce((sum, item) => sum + item.durationMs, 0);
}

describe('the rest after the last movement of each round', () => {
  it('moves into the rest between rounds and the rest between sections, at the same length', () => {
    const draft = workoutToBuilder(bundledWorkout('full-body-partner'))!;
    const legs = draft.sections[1];
    expect(legs).toMatchObject({ rounds: 2, trailingRestMs: 0, betweenRoundsRestMs: 20_000, blockRestMs: 140_000 });
  });

  it('keeps the timing of every bundled workout the editor can open, except a pause after the very last movement', () => {
    for (const workout of bundledWorkouts) {
      const draft = workoutToBuilder(workout);
      if (!draft) continue;
      const saved = builderToWorkout(draft, { id: workout.id, revision: workout.revision + 1 });
      expect(total(saved), workout.id).toBe(total(workout) - finalTransitions(workout));
      expect(saved.sections.map(section => section.transitionAfter), workout.id).toEqual(workout.sections.map(section => section.transitionAfter));
    }
  });
});
