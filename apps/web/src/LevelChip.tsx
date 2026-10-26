import { loadText } from '../../../packages/domain/src/fixtures';
import { LOAD_LEVELS, type LoadLevel, type Prescription } from '../../../packages/domain/src/schema';
import styles from './LevelChip.module.css';

export const LEVEL_LABELS: Record<LoadLevel, string> = { light: 'Light', medium: 'Medium', heavy: 'Heavy' };
export const LEVEL_LETTERS: Record<LoadLevel, string> = { light: 'L', medium: 'M', heavy: 'H' };

/** Does this prescription offer per-level loads? */
export const hasLevels = (load: Prescription['load']) => Boolean(load && !('value' in load));

/** A ski-slope style chip: blue L, red M, black H. The letter is always present, so colour is never the only cue. */
export function LevelChip({ level, title, decorative = false }: { level: LoadLevel; title?: string; decorative?: boolean }) {
  return <span className={styles.chip} data-level={level} title={title ?? LEVEL_LABELS[level]} aria-label={decorative ? undefined : LEVEL_LABELS[level]} aria-hidden={decorative || undefined}>{LEVEL_LETTERS[level]}</span>;
}

/** Every level side by side, for the overview. */
export function LoadLevels({ load }: { load: Prescription['load'] }) {
  if (!load) return null;
  if ('value' in load) return <span className={styles.line}><span>{loadText(load)}</span></span>;
  return <span className={styles.levels}>{LOAD_LEVELS.filter(level => load[level]).map(level => <span key={level} className={styles.line}><LevelChip level={level} /><span>{loadText(load[level])}</span></span>)}</span>;
}
