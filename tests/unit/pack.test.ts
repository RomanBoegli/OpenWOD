import { describe, expect, it } from 'vitest';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { serialiseWorkoutFile } from '../../packages/domain/src/exchange';
import { normaliseForComparison, parsePackFile, parseSharedFile, serialisePackFile, type WorkoutPack } from '../../packages/domain/src/pack';
import { WorkoutValidationError } from '../../packages/domain/src/validate';

const pack = (): WorkoutPack => ({ title: 'Benchmarks to go', workouts: [bundledWorkout('fran'), bundledWorkout('cindy')], collections: [{ title: 'Girls', description: 'Two of them', workoutIds: ['fran', 'cindy'] }] });

describe('workout packs', () => {
  it('round-trips through canonical YAML with the sharing identity kept and ids remappable', () => {
    const text = serialisePackFile(pack());
    expect(text.startsWith('format: openwod.workoutPack\nformatVersion: 1\ntitle: Benchmarks to go\nworkouts:\n')).toBe(true);
    expect(text).toContain('sharing:\n      id: openwod.bundled:fran\n      sourceRevision: 1');
    const parsed = parsePackFile(text);
    expect(parsed.title).toBe('Benchmarks to go');
    expect(parsed.workouts.map(workout => workout.id)).toEqual(['fran', 'cindy']);
    expect(parsed.collections).toEqual([{ title: 'Girls', description: 'Two of them', workoutIds: ['fran', 'cindy'] }]);
    expect(parsed.workouts[0].sharing).toEqual({ id: 'openwod.bundled:fran', sourceRevision: 1 });
    // SHR-06: the comparison form ignores local identity, so a renamed copy still means the same workout.
    const copy = { ...parsed.workouts[0], id: 'fran-2', revision: 7, sharing: undefined };
    expect(normaliseForComparison(copy)).toEqual(normaliseForComparison(bundledWorkout('fran')));
    expect(compileWorkout(parsed.workouts[0]).durationMs).toBe(compileWorkout(bundledWorkout('fran')).durationMs);
  });

  it('rejects anchors, wrong discriminators, newer versions, dangling collection references and oversized packs', () => {
    const base = serialisePackFile(pack());
    expect(() => parsePackFile(base.replace('title: Benchmarks to go', 'title: &t Benchmarks\ndescription: *t'))).toThrow(WorkoutValidationError);
    expect(() => parsePackFile(serialiseWorkoutFile(bundledWorkout('fran')))).toThrow(/not an OpenWOD workout pack/);
    expect(() => parsePackFile(base.replace('formatVersion: 1', 'formatVersion: 2'))).toThrow(/newer than this app/);
    expect(() => parsePackFile(base.replace('      - cindy\n', '      - nope\n'))).toThrow(/refers to "nope"/);
    const many: WorkoutPack = { workouts: Array.from({ length: 201 }, (_, i) => ({ ...bundledWorkout('fran'), id: `fran-${i}` })), collections: [] };
    expect(() => parsePackFile(serialisePackFile(many))).toThrow(WorkoutValidationError);
  });

  it('reads either kind of shared file by its discriminator', () => {
    expect(parseSharedFile(serialiseWorkoutFile(bundledWorkout('fran'))).kind).toBe('workout');
    expect(parseSharedFile(serialisePackFile(pack())).kind).toBe('pack');
    expect(() => parseSharedFile('format: something.else\n')).toThrow(/not an OpenWOD workout file or pack/);
  });
});
