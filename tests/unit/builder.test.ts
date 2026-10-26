import { describe, expect, it } from 'vitest';
import { builderToWorkout, emptyDraft, validateDraft, workoutToBuilder } from '../../packages/domain/src/builder';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { backSquatFives, cindy, fightGoneBad, fran, fullBodyPartner, hyroxDoublesCircuit, hyroxEngineEmom, hyroxPaceIntervals, mixedSession, partnerCircuit, partnerEmom16, partnerSprints, rowBurpeeEmom, runSledRun, tabataThis } from '../../packages/domain/src/fixtures';

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

  it('reports workouts outside the editable shape instead of approximating them', () => {
    expect(workoutToBuilder(hyroxDoublesCircuit)).toBeNull(); // A timed run before an alternating repeat.
    expect(workoutToBuilder(tabataThis)?.sections[0]).toMatchObject({ slotRepeats: 8, slotRepeatRestMs: 10_000, betweenSlotsRestMs: 60_000 });
    expect(workoutToBuilder(fran)?.sections[0]).toMatchObject({ format: 'forTime', capMs: 600_000 });
    expect(workoutToBuilder(fran)?.sections[0].slots[0].A.load).toEqual({ light: { value: 20, unit: 'kg' }, medium: { value: 30, unit: 'kg' }, heavy: { value: 43, unit: 'kg' } });
    expect(workoutToBuilder(partnerEmom16)?.sections[0]).toMatchObject({ format: 'emom', intervalMs: 60_000, intervals: 16 });
    expect(workoutToBuilder(partnerEmom16)?.sections[0].slots[0].completion).toBe('team');
    expect(workoutToBuilder(partnerSprints)?.sections[0]).toMatchObject({ format: 'youGoIGo', capMs: 720_000, teamRounds: 0 });
  });

  it('keeps the full-body block structure: alternating rounds, trailing transition and block rest', () => {
    const draft = workoutToBuilder(fullBodyPartner)!;
    const block = draft.sections[1];
    expect(block).toMatchObject({ rounds: 2, alternate: true, betweenSlotsRestMs: 20_000, trailingRestMs: 20_000, blockRestMs: 120_000, betweenRoundsRestMs: 0 });
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
    draft.sections[0].slots[1].durationMs = 500;
    expect(validateDraft(draft).map(issue => issue.path)).toEqual(['sections.0.slots.1.durationMs']);
  });
});
