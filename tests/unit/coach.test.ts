import { describe, expect, it } from 'vitest';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { coachWorkouts } from '../../packages/domain/src/fixtures/coach';
import { parseWorkoutFile, serialiseWorkoutFile, SECTION_FORMATS, type SectionFormat } from '../../packages/domain/src';

describe('coach program workouts', () => {
  it('number twenty-two with unique ids, distinct from the bundled fixtures', () => {
    expect(coachWorkouts).toHaveLength(22);
    const ids = coachWorkouts.map(workout => workout.id);
    expect(new Set(ids).size).toBe(ids.length);
    const bundled = ['partner-circuit', 'full-body-partner', 'tabata-this', 'fight-gone-bad', 'row-burpee-emom-20', 'hyrox-pace-intervals', 'hyrox-doubles-circuit', 'hyrox-engine-emom-24', 'cindy', 'fran', 'partner-emom-16', 'you-go-i-go-sprints', 'run-sled-run', 'back-squat-5x5', 'mixed-session'];
    for (const id of ids) expect(bundled, id).not.toContain(id);
  });

  it.each(coachWorkouts.map(workout => [workout.id, workout] as const))('%s compiles, is attributed, lists equipment and survives the file format', (_id, workout) => {
    const plan = compileWorkout(workout);
    expect(plan.occurrences.length).toBeGreaterThan(0);
    expect(workout.attribution?.author).toBeTruthy();
    expect(workout.equipment.length).toBeGreaterThan(0);
    expect(workout.schemaVersion).toBe(2);
    expect(workout.revision).toBe(1);
    expect(workout.prepMs).toBe(10_000);
    for (const section of workout.sections) expect(section.transitionAfter).toBe('manualReady');
    expect(parseWorkoutFile(serialiseWorkoutFile(workout))).toEqual(workout);
  });

  it('include pair workouts and cover every section format', () => {
    expect(coachWorkouts.filter(workout => workout.participants === 2).length).toBeGreaterThanOrEqual(2);
    const formats = new Set<SectionFormat>(coachWorkouts.flatMap(workout => workout.sections.map(section => section.format)));
    for (const format of SECTION_FORMATS) expect(formats, format).toContain(format);
    expect([...formats].sort()).toEqual([...SECTION_FORMATS].sort());
  });
});
