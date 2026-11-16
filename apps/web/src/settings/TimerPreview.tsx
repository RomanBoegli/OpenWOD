import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { displayTime, warningLevel, washDrain, washMorph } from '../../../../packages/engine/src';
import { Icon } from '../Icon';
import type { Preferences } from '../preferences';
import shared from '../App.module.css';
import styles from './TimerPreview.module.css';

interface TimerPreviewProps { view: 'focus' | 'context'; ringWidth: number; washGain: number; amberMs: number; redMs: number; colors: { first: string; second: string }; progress: Preferences['progress'] }
type Phase = 'idle' | 'work' | 'complete';

/** The player's ring path at miniature size: starts top centre and drains clockwise, like Player.tsx. */
const RING = 'M100 3H184Q197 3 197 16V116Q197 129 184 129H16Q3 129 3 116V16Q3 3 16 3H100';
/** The round donut's outline, as in RoundDonut.tsx. */
const DONUT = 'M30 4 H44 A12 12 0 0 1 56 16 V26 A12 12 0 0 1 44 38 H16 A12 12 0 0 1 4 26 V16 A12 12 0 0 1 16 4 Z';
/** The preview hurries to the amber mark in this long, then plays the marks at close to real time (capped). */
const RUSH_MS = 3000;
const MARKS_MAX_MS = 8000;

/**
 * A miniature of the player: the ring, the pulse and the colour marks with the settings as they are, drawn as the
 * focus or the context layout, with the parts of the progress that are switched on: the bar, the percentage under it,
 * the percentage beside the clock and the round donut. Preview drains one slot in a few seconds using the same warning rule as the player.
 */
export function TimerPreview({ view, ringWidth, washGain, amberMs, redMs, colors, progress: shown }: TimerPreviewProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [remainingMs, setRemainingMs] = useState(0);
  const frame = useRef(0);
  // Long enough that the quarter and tenth caps of UI-13 never hide the chosen marks.
  const slotMs = Math.max(60_000, amberMs * 4, redMs * 10);
  const fraction = phase === 'work' ? remainingMs / slotMs : 1;
  const warning = phase === 'work' ? warningLevel(remainingMs, slotMs, { amberMs, redMs }) : 'normal';
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const play = () => {
    cancelAnimationFrame(frame.current);
    if (reduced) { setPhase('complete'); frame.current = window.setTimeout(() => setPhase('idle'), 1500) as unknown as number; return; }
    const started = performance.now();
    setPhase('work'); setRemainingMs(slotMs);
    const marksMs = Math.min(amberMs, MARKS_MAX_MS);
    const tick = (now: number) => {
      const real = now - started;
      const elapsed = real < RUSH_MS ? (slotMs - amberMs) * (real / RUSH_MS) : slotMs - amberMs + amberMs * ((real - RUSH_MS) / marksMs);
      if (elapsed >= slotMs) {
        setRemainingMs(0); setPhase('complete');
        frame.current = window.setTimeout(() => setPhase('idle'), 1800) as unknown as number;
        return;
      }
      setRemainingMs(slotMs - elapsed);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  // The same overlay as the player, fed the same numbers: the gain and floor from the settings, the drain of the running slot and the colour morph at the marks.
  // At rest the overlay sits at its full gain so the slider has a visible effect; a run climbs to it once over the slot while the marks only change the colour.
  const drained = phase === 'work' ? washDrain(remainingMs, slotMs) : phase === 'idle' ? 1 : 0;
  const morph = phase === 'work' ? washMorph(remainingMs, slotMs, { amberMs, redMs }) : { amber: 0, red: 0 };
  const style = { '--ring': `${ringWidth}px`, '--wash-gain': String(washGain / 100), '--wash-min': String(washGain / 600), '--drained': drained.toFixed(3), '--to-amber': morph.amber.toFixed(3), '--to-red': morph.red.toFixed(3), ...(colors.first ? { '--phase-amber': colors.first } : {}), ...(colors.second ? { '--phase-red': colors.second } : {}) } as CSSProperties;
  const time = phase === 'idle' ? displayTime(slotMs) : phase === 'complete' ? '00:00' : displayTime(remainingMs);
  const percent = Math.round((phase === 'complete' ? 1 : 0.2 + (phase === 'work' ? 0.1 * (1 - fraction) : 0)) * 100);
  return <div className={styles.wrap}>
    <div className={`${shared.wash} ${styles.panel}`} data-view={view} data-phase={phase} data-warning={warning} style={style} aria-hidden="true">
      <svg className={styles.ring} viewBox="0 0 200 132" preserveAspectRatio="none">
        <path className={styles.track} d={RING} />
        <path className={styles.progress} d={RING} pathLength={1} strokeDasharray="1 1" strokeDashoffset={-(1 - fraction)} />
        {/* Where the colour turns: the last amberMs of the slot in amber, the last redMs in red, as marks on the ring. */}
        <path className={styles.mark} data-mark="amber" d={RING} pathLength={1} strokeDasharray={`${amberMs / slotMs - redMs / slotMs} 1`} strokeDashoffset={-(1 - amberMs / slotMs)} />
        <path className={styles.mark} data-mark="red" d={RING} pathLength={1} strokeDasharray={`${redMs / slotMs} 1`} strokeDashoffset={-(1 - redMs / slotMs)} />
      </svg>
      <div className={styles.top}><span><span className={styles.dot} />Row</span><span>1 / 5</span></div>
      {(shown.bar || shown.barPercent) && <div className={styles.overall}>{shown.bar && <span className={styles.overallTrack}><span className={styles.overallFill} style={{ width: `${percent}%` }} /></span>}{shown.barPercent && <span className={styles.overallText}>{percent} % DONE</span>}</div>}
      <div className={styles.phase}>{phase === 'complete' ? 'Done' : warning === 'red' ? 'Last seconds' : warning === 'amber' ? 'Nearly there' : 'Work'}</div>
      {/* The clock's line as in the player: the donut left of the digits, the percentage right of them, both on the digits' baseline. */}
      <div className={styles.clock}>
        {shown.donut && <span className={styles.donut}>
          <svg viewBox="0 0 60 42">{[0, 1, 2, 3].map(index => <path key={index} className={styles.donutSegment} data-state={index === 0 ? 'done' : index === 1 ? 'now' : 'open'} d={DONUT} pathLength={1} strokeDasharray=".21 .79" strokeDashoffset={-(index * .25 + .02)} />)}<text x="30" y="21">2/4</text></svg>
          <span className={styles.donutDots}>{[0, 1, 2, 3, 4].map(index => <i key={index} data-state={index === 0 ? 'current' : 'open'} />)}</span>
        </span>}
        <span className={styles.time}>{time}</span>
        {shown.clockPercent && <span className={styles.percent}>{percent} %</span>}
      </div>
      {view === 'focus' ? <div className={styles.lanes}><span className={styles.lane}><b>A</b>Row</span><span className={styles.lane}><b>B</b>Swings</span></div>
        : <ul className={styles.rows}><li data-active=""><span>01</span>Row<small>40s</small></li><li><span>02</span>Kettlebell swings<small>40s</small></li><li><span>03</span>Burpees<small>40s</small></li></ul>}
    </div>
    <button type="button" className={shared.quietButton} onClick={play} disabled={phase !== 'idle'}><Icon name="play" size={15} />{phase === 'idle' ? 'Preview' : phase === 'work' ? 'Previewing…' : 'Complete'}</button>
  </div>;
}
