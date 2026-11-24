import { useMemo, useState } from 'react';
import { compileWorkout } from '../../../packages/domain/src/compiler';
import { QUICK_TIMER_ID } from '../../../packages/domain/src/library';
import { QUICK_TIMER_KINDS, QUICK_TIMER_LABELS, QUICK_TIMER_MAX_PREP_MS, quickTimerWorkout, type QuickTimer, type QuickTimerKind } from '../../../packages/domain/src/quick-timer';
import { displayTime } from '../../../packages/engine/src';
import { Icon } from './Icon';
import { NumberInput } from './NumberInput';
import { TimeInput } from './TimeInput';
import { loadQuickTimer, saveQuickTimer } from './quick-timer-store';
import { playHref } from './router';
import { useStart } from './start';
import shared from './App.module.css';
import styles from './QuickTimer.module.css';

const HINTS: Record<QuickTimerKind, string> = {
  tabata: 'Work and rest in turns, for a number of rounds.',
  emom: 'A new interval starts on the clock, every time.',
  amrap: 'One countdown. Count your rounds as you go.',
  forTime: 'The clock counts up until you tap Done, or to the cap.',
};

/**
 * The quick timer's page (LIB-09): a kind, its few numbers and Start. The numbers are stored as they are typed, and the
 * play route builds the session from that store, so a reload of the player plays the same timer.
 */
export function QuickTimerPage() {
  const [timer, setTimer] = useState(loadQuickTimer);
  const { starting, start } = useStart();
  const change = (next: QuickTimer) => { setTimer(next); saveQuickTimer(next); };
  const workout = useMemo(() => quickTimerWorkout(timer), [timer]);
  const plan = useMemo(() => { try { return compileWorkout(workout); } catch { return undefined; } }, [workout]);
  const time = (label: string, value: number, onChange: (ms: number) => void, min = 1000, allowEmpty = false, max = 99 * 60_000 + 59_000) => <label className={styles.field}>{label}<TimeInput value={value} min={min} max={max} allowEmpty={allowEmpty} placeholder={allowEmpty ? 'none' : undefined} onChange={onChange} /></label>;
  const count = (label: string, value: number, onChange: (count: number) => void) => <label className={styles.field}>{label}<NumberInput value={value} min={1} max={99} onChange={next => { if (next !== '') onChange(next); }} /></label>;
  const { kind } = timer;
  const busy = starting === QUICK_TIMER_ID;

  return <div className={styles.page}>
    <div className={shared.eyebrow}><a href="#/">YOUR LIBRARY</a> <span>/</span> QUICK TIMER</div>
    <h1>Quick timer</h1>
    <p className={shared.description}>Only the clock, with the beeps and cues of a workout. Nothing is added to your library.</p>
    <section className={styles.card} aria-label="Timer">
      <div className={`${shared.segmented} ${styles.kinds}`} role="radiogroup" aria-label="Kind of timer">{QUICK_TIMER_KINDS.map(value => <label key={value} data-checked={kind === value}><input type="radio" name="quick-timer-kind" value={value} checked={kind === value} onChange={() => change({ ...timer, kind: value })} />{QUICK_TIMER_LABELS[value]}</label>)}</div>
      <p className={styles.hint}>{HINTS[kind]}</p>
      <div className={styles.fields}>
        {kind === 'tabata' && <>
          {count('Rounds', timer.tabata.rounds, rounds => change({ ...timer, tabata: { ...timer.tabata, rounds } }))}
          {time('Work', timer.tabata.workMs, workMs => change({ ...timer, tabata: { ...timer.tabata, workMs } }))}
          {time('Rest', timer.tabata.restMs, restMs => change({ ...timer, tabata: { ...timer.tabata, restMs } }), 0)}
        </>}
        {kind === 'emom' && <>
          {time('Every', timer.emom.intervalMs, intervalMs => change({ ...timer, emom: { ...timer.emom, intervalMs } }))}
          {count('Rounds', timer.emom.intervals, intervals => change({ ...timer, emom: { ...timer.emom, intervals } }))}
        </>}
        {kind === 'amrap' && time('Time', timer.amrap.capMs, capMs => change({ ...timer, amrap: { capMs } }))}
        {kind === 'forTime' && time('Time cap (optional)', timer.forTime.capMs, capMs => change({ ...timer, forTime: { capMs } }), 0, true)}
        {time('Countdown before', timer.prepMs, prepMs => change({ ...timer, prepMs }), 0, false, QUICK_TIMER_MAX_PREP_MS)}
      </div>
      <p className={styles.total} role="status">{workout.title}{!plan && <span>A timer runs for 24 hours at the most.</span>}{plan && <span>{plan.durationKind === 'open' ? 'Open-ended' : `${plan.durationKind === 'capped' ? 'Up to ' : ''}${displayTime(plan.durationMs)}`}{workout.prepMs ? ` after a ${Math.round(workout.prepMs / 1000)}-second countdown` : ''}</span>}</p>
      <div className={styles.actions}>
        <a className={shared.primaryButton} href={playHref(QUICK_TIMER_ID)} aria-disabled={!plan || undefined} onClick={event => { if (plan) start(event, QUICK_TIMER_ID, workout); else event.preventDefault(); }} aria-busy={busy || undefined}><Icon name={busy ? 'loading' : 'play'} />Start timer</a>
      </div>
    </section>
  </div>;
}
