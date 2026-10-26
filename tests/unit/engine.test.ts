import { describe, expect, it } from 'vitest';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import { WorkoutEngine, displayTime, overallProgress, warningLevel, washDrain, type CommandType } from '../../packages/engine/src';
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

  it('skips a whole section, scoring it as skipped, and returns to the previous one to play it again', () => {
    const { engine, at, command } = fixture(fullBodyPartner);
    const [first, second] = engine.plan.sections;
    command('play'); at(30_000);
    expect(engine.project().controls).toEqual(expect.arrayContaining(['previousSection', 'nextSection']));
    expect(command('nextSection')).toBe(true);
    expect(engine.project().status).toBe('awaitingReady'); // The skipped section's Ready gate still applies.
    expect(engine.project().section.id).toBe(second.id);
    expect(engine.project().results.map(result => [result.sectionId, result.outcome])).toEqual([[first.id, 'skipped']]);
    expect(engine.project().controls).toEqual(expect.arrayContaining(['ready', 'stop', 'previousSection']));
    at(31_000);
    expect(command('previousSection')).toBe(true);
    expect(engine.project().status).toBe('paused'); // Back from a Ready gate the clock waits for Resume.
    expect(engine.project().section.id).toBe(first.id);
    expect(engine.project().results).toEqual([]);
    expect(engine.readClocks().sectionMs).toBe(0);
    expect(engine.project().modified).toBe(true);
    command('resume'); at(400_000);
    expect(engine.project().status).toBe('awaitingReady');
    expect(engine.project().results.map(result => result.outcome)).toEqual(['completed']);
    expect(command('previousSection')).toBe(true); // At the first section: restart it.
    expect(engine.project().section.id).toBe(first.id);
    expect(engine.readClocks().sectionMs).toBe(0);
    command('resume');
    while (engine.project().controls.includes('nextSection')) command('nextSection');
    expect(engine.project().section.id).toBe(engine.plan.sections.at(-1)!.id); // No section after the last one.
    expect(engine.project().results).toHaveLength(engine.plan.sections.length - 1);
  });

  it('nudges the clock 5 seconds either way within its span, in prep, a slot and while paused, and lets a forward nudge at the end fire the boundary', () => {
    const { engine, at, command } = fixture();
    const nudge = (delta: number) => engine.command({ type: 'nudge', id: `n${delta}:${Math.random()}`, occurrenceId: engine.occurrenceId, delta });
    command('play'); at(3000);
    expect(engine.project().controls).toContain('nudge');
    expect(nudge(-5000)).toBe(true); // Back no further than the start of the prep: 3 of the 5 seconds.
    expect(engine.readClocks().remainingMs).toBe(10_000);
    nudge(5000); nudge(5000); // Forward to the end of the prep: the next tick starts the work.
    at(3001);
    expect(engine.project().status).toBe('running');
    expect(engine.readClocks().remainingMs).toBe(40_000 - 1);
    at(13_000);
    nudge(-5000);
    expect(engine.readClocks().remainingMs).toBe(35_000);
    expect(engine.readClocks().sectionMs).toBe(5000); // The section clock moves with the slot.
    expect(engine.readClocks().activeMs).toBe(10_000); // The training time stays real.
    expect(engine.project().modified).toBe(true);
    expect(engine.project().nudges).toBe(4);
    command('pause'); at(20_000);
    expect(engine.project().controls).toContain('nudge');
    nudge(5000);
    expect(engine.readClocks().remainingMs).toBe(30_000);
    command('resume'); at(22_000);
    expect(engine.readClocks().remainingMs).toBe(28_000);
    expect(engine.events.filter(event => event.type === 'nudged').map(event => event.payload?.deltaMs)).toEqual([-3000, 5000, 5000, -5000, 5000]);
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
    // The pulse climbs within each segment and is full just before its end: 60 s slot, markers at 10 s and 3 s.
    expect(washDrain(60_000, 60_000)).toBe(0);
    expect(washDrain(35_000, 60_000)).toBeCloseTo(25 / 45, 3);
    expect(washDrain(11_000, 60_000)).toBe(1);
    expect(washDrain(9999, 60_000)).toBeCloseTo(0, 2);
    expect(washDrain(3100, 60_000)).toBe(1);
    expect(washDrain(1500, 60_000)).toBeCloseTo(1.5 / 2.7, 3);
    expect(washDrain(0, 60_000)).toBe(1);
  });
});

describe('checkpoint recovery (ENG-11/12)', () => {
  it('restores a checkpoint with its progress offsets and completes an overdue boundary on the first tick after resume', () => {
    let now = 0; let id = 0;
    const plan = compileWorkout(bundledWorkout('partner-circuit'));
    const engine = new WorkoutEngine(plan, () => now, 'ckpt');
    const command = (type: Parameters<WorkoutEngine['command']>[0]['type']) => engine.command({ type, id: String(++id), occurrenceId: engine.occurrenceId });
    command('play'); now = 10_000; engine.tick(); now = 35_000; engine.tick();
    const checkpoint = engine.toJSON();
    expect(engine.offsets()).toEqual({ phaseMs: 25_000, activeMs: 25_000, sectionMs: 25_000 });
    // The tab died 20 seconds later than the last checkpoint, 5 seconds past the slot boundary.
    const progress = { phaseMs: 45_000, activeMs: 45_000, sectionMs: 45_000 };
    let later = 500_000;
    const restored = WorkoutEngine.fromSnapshot(plan, { ...structuredClone(checkpoint), ...progress }, () => later);
    expect(restored.project().status).toBe('paused');
    expect(restored.project().pauseReason).toBe('recovered');
    // The five seconds past the slot boundary are pulled back: the boundary is due the moment the session resumes.
    expect(restored.readClocks().activeMs).toBe(40_000);
    expect(restored.command({ type: 'resume', id: 'r', occurrenceId: restored.occurrenceId })).toBe(true);
    restored.tick();
    expect(restored.project().status).toBe('running');
    expect(restored.project().current.anchor).not.toBe(engine.project().current.anchor);
    expect(restored.readClocks().activeMs).toBe(40_000);
    later += 5_000; restored.tick();
    expect(restored.readClocks().activeMs).toBe(45_000);
    // Commands acknowledged before the checkpoint stay acknowledged after it.
    expect(restored.command({ type: 'pause', id: '1', occurrenceId: restored.occurrenceId })).toBe(false);
  });
});

describe('overall progress', () => {
  it('runs from 0 at ready to 1 at completion, counting the current slot by its elapsed share and naming section and round', () => {
    let now = 0; let id = 0;
    const plan = compileWorkout(bundledWorkout('partner-circuit'));
    const engine = new WorkoutEngine(plan, () => now, 'overall');
    const command = (type: Parameters<WorkoutEngine['command']>[0]['type']) => engine.command({ type, id: String(++id), occurrenceId: engine.occurrenceId });
    const read = () => overallProgress(plan, engine.project(), engine.readClocks());
    expect(read()).toMatchObject({ fraction: 0, sectionIndex: 0, sections: plan.sections.length });
    command('play'); now = 10_000; engine.tick();
    expect(read().fraction).toBe(0);
    now = 30_000; engine.tick();
    expect(read().fraction).toBeCloseTo(0.5 / plan.occurrences.length, 5);
    expect(read().round).toEqual({ current: 1, total: 5 });
    now = 10_000 + plan.durationMs; engine.tick();
    expect(engine.project().status).toBe('completed');
    expect(read().fraction).toBe(1);
  });
});
