import { describe, expect, it } from 'vitest';
import { loadValueOf, targetAmountOf, targetKindOf, withLoad, withTarget, withWomen, womenOf } from '../../apps/web/src/lane';
import type { Prescription } from '../../packages/domain/src/schema';

const carry: Prescription = { name: 'Dumbbell Farmers Carry', load: { light: { value: 12, women: 7.5, unit: 'kg' }, medium: { value: 17.5, women: 12.5, unit: 'kg' }, heavy: { value: 22.5, women: 15, unit: 'kg' } } };
const swings: Prescription = { name: 'Kettlebell Swings', reps: 15, load: { value: 24, women: 16, unit: 'kg' } };

describe('lane loads', () => {
  it('keep the women’s amounts when a men’s amount is edited', () => {
    expect(withLoad(swings, 'kg', false, { single: 28 }).load).toEqual({ value: 28, women: 16, unit: 'kg' });
    expect(withLoad(carry, 'kg', true, { medium: 20 }).load).toEqual({ light: { value: 12, women: 7.5, unit: 'kg' }, medium: { value: 20, women: 12.5, unit: 'kg' }, heavy: { value: 22.5, women: 15, unit: 'kg' } });
  });

  it('keep the women’s amounts through a change of unit, and drop them for a percentage', () => {
    expect(withLoad(swings, 'lb', false, { single: loadValueOf(swings) }).load).toEqual({ value: 24, women: 16, unit: 'lb' });
    expect(withLoad(carry, 'lb', true, {}).load).toEqual({ light: { value: 12, women: 7.5, unit: 'lb' }, medium: { value: 17.5, women: 12.5, unit: 'lb' }, heavy: { value: 22.5, women: 15, unit: 'lb' } });
    expect(withLoad(swings, 'percent', false, {}).load).toEqual({ value: 24, unit: 'percent' });
    expect(withLoad(carry, 'percent', true, {}).load).toEqual({ light: { value: 12, unit: 'percent' }, medium: { value: 17.5, unit: 'percent' }, heavy: { value: 22.5, unit: 'percent' } });
  });

  it('keep the women’s amount through the Levels switch: the single value and the medium level stand for each other', () => {
    const levelled = withLoad(swings, 'kg', true, { light: 16, medium: 24, heavy: 34 });
    expect(levelled.load).toEqual({ light: { value: 16, unit: 'kg' }, medium: { value: 24, women: 16, unit: 'kg' }, heavy: { value: 34, unit: 'kg' } });
    expect(withLoad(levelled, 'kg', false, { single: loadValueOf(levelled, 'medium') }).load).toEqual({ value: 24, women: 16, unit: 'kg' });
    expect(withLoad(carry, 'kg', false, { single: loadValueOf(carry, 'medium') }).load).toEqual({ value: 17.5, women: 12.5, unit: 'kg' });
  });

  it('remove an emptied level, the whole load with the last one, and everything for no load', () => {
    expect(withLoad(carry, 'kg', true, { light: '' }).load).toEqual({ medium: { value: 17.5, women: 12.5, unit: 'kg' }, heavy: { value: 22.5, women: 15, unit: 'kg' } });
    expect(withLoad({ name: 'Carry', load: { medium: { value: 20, unit: 'kg' } } }, 'kg', true, { medium: '' })).toEqual({ name: 'Carry' });
    expect(withLoad(swings, 'none', false, {})).toEqual({ name: 'Kettlebell Swings', reps: 15 });
  });

  it('set and clear a women’s amount on the single value or one level', () => {
    expect(womenOf(withWomen(swings, undefined, 20))).toBe(20);
    expect(withWomen(swings, undefined, '').load).toEqual({ value: 24, unit: 'kg' });
    expect(womenOf(withWomen(carry, 'heavy', 17.5), 'heavy')).toBe(17.5);
    expect(womenOf(withWomen(carry, 'heavy', ''), 'heavy')).toBe('');
    expect(womenOf(withWomen(carry, 'heavy', ''), 'light')).toBe(7.5);
  });
});

describe('lane targets', () => {
  it('change the amount of the shown target and leave a second target alone', () => {
    // Written by hand: the form shows the reps, the distance is not its to drop.
    const both: Prescription = { name: 'Shuttle Runs', reps: 5, distance: { value: 400, unit: 'm' } };
    expect(targetKindOf(both)).toBe('reps');
    expect(withTarget(both, 'reps', 8)).toEqual({ name: 'Shuttle Runs', reps: 8, distance: { value: 400, unit: 'm' } });
    expect(withTarget(both, 'calories', 5)).toEqual({ name: 'Shuttle Runs', calories: 5, distance: { value: 400, unit: 'm' } });
    // "No target" removes the shown one; the other is then the one shown.
    expect(withTarget(both, 'none', 5)).toEqual({ name: 'Shuttle Runs', distance: { value: 400, unit: 'm' } });
  });

  it('never write reps or calories below 1 when the kind changes', () => {
    const row: Prescription = { name: 'Row', distance: { value: .4, unit: 'km' } };
    expect(withTarget(row, 'reps', .4)).toEqual({ name: 'Row', reps: 1 });
    expect(withTarget(row, 'calories', .4)).toEqual({ name: 'Row', calories: 1 });
    expect(withTarget({ name: 'Row', distance: { value: 12.5, unit: 'm' } }, 'reps', 12.5).reps).toBe(13);
  });

  it('keep the target when the amount is not above zero: only "No target" removes one', () => {
    const run: Prescription = { name: 'Run', distance: { value: 400, unit: 'm' } };
    expect(withTarget(run, 'm', 0)).toBe(run);
    expect(withTarget(run, 'm', Number.NaN)).toBe(run);
    expect(withTarget(run, 'none', 400)).toEqual({ name: 'Run' });
  });

  it('write each kind to its own field and read it back', () => {
    const plain: Prescription = { name: 'Run', notes: 'Easy pace' };
    const km = withTarget(plain, 'km', 1.5);
    expect(km).toEqual({ name: 'Run', notes: 'Easy pace', distance: { value: 1.5, unit: 'km' } });
    expect([targetKindOf(km), targetAmountOf(km)]).toEqual(['km', 1.5]);
    const metres = withTarget(km, 'm', 1.5);
    expect(metres.distance).toEqual({ value: 1.5, unit: 'm' });
    const hold = withTarget(metres, 'time', 1.5);
    expect(hold).toEqual({ name: 'Run', notes: 'Easy pace', timeMs: 1500 });
    expect([targetKindOf(hold), targetAmountOf(hold)]).toEqual(['time', 1.5]);
    expect(targetAmountOf(withTarget(hold, 'reps', 1.5))).toBe(2);
  });
});
