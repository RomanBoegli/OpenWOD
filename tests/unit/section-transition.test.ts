import { describe, expect, it } from 'vitest';
import { builderToWorkout, emptyDraft, emptySection, emptySlot, validateDraft, workoutToBuilder, type BuilderDraft, type BuilderSection } from '../../packages/domain/src/builder';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import { bundledWorkouts } from '../../packages/domain/src/generated/bundled';
import { outlineWorkout } from '../../packages/domain/src/outline';
import { WorkoutEngine, type CommandType } from '../../packages/engine/src';
import type { SectionFormat } from '../../packages/domain/src/schema';

/** BLD-14: what happens after a section, for every format. */
const section = (format: SectionFormat, patch: Partial<BuilderSection> = {}): BuilderSection => {
  const base = emptySection(1, format);
  return { ...base, title: format, slots: [{ ...emptySlot(1), A: { name: 'Burpees', reps: 10 } }, { ...emptySlot(1), A: { name: 'Air Squats', reps: 10 } }], ...(format === 'forTime' ? { capMs: 300_000 } : {}), ...patch };
};
const draftOf = (...sections: BuilderSection[]): BuilderDraft => ({ ...emptyDraft(1), title: 'Transitions', prepMs: 0, sections });

function run(draft: BuilderDraft) {
  let now = 0;
  let id = 0;
  const engine = new WorkoutEngine(compileWorkout(builderToWorkout(draft, { id: 'transitions', revision: 1 })), () => now, 'transitions');
  return { engine, at(ms: number) { now = ms; engine.tick(); }, command(type: CommandType) { return engine.command({ type, id: String(++id), occurrenceId: engine.occurrenceId }); } };
}

describe('the rest after a section (BLD-14)', () => {
  it('gives every list format a real rest occurrence that round-trips through the builder', () => {
    for (const format of ['amrap', 'emom', 'forTime', 'strength'] as SectionFormat[]) {
      const draft = draftOf(section(format, { transitionAfter: 'automatic', blockRestMs: 60_000 }), section('amrap'));
      expect(validateDraft(draft), format).toEqual([]);
      const workout = builderToWorkout(draft, { id: 'transitions', revision: 1 });
      const plan = compileWorkout(workout);
      const first = plan.sections[0];
      expect(first.restAfter, format).toEqual({ index: first.endIndex, durationMs: 60_000 });
      expect(plan.occurrences[first.endIndex]).toMatchObject({ phase: 'blockRest', durationMs: 60_000, sectionIndex: 0 });
      expect(outlineWorkout(plan)[0].restAfterMs).toBe(60_000);
      const back = workoutToBuilder(workout)!;
      expect(back.sections[0], format).toMatchObject({ transitionAfter: 'automatic', blockRestMs: 60_000 });
      expect(builderToWorkout(back, { id: 'transitions', revision: 1 })).toEqual(workout);
    }
  });

  it('builds a you-go-I-go rest after the section as well', () => {
    const base = emptySection(2, 'youGoIGo');
    const draft: BuilderDraft = { ...emptyDraft(2), title: 'Pair', prepMs: 0, sections: [
      { ...base, title: 'Sprints', capMs: 120_000, transitionAfter: 'automatic', blockRestMs: 45_000, slots: [{ ...emptySlot(2), A: { name: 'Burpees', reps: 5 }, B: { name: '' } }] },
      { ...emptySection(2, 'timedCircuit'), title: 'Finisher', slots: [{ A: { name: 'Air Squats' }, B: { name: 'Burpees' }, durationMs: 30_000 }] },
    ] };
    const plan = compileWorkout(builderToWorkout(draft, { id: 'pair', revision: 1 }));
    expect(plan.occurrences.map(item => item.phase)).toEqual(['work', 'blockRest', 'work']);
    expect(plan.sections[0].durationMs).toBe(165_000);
  });

  it('keeps list sections without a rest exactly as before', () => {
    const draft = draftOf(section('amrap'), section('emom'));
    const workout = builderToWorkout(draft, { id: 'transitions', revision: 1 });
    expect(workout.sections[0].body).toMatchObject({ type: 'sequence', id: 's1-list' });
    expect(workout.sections[0].body.type === 'sequence' && workout.sections[0].body.children.every(child => child.type === 'task')).toBe(true);
    expect(compileWorkout(workout).sections[0].restAfter).toBeUndefined();
  });

  it('leaves every bundled workout compiling to the same plan, with the block rests of timed circuits where they were', () => {
    for (const workout of bundledWorkouts) {
      const plan = compileWorkout(workout);
      for (const compiled of plan.sections) if (compiled.restAfter && workout.id !== 'squat-snatch-battery') expect(compiled.format, workout.id).toBe('timedCircuit');
    }
    // The snatch battery ends its first two EMOMs and its first two metcon pieces in the rest before the next block.
    expect(compileWorkout(bundledWorkout('squat-snatch-battery')).sections.map(section => section.restAfter?.durationMs)).toEqual([undefined, undefined, undefined, 90_000, 90_000, undefined, undefined, 90_000, 90_000, undefined]);
    const fullBody = compileWorkout(bundledWorkout('full-body-partner'));
    expect(fullBody.sections[1]).toMatchObject({ transitionAfter: 'automatic', restAfter: { durationMs: 120_000 } });
    // A rest in the middle of a for-time list stays inside the cap.
    expect(compileWorkout(bundledWorkout('pull-and-press-ladder')).sections[0].restAfter).toBeUndefined();
  });

  it('runs the rest after an AMRAP cap, outside the cap, then starts the next section on its own', () => {
    const { engine, at, command } = run(draftOf(section('amrap', { capMs: 60_000, transitionAfter: 'automatic', blockRestMs: 30_000 }), section('forTime')));
    command('play');
    at(60_000);
    let projection = engine.project();
    expect(projection.current.phase).toBe('blockRest');
    expect(projection.status).toBe('running');
    expect(projection.capMs).toBeUndefined();
    expect(projection.controls).not.toContain('finish');
    expect(projection.results[0]).toMatchObject({ outcome: 'capped', sectionMs: 60_000 });
    expect(projection.nextWork?.assignments?.A.name).toBe('Burpees');
    expect(engine.readClocks()).toMatchObject({ remainingMs: 30_000 });
    expect(engine.readClocks().capRemainingMs).toBeUndefined();
    at(90_000);
    projection = engine.project();
    expect(projection.status).toBe('running');
    expect(projection.current).toMatchObject({ sectionIndex: 1, phase: 'work' });
    expect(projection.results[0]).toMatchObject({ outcome: 'capped', sectionMs: 60_000 });
  });

  it('keeps the rest after a Finish and after the last Done of a for-time section, and scores without it', () => {
    const finished = run(draftOf(section('forTime', { transitionAfter: 'automatic', blockRestMs: 60_000 }), section('amrap')));
    finished.command('play');
    finished.at(20_000);
    finished.command('finish');
    expect(finished.engine.project().current.phase).toBe('blockRest');
    expect(finished.engine.project().results[0]).toMatchObject({ outcome: 'finished', sectionMs: 20_000 });

    const done = run(draftOf(section('forTime', { transitionAfter: 'automatic', blockRestMs: 60_000 }), section('amrap')));
    done.command('play');
    done.at(10_000); done.command('done');
    done.at(25_000); done.command('done');
    let projection = done.engine.project();
    expect(projection.current.phase).toBe('blockRest');
    expect(projection.results[0]).toMatchObject({ outcome: 'completed', sectionMs: 25_000 });
    // The cap (5 minutes) does not end the rest early, and skipping the rest keeps the score.
    done.at(80_000);
    expect(done.command('nextSection')).toBe(true);
    projection = done.engine.project();
    expect(projection.current.sectionIndex).toBe(1);
    expect(projection.results[0]).toMatchObject({ outcome: 'completed', sectionMs: 25_000 });
  });

  it('waits for Ready without a rest, and continues straight away without one', () => {
    const ready = run(draftOf(section('emom', { intervals: 1 }), section('amrap')));
    ready.command('play');
    ready.at(60_000);
    expect(ready.engine.project().status).toBe('awaitingReady');

    const straight = run(draftOf(section('emom', { intervals: 1, transitionAfter: 'automatic' }), section('amrap')));
    straight.command('play');
    straight.at(60_000);
    expect(straight.engine.project()).toMatchObject({ status: 'running', current: { sectionIndex: 1, phase: 'work' } });
  });

  it('runs an EMOM rest after the last interval, then continues automatically', () => {
    const { engine, at, command } = run(draftOf(section('emom', { intervals: 2, transitionAfter: 'automatic', blockRestMs: 60_000 }), section('amrap')));
    command('play');
    at(120_000);
    expect(engine.project().current.phase).toBe('blockRest');
    expect(engine.project().results[0]).toMatchObject({ sectionMs: 120_000 });
    at(180_000);
    expect(engine.project()).toMatchObject({ status: 'running', current: { sectionIndex: 1 } });
  });
});
