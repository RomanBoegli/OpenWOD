import { describe, expect, it } from 'vitest';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { movementIntensity, rateDifficulty } from '../../packages/domain/src/difficulty';
import { fullBodyPartner, partnerCircuit } from '../../packages/domain/src/fixtures';
import type { Workout } from '../../packages/domain/src';

const soloTimed = (id: string, names: string[], durationMs: number, restMs = 0): Workout => ({
  schemaVersion: 2, id, revision: 1, title: id, equipment: [], participants: 1, prepMs: 0,
  sections: [{ id: `${id}-s`, title: 'Main', format: 'timedCircuit', transitionAfter: 'manualReady', body: { id: `${id}-seq`, type: 'sequence', betweenChildrenRestMs: restMs, children: names.map((name, index) => ({ id: `${id}-${index}`, type: 'timed', durationMs, assignments: { A: { name } } })) } }],
});

describe('projected difficulty', () => {
  it('classifies movements by name with a medium default', () => {
    expect(movementIntensity('Quad stretch')).toBeLessThan(movementIntensity('Air squats'));
    expect(movementIntensity('Air squats')).toBeLessThan(movementIntensity('Burpees'));
    expect(movementIntensity('Dumbbell thrusters')).toBe(0.9);
    expect(movementIntensity('Something unusual')).toBe(0.5);
  });

  it('rates stretching as Light and dense high-intensity intervals as Brutal', () => {
    const stretch = rateDifficulty(compileWorkout(soloTimed('stretch', ['Quad stretch', 'Hamstring stretch', 'Deep breathing'], 60_000)));
    expect(stretch.label).toBe('Light');
    const tabata = rateDifficulty(compileWorkout(soloTimed('tabata', Array(8).fill('Burpees'), 20_000, 10_000)));
    expect(tabata.label).toBe('Hard');
    expect(tabata.factors.density).toBeCloseTo(160 / 230, 5);
    const fortyMinutes = rateDifficulty(compileWorkout(soloTimed('long-tabata', Array(80).fill('Burpees'), 20_000, 10_000)));
    expect(fortyMinutes.label).toBe('Brutal');
    expect(fortyMinutes.score).toBeGreaterThan(tabata.score);
  });

  it('rates the bundled fixtures in the middle of the scale and keeps the score within 0..100', () => {
    const circuit = rateDifficulty(compileWorkout(partnerCircuit));
    const fullBody = rateDifficulty(compileWorkout(fullBodyPartner));
    expect(circuit.label).toBe('Hard');
    expect(fullBody.label).toBe('Hard');
    for (const rating of [circuit, fullBody]) { expect(rating.score).toBeGreaterThanOrEqual(0); expect(rating.score).toBeLessThanOrEqual(100); }
  });

  it('is monotonic in work density, duration and prescribed load', () => {
    const base = soloTimed('base', ['Push-ups', 'Air squats'], 40_000, 20_000);
    const denser = soloTimed('denser', ['Push-ups', 'Air squats'], 40_000, 5_000);
    expect(rateDifficulty(compileWorkout(denser)).score).toBeGreaterThan(rateDifficulty(compileWorkout(base)).score);
    const longer = soloTimed('longer', Array(30).fill('Push-ups'), 60_000, 20_000);
    expect(rateDifficulty(compileWorkout(longer)).score).toBeGreaterThan(rateDifficulty(compileWorkout(base)).score);
    const loaded = structuredClone(base);
    const sequence = loaded.sections[0].body;
    if (sequence.type !== 'sequence') throw new Error('fixture');
    for (const child of sequence.children) if (child.type === 'timed') child.assignments.A.load = { value: 20, unit: 'kg' };
    expect(rateDifficulty(compileWorkout(loaded)).score).toBeGreaterThan(rateDifficulty(compileWorkout(base)).score);
  });
});
