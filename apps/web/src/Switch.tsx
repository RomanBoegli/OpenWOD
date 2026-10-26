import type { ReactNode } from 'react';
import styles from './App.module.css';

/** A labelled on/off switch: text on the left, the toggle on the right, as on a phone's settings screen. */
export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return <label className={styles.switchRow}>
    <span className={styles.switchText}><span>{label}</span>{hint && <small>{hint}</small>}</span>
    <span className={styles.switch} data-checked={checked}><input type="checkbox" role="switch" checked={checked} onChange={event => onChange(event.target.checked)} /><span className={styles.switchKnob} aria-hidden="true" /></span>
  </label>;
}
