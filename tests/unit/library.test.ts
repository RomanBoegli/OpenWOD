import { describe, expect, it } from 'vitest';
import { freeWorkoutId, slugify } from '../../packages/domain/src/library';
import { durationBucket, equipmentName, equipmentOptions, inferEquipment, matchesFilter, sortSummaries, summariseWorkout } from '../../packages/domain/src/library';
import { bundledWorkout } from '../../packages/domain/src/bundled';
const fullBodyPartner = bundledWorkout('full-body-partner');
const partnerCircuit = bundledWorkout('partner-circuit');

const circuit = summariseWorkout(partnerCircuit);
const fullBody = summariseWorkout(fullBodyPartner);

describe('library summaries and filters', () => {
  it('summarises duration, athletes, equipment and unique movements in authored order', () => {
    expect(circuit.activeMs).toBe(1_190_000);
    expect(circuit.totalMs).toBe(1_200_000);
    expect(circuit.participants).toBe(2);
    expect(circuit.movements).toEqual(['Row', 'Kettlebell Swings', 'Burpees', 'Air Squats']);
    expect(fullBody.sections).toBe(6);
    expect(fullBody.movements).toContain('Dumbbell Thrusters');
    expect(new Set(fullBody.movements).size).toBe(fullBody.movements.length);
  });

  it('LIB-04: searches titles, descriptions, movements and equipment with every token required', () => {
    expect(matchesFilter(circuit, { query: 'row' })).toBe(true);
    expect(matchesFilter(fullBody, { query: 'row' })).toBe(true); // "Bent-Over Rows"
    expect(matchesFilter(fullBody, { query: 'kettlebell' })).toBe(false);
    expect(matchesFilter(circuit, { query: 'KETTLEBELL   swings' })).toBe(true);
    expect(matchesFilter(circuit, { query: 'kettlebell dumbbell' })).toBe(false);
    expect(matchesFilter(circuit, { query: '   ' })).toBe(true);
    expect(matchesFilter(fullBody, { query: 'hyrox' })).toBe(false);
  });

  it('filters by athletes, equipment and duration bucket', () => {
    expect(matchesFilter(circuit, { participants: 1 })).toBe(false);
    expect(matchesFilter(circuit, { participants: 2 })).toBe(true);
    expect(matchesFilter(circuit, { equipment: ['kettlebell'] })).toBe(true);
    expect(matchesFilter(circuit, { equipment: ['Dumbbells'] })).toBe(false);
    expect(matchesFilter(circuit, { equipment: ['Dumbbells', 'Rowing Machine'] })).toBe(true); // any of
    expect(matchesFilter(circuit, { onlyEquipment: ['Rowing Machine'] })).toBe(false);
    expect(matchesFilter(circuit, { onlyEquipment: ['rowing machine', 'Kettlebells'] })).toBe(true);
    expect(matchesFilter(circuit, { format: ['amrap'] })).toBe(false);
    expect(matchesFilter(circuit, { format: ['amrap', 'timedCircuit'] })).toBe(true);
    expect(matchesFilter({ ...circuit, collections: ['benchmarks'] }, { collections: ['benchmarks'] })).toBe(true);
    expect(matchesFilter(circuit, { collections: ['benchmarks'] })).toBe(false);
    expect(summariseWorkout(partnerCircuit, { canonicalEquipment: name => name === 'Kettlebell' ? 'KB' : name }).equipmentNeeded).toEqual(['Rowing Machine', 'KB']);
    expect(durationBucket(circuit.totalMs)).toBe('short');
    expect(durationBucket(fullBody.totalMs)).toBe('long');
    expect(durationBucket(20 * 60_000 + 1)).toBe('medium');
    expect(matchesFilter(fullBody, { duration: ['long'], query: 'burpees' })).toBe(true);
    expect(matchesFilter(fullBody, { duration: ['short'] })).toBe(false);
    expect(matchesFilter(fullBody, { duration: ['short', 'long'] })).toBe(true);
    expect(circuit.difficulty.label).toBe('Hard');
    expect(matchesFilter(circuit, { difficulty: [3] })).toBe(true);
    expect(matchesFilter(circuit, { difficulty: [1, 2] })).toBe(false);
  });

  it('infers a resistance band from a band movement the catalogue does not know, and from no other word', () => {
    for (const name of ['Band Walks', 'Banded Good Mornings', 'Mini-Band Lateral Walks', 'Miniband Squats', 'Resistance Band Face Pulls', 'Monster Bands']) expect(inferEquipment([name]), name).toEqual(['Resistance Band']);
    for (const name of ['IT Band Stretch', 'IT-Band Roll', 'Iliotibial Band Stretch', 'Husband Carry', 'Bandage Wraps', 'Headband Toss']) expect(inferEquipment([name]), name).toEqual([]);
    expect(inferEquipment(['Band-Assisted Pull-Ups'])).toEqual(['Pull-Up Bar', 'Resistance Band']);
    // A lift done against a band is not a barbell lift, unless the name says so.
    expect(inferEquipment(['Band Deadlifts'])).toEqual(['Resistance Band']);
    expect(inferEquipment(['Banded Barbell Deadlifts'])).toEqual(['Barbell', 'Resistance Band']);
  });

  it('sorts by title or duration and lists equipment once', () => {
    expect(sortSummaries([fullBody, circuit], 'title').map(item => item.id)).toEqual(['full-body-partner', 'partner-circuit']);
    expect(sortSummaries([fullBody, circuit], 'shortest').map(item => item.id)).toEqual(['partner-circuit', 'full-body-partner']);
    expect(sortSummaries([circuit, fullBody], 'longest').map(item => item.id)).toEqual(['full-body-partner', 'partner-circuit']);
    expect(sortSummaries([circuit, fullBody], 'easiest').map(item => item.id)).toEqual(['partner-circuit', 'full-body-partner']);
    expect(sortSummaries([circuit, fullBody], 'hardest').map(item => item.id)).toEqual(['full-body-partner', 'partner-circuit']);
    expect(equipmentOptions([circuit, fullBody, { ...circuit, equipment: ['kettlebell'] }])).toEqual(['Dumbbells', 'Exercise Mat', 'Kettlebell', 'Rowing Machine']);
  });

  it('shows equipment names in Title Case however they were written', () => {
    const cases = [['pull-up bar', 'Pull-Up Bar'], ['Rowing machine', 'Rowing Machine'], ['treadmill or running route', 'Treadmill or Running Route'], ['  ab   wheel ', 'Ab Wheel'], ['bench (flat)', 'Bench (Flat)'],
      ['SkiErg', 'SkiErg'], ['GHD', 'GHD'], ['kettlebell 16 kg', 'Kettlebell 16 kg'], ['20kg plate', '20kg Plate'], ['Pull-Up Bar', 'Pull-Up Bar']];
    for (const [written, shown] of cases) expect(equipmentName(written), written).toBe(shown);
    // A workout saved by an older build keeps its spelling in the file and shows the new one, also after a merge.
    const older = { ...partnerCircuit, equipment: ['Rowing machine', 'kettlebell', 'Exercise mat'] };
    expect(summariseWorkout(older).equipmentNeeded).toEqual(['Rowing Machine', 'Kettlebell', 'Exercise Mat']);
    expect(summariseWorkout(older, { canonicalEquipment: name => name === 'Exercise mat' ? 'yoga mat' : name }).equipmentNeeded).toEqual(['Rowing Machine', 'Kettlebell', 'Yoga Mat']);
  });
});

describe('workout ids for copies', () => {
  it('slugifies titles and appends a counter only when the id is taken', () => {
    expect(slugify('Fran: Thrusters & Pull-ups!')).toBe('fran-thrusters-pull-ups');
    expect(slugify('Élan vital')).toBe('elan-vital');
    expect(slugify('')).toBe('workout');
    expect(freeWorkoutId('fran', new Set())).toBe('fran');
    expect(freeWorkoutId('fran', new Set(['fran']))).toBe('fran-2');
    expect(freeWorkoutId('fran', new Set(['fran', 'fran-2']))).toBe('fran-3');
    expect(freeWorkoutId('x'.repeat(120), new Set(['x'.repeat(120)])).length).toBeLessThanOrEqual(120);
  });
});
