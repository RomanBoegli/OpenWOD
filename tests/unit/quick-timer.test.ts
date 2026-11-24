import { describe, expect, it } from 'vitest';
import { validateDraft, workoutToBuilder } from '../../packages/domain/src/builder';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { freeWorkoutId, QUICK_TIMER_ID } from '../../packages/domain/src/library';
import { DEFAULT_QUICK_TIMER, isQuickTimer, normaliseQuickTimer, QUICK_TIMER_KINDS, quickTimerDraft, quickTimerTitle, quickTimerWorkout, type QuickTimer } from '../../packages/domain/src/quick-timer';
import { parseWorkout } from '../../packages/domain/src/validate';

const of = (change: Partial<QuickTimer>): QuickTimer => ({ ...DEFAULT_QUICK_TIMER, ...change });

describe('quick timer (LIB-09)', () => {
  it('builds a valid solo workout of the reserved id for every kind', () => {
    for (const kind of QUICK_TIMER_KINDS) {
      const workout = quickTimerWorkout(of({ kind }));
      expect(parseWorkout(JSON.parse(JSON.stringify(workout)))).toEqual(workout);
      expect(workout).toMatchObject({ id: QUICK_TIMER_ID, revision: 1, participants: 1, prepMs: 10_000 });
      expect(isQuickTimer(workout)).toBe(true);
      expect(workout.sections).toHaveLength(1);
      expect(() => compileWorkout(workout)).not.toThrow();
    }
  });

  it('times a Tabata as rounds of work with the rest between them, and none after the last', () => {
    const plan = compileWorkout(quickTimerWorkout(of({ kind: 'tabata' })));
    expect(plan.durationMs).toBe(8 * 20_000 + 7 * 10_000);
    expect(plan.occurrences.filter(item => item.phase === 'work')).toHaveLength(8);
    expect(plan.occurrences.filter(item => item.phase === 'work').map(item => item.rounds.at(-1)?.iteration)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(plan.occurrences.at(-1)?.phase).toBe('work');
    // Without a rest the rounds follow each other.
    expect(compileWorkout(quickTimerWorkout(of({ kind: 'tabata', tabata: { rounds: 3, workMs: 30_000, restMs: 0 } }))).durationMs).toBe(90_000);
  });

  it('times an EMOM by its intervals, an AMRAP by its cap, and leaves For Time open unless it has a cap', () => {
    expect(compileWorkout(quickTimerWorkout(of({ kind: 'emom', emom: { intervalMs: 90_000, intervals: 6 } })))).toMatchObject({ durationMs: 540_000, durationKind: 'exact' });
    const amrap = quickTimerWorkout(of({ kind: 'amrap', amrap: { capMs: 720_000 } }));
    expect(compileWorkout(amrap)).toMatchObject({ durationMs: 720_000 });
    expect(amrap.sections[0]).toMatchObject({ format: 'amrap', capMs: 720_000, counter: 'rounds' });
    expect(compileWorkout(quickTimerWorkout(of({ kind: 'forTime' }))).durationKind).toBe('open');
    const capped = quickTimerWorkout(of({ kind: 'forTime', forTime: { capMs: 900_000 } }));
    expect(capped.sections[0].capMs).toBe(900_000);
    expect(compileWorkout(capped).durationKind).toBe('capped');
  });

  it('names the session in Title Case with its numbers', () => {
    expect(quickTimerTitle(of({ kind: 'tabata' }))).toBe('Tabata: 8 × 0:20 / 0:10');
    expect(quickTimerTitle(of({ kind: 'tabata', tabata: { rounds: 5, workMs: 90_000, restMs: 0 } }))).toBe('Tabata: 5 × 1:30');
    expect(quickTimerTitle(of({ kind: 'emom' }))).toBe('EMOM: 10 × 1:00');
    expect(quickTimerTitle(of({ kind: 'amrap', amrap: { capMs: 725_000 } }))).toBe('AMRAP: 12:05');
    expect(quickTimerTitle(of({ kind: 'forTime' }))).toBe('For Time');
    expect(quickTimerTitle(of({ kind: 'forTime', forTime: { capMs: 900_000 } }))).toBe('For Time: Cap 15:00');
  });

  it('is a block the editor’s model can hold, of the format its kind names', () => {
    for (const kind of QUICK_TIMER_KINDS) {
      const draft = quickTimerDraft(of({ kind }));
      expect(validateDraft(draft)).toEqual([]);
      const reopened = workoutToBuilder(quickTimerWorkout(of({ kind })));
      expect(reopened?.sections[0].format).toBe(draft.sections[0].format);
    }
  });

  it('brings stored settings of any shape into range, field by field', () => {
    expect(normaliseQuickTimer(undefined)).toEqual(DEFAULT_QUICK_TIMER);
    expect(normaliseQuickTimer('nonsense')).toEqual(DEFAULT_QUICK_TIMER);
    expect(normaliseQuickTimer({ kind: 'yoga', tabata: { rounds: 500, workMs: 0, restMs: -5 }, emom: 'x', prepMs: 3400 })).toEqual({
      ...DEFAULT_QUICK_TIMER, prepMs: 3000, tabata: { rounds: 99, workMs: 1000, restMs: 0 },
    });
    expect(normaliseQuickTimer({ kind: 'amrap', amrap: { capMs: 1e12 } })).toMatchObject({ kind: 'amrap', amrap: { capMs: 5_999_000 } });
    // Every stored shape still compiles.
    for (const kind of QUICK_TIMER_KINDS) expect(() => compileWorkout(quickTimerWorkout(normaliseQuickTimer({ kind, prepMs: 5_999_000, tabata: { rounds: 99, workMs: 5_999_000, restMs: 5_999_000 }, emom: { intervals: 99, intervalMs: 5_999_000 }, amrap: { capMs: 5_999_000 }, forTime: { capMs: 5_999_000 } })))).not.toThrow();
    expect(normaliseQuickTimer({ prepMs: 5_999_000, tabata: { rounds: 99, workMs: 5_999_000, restMs: 5_999_000 } })).toMatchObject({ prepMs: 60_000, tabata: { rounds: 6 } });
  });

  it('keeps its id out of the library: no copy and no saved workout is given it', () => {
    expect(freeWorkoutId(QUICK_TIMER_ID, new Set())).toBe(`${QUICK_TIMER_ID}-2`);
    expect(freeWorkoutId(QUICK_TIMER_ID, new Set([`${QUICK_TIMER_ID}-2`]))).toBe(`${QUICK_TIMER_ID}-3`);
    expect(freeWorkoutId('fran', new Set())).toBe('fran');
  });
});
