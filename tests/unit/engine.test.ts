import { describe, expect, it } from 'vitest';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import { WorkoutEngine, displayTime, warningLevel, type CommandType } from '../../packages/engine/src';
const fullBodyPartner = bundledWorkout('full-body-partner');
const partnerCircuit = bundledWorkout('partner-circuit');

function fixture(workout = partnerCircuit) {
  let now = 0;
  let id = 0;
  const engine = new WorkoutEngine(compileWorkout(workout), () => now, 'test');
  return { engine, at(ms: number) { now = ms; engine.tick(); }, command(type: CommandType) { return engine.command({ type, id: String(++id), occurrenceId: engine.occurrenceId }); } };
}

describe('deterministic workout engine', () => {
  it('AT-01/03: excludes prep, changes lanes in place, and completes without a final Ready gate', () => {
    const { engine, at, command } = fixture();
    command('play'); at(9999);
    expect(engine.project().status).toBe('preparing');
    expect(engine.readClocks().activeMs).toBe(0);
    at(10_000);
    expect(engine.project().current.assignments?.A.name).toBe('Row');
    at(50_000);
    expect(engine.project().current.phase).toBe('transition');
    expect(engine.project().nextWork?.assignments?.A.name).toBe('Kettlebell swings');
    at(60_000);
    expect(engine.project().current.assignments?.A.name).toBe('Kettlebell swings');
    expect(engine.project().current.assignments?.B?.name).toBe('Row');
    at(1_200_000);
    expect(engine.project().status).toBe('completed');
    expect(engine.readClocks().activeMs).toBe(1_190_000);
    expect(engine.project().nextWork).toBeUndefined();
  });

  it('AT-09: freezes with 23 seconds remaining and excludes a 30-second pause', () => {
    const { engine, at, command } = fixture();
    command('play'); at(27_000); command('pause');
    at(57_000);
    expect(engine.readClocks().remainingMs).toBe(23_000);
    expect(engine.readClocks().activeMs).toBe(17_000);
    command('resume'); at(80_000);
    expect(engine.project().current.phase).toBe('transition');
    expect(engine.readClocks().activeMs).toBe(40_000);
    expect(engine.project().modified).toBe(true);
  });

  it('pauses prep without consuming scored time or restarting the countdown', () => {
    const { engine, at, command } = fixture();
    command('play'); at(7000); command('pause'); at(50_000); command('resume'); at(53_000);
    expect(engine.project().status).toBe('running');
    expect(engine.readClocks().activeMs).toBe(0);
  });

  it('AT-10: catches up all due semantic boundaries exactly once after a delayed callback', () => {
    const { engine, at, command } = fixture();
    command('play'); at(260_000);
    expect(engine.project().current.anchor).toBe('slot-1');
    expect(engine.project().current.rounds[0].iteration).toBe(2);
    expect(engine.readClocks().remainingMs).toBe(40_000);
    expect(engine.events.filter(event => event.type === 'occurrenceEnded')).toHaveLength(8);
    const count = engine.events.length;
    at(260_000);
    expect(engine.events).toHaveLength(count);
    expect(new Set(engine.events.map(event => event.id)).size).toBe(count);
  });

  it('rejects duplicate/stale commands and seeking keeps section time while resetting slot time', () => {
    const { engine, at, command } = fixture();
    command('play'); at(20_000);
    const input = { id: 'skip', type: 'next' as const, occurrenceId: engine.occurrenceId };
    expect(engine.command(input)).toBe(true);
    expect(engine.command(input)).toBe(false);
    expect(engine.command({ ...input, id: 'another-click' })).toBe(false);
    expect(engine.project().current.phase).toBe('transition');
    expect(engine.readClocks().sectionMs).toBe(10_000);
    expect(engine.readClocks().slotMs).toBe(0);
    command('previous');
    expect(engine.project().current.anchor).toBe('slot-1');
    expect(engine.project().occurrenceId).not.toBe(input.occurrenceId);
    at(25_000);
    const beforeRestart = engine.project().occurrenceId;
    command('previous'); // At the section's first occurrence: restart it rather than leaving the section.
    expect(engine.project().current.anchor).toBe('slot-1');
    expect(engine.project().occurrenceId).not.toBe(beforeRestart);
    expect(engine.readClocks().slotMs).toBe(0);
    expect(engine.readClocks().sectionMs).toBe(15_000);
  });

  it('stops at a manual section gate even after a long callback delay and excludes readiness waits', () => {
    const { engine, at, command } = fixture(fullBodyPartner);
    command('play'); at(1_000_000);
    expect(engine.project().status).toBe('awaitingReady');
    expect(engine.readClocks().activeMs).toBe(300_000);
    expect(engine.project().section.id).toBe('block-1');
    command('ready'); at(1_040_000);
    expect(engine.readClocks().activeMs).toBe(340_000);
    expect(engine.project().current.phase).toBe('transition');
  });

  it('AT-09: uses scaled warning thresholds and ceiling display without a lingering zero', () => {
    expect(displayTime(23_001)).toBe('00:24');
    expect(displayTime(999, 'floor')).toBe('00:00');
    expect(warningLevel(2501, 10_000)).toBe('normal');
    expect(warningLevel(2500, 10_000)).toBe('amber');
    expect(warningLevel(1000, 10_000)).toBe('red');
    expect(warningLevel(14_000, 120_000, { amberMs: 15_000, redMs: 5000 })).toBe('amber');
    expect(warningLevel(4000, 120_000, { amberMs: 15_000, redMs: 5000 })).toBe('red');
    expect(warningLevel(4000, 20_000, { amberMs: 15_000, redMs: 5000 })).toBe('amber'); // the quarter and tenth caps still apply
  });
});
