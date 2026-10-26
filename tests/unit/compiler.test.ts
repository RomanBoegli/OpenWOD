import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration, parseWorkoutFile, serialiseWorkoutFile, WorkoutValidationError } from '../../packages/domain/src';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { fullBodyPartner, partnerCircuit } from '../../packages/domain/src/fixtures';

describe('canonical workout compiler', () => {
  it('AT-01: produces exactly 19:50 active and 20:00 with prep, with no trailing rest', () => {
    const plan = compileWorkout(partnerCircuit);
    expect(plan.durationMs).toBe(1_190_000);
    expect(plan.durationMs + plan.workout.prepMs).toBe(1_200_000);
    expect(plan.occurrences.filter(item => item.phase === 'work')).toHaveLength(20);
    expect(plan.occurrences.at(-1)?.phase).toBe('work');
    expect(new Set(plan.occurrences.map(item => item.id)).size).toBe(plan.occurrences.length);
  });

  it('AT-02: resolves two rounds to 7:20 and returns to slot 1 at 4:10', () => {
    const workout = structuredClone(partnerCircuit);
    if (workout.sections[0].body.type !== 'repeat') throw new Error('Invalid fixture.');
    workout.sections[0].body.count = 2;
    const plan = compileWorkout(workout);
    expect(plan.durationMs).toBe(440_000);
    const secondRound = plan.occurrences.find(item => item.startMs === 250_000)!;
    expect(secondRound.anchor).toBe('slot-1');
    expect(secondRound.rounds[0].iteration).toBe(2);
    expect(secondRound.assignments?.A.name).toBe('Row');
  });

  it('AT-29: compiles the supplied workout into 50 minutes with explicit trailing rests and alternating columns', () => {
    const plan = compileWorkout(fullBodyPartner);
    expect(plan.durationMs).toBe(3_000_000);
    expect(plan.sections.map(section => section.durationMs)).toEqual([300_000, 600_000, 600_000, 600_000, 600_000, 300_000]);
    const first = plan.occurrences.find(item => item.anchor === 'block-1-slot-1' && item.rounds[0].iteration === 1)!;
    const second = plan.occurrences.find(item => item.anchor === first.anchor && item.rounds[0].iteration === 2)!;
    expect(first.assignments?.A.name).toBe('Air squats');
    expect(second.assignments?.A.name).toBe('Dumbbell thrusters');
    expect(second.assignments?.B?.name).toBe('Air squats');
    expect(plan.occurrences[plan.sections[4].endIndex].durationMs).toBe(120_000);
    expect(plan.occurrences[plan.sections[4].endIndex].phase).toBe('blockRest');
  });

  it('AT-23: distinguishes nested repeat paths and between-set/round rest', () => {
    const workout = structuredClone(partnerCircuit);
    const body = workout.sections[0].body;
    if (body.type !== 'repeat') throw new Error('Invalid fixture.');
    body.count = 2;
    workout.sections[0].body = { id: 'sets', type: 'repeat', count: 2, betweenIterationsRestMs: 120_000, body };
    const plan = compileWorkout(workout);
    expect(plan.durationMs).toBe(2 * 440_000 + 120_000);
    expect(plan.occurrences.find(item => item.startMs === 560_000)?.rounds.map(round => round.iteration)).toEqual([2, 1]);
  });

  it('rejects duplicate IDs, negative durations, mismatched athletes, and excessive expansion', () => {
    const duplicate = structuredClone(partnerCircuit);
    duplicate.sections[0].id = duplicate.id;
    expect(() => compileWorkout(duplicate)).toThrow(WorkoutValidationError);
    expect(() => compileWorkout({ ...partnerCircuit, prepMs: -1 })).toThrow(WorkoutValidationError);
    expect(() => compileWorkout({ ...partnerCircuit, participants: 1 })).toThrow(/athlete count/);
    const large = structuredClone(partnerCircuit);
    const body = large.sections[0].body;
    if (body.type !== 'repeat') throw new Error('Invalid fixture.');
    body.count = 999;
    large.sections[0].body = { id: 'outer', type: 'repeat', count: 999, body };
    expect(() => compileWorkout(large)).toThrow(/10,000|24 hours/);
  });

  it('exports self-contained YAML fixtures that round-trip without personal session settings', () => {
    const file = serialiseWorkoutFile(fullBodyPartner);
    expect(file.startsWith('format: wodva.workout\nformatVersion: 2\nworkout:\n  schemaVersion: 1\n  id: full-body-partner\n')).toBe(true);
    expect(file).toContain('duration: 40s');
    expect(file).toContain('betweenChildrenRest: 20s');
    expect(file).toContain('prep: 10s');
    expect(file).not.toContain('Ms:');
    expect(file).not.toContain('voiceURI');
    expect(parseWorkoutFile(file)).toEqual(fullBodyPartner);
    expect(compileWorkout(parseWorkoutFile(file)).durationMs).toBe(3_000_000);
    expect(() => parseWorkoutFile(file.replace('formatVersion: 2', 'formatVersion: 99'))).toThrow(/newer than this app/);
    expect(() => parseWorkoutFile(file.replace('format: wodva.workout', 'format: other'))).toThrow(/not a Wodva workout/);
    expect(() => parseWorkoutFile('<script>alert(1)</script>')).toThrow(/not a Wodva workout|valid YAML/);
    expect(() => parseWorkoutFile('{"formatVersion":99}')).toThrow(/not a Wodva workout/);
  });

  it('still reads version 1 JSON files and rejects YAML aliases and duplicate keys', () => {
    const legacy = JSON.stringify({ format: 'wodva.workout', formatVersion: 1, workout: partnerCircuit });
    expect(parseWorkoutFile(legacy)).toEqual(partnerCircuit);
    const bomb = 'format: wodva.workout\nformatVersion: 2\nworkout: &w\n  title: x\nother: *w\n';
    expect(() => parseWorkoutFile(bomb)).toThrow(/valid YAML/);
    expect(() => parseWorkoutFile('format: wodva.workout\nformat: wodva.workout\nformatVersion: 2\n')).toThrow(/valid YAML/);
    expect(() => parseWorkoutFile(JSON.stringify({ format: 'wodva.workout', formatVersion: 2, workout: partnerCircuit }))).toThrow(/Unsupported/); // *Ms keys are version 1 only
  });

  it('reads human durations in version 2 files and rejects ambiguous ones', () => {
    const file = serialiseWorkoutFile(partnerCircuit).replace('duration: 40s', 'duration: 0:40').replace('betweenIterationsRest: 1m', 'betweenIterationsRest: 60').replace('prep: 10s', 'prep: 10000ms');
    expect(compileWorkout(parseWorkoutFile(file)).durationMs).toBe(1_190_000);
    expect(parseWorkoutFile(file).prepMs).toBe(10_000);
    expect(() => parseWorkoutFile(serialiseWorkoutFile(partnerCircuit).replace('duration: 40s', 'duration: forty'))).toThrow(WorkoutValidationError);
    expect(() => parseWorkoutFile(serialiseWorkoutFile(partnerCircuit).replace('prep: 10s', 'prep: 10s\n  prepMs: 10000'))).toThrow(/not both|Unsupported/);
    expect(parseDuration('1m30s')).toBe(90_000);
    expect(parseDuration('1:02:03')).toBe(3_723_000);
    expect(parseDuration('0.5s')).toBe(500);
    expect(parseDuration(45)).toBe(45_000);
    expect(() => parseDuration('1:75')).toThrow();
    expect(() => parseDuration('')).toThrow();
    expect(() => parseDuration(-1)).toThrow();
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(90_000)).toBe('1m30s');
    expect(formatDuration(3_600_000)).toBe('1h');
    expect(formatDuration(1_500)).toBe('1.5s');
  });

  it('keeps authored nodes distinct from generated rest occurrences with similar names', () => {
    const workout = structuredClone(partnerCircuit);
    const repeat = workout.sections[0].body;
    if (repeat.type !== 'repeat' || repeat.body.type !== 'sequence') throw new Error('Invalid fixture.');
    repeat.body.children[0].id = 'stations:between:1';
    const plan = compileWorkout(workout);
    expect(new Set(plan.occurrences.map(item => item.id)).size).toBe(plan.occurrences.length);
  });
});
