import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { bundledCollections, bundledWorkout, bundledWorkouts } from '../../packages/domain/src/bundled';
import { Catalogue } from '../../packages/domain/src/catalogue';
import { collectPrescriptions, summariseWorkout } from '../../packages/domain/src/library';
import { seedMovements } from '../../packages/domain/src/movements';
import { parseWorkoutFile, SECTION_FORMATS, serialiseWorkoutFile, type SectionFormat } from '../../packages/domain/src';

const registry = new URL('../../workouts/', import.meta.url);
const files = readdirSync(registry, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(folder => readdirSync(new URL(`${folder.name}/`, registry)).filter(name => name.endsWith('.wod.yaml')).map(name => `${folder.name}/${name}`));

describe('the workout registry (workouts/**)', () => {
  it('bundles every file, once, under the id its name says', () => {
    expect(files).toHaveLength(53);
    expect(bundledWorkouts).toHaveLength(files.length);
    expect(new Set(bundledWorkouts.map(workout => workout.id)).size).toBe(bundledWorkouts.length);
    for (const file of files) {
      const workout = parseWorkoutFile(readFileSync(new URL(file, registry), 'utf8'));
      expect(file.endsWith(`/${workout.id}.wod.yaml`), file).toBe(true);
      expect(bundledWorkout(workout.id), file).toEqual(workout);
    }
    expect(() => bundledWorkout('no-such-workout')).toThrow(/No bundled workout/);
  });

  it('groups folders with a collection.yaml into bundled collections', () => {
    expect(bundledCollections.map(collection => collection.id)).toEqual(['benchmarks', 'coach-programming', 'hyrox']);
    const benchmarks = bundledCollections.find(collection => collection.id === 'benchmarks')!;
    expect(benchmarks.title).toBe('Benchmarks');
    expect(benchmarks.workoutIds).toHaveLength(19);
    expect(benchmarks.workoutIds).toContain('fran');
    expect(bundledCollections.find(collection => collection.id === 'coach-programming')!.workoutIds).toHaveLength(22);
    for (const collection of bundledCollections) for (const id of collection.workoutIds) expect(bundledWorkouts.some(workout => workout.id === id), id).toBe(true);
  });

  it.each(bundledWorkouts.map(workout => [workout.id, workout] as const))('%s compiles, is attributed, lists equipment, names known movements and survives the file format', (_id, workout) => {
    const catalogue = new Catalogue(seedMovements);
    expect(compileWorkout(workout).occurrences.length).toBeGreaterThan(0);
    expect(workout.attribution?.author).toBeTruthy();
    if (workout.attribution?.sourceUrl) expect(workout.attribution.sourceUrl).toMatch(/^https:\/\//);
    expect(workout.equipment.length).toBeGreaterThan(0);
    expect(workout.revision).toBe(1);
    for (const section of workout.sections) expect(section.transitionAfter).toBe('manualReady');
    for (const item of collectPrescriptions(workout)) expect(catalogue.resolve(item), item.name).toBeDefined();
    expect(parseWorkoutFile(serialiseWorkoutFile(workout))).toEqual(workout);
  });

  it('compiles the timed sessions to their hand-calculated active durations', () => {
    expect(compileWorkout(bundledWorkout('tabata-this')).durationMs).toBe((8 * 20 + 7 * 10) * 5 * 1000 + 4 * 60_000); // 23:10
    expect(compileWorkout(bundledWorkout('fight-gone-bad')).durationMs).toBe(3 * 300_000 + 2 * 60_000); // 17:00
    expect(compileWorkout(bundledWorkout('row-burpee-emom-20')).durationMs).toBe(20 * 60_000); // 20:00
    expect(compileWorkout(bundledWorkout('hyrox-pace-intervals')).durationMs).toBe(8 * 180_000 + 8 * 120_000 + 15 * 30_000); // 47:30
    expect(compileWorkout(bundledWorkout('hyrox-doubles-circuit')).durationMs).toBe(2 * (180_000 + 2 * (2 * 45_000 + 2 * 15_000))); // 14:00
    expect(compileWorkout(bundledWorkout('hyrox-engine-emom-24')).durationMs).toBe(24 * 60_000); // 24:00
    for (const id of ['partner-circuit', 'full-body-partner', 'tabata-this', 'fight-gone-bad', 'row-burpee-emom-20', 'hyrox-pace-intervals', 'hyrox-doubles-circuit', 'hyrox-engine-emom-24']) expect(compileWorkout(bundledWorkout(id)).durationKind, id).toBe('exact');
  });

  it('bounds the manual formats by their caps and marks open-ended ones', () => {
    const kinds = (id: string) => { const plan = compileWorkout(bundledWorkout(id)); return [plan.durationMs, plan.durationKind] as const; };
    expect(kinds('cindy')).toEqual([1_200_000, 'capped']);
    expect(kinds('fran')).toEqual([600_000, 'capped']);
    expect(kinds('partner-emom-16')).toEqual([960_000, 'exact']);
    expect(kinds('you-go-i-go-sprints')).toEqual([720_000, 'capped']);
    expect(kinds('run-sled-run')).toEqual([0, 'open']);
    expect(kinds('back-squat-5x5')).toEqual([4 * 120_000, 'open']);
    expect(kinds('mixed-session')).toEqual([180_000 + 2 * 90_000 + 600_000, 'open']);
    expect(compileWorkout(bundledWorkout('mixed-session')).sections.map(section => section.durationKind)).toEqual(['exact', 'open', 'capped']);
    const emom = compileWorkout(bundledWorkout('partner-emom-16'));
    expect(emom.occurrences).toHaveLength(16);
    expect(emom.occurrences[0].interval).toEqual({ index: 1, count: 16 });
    expect(emom.occurrences[1].assignments?.A.name).toBe('Burpees');
    expect(emom.occurrences[2].rounds).toEqual([{ nodeId: 'emom16-minutes', iteration: 2, count: 8 }]);
    expect(compileWorkout(bundledWorkout('cindy')).occurrences[0].tasks?.map(item => item.assignments.A.reps)).toEqual([5, 10, 15]);
    expect(compileWorkout(bundledWorkout('murph')).durationKind).toBe('capped');
    expect(bundledWorkout('nate').sections[0].format).toBe('amrap');
    const karen = compileWorkout(bundledWorkout('karen'));
    expect(karen.occurrences).toHaveLength(1);
    expect(karen.occurrences[0].timing).toBe('manual');
    expect(karen.occurrences[0].assignments?.A.reps).toBe(150);
  });

  it('covers every section format, both participant counts and more than one difficulty label', () => {
    const formats = new Set<SectionFormat>(bundledWorkouts.flatMap(workout => workout.sections.map(section => section.format)));
    for (const format of SECTION_FORMATS) expect(formats, format).toContain(format);
    expect(bundledWorkouts.filter(workout => workout.participants === 1).length).toBeGreaterThanOrEqual(4);
    expect(bundledWorkouts.filter(workout => workout.participants === 2).length).toBeGreaterThanOrEqual(4);
    expect(new Set(bundledWorkouts.map(workout => summariseWorkout(workout).difficulty.label)).size).toBeGreaterThanOrEqual(2);
    expect(bundledWorkout('tabata-this').attribution?.author).toBe('CrossFit');
    expect(bundledWorkout('hyrox-doubles-circuit').attribution?.notes).toMatch(/not.*official/i);
    for (const workout of bundledCollections.find(collection => collection.id === 'benchmarks')!.workoutIds.map(bundledWorkout)) expect(workout.attribution?.sourceUrl, workout.id).toMatch(/^https:\/\/www\.crossfit\.com\//);
  });

  it('keeps the doubles circuit swapping columns each round', () => {
    const plan = compileWorkout(bundledWorkout('hyrox-doubles-circuit'));
    const first = plan.occurrences.find(item => item.anchor === 'doubles-1-skierg' && item.rounds[0]?.iteration === 1)!;
    const second = plan.occurrences.find(item => item.anchor === 'doubles-1-skierg' && item.rounds[0]?.iteration === 2)!;
    expect(first.assignments?.A.name).toBe('SkiErg');
    expect(second.assignments?.A.name).toBe('Sled push');
  });
});
