import { describe, expect, it } from 'vitest';
import { builderToWorkout, emptyDraft, emptyRest, emptySection, emptySlot, slotsOf, validateDraft, workoutToBuilder, type BuilderGroup, type BuilderSlot } from '../../packages/domain/src/builder';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { bundledWorkout, bundledWorkouts } from '../../packages/domain/src/bundled';
import type { Workout, WorkoutNode, WorkoutSection } from '../../packages/domain/src/schema';
const backSquatFives = bundledWorkout('back-squat-5x5');
const cindy = bundledWorkout('cindy');
const fightGoneBad = bundledWorkout('fight-gone-bad');
const fran = bundledWorkout('fran');
const fullBodyPartner = bundledWorkout('full-body-partner');
const pullAndPressLadder = bundledWorkout('pull-and-press-ladder');
const hyroxEngineEmom = bundledWorkout('hyrox-engine-emom-24');
const hyroxPaceIntervals = bundledWorkout('hyrox-pace-intervals');
const mixedSession = bundledWorkout('mixed-session');
const partnerCircuit = bundledWorkout('partner-circuit');
const partnerEmom16 = bundledWorkout('partner-emom-16');
const partnerSprints = bundledWorkout('you-go-i-go-sprints');
const rowBurpeeEmom = bundledWorkout('row-burpee-emom-20');
const runSledRun = bundledWorkout('run-sled-run');
const tabataThis = bundledWorkout('tabata-this');

describe('editor builder model', () => {
  it('round-trips the editable fixtures with identical compiled timing and assignments', () => {
    for (const workout of [partnerCircuit, fullBodyPartner, fightGoneBad, rowBurpeeEmom, hyroxPaceIntervals, hyroxEngineEmom, tabataThis, cindy, fran, partnerEmom16, partnerSprints, runSledRun, backSquatFives, mixedSession]) {
      const draft = workoutToBuilder(workout);
      expect(draft, workout.id).not.toBeNull();
      expect(validateDraft(draft!)).toEqual([]);
      const rebuilt = builderToWorkout(draft!, { id: workout.id, revision: workout.revision + 1 });
      const before = compileWorkout(workout);
      const after = compileWorkout(rebuilt);
      expect(after.durationMs).toBe(before.durationMs);
      const shape = (plan: typeof before) => plan.occurrences.map(item => [item.phase, item.timing, item.durationMs, item.assignments?.A.name, item.assignments?.B?.name, item.completion, item.tasks?.map(task => task.assignments.A.name)]);
      expect(shape(after)).toEqual(shape(before));
      expect(after.sections.map(section => [section.format, section.capMs, section.durationKind, section.emom, section.youGoIGo, section.amrap])).toEqual(before.sections.map(section => [section.format, section.capMs, section.durationKind, section.emom, section.youGoIGo, section.amrap]));
      expect(rebuilt.revision).toBe(workout.revision + 1);
      expect(rebuilt.attribution).toEqual(workout.attribution);
    }
  });

  it('opens each format with its own settings', () => {
    expect(workoutToBuilder(tabataThis)?.sections[0]).toMatchObject({ slotRepeats: 8, slotRepeatRestMs: 10_000, betweenSlotsRestMs: 60_000 });
    expect(workoutToBuilder(fran)?.sections[0]).toMatchObject({ format: 'forTime', capMs: 600_000 });
    expect(slotsOf(workoutToBuilder(fran)!.sections[0].slots)[0].A.load).toEqual({ light: { value: 20, women: 15, unit: 'kg' }, medium: { value: 30, women: 20, unit: 'kg' }, heavy: { value: 43, women: 29, unit: 'kg' } });
    expect(workoutToBuilder(partnerEmom16)?.sections[0]).toMatchObject({ format: 'emom', intervalMs: 60_000, intervals: 16 });
    expect(slotsOf(workoutToBuilder(partnerEmom16)!.sections[0].slots)[0].completion).toBe('team');
    expect(workoutToBuilder(partnerSprints)?.sections[0]).toMatchObject({ format: 'youGoIGo', capMs: 720_000, teamRounds: 0 });
  });

  it('keeps the full-body block structure: alternating rounds, the rest between rounds and the rest after the section', () => {
    const draft = workoutToBuilder(fullBodyPartner)!;
    const block = draft.sections[1];
    expect(block).toMatchObject({ rounds: 2, alternate: true, betweenSlotsRestMs: 20_000, trailingRestMs: 0, blockRestMs: 120_000, betweenRoundsRestMs: 20_000 });
    expect(block.slots).toHaveLength(4);
    expect(draft.sections[0]).toMatchObject({ rounds: 1, blockRestMs: 0, betweenSlotsRestMs: 0 });
  });

  it('validates the author’s fields and builds deterministic IDs', () => {
    const draft = emptyDraft(2);
    const issues = validateDraft(draft);
    expect(issues.map(issue => issue.path)).toEqual(['title', 'sections.0.slots.0.A', 'sections.0.slots.0.B']);
    draft.title = 'Mine';
    draft.sections[0].slots[0] = { A: { name: ' Row ' }, B: { name: 'Swings' }, durationMs: 40_000 };
    draft.sections[0].slots.push({ A: { name: 'Burpees' }, B: { name: 'Squats' }, durationMs: 30_000 });
    draft.sections[0].rounds = 3;
    draft.sections[0].betweenRoundsRestMs = 60_000;
    expect(validateDraft(draft)).toEqual([]);
    const workout = builderToWorkout(draft, { id: 'mine', revision: 1 });
    expect(workout.sections[0].id).toBe('s1');
    expect(compileWorkout(workout).durationMs).toBe(3 * (40_000 + 10_000 + 30_000) + 2 * 60_000);
    expect(JSON.stringify(builderToWorkout(draft, { id: 'mine', revision: 1 }))).toBe(JSON.stringify(workout));
    expect(workout.sections[0].body.type).toBe('repeat');
    expect(compileWorkout(workout).occurrences[0].assignments?.A.name).toBe('Row');
    (draft.sections[0].slots[1] as BuilderSlot).durationMs = 500;
    expect(validateDraft(draft).map(issue => issue.path)).toEqual(['sections.0.slots.1.durationMs']);
  });
});

/** What a workout does, IDs aside: each work in order, the time between it and the work before, and its rounds. */
function meaning(workout: Workout) {
  const plan = compileWorkout(workout);
  const lastWork = plan.occurrences.map(item => item.phase).lastIndexOf('work');
  const works: unknown[] = [];
  let gap = 0;
  // The time after the very last work is dropped by the editor, so it is not compared.
  for (const item of plan.occurrences.slice(0, lastWork + 1)) {
    if (item.phase !== 'work') { gap += item.durationMs; continue; }
    // A round of one carries nothing to show, and the editor writes such a group as a plain list.
    works.push([gap, item.sectionIndex, item.timing, item.durationMs, item.assignments?.A.name, item.assignments?.B?.name, item.completion, item.rounds.filter(round => round.count > 1).map(round => `${round.iteration}/${round.count}`).join('.'), item.tasks?.map(task => task.assignments.A.name), item.interval]);
    gap = 0;
  }
  return { works, sections: plan.sections.map(section => [section.format, section.capMs, section.durationKind, section.emom, section.youGoIGo, section.amrap]), after: workout.sections.map(section => section.transitionAfter) };
}
function reopens(workout: Workout) {
  const draft = workoutToBuilder(workout);
  expect(draft, workout.id).not.toBeNull();
  expect(validateDraft(draft!), workout.id).toEqual([]);
  expect(meaning(builderToWorkout(draft!, { id: workout.id, revision: workout.revision + 1 })), workout.id).toEqual(meaning(workout));
  return draft!;
}

/** A small seeded generator (mulberry32), so a failing tree can be rebuilt from its seed. */
function randomWorkout(seed: number): Workout {
  let state = seed;
  const next = () => { state = (state + 0x6D2B79F5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
  const pair = next() < 0.4;
  let counter = 0;
  const id = () => `n${++counter}`;
  const lane = () => ({ name: pick(['Burpees', 'Row', 'Air Squats', 'Push-Ups', 'Lunges']) });
  const assignments = () => pair ? { A: lane(), B: lane() } : { A: lane() };
  type Format = 'timedCircuit' | 'forTime' | 'strength';
  const rest = (): WorkoutNode => ({ id: id(), type: 'rest', durationMs: pick([5, 10, 30, 60]) * 1000, ...(next() < 0.5 ? { kind: pick(['transition', 'roundRest', 'blockRest'] as const) } : {}) });
  const work = (format: Format): WorkoutNode => format === 'timedCircuit' || next() < 0.3
    ? { id: id(), type: 'timed', durationMs: pick([20, 30, 40]) * 1000, assignments: assignments() }
    : { id: id(), type: 'task', assignments: assignments(), ...(pair ? { completion: pick(['team', 'both'] as const) } : {}) };
  // `depth` counts the repeats above, which the compiler allows two of.
  const list = (format: Format, depth: number): WorkoutNode => {
    const children = Array.from({ length: 1 + Math.floor(next() * 4) }, (): WorkoutNode => { const roll = next(); return roll < 0.2 ? rest() : roll < 0.4 ? depth < 2 && next() < 0.7 ? repeat(format, depth) : list(format, depth) : work(format); });
    if (!children.some(child => child.type !== 'rest')) children.push(work(format));
    return { id: id(), type: 'sequence', ...(next() < 0.3 ? { betweenChildrenRestMs: pick([5, 10]) * 1000 } : {}), ...(next() < 0.2 ? { trailingRestMs: pick([5, 15]) * 1000 } : {}), children };
  };
  const repeat = (format: Format, depth: number): WorkoutNode => ({ id: id(), type: 'repeat', count: 2 + Math.floor(next() * 3), ...(next() < 0.5 ? { betweenIterationsRestMs: pick([10, 60]) * 1000 } : {}), ...(pair && next() < 0.4 ? { assignmentPolicy: 'alternate' as const } : {}), body: next() < 0.8 ? list(format, depth + 1) : work(format) });
  const sections = Array.from({ length: 1 + Math.floor(next() * 3) }, (_, s): WorkoutSection => {
    const format = pick(['timedCircuit', 'forTime', 'strength'] as const);
    const roll = next();
    return { id: `section-${s + 1}`, title: `Block ${s + 1}`, format, transitionAfter: pick(['manualReady', 'automatic'] as const), ...(format === 'forTime' && next() < 0.5 ? { capMs: 600_000 } : {}), body: roll < 0.4 ? repeat(format, 0) : roll < 0.8 ? list(format, 0) : work(format) };
  });
  return { schemaVersion: 2, id: `random-${seed}`, revision: 1, title: 'Random', equipment: [], participants: pair ? 2 : 1, prepMs: 10_000, sections };
}

describe('BLD-15: every workout the compiler accepts opens in the editor', () => {
  it('opens every bundled workout and saves it unchanged with the same timing, rounds and assignments', () => {
    for (const workout of bundledWorkouts) reopens(workout);
  });

  it('opens rests of their own length, timed movements in for time, and groups with their own rounds', () => {
    const ladder = reopens(pullAndPressLadder).sections[0];
    expect(ladder.slots.map(item => item.kind ?? 'movement')).toEqual(['movement', 'movement', 'movement', 'rest', 'movement', 'movement', 'movement', 'rest', 'movement', 'movement', 'movement']);
    expect(ladder.slots[3]).toEqual({ kind: 'rest', durationMs: 60_000, restKind: 'blockRest' });
    const cardio = reopens(bundledWorkout('squat-snatch-battery')).sections[1];
    expect(cardio).toMatchObject({ format: 'forTime', rounds: 3 });
    expect(slotsOf(cardio.slots).find(slot => slot.A.name === 'Stretch of Choice')).toMatchObject({ timed: true, durationMs: 30_000 });
    // An imported Tabata: each 20 s movement followed by a 10 s rest of its own, four rounds.
    const tabata = structuredClone(bundledWorkout('tabata-this'));
    const movement = (name: string, n: number): WorkoutNode[] => [{ id: `work-${n}`, type: 'timed', durationMs: 20_000, assignments: { A: { name } } }, { id: `rest-${n}`, type: 'rest', durationMs: 10_000, kind: 'transition' }];
    tabata.sections = [{ id: 'tabata', title: 'Tabata', format: 'timedCircuit', transitionAfter: 'manualReady', body: { id: 'rounds', type: 'repeat', count: 4, body: { id: 'list', type: 'sequence', children: ['Burpees', 'High Knees', 'Jump Squats', 'Skater Jumps'].flatMap(movement) } } }];
    tabata.participants = 1;
    const block = reopens(tabata).sections[0];
    expect(block).toMatchObject({ rounds: 4, slotRepeats: 1 });
    expect(block.slots.map(item => item.kind ?? 'movement')).toEqual(['movement', 'rest', 'movement', 'rest', 'movement', 'rest', 'movement', 'rest']);
  });

  it('AT-23: opens two sets of a circuit as a group inside the rounds, and a nested list as a group of one round', () => {
    const workout = structuredClone(partnerCircuit);
    const body = workout.sections[0].body;
    if (body.type !== 'repeat') throw new Error('Invalid fixture.');
    body.count = 2;
    workout.sections[0].body = { id: 'sets', type: 'repeat', count: 2, betweenIterationsRestMs: 120_000, body };
    const block = reopens(workout).sections[0];
    expect(block).toMatchObject({ rounds: 2, betweenRoundsRestMs: 120_000 });
    expect(block.slots).toHaveLength(1);
    expect(block.slots[0]).toMatchObject({ kind: 'group', rounds: 2 });
    expect(slotsOf(block.slots)).toHaveLength(4);
    // A rest after a group's last movement stays where it is, without an extra rest between before it.
    workout.sections[0].body = { id: 'outer', type: 'sequence', children: [{ id: 'inner', type: 'sequence', betweenChildrenRestMs: 5_000, trailingRestMs: 15_000, children: [{ id: 'a', type: 'timed', durationMs: 30_000, assignments: { A: { name: 'Row' }, B: { name: 'Burpees' } } }, { id: 'b', type: 'timed', durationMs: 30_000, assignments: { A: { name: 'Burpees' }, B: { name: 'Row' } } }] }, { id: 'c', type: 'timed', durationMs: 30_000, assignments: { A: { name: 'Lunges' }, B: { name: 'Lunges' } } }] };
    expect((reopens(workout).sections[0].slots[0] as BuilderGroup).slots.map(item => item.kind === 'rest' ? item.durationMs : 'movement')).toEqual(['movement', 5_000, 'movement', 15_000]);
  });

  it('opens 300 random trees of every structure the compiler allows and keeps what they do', () => {
    let compiled = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const workout = randomWorkout(seed);
      try { compileWorkout(workout); } catch { continue; }
      compiled++;
      reopens(workout);
    }
    expect(compiled).toBeGreaterThan(250);
  });

  it('names what blocks a draft with rests or groups from saving', () => {
    const draft = emptyDraft(1);
    draft.title = 'Groups';
    const block = { ...emptySection(1, 'forTime'), title: 'Main', rounds: 2 };
    const group = (slots: BuilderGroup['slots'], rounds = 2): BuilderGroup => ({ kind: 'group', rounds, betweenRoundsRestMs: 0, alternate: false, betweenSlotsRestMs: 0, slots });
    const squat = { ...emptySlot(1), A: { name: 'Air Squats', reps: 10 } };
    draft.sections = [{ ...block, slots: [squat, group([squat, group([squat])])] }];
    expect(validateDraft(draft).map(issue => issue.message)).toEqual(['Block 1: use at most two levels of rounds, such as rounds of the block and rounds of a group.']);
    draft.sections = [{ ...block, slots: [squat, group([emptyRest()]), { kind: 'rest', durationMs: 500 }] }];
    expect(validateDraft(draft).map(issue => issue.path)).toEqual(['sections.0.slots.1.slots', 'sections.0.slots.2.durationMs']);
    draft.sections = [{ ...emptySection(1, 'amrap'), title: 'Cap', slots: [squat, emptyRest()] }];
    expect(validateDraft(draft).map(issue => issue.message)).toEqual(['Block 1: AMRAP blocks list movements only; remove the rests and groups.']);
    draft.sections = [{ ...block, slots: [squat, group([{ ...squat, A: { name: 'Row' }, timed: true, durationMs: 45_000 }, emptyRest()])] }];
    expect(validateDraft(draft)).toEqual([]);
    const saved = builderToWorkout(draft, { id: 'groups', revision: 1 });
    expect(compileWorkout(saved).occurrences.filter(item => item.phase === 'work').map(item => [item.assignments?.A.name, item.timing, item.rounds.map(round => round.iteration).join('.')])).toEqual([
      ['Air Squats', 'manual', '1'], ['Row', 'timed', '1.1'], ['Row', 'timed', '1.2'],
      ['Air Squats', 'manual', '2'], ['Row', 'timed', '2.1'], ['Row', 'timed', '2.2'],
    ]);
    expect(reopens(saved).sections[0].slots.map(item => item.kind ?? 'movement')).toEqual(['movement', 'group']);
  });
});
