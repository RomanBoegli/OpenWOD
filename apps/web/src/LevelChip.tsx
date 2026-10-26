import { useId } from 'react';
import { loadText, resolveLoad } from '../../../packages/domain/src/fixtures';
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

/** The load an athlete lifts at their level, with the chip when the prescription has levels. */
export function LoadLine({ load, level, className }: { load: Prescription['load']; level: LoadLevel; className?: string }) {
  const resolved = resolveLoad(load, level);
  if (!resolved) return null;
  return <span className={`${styles.line} ${className ?? ''}`}>{hasLevels(load) && <LevelChip level={level} />}<span>{loadText(resolved)}</span></span>;
}

/** Every level side by side, for the overview. */
export function LoadLevels({ load }: { load: Prescription['load'] }) {
  if (!load) return null;
  if ('value' in load) return <span className={styles.line}><span>{loadText(load)}</span></span>;
  return <span className={styles.levels}>{LOAD_LEVELS.filter(level => load[level]).map(level => <span key={level} className={styles.line}><LevelChip level={level} /><span>{loadText(load[level])}</span></span>)}</span>;
}

interface LevelPickerProps { levels: { A: LoadLevel; B: LoadLevel }; participants: 1 | 2; names: { A: string; B: string }; onChange: (levels: { A: LoadLevel; B: LoadLevel }) => void; compact?: boolean }

/** Session setup: which load each athlete lifts today (BLD-08). Stored per device, never in the workout file. */
export function LevelPicker({ levels, participants, names, onChange, compact }: LevelPickerProps) {
  const id = useId(); // Radio groups must not share a name across the settings dialog and the player.
  return <div className={styles.picker} data-compact={compact}>
    {(['A', 'B'] as const).filter(role => role === 'A' || participants === 2).map(role => <fieldset key={role} className={styles.group}>
      <legend>{participants === 2 ? `${role} · ${names[role]}` : 'Load level'}</legend>
      <div className={styles.options} role="radiogroup" aria-label={`Load level for athlete ${role}`}>
        {LOAD_LEVELS.map(level => <label key={level} data-checked={levels[role] === level} data-level={level}>
          <input type="radio" name={`${id}-level-${role}`} value={level} checked={levels[role] === level} onChange={() => onChange({ ...levels, [role]: level })} />
          <LevelChip level={level} decorative /><span>{LEVEL_LABELS[level]}</span>
        </label>)}
      </div>
    </fieldset>)}
  </div>;
}
