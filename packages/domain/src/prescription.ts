import { LOAD_LEVELS, type LoadLevel, type LoadValue, type Prescription } from './schema';

/** Who an athlete lifts as; selects `value` or `women` on a load. */
export type Sex = 'men' | 'women';
/** Display unit for absolute loads; percentages are never converted. */
export type LoadUnit = 'kg' | 'lb';
export interface LoadOptions {
  /** Show absolute loads in this unit, converting when the file uses the other one. Default: as written. */
  unit?: LoadUnit;
  /** Show one athlete's amount only. Default: the men's amount with the women's in brackets, "34 (25)". */
  sex?: Sex;
}
export const LEVEL_LETTERS: Record<LoadLevel, string> = { light: 'L', medium: 'M', heavy: 'H' };

const LB_PER_KG = 2.20462;
/**
 * Converts between kg and lb and rounds to a plate-friendly number: kilograms to halves under 10 and whole numbers
 * above, pounds to whole numbers under 20 and fives above (34 kg → 75 lb, 43 kg → 95 lb, 29 kg → 65 lb).
 */
export function convertLoad(amount: number, from: LoadUnit, to: LoadUnit): number {
  if (from === to) return amount;
  if (to === 'lb') { const lb = amount * LB_PER_KG; return lb < 20 ? Math.round(lb) : Math.round(lb / 5) * 5; }
  const kg = amount / LB_PER_KG;
  return kg < 10 ? Math.round(kg * 2) / 2 : Math.round(kg);
}

/** The unit a load is shown in: the preference for absolute loads, `percent` untouched. */
export const loadDisplayUnit = (load: LoadValue, unit?: LoadUnit): LoadUnit | 'percent' => load.unit === 'percent' ? 'percent' : unit ?? load.unit;
export const loadUnitLabel = (unit: LoadUnit | 'percent') => unit === 'percent' ? '% 1RM' : unit;

/** The number(s) of a load without the unit: "34", "25" or "34 (25)". */
export function loadAmount(load: LoadValue, options: LoadOptions = {}): string {
  if (load.unit === 'percent') return String(load.value);
  const unit = loadDisplayUnit(load, options.unit) as LoadUnit;
  const men = convertLoad(load.value, load.unit, unit);
  const women = load.women === undefined ? undefined : convertLoad(load.women, load.unit, unit);
  if (options.sex === 'women') return String(women ?? men);
  if (options.sex === 'men' || women === undefined) return String(men);
  return `${men} (${women})`;
}

/** One load with its unit: "34 (25) kg", "75 lb", "70 % 1RM". */
export function loadText(load: LoadValue | undefined, options: LoadOptions = {}): string {
  if (!load) return '';
  return `${loadAmount(load, options)} ${loadUnitLabel(loadDisplayUnit(load, options.unit))}`;
}

/** The load an athlete at `level` lifts: their level, else the nearest defined level, else the single value. */
export function resolveLoad(load: Prescription['load'], level: LoadLevel = 'medium'): LoadValue | undefined {
  if (!load) return undefined;
  if ('value' in load) return load;
  return load[level] ?? load.medium ?? load.light ?? load.heavy;
}

/** Every level on one line, the unit once: "L 15 (12) · M 25 (19) · H 34 (25) kg"; a single value as loadText. */
export function levelsText(load: Prescription['load'], options: LoadOptions = {}): string {
  if (!load) return '';
  if ('value' in load) return loadText(load, options);
  const levels = LOAD_LEVELS.filter(level => load[level]);
  if (!levels.length) return '';
  const unit = loadDisplayUnit(load[levels[0]]!, options.unit);
  return `${levels.map(level => `${LEVEL_LETTERS[level]} ${loadAmount(load[level]!, options)}`).join(' · ')} ${loadUnitLabel(unit)}`;
}

export function distanceText(distance: Prescription['distance']): string {
  return distance ? `${distance.value} ${distance.unit}` : '';
}

/** Targets as a short line: "21 reps · L 20 (15) · M 30 (20) · H 43 (29) kg", "12 cal", "1 km". Falls back to notes, then a steady-effort hint. */
export function prescriptionText(value: Prescription, options: LoadOptions = {}): string {
  const targets = [
    value.reps ? `${value.reps} reps` : '',
    value.calories ? `${value.calories} cal` : '',
    distanceText(value.distance),
    value.timeMs ? `${Math.round(value.timeMs / 1000)} s` : '',
    levelsText(value.load, options),
  ].filter(Boolean).join(' · ');
  return targets || value.notes || 'Steady effort. Your pace.';
}
