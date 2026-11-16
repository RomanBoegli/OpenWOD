import { LOAD_LEVELS, type LoadLevel, type LoadValue, type Prescription } from '../../../packages/domain/src/schema';

/**
 * What the editor reads from and writes to one lane (a prescription): the one target it shows, and the load with its
 * women's amounts. Pure, so the rules of the form are tested without a browser.
 */

export type TargetKind = 'none' | 'reps' | 'calories' | 'm' | 'km' | 'time';
export const TARGET_LABELS: Record<TargetKind, string> = { none: 'No target', reps: 'Reps', calories: 'Calories', m: 'Metres', km: 'Kilometres', time: 'Seconds' };
/** What the amount field of each kind takes (NumberInput): whole reps and calories from 1, decimals above zero for the rest, up to the schema's limits. */
export const TARGET_AMOUNTS: Record<Exclude<TargetKind, 'none'>, { min: number; max: number; decimal: boolean; step: number }> = {
  reps: { min: 1, max: 100_000, decimal: false, step: 1 },
  calories: { min: 1, max: 100_000, decimal: false, step: 1 },
  m: { min: .001, max: 1_000_000, decimal: true, step: 1 },
  km: { min: .001, max: 1_000_000, decimal: true, step: .1 },
  time: { min: .001, max: 86_400, decimal: true, step: 1 },
};
/** The prescription field each kind is kept in. */
const TARGET_FIELDS = { reps: 'reps', calories: 'calories', m: 'distance', km: 'distance', time: 'timeMs' } as const;
export const targetKindOf = (value: Prescription): TargetKind => value.reps ? 'reps' : value.calories ? 'calories' : value.distance ? value.distance.unit : value.timeMs ? 'time' : 'none';
export const targetAmountOf = (value: Prescription): number | '' => value.reps ?? value.calories ?? (value.distance ? value.distance.value : value.timeMs ? value.timeMs / 1000 : '');
/**
 * Sets the target the lane shows to `kind` at `amount`; 'none' removes it. Only the shown target's field changes, so a
 * lane written by hand with two targets (reps and a distance) keeps the other one. An amount that is not above zero
 * changes nothing, and reps and calories are whole numbers from 1, whatever the amount came from.
 */
export function withTarget(value: Prescription, kind: TargetKind, amount: number): Prescription {
  if (kind !== 'none' && !(amount > 0)) return value;
  const shown = targetKindOf(value);
  const rest = { ...value };
  if (shown !== 'none') delete rest[TARGET_FIELDS[shown]];
  if (kind === 'none') return rest;
  if (kind === 'reps' || kind === 'calories') return { ...rest, [kind]: Math.max(1, Math.round(amount)) };
  if (kind === 'time') return { ...rest, timeMs: Math.max(1, Math.round(amount * 1000)) };
  return { ...rest, distance: { value: amount, unit: kind } };
}

export type LoadMode = 'none' | 'kg' | 'lb' | 'percent';
/** What a load amount field takes (NumberInput), the women's one too: a decimal above zero. */
export const LOAD_AMOUNT = { min: .001, max: 10_000, decimal: true };
export const loadModeOf = (value: Prescription): LoadMode => { const load = value.load; if (!load) return 'none'; const first = 'value' in load ? load : load.medium ?? load.light ?? load.heavy; return first?.unit ?? 'none'; };
export const levelledOf = (value: Prescription) => Boolean(value.load && !('value' in value.load));
export const loadValueOf = (value: Prescription, level?: LoadLevel): number | '' => { const load = value.load; if (!load) return ''; if ('value' in load) return load.value; const picked = level ? load[level] : load.medium; return picked ? picked.value : ''; };
export const womenOf = (value: Prescription, level?: LoadLevel): number | '' => { const load = value.load; if (!load) return ''; const picked = 'value' in load ? load : level ? load[level] : load.medium; return picked?.women ?? ''; };
/** Sets or clears the women's amount on one load value (the single value, or the given level). */
export function withWomen(value: Prescription, level: LoadLevel | undefined, amount: number | ''): Prescription {
  const load = value.load;
  if (!load) return value;
  const patch = (item: LoadValue): LoadValue => { const { women: _w, ...rest } = item; return amount === '' ? rest : { ...rest, women: amount }; };
  if ('value' in load) return { ...value, load: patch(load) };
  if (!level || !load[level]) return value;
  return { ...value, load: { ...load, [level]: patch(load[level]!) } };
}
/**
 * The load in `mode`, single or by level, with `amounts` in place of the amounts it has; an empty amount removes that
 * value. Every value keeps its women's amount through an edit, a change of unit and the Levels switch (the single value
 * and the medium level stand for each other). A percentage is of each athlete's own maximum, so it carries none.
 */
export function withLoad(value: Prescription, mode: LoadMode, levelled: boolean, amounts: Partial<Record<LoadLevel, number | ''>> & { single?: number | '' }): Prescription {
  const { load, ...rest } = value;
  if (mode === 'none') return rest;
  const before = (level?: LoadLevel) => !load ? undefined : 'value' in load ? (!level || level === 'medium' ? load : undefined) : load[level ?? 'medium'];
  const item = (amount: number, level?: LoadLevel): LoadValue => { const women = mode === 'percent' ? undefined : before(level)?.women; return { value: amount, ...(women === undefined ? {} : { women }), unit: mode }; };
  if (!levelled) { const amount = amounts.single ?? loadValueOf(value); return amount === '' ? rest : { ...rest, load: item(amount) }; }
  const levels: Partial<Record<LoadLevel, LoadValue>> = {};
  for (const level of LOAD_LEVELS) { const amount = amounts[level] ?? loadValueOf(value, level); if (amount !== '') levels[level] = item(amount, level); }
  return Object.keys(levels).length ? { ...rest, load: levels } : rest;
}
