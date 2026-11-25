import type { RefObject } from 'react';
import { stillOnly } from './cameo';
import { Icon } from './Icon';
import type { Preferences } from './preferences';
import styles from './App.module.css';

/**
 * The keyboard sheet (NFR-08): the keys of the training view. The app has one, so the footer's Shortcuts link opens it on
 * every page, and the player opens the same one on the ? key and from its Keys button.
 */
export function ShortcutsDialog({ dialog, preferences }: { dialog: RefObject<HTMLDialogElement | null>; preferences: Preferences }) {
  const fun = preferences.funButtons && preferences.soundMode !== 'silent';
  const still = stillOnly();
  const key = (label: string) => <span className={styles.kbd}>{label}</span>;
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="help-title">
    <div className={styles.dialogHeading}><h2 id="help-title">Keyboard</h2><button className={styles.iconButton} aria-label="Close keyboard help" onClick={() => dialog.current?.close()}><Icon name="close" /></button></div>
    <p>These keys work in the training view.</p>
    <ul className={styles.shortcuts}>
      <li>{key('Space')}Start, pause, resume, or Ready</li>
      <li>{key('Enter')}Done, or Switch in you-go-I-go</li>
      <li>{key('←')}{key('→')}Previous or next interval</li>
      <li>{key('Shift')}{key('←')}{key('→')}Previous or next block</li>
      <li>{key('J')}{key('L')}Back or forward {preferences.nudgeSeconds} seconds on the clock</li>
      <li>{key('+')}{key('-')}Larger or smaller stations</li>
      {fun && <li>{key('H')}{!still && key('D')}Party horn{!still && ', or the Just do it speech'}</li>}
      <li>{key('?')}This sheet</li>
    </ul>
  </dialog>;
}
