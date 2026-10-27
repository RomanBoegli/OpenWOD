import type { Difficulty, DifficultyLevel } from '../../../packages/domain/src/difficulty';
import styles from './DifficultyChip.module.css';

/** Projected difficulty derived from the workout's specification. Text always carries the meaning; colour is secondary. */
export function DifficultyChip({ difficulty, detailed = false }: { difficulty: Difficulty; detailed?: boolean }) {
  const { density, intensity } = difficulty.factors;
  const title = `Projected from the workout: ${Math.round(density * 100)}% of timed content is work, movement intensity ${Math.round(intensity * 100)}/100. Score ${difficulty.score}/100.`;
  return <span className={styles.chip} data-level={difficulty.level} title={title} aria-label={`Projected difficulty: ${difficulty.label}`}>
    <span className={styles.dots} aria-hidden="true">{[1, 2, 3, 4].map(dot => <i key={dot} data-on={dot <= difficulty.level} />)}</span>
    {difficulty.label}{detailed && <small> · {difficulty.score}/100</small>}
  </span>;
}

/** The same chip as a filter toggle: the level's bars and name, pressed while the filter is on. */
export function DifficultyFilterChip({ level, label, pressed, onClick }: { level: DifficultyLevel; label: string; pressed: boolean; onClick: () => void }) {
  return <button type="button" className={styles.chip} data-level={level} aria-pressed={pressed} onClick={onClick}>
    <span className={styles.dots} aria-hidden="true">{[1, 2, 3, 4].map(dot => <i key={dot} data-on={dot <= level} />)}</span>
    {label}
  </button>;
}
