import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration, parseWorkoutFile, serialiseWorkoutFile, WorkoutValidationError } from '../../packages/domain/src';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { readFileSync } from 'node:fs';
import { bundledWorkout } from '../../packages/domain/src/bundled';
const fullBodyPartner = bundledWorkout('full-body-partner');
const partnerCircuit = bundledWorkout('partner-circuit');
/** The timed circuits with frozen traces under tests/unit/traces. */
const timedWorkouts = ['partner-circuit', 'full-body-partner', 'tabata-this', 'fight-gone-bad', 'row-burpee-emom-20', 'hyrox-pace-intervals', 'hyrox-doubles-circuit', 'hyrox-engine-emom-24'].map(bundledWorkout);

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

  it('AT-29: compiles the supplied workout into 48:40 with explicit rests between rounds and sections and alternating columns', () => {
    const plan = compileWorkout(fullBodyPartner);
    expect(plan.durationMs).toBe(2_920_000);
    expect(plan.sections.map(section => section.durationMs)).toEqual([300_000, 580_000, 580_000, 580_000, 580_000, 300_000]);
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
    expect(file.startsWith('format: openwod.workout\nformatVersion: 3\nworkout:\n  schemaVersion: 2\n  id: full-body-partner\n')).toBe(true);
    expect(file).toContain('duration: 40s');
    expect(file).toContain('betweenChildrenRest: 20s');
    expect(file).toContain('prep: 10s');
    expect(file).not.toContain('Ms:');
    expect(file).not.toContain('voiceURI');
    expect(parseWorkoutFile(file)).toEqual(fullBodyPartner);
    expect(compileWorkout(parseWorkoutFile(file)).durationMs).toBe(2_920_000);
    expect(() => parseWorkoutFile(file.replace('formatVersion: 3', 'formatVersion: 99'))).toThrow(/newer than this app/);
    expect(() => parseWorkoutFile(file.replace('format: openwod.workout', 'format: other'))).toThrow(/not an OpenWOD workout/);
    expect(() => parseWorkoutFile('<script>alert(1)</script>')).toThrow(/not an OpenWOD workout|valid YAML/);
    expect(() => parseWorkoutFile('{"formatVersion":99}')).toThrow(/not an OpenWOD workout/);
  });

  it('rejects the pre-release file versions, YAML aliases and duplicate keys', () => {
    const version1 = JSON.stringify({ format: 'openwod.workout', formatVersion: 1, workout: { ...partnerCircuit, schemaVersion: 1 } });
    expect(() => parseWorkoutFile(version1)).toThrow(/version 1 is no longer read/);
    const version2 = serialiseWorkoutFile(partnerCircuit).replace('formatVersion: 3', 'formatVersion: 2').replace('schemaVersion: 2', 'schemaVersion: 1');
    expect(() => parseWorkoutFile(version2)).toThrow(/version 2 is no longer read/);
    expect(() => parseWorkoutFile(JSON.stringify({ format: 'openwod.workout', formatVersion: 3, workout: { ...partnerCircuit, schemaVersion: 3 } }))).toThrow(/Unsupported|newer/);
    const bomb = 'format: openwod.workout\nformatVersion: 3\nworkout: &w\n  title: x\nother: *w\n';
    expect(() => parseWorkoutFile(bomb)).toThrow(/valid YAML/);
    expect(() => parseWorkoutFile('format: openwod.workout\nformat: openwod.workout\nformatVersion: 3\n')).toThrow(/valid YAML/);
    expect(() => parseWorkoutFile(JSON.stringify({ format: 'openwod.workout', formatVersion: 3, workout: partnerCircuit }))).toThrow(/Unsupported/); // *Ms keys are not file keys
  });

  it('reads human durations and rejects ambiguous ones', () => {
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

  it('keeps every timed fixture on its frozen trace (ids, offsets, durations, rounds, assignments)', () => {
    for (const workout of timedWorkouts) {
      const frozen = JSON.parse(readFileSync(new URL(`./traces/${workout.id}.json`, import.meta.url), 'utf8'));
      const plan = compileWorkout(workout);
      const trace = {
        durationMs: plan.durationMs,
        sections: plan.sections.map(({ id, startIndex, endIndex, startMs, durationMs, transitionAfter }) => ({ id, startIndex, endIndex, startMs, durationMs, transitionAfter })),
        occurrences: plan.occurrences.map(({ id, anchor, sectionIndex, phase, startMs, durationMs, rounds, assignments }) => ({ id, anchor, sectionIndex, phase, startMs, durationMs, rounds, A: assignments?.A.name, B: assignments?.B?.name })),
      };
      expect(trace, workout.id).toEqual(frozen);
    }
  });
});
