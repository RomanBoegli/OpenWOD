import { LEVEL_LETTERS, loadAmount, loadDisplayUnit, loadUnitLabel, type LoadOptions } from '../../../packages/domain/src/prescription';
import { LOAD_LEVELS, type LoadLevel, type Prescription } from '../../../packages/domain/src/schema';
import styles from './LevelChip.module.css';

export const LEVEL_LABELS: Record<LoadLevel, string> = { light: 'Light', medium: 'Medium', heavy: 'Heavy' };
export { LEVEL_LETTERS };

/** A ski-slope style chip: blue L, red M, black H. The letter is always present, so colour is never the only cue. */
export function LevelChip({ level, title, decorative = false }: { level: LoadLevel; title?: string; decorative?: boolean }) {
  return <span className={styles.chip} data-level={level} title={title ?? LEVEL_LABELS[level]} aria-label={decorative ? undefined : LEVEL_LABELS[level]} aria-hidden={decorative || undefined}>{LEVEL_LETTERS[level]}</span>;
}

/**
 * A prescription's load as written: every level side by side with the unit once, "L 15 (12) · M 25 (19) · H 34 (25) kg".
 * Without `sex` the women's amount follows in brackets (solo workouts); with it only that athlete's amount shows (pair lanes).
 */
export function LoadLevels({ load, unit, sex }: { load: Prescription['load'] } & LoadOptions) {
  if (!load) return null;
  const options = { unit, sex };
  if ('value' in load) return <span className={styles.line}><span>{loadAmount(load, options)}</span><span className={styles.unit}>{` ${loadUnitLabel(loadDisplayUnit(load, unit))}`}</span></span>;
  const levels = LOAD_LEVELS.filter(level => load[level]);
  if (!levels.length) return null;
  return <span className={styles.levels}>{levels.map(level => <span key={level} className={styles.line}><LevelChip level={level} /><span>{loadAmount(load[level]!, options)}</span></span>)}<span className={styles.unit}>{` ${loadUnitLabel(loadDisplayUnit(load[levels[0]]!, unit))}`}</span></span>;
}
