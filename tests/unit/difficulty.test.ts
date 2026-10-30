import { describe, expect, it } from 'vitest';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { movementIntensity, normaliseCalibration, rateDifficulty } from '../../packages/domain/src/difficulty';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import type { Workout } from '../../packages/domain/src';
const fullBodyPartner = bundledWorkout('full-body-partner');
const partnerCircuit = bundledWorkout('partner-circuit');

const soloTimed = (id: string, names: string[], durationMs: number, restMs = 0): Workout => ({
  schemaVersion: 2, id, revision: 1, title: id, equipment: [], participants: 1, prepMs: 0,
  sections: [{ id: `${id}-s`, title: 'Main', format: 'timedCircuit', transitionAfter: 'manualReady', body: { id: `${id}-seq`, type: 'sequence', betweenChildrenRestMs: restMs, children: names.map((name, index) => ({ id: `${id}-${index}`, type: 'timed', durationMs, assignments: { A: { name } } })) } }],
});

describe('projected difficulty', () => {
  it('classifies movements by name with a medium default', () => {
    expect(movementIntensity('Quad Stretch')).toBeLessThan(movementIntensity('Air Squats'));
    expect(movementIntensity('Air Squats')).toBeLessThan(movementIntensity('Burpees'));
    expect(movementIntensity('Dumbbell Thrusters')).toBe(0.9);
    expect(movementIntensity('Something unusual')).toBe(0.5);
  });

  it('rates stretching as Light, one short Tabata as Moderate and forty minutes of it as Brutal', () => {
    const stretch = rateDifficulty(compileWorkout(soloTimed('stretch', ['Quad Stretch', 'Hamstring Stretch', 'Deep Breathing'], 60_000)));
    expect(stretch.label).toBe('Light');
    const tabata = rateDifficulty(compileWorkout(soloTimed('tabata', Array(8).fill('Burpees'), 20_000, 10_000)));
    expect(tabata.label).toBe('Moderate');
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

  it('discounts short pieces and honours the device calibration', () => {
    const short = compileWorkout(soloTimed('short', ['Dumbbell Front Rack Lunges', 'Dumbbell Front Rack Lunges'], 70_000));
    const rating = rateDifficulty(short);
    expect(rating.label).toBe('Light');
    expect(rating.factors.length).toBeCloseTo(Math.sqrt(140 / 60 / 15), 5);
    const eager = rateDifficulty(short, normaliseCalibration({ fullEffortMinutes: 3, thresholds: { moderate: 10, hard: 20, brutal: 30 } }));
    expect(eager.score).toBeGreaterThan(rating.score);
    expect(eager.label).toBe('Brutal');
    expect(rateDifficulty(short, normaliseCalibration({ weights: { effort: 0, duration: 100, load: 0 } })).score).toBe(0);
  });

  it('normalises a calibration: clamps, orders the thresholds, keeps the long mark above the full-effort mark', () => {
    expect(normaliseCalibration(undefined)).toEqual({ fullEffortMinutes: 15, longMinutes: 60, weights: { effort: 75, duration: 15, load: 10 }, thresholds: { moderate: 25, hard: 45, brutal: 62 } });
    const odd = normaliseCalibration({ fullEffortMinutes: 400, longMinutes: 5, weights: { effort: 0, duration: 0, load: 0 }, thresholds: { moderate: 80, hard: 40, brutal: 20 } });
    expect(odd.fullEffortMinutes).toBe(60);
    expect(odd.longMinutes).toBe(65);
    expect(odd.weights.effort).toBe(1);
    expect(odd.thresholds).toEqual({ moderate: 80, hard: 80, brutal: 80 });
  });

  it('is monotonic in work density, duration and prescribed load', () => {
    const base = soloTimed('base', ['Push-Ups', 'Air Squats'], 40_000, 20_000);
    const denser = soloTimed('denser', ['Push-Ups', 'Air Squats'], 50_000, 0); // The same 100 seconds with the rest turned into work.
    expect(rateDifficulty(compileWorkout(denser)).score).toBeGreaterThan(rateDifficulty(compileWorkout(base)).score);
    const longer = soloTimed('longer', Array(30).fill('Push-Ups'), 60_000, 20_000);
    expect(rateDifficulty(compileWorkout(longer)).score).toBeGreaterThan(rateDifficulty(compileWorkout(base)).score);
    const loaded = structuredClone(base);
    const sequence = loaded.sections[0].body;
    if (sequence.type !== 'sequence') throw new Error('fixture');
    for (const child of sequence.children) if (child.type === 'timed') child.assignments.A.load = { value: 20, unit: 'kg' };
    expect(rateDifficulty(compileWorkout(loaded)).score).toBeGreaterThan(rateDifficulty(compileWorkout(base)).score);
  });
});
