import { describe, expect, it } from 'vitest';
import { durationBucket, equipmentOptions, matchesFilter, sortSummaries, summariseWorkout } from '../../packages/domain/src/library';
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
    expect(circuit.movements).toEqual(['Row', 'Kettlebell swings', 'Burpees', 'Air squats']);
    expect(fullBody.sections).toBe(6);
    expect(fullBody.movements).toContain('Dumbbell thrusters');
    expect(new Set(fullBody.movements).size).toBe(fullBody.movements.length);
  });

  it('LIB-04: searches titles, descriptions, movements and equipment with every token required', () => {
    expect(matchesFilter(circuit, { query: 'row' })).toBe(true);
    expect(matchesFilter(fullBody, { query: 'row' })).toBe(true); // "Bent-over rows"
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
    expect(matchesFilter(circuit, { equipment: ['Dumbbells', 'Rowing machine'] })).toBe(true); // any of
    expect(matchesFilter(circuit, { onlyEquipment: ['Rowing machine'] })).toBe(false);
    expect(matchesFilter(circuit, { onlyEquipment: ['rowing machine', 'Kettlebells'] })).toBe(true);
    expect(matchesFilter(circuit, { format: ['amrap'] })).toBe(false);
    expect(matchesFilter(circuit, { format: ['amrap', 'timedCircuit'] })).toBe(true);
    expect(matchesFilter({ ...circuit, collections: ['benchmarks'] }, { collections: ['benchmarks'] })).toBe(true);
    expect(matchesFilter(circuit, { collections: ['benchmarks'] })).toBe(false);
    expect(summariseWorkout(partnerCircuit, { canonicalEquipment: name => name === 'Kettlebell' ? 'KB' : name }).equipmentNeeded).toEqual(['Rowing machine', 'KB']);
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

  it('sorts by title or duration and lists equipment once', () => {
    expect(sortSummaries([fullBody, circuit], 'title').map(item => item.id)).toEqual(['full-body-partner', 'partner-circuit']);
    expect(sortSummaries([fullBody, circuit], 'shortest').map(item => item.id)).toEqual(['partner-circuit', 'full-body-partner']);
    expect(sortSummaries([circuit, fullBody], 'longest').map(item => item.id)).toEqual(['full-body-partner', 'partner-circuit']);
    expect(sortSummaries([circuit, fullBody], 'easiest').map(item => item.id)).toEqual(['partner-circuit', 'full-body-partner']);
    expect(sortSummaries([circuit, fullBody], 'hardest').map(item => item.id)).toEqual(['full-body-partner', 'partner-circuit']);
    expect(equipmentOptions([circuit, fullBody, { ...circuit, equipment: ['kettlebell'] }])).toEqual(['Dumbbells', 'Exercise mat', 'Kettlebell', 'Rowing machine']);
  });
});
