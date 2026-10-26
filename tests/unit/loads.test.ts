import { describe, expect, it } from 'vitest';
import { convertLoad, levelsText, loadAmount, loadText, prescriptionText } from '../../packages/domain/src/prescription';
import { compileWorkout } from '../../packages/domain/src/compiler';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import { validateDraft, workoutToBuilder } from '../../packages/domain/src/builder';

const randy = { light: { value: 15, women: 12, unit: 'kg' as const }, medium: { value: 25, women: 19, unit: 'kg' as const }, heavy: { value: 34, women: 25, unit: 'kg' as const } };

describe('loads with a women’s amount and a display unit', () => {
  it('converts kg and lb to plate-friendly numbers so a published Rx reappears', () => {
    expect(convertLoad(34, 'kg', 'lb')).toBe(75);
    expect(convertLoad(43, 'kg', 'lb')).toBe(95);
    expect(convertLoad(25, 'kg', 'lb')).toBe(55);
    expect(convertLoad(75, 'lb', 'kg')).toBe(34);
    expect(convertLoad(4, 'kg', 'lb')).toBe(9);
    expect(convertLoad(10, 'lb', 'kg')).toBe(4.5);
    expect(convertLoad(20, 'kg', 'kg')).toBe(20);
  });

  it('shows the men’s amount with the women’s in brackets, or one athlete’s amount only', () => {
    expect(loadAmount(randy.heavy)).toBe('34 (25)');
    expect(loadAmount(randy.heavy, { sex: 'men' })).toBe('34');
    expect(loadAmount(randy.heavy, { sex: 'women' })).toBe('25');
    expect(loadAmount({ value: 24, unit: 'kg' }, { sex: 'women' })).toBe('24');
    expect(loadText(randy.heavy, { unit: 'lb' })).toBe('75 (55) lb');
    expect(loadText({ value: 70, unit: 'percent' }, { unit: 'lb', sex: 'women' })).toBe('70 % 1RM');
    expect(loadText(undefined)).toBe('');
  });

  it('writes every level on one line with the unit once', () => {
    expect(levelsText(randy)).toBe('L 15 (12) · M 25 (19) · H 34 (25) kg');
    expect(levelsText(randy, { unit: 'lb', sex: 'women' })).toBe('L 26 · M 42 · H 55 lb');
    expect(levelsText({ light: { value: 65, unit: 'percent' }, heavy: { value: 85, unit: 'percent' } })).toBe('L 65 · H 85 % 1RM');
    expect(prescriptionText({ name: 'Power snatches', reps: 75, load: randy })).toBe('75 reps · L 15 (12) · M 25 (19) · H 34 (25) kg');
    expect(prescriptionText({ name: 'Run', notes: 'Easy' })).toBe('Easy');
  });

  it('rejects a women’s amount on a percentage in the compiler and the editor', () => {
    const workout = structuredClone(bundledWorkout('back-squat-5x5'));
    const body = workout.sections[0].body;
    if (body.type !== 'repeat' || body.body.type !== 'task') throw new Error('Unexpected fixture shape.');
    const load = body.body.assignments.A.load;
    if (!load || 'value' in load || !load.medium) throw new Error('Unexpected fixture load.');
    load.medium.women = 50;
    expect(() => compileWorkout(workout)).toThrow(/takes no women’s value/);
    const draft = workoutToBuilder(workout)!;
    expect(validateDraft(draft).map(issue => issue.message).join(' ')).toMatch(/takes no women’s value/);
  });
});
