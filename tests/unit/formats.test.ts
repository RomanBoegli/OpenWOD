import { describe, expect, it } from 'vitest';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { WorkoutValidationError, type Workout } from '../../packages/domain/src';
import { cindy, fran, mixedSession, partnerCircuit, partnerEmom16, partnerSprints, runSledRun } from '../../packages/domain/src/fixtures';
import { WorkoutEngine, type Command, type CommandType } from '../../packages/engine/src';

function fixture(workout: Workout) {
  let now = 0;
  const engine = new WorkoutEngine(compileWorkout(workout), () => now);
  let n = 0;
  const at = (ms: number) => { now = ms; engine.tick(); };
  const command = (type: CommandType, extra: Partial<Command> = {}) => engine.command({ id: `c${++n}`, occurrenceId: engine.occurrenceId, type, ...extra });
  const stale = (type: CommandType, occurrenceId: string) => engine.command({ id: `c${++n}`, occurrenceId, type });
  return { engine, at, command, stale, clock: () => now };
}

type TaskNode = Extract<Workout['sections'][number]['body'], { type: 'task' }>;
function firstTask(workout: Workout): TaskNode {
  const body = workout.sections[0].body;
  const first = body.type === 'sequence' ? body.children[0] : body;
  if (first.type !== 'task') throw new Error('Invalid fixture.');
  return first;
}

const bothDonePair: Workout = {
  schemaVersion: 2, id: 'both-done', revision: 1, title: 'Both done', equipment: [], participants: 2, prepMs: 0,
  sections: [{ id: 'ft', title: 'For time', format: 'forTime', transitionAfter: 'automatic', body: { id: 'ft-list', type: 'sequence', children: [
    { id: 'ft-1', type: 'task', completion: 'both', assignments: { A: { name: 'Row', calories: 20 }, B: { name: 'Burpees', reps: 15 } } },
    { id: 'ft-2', type: 'task', completion: 'both', assignments: { A: { name: 'Burpees', reps: 15 }, B: { name: 'Row', calories: 20 } } },
  ] } }],
};

describe('manual formats', () => {
  it('AT-04: an AMRAP never advances its block, counts only what is tapped, and ends capped', () => {
    const { engine, at, command } = fixture(cindy);
    command('play');
    at(70_000);
    const projection = engine.project();
    expect(projection.status).toBe('running');
    expect(projection.format).toBe('amrap');
    expect(projection.clockScope).toBe('cap');
    expect(projection.tasks?.map(item => item.assignments.A.name)).toEqual(['Pull-ups', 'Push-ups', 'Air squats']);
    expect(engine.readClocks().capRemainingMs).toBe(1_140_000);
    expect(engine.readClocks().remainingMs).toBe(1_140_000);
    expect(engine.events.filter(event => event.type === 'counted')).toHaveLength(0);
    expect(projection.controls).toEqual(expect.arrayContaining(['pause', 'stop', 'finish', 'count:round', 'count:rep']));
    expect(projection.controls).not.toContain('next');
    expect(command('count')).toBe(true);
    expect(command('count')).toBe(true);
    expect(command('count', { unit: 'rep', delta: 3 })).toBe(true);
    expect(engine.project().counter).toEqual({ rounds: 2, reps: 3, canUndo: true });
    expect(command('undoCount')).toBe(true);
    expect(engine.project().counter).toEqual({ rounds: 2, reps: 0, canUndo: true });
    expect(engine.project().current).toBe(projection.current);
    at(1_210_000);
    expect(engine.project().status).toBe('completed');
    expect(engine.project().results[0]).toMatchObject({ outcome: 'capped', sectionMs: 1_200_000, counter: { rounds: 2, reps: 0 } });
    expect(command('count')).toBe(false);
    expect(engine.events.map(event => event.type).slice(-3)).toEqual(['capReached', 'sectionEnded', 'completed']);
  });

  it('AT-05: EMOM boundaries never move for an early Done, a missing Done is left unreported, and navigation is off', () => {
    const { engine, at, command } = fixture(partnerEmom16);
    command('play');
    at(40_000);
    expect(engine.project().interval).toEqual({ index: 1, count: 16 });
    expect(engine.project().clockScope).toBe('interval');
    expect(command('done')).toBe(true);
    expect(engine.project().acks.team).toBe(true);
    expect(engine.nextDeadline).toBe(70_000);
    expect(engine.readClocks(50_000).remainingMs).toBe(20_000);
    expect(command('done')).toBe(false);
    expect(command('next')).toBe(false);
    expect(command('previous')).toBe(false);
    expect(engine.project().controls).not.toContain('next');
    expect(engine.project().controls).not.toContain('previous');
    at(70_000);
    expect(engine.project().interval?.index).toBe(2);
    expect(engine.project().acks.team).toBe(false);
    expect(engine.events.at(-1)).toMatchObject({ type: 'occurrenceStarted', activeMs: 60_000 });
    at(130_000);
    expect(engine.project().interval?.index).toBe(3);
    at(10_000 + 16 * 60_000);
    expect(engine.project().status).toBe('completed');
    const result = engine.project().results[0];
    expect(result.outcome).toBe('completed');
    expect(result.unacknowledged).toContain(engine.plan.occurrences[1].id);
    expect(result.unacknowledged).not.toContain(engine.plan.occurrences[0].id);
  });

  it('AT-06: a double-tapped Switch hands over once and a team round completes after both turns', () => {
    const { engine, at, command, stale } = fixture(partnerSprints);
    command('play');
    at(40_000);
    const before = engine.occurrenceId;
    expect(engine.project().turn).toMatchObject({ athlete: 'A', number: 1, teamRound: 0 });
    expect(command('switch')).toBe(true);
    expect(stale('switch', before)).toBe(false);
    expect(engine.project().turn).toMatchObject({ athlete: 'B', number: 2, teamRound: 0 });
    expect(engine.readClocks().slotMs).toBe(0);
    at(55_000);
    expect(engine.readClocks().slotMs).toBe(15_000);
    expect(command('switch')).toBe(true);
    expect(engine.project().turn).toMatchObject({ athlete: 'A', number: 3, teamRound: 1 });
    expect(engine.events.filter(event => event.type === 'switched')).toHaveLength(2);
    expect(command('skipTurn')).toBe(true);
    expect(engine.project().modified).toBe(true);
    at(730_000);
    expect(engine.project().status).toBe('completed');
    expect(engine.project().results[0]).toMatchObject({ outcome: 'capped', turns: 3, teamRounds: 1, skippedTurns: 1 });
  });

  it('AT-07: both-done tasks count each athlete once and advance only when both have tapped', () => {
    const { engine, at, command } = fixture(bothDonePair);
    command('play');
    at(20_000);
    expect(engine.project().controls).toEqual(expect.arrayContaining(['done:A', 'done:B']));
    const id = engine.occurrenceId;
    expect(command('done', { athlete: 'A' })).toBe(true);
    expect(command('done', { athlete: 'A' })).toBe(false);
    expect(engine.project().acks).toEqual({ A: true, B: false, team: false });
    expect(engine.occurrenceId).toBe(id);
    expect(engine.project().controls).not.toContain('done:A');
    expect(command('done')).toBe(false); // an athlete is required for both-done
    at(30_000);
    expect(command('done', { athlete: 'B' })).toBe(true);
    expect(engine.project().index).toBe(1);
    expect(engine.project().acks).toEqual({ A: false, B: false, team: false });
    expect(engine.events.filter(event => event.type === 'done')).toHaveLength(2);
  });

  it('AT-08: a Finish before the cap completes, at or after the cap the result is Capped', () => {
    const run = (finishAt: number) => {
      const { engine, at, command } = fixture(fran);
      command('play');
      for (let step = 1; step <= 5; step++) { at(10_000 + step * 30_000); expect(command('done')).toBe(true); }
      at(finishAt);
      const accepted = command('finish');
      return { accepted, result: engine.project().results[0], events: engine.events.map(event => event.type) };
    };
    const early = run(10_000 + 299_900);
    expect(early.accepted).toBe(true);
    expect(early.result).toMatchObject({ outcome: 'completed', sectionMs: 299_900 });
    const atCap = run(10_000 + 600_000);
    expect(atCap.accepted).toBe(false);
    expect(atCap.result).toMatchObject({ outcome: 'capped', sectionMs: 600_000 });
    expect(atCap.events.slice(-3)).toEqual(['capReached', 'sectionEnded', 'completed']);
    const { engine, at, command } = fixture(fran);
    command('play');
    at(10_000 + 599_999);
    at(10_000 + 600_000);
    expect(command('finish')).toBe(false);
    expect(engine.project().results[0]).toMatchObject({ outcome: 'capped' });
    // An early Finish with tasks still open is honest about it.
    const partial = fixture(fran);
    partial.command('play');
    partial.at(100_000);
    expect(partial.command('finish')).toBe(true);
    expect(partial.engine.project().results[0].outcome).toBe('finished');
    expect(partial.engine.project().modified).toBe(true);
  });

  it('AT-20: run → station → run never times out a distance and records each split', () => {
    const { engine, at, command } = fixture(runSledRun);
    command('play');
    at(400_000);
    expect(engine.project().current.anchor).toBe('rsr-run-1');
    expect(engine.nextDeadline).toBeUndefined();
    expect(engine.project().clockScope).toBe('elapsed');
    expect(engine.readClocks()).toMatchObject({ remainingMs: 0, slotMs: 390_000, sectionMs: 390_000, fraction: 0 });
    expect(command('done')).toBe(true);
    expect(engine.toJSON().splits[0]).toMatchObject({ anchor: 'rsr-run-1', sectionMs: 390_000, athlete: 'team' });
    expect(engine.project().current.anchor).toBe('rsr-sled');
    expect(engine.project().nextWork?.anchor).toBe('rsr-run-2');
    at(500_000);
    command('done');
    at(900_000);
    expect(engine.project().controls).toContain('done');
    expect(command('done')).toBe(true);
    expect(engine.project().status).toBe('completed');
    expect(engine.plan.durationKind).toBe('open');
    expect(engine.project().results[0]).toMatchObject({ outcome: 'completed', sectionMs: 890_000 });
  });

  it('AT-22: a mixed session gives each section its own clock scope and Ready gate', () => {
    const { engine, at, command } = fixture(mixedSession);
    command('play');
    at(190_000);
    expect(engine.project().status).toBe('awaitingReady');
    expect(engine.readClocks().activeMs).toBe(180_000);
    at(200_000);
    expect(command('ready')).toBe(true);
    expect(engine.project().format).toBe('strength');
    expect(engine.project().clockScope).toBe('elapsed');
    expect(engine.nextDeadline).toBeUndefined();
    at(230_000);
    expect(command('done')).toBe(true);
    expect(engine.project().current.phase).toBe('roundRest');
    expect(engine.nextDeadline).toBe(320_000);
    at(320_000);
    expect(engine.project().current.rounds[0].iteration).toBe(2);
    at(330_000); command('done');
    at(420_000);
    at(430_000); command('done');
    expect(engine.project().status).toBe('awaitingReady');
    at(440_000); command('ready');
    expect(engine.project().format).toBe('amrap');
    expect(engine.project().clockScope).toBe('cap');
    expect(engine.readClocks()).toMatchObject({ sectionMs: 0, remainingMs: 600_000, durationMs: 600_000 });
    at(440_000 + 600_000);
    expect(engine.project().status).toBe('completed');
    expect(engine.project().results.map(result => result.outcome)).toEqual(['completed', 'completed', 'capped']);
    expect(engine.readClocks().activeMs).toBe(180_000 + 30_000 + 90_000 + 10_000 + 90_000 + 10_000 + 600_000);
    expect(engine.plan.durationKind).toBe('open');
  });

  it('restores a snapshot paused with every counter, turn and offset intact', () => {
    const { engine, at, command } = fixture(partnerSprints);
    command('play');
    at(40_000);
    command('switch');
    const snapshot = engine.toJSON(50_000);
    expect(snapshot.phaseMs).toBe(10_000);
    expect(snapshot.sectionMs).toBe(40_000);
    let now = 1_000_000;
    const restored = WorkoutEngine.fromSnapshot(engine.plan, structuredClone(snapshot), () => now);
    const projection = restored.project();
    expect(projection.status).toBe('paused');
    expect(projection.pauseReason).toBe('recovered');
    expect(projection.turn).toEqual(engine.project().turn);
    expect(restored.readClocks()).toMatchObject({ sectionMs: 40_000, slotMs: 10_000, capRemainingMs: 680_000 });
    expect(restored.command({ id: 'r1', occurrenceId: restored.occurrenceId, type: 'resume' })).toBe(true);
    now = 1_000_000 + 680_000;
    restored.tick();
    expect(restored.project().status).toBe('completed');
    expect(restored.project().results[0]).toMatchObject({ outcome: 'capped', turns: 1 });
  });

  it('rejects shapes the formats cannot run, with a reason', () => {
    const base = structuredClone(cindy);
    const amrapWithoutCap = structuredClone(cindy); delete amrapWithoutCap.sections[0].capMs;
    expect(() => compileWorkout(amrapWithoutCap)).toThrow(/need a cap/);
    const timedWithTask = structuredClone(partnerCircuit);
    (timedWithTask.sections[0].body as Extract<Workout['sections'][number]['body'], { type: 'repeat' }>).body = { id: 'x', type: 'task', assignments: { A: { name: 'Row' }, B: { name: 'Row' } } };
    expect(() => compileWorkout(timedWithTask)).toThrow(/Timed circuits need durations/);
    const pairWithoutRule = structuredClone(bothDonePair);
    delete (firstTask(pairWithoutRule) as Partial<TaskNode>).completion;
    expect(() => compileWorkout(pairWithoutRule)).toThrow(/completion rule/);
    const ygigNoEnd = structuredClone(partnerSprints); delete ygigNoEnd.sections[0].capMs;
    expect(() => compileWorkout(ygigNoEnd)).toThrow(/cap or a number of team rounds/);
    const emomNoInterval = structuredClone(partnerEmom16); delete emomNoInterval.sections[0].intervals;
    expect(() => compileWorkout(emomNoInterval)).toThrow(/interval length/);
    const wrongSetting = structuredClone(base); wrongSetting.sections[0].intervals = 3;
    expect(() => compileWorkout(wrongSetting)).toThrow(/do not use intervals/);
    const soloBoth = structuredClone(fran);
    firstTask(soloBoth).completion = 'both';
    expect(() => compileWorkout(soloBoth)).toThrow(WorkoutValidationError);
  });
});
