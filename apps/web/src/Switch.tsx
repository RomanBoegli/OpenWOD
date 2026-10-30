import type { ReactNode } from 'react';
import styles from './App.module.css';

/** A labelled on/off switch: text on the left, the toggle on the right, as on a phone's settings screen. */
export function Switch({ checked, onChange, label, hint, compact }: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode; hint?: ReactNode; /** Inline, without the settings row's rule and height. */ compact?: boolean }) {
  return <label className={styles.switchRow} data-compact={compact || undefined}>
    <span className={styles.switchText}><span>{label}</span>{hint && <small>{hint}</small>}</span>
    <span className={styles.switch} data-checked={checked}><input type="checkbox" role="switch" checked={checked} onChange={event => onChange(event.target.checked)} /><span className={styles.switchKnob} aria-hidden="true" /></span>
  </label>;
}
