import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { FILE_EXTENSION, serialiseWorkoutFile, type Workout } from '../../../packages/domain/src';
import { fixtureWorkouts, prescriptionText } from '../../../packages/domain/src/fixtures';
import { displayTime, warningLevel, type ClockValues } from '../../../packages/engine/src';
import { useWorkout } from './use-workout';
import type { WorkoutAudio } from './audio';
import type { Preferences } from './preferences';
import { slugify } from './library-store';
import { workoutHref } from './router';
import { Icon } from './Icon';
import { DifficultyChip } from './DifficultyChip';
import { rateDifficulty } from '../../../packages/domain/src/difficulty';
import styles from './App.module.css';

function Perimeter({ progress }: { progress: RefObject<SVGPathElement | null> }) {
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    if (svg.current) observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  const { width: w, height: h } = size;
  const d = `M${w / 2} 4H${w - 25}Q${w - 4} 4 ${w - 4} 25V${h - 25}Q${w - 4} ${h - 4} ${w - 25} ${h - 4}H25Q4 ${h - 4} 4 ${h - 25}V25Q4 4 25 4H${w / 2}`;
  return <svg className={styles.perimeter} ref={svg} aria-hidden="true"><path className={styles.borderTrack} d={d} /><path ref={progress} className={styles.borderProgress} pathLength="1" strokeDasharray="1 1" d={d} /></svg>;
}

export function exportWorkoutFile(workout: Workout) {
  const blob = new Blob([serialiseWorkoutFile(workout)], { type: 'application/yaml' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${slugify(workout.title)}${FILE_EXTENSION}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface PlayerProps {
  workout: Workout;
  audio: WorkoutAudio;
  preferences: Preferences;
  onPreferencesChange: (update: (value: Preferences) => Preferences) => void;
  onPerformingChange: (performing: boolean) => void;
}

export function Player({ workout, audio, preferences, onPreferencesChange, onPerformingChange }: PlayerProps) {
  const { names, view } = preferences;
  const setView = (next: 'focus' | 'context') => onPreferencesChange(value => ({ ...value, view: next }));
  const [following, setFollowing] = useState(true);
  const stopDialog = useRef<HTMLDialogElement>(null);
  const context = useRef<HTMLDivElement>(null);
  const activeRow = useRef<HTMLDivElement>(null);
  const timer = useRef<HTMLDivElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const border = useRef<SVGPathElement>(null);
  const player = useRef<HTMLDivElement>(null);
  const { engine, plan, projection, send, subscribeClock, soundError, wakeStatus, restart } = useWorkout(workout, audio);
  const { status, current, nextWork, section } = projection;
  const isPrep = status === 'preparing' || (status === 'paused' && projection.occurrenceId === 'prep');
  const isRest = current.phase !== 'work' && !isPrep;
  const terminal = status === 'completed' || status === 'aborted';
  const editable = status === 'ready' || terminal;
  const active = ['running', 'preparing'].includes(status);
  const showing = isRest ? nextWork?.assignments : current.assignments;
  const round = (isRest ? nextWork : current)?.rounds.at(-1) ?? current.rounds.at(-1);
  const totalRounds = round?.count ?? 1;
  const roundNumber = round?.iteration ?? 1;
  const bundled = fixtureWorkouts.some(item => item.id === workout.id);
  const difficulty = useMemo(() => rateDifficulty(plan), [plan]);

  // One row per content anchor in the current section, showing the assignments of the current round.
  const contextRows = useMemo(() => {
    const rows = new Map<string, typeof current>();
    for (const item of plan.occurrences) {
      if (item.sectionIndex !== current.sectionIndex || item.phase !== 'work') continue;
      const iteration = item.rounds.at(-1)?.iteration ?? 1;
      if (!rows.has(item.anchor) || iteration === roundNumber) rows.set(item.anchor, item);
    }
    return [...rows.values()];
  }, [plan, current.sectionIndex, roundNumber]);
  const focusAnchor = isRest ? nextWork?.anchor : current.anchor;
  const currentWorkNumber = contextRows.findIndex(item => item.anchor === focusAnchor) + 1;

  useEffect(() => { onPerformingChange(!editable); }, [editable, onPerformingChange]);
  useEffect(() => { void audio.preload(); }, [audio]); // Clips are decoded before Play so a session never waits on the network.
  useEffect(() => () => onPerformingChange(false), [onPerformingChange]);

  // Until checkpoints exist, leaving the page ends the session: ask first.
  useEffect(() => {
    if (editable) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [editable]);

  useEffect(() => subscribeClock((clocks: ClockValues) => {
    if (timer.current) {
      const text = status === 'ready' ? displayTime(workout.prepMs || current.durationMs) : terminal ? displayTime(clocks.activeMs) : status === 'awaitingReady' ? displayTime(current.durationMs) : displayTime(clocks.remainingMs);
      if (timer.current.textContent !== text) timer.current.textContent = text;
    }
    if (elapsed.current) {
      const text = displayTime(clocks.activeMs, 'floor');
      if (elapsed.current.textContent !== text) elapsed.current.textContent = text;
    }
    if (border.current) border.current.style.strokeDashoffset = String(-(1 - (status === 'ready' || status === 'awaitingReady' ? 1 : clocks.fraction)));
    if (player.current) {
      const warning = warningLevel(clocks.remainingMs, clocks.durationMs);
      if (player.current.dataset.warning !== warning) player.current.dataset.warning = warning;
    }
  }), [subscribeClock, status, terminal, workout.prepMs, current.durationMs]);

  useEffect(() => {
    if (following && view === 'context' && activeRow.current && context.current) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      context.current.scrollTo({ top: Math.max(0, activeRow.current.offsetTop - context.current.offsetTop - 80), behavior: reduced ? 'instant' : 'smooth' });
    }
  }, [projection.occurrenceId, following, view]);

  const phaseLabel = status === 'ready' ? 'Ready when you are' : status === 'paused' ? projection.pauseReason === 'hidden' ? 'Paused · app was hidden' : 'Workout paused' : status === 'awaitingReady' ? 'Next section · ready?' : status === 'completed' ? 'Workout complete' : status === 'aborted' ? 'Workout ended' : isPrep ? 'Get ready' : isRest ? current.phase === 'roundRest' ? 'Round rest' : current.phase === 'transition' ? 'Transition' : 'Block rest' : 'Work';
  const playerPhase = terminal ? 'complete' : status === 'paused' ? 'paused' : isRest ? 'rest' : isPrep || status === 'ready' ? 'prep' : 'work';
  const canNavigate = ['running', 'paused'].includes(status) && !isPrep;

  return <div className={styles.screen} data-performing={!editable} data-view={view}>
    <div className={styles.workoutHeading}>
      <div>
        <div className={styles.eyebrow}><a href="#/">YOUR LIBRARY</a> <span>/</span> <a href={workoutHref(workout.id)}>{workout.participants === 2 ? 'PARTNER SESSION' : 'SOLO SESSION'}</a>{!bundled && <><span>/</span>SAVED ON THIS DEVICE</>}</div>
        <h1>{workout.title}</h1>
        {workout.description && <p className={styles.description}>{workout.description}</p>}
        <div className={styles.metadata}><span><Icon name="clock" size={16} />{displayTime(plan.durationMs + workout.prepMs)} incl. prep</span><span><Icon name={workout.participants === 2 ? 'users' : 'user'} size={16} />{workout.participants === 2 ? '2 athletes' : 'Solo'}</span>{workout.equipment.length > 0 && <span className={styles.equipment}>{workout.equipment.join(' + ')}</span>}<DifficultyChip difficulty={difficulty} /></div>
      </div>
      <div className={styles.viewSwitch} aria-label="Player view"><button aria-pressed={view === 'focus'} onClick={() => setView('focus')}><Icon name="focus" size={17} />Focus</button><button aria-pressed={view === 'context'} onClick={() => setView('context')}><Icon name="list" size={17} />Context</button></div>
    </div>

    <div className={styles.player} ref={player} data-phase={playerPhase} data-warning="normal">
      <Perimeter progress={border} />
      <div className={styles.playerTop}><span><span className={styles.liveDot} />{section.title}</span><span>{round ? `ROUND ${roundNumber} / ${totalRounds}` : `SECTION ${current.sectionIndex + 1} / ${plan.sections.length}`}{!editable && <button className={styles.iconButton} aria-label={view === 'focus' ? 'Switch to context view' : 'Switch to focus view'} onClick={() => setView(view === 'focus' ? 'context' : 'focus')}><Icon name={view === 'focus' ? 'list' : 'focus'} size={18} /></button>}</span></div>
      <div className={styles.clockBlock}>
        <div className={styles.phase} role="status" aria-live="polite">{phaseLabel}</div>
        <div ref={timer} className={styles.timer} data-testid="primary-timer" aria-label="Primary timer">{displayTime(workout.prepMs || current.durationMs)}</div>
        <div className={styles.clockCaption}>{terminal ? 'ACTIVE SESSION TIME' : status === 'ready' || isPrep ? 'PREP COUNTDOWN' : status === 'awaitingReady' ? 'FIRST WORK INTERVAL' : isRest ? 'REST REMAINING' : 'WORK REMAINING'}</div>
      </div>

      {terminal ? <div className={styles.finishMessage}><span className={styles.finishIcon}><Icon name="check" size={28} /></span><h2>{status === 'completed' ? 'That’s a good session.' : 'Every bit of movement counts.'}</h2><p>{status === 'completed' ? 'Take a breath. Grab some water. You earned it.' : 'Your session has ended.'}</p></div> : <>
        <div className={styles.laneHeading}>{isRest ? 'COMING UP AFTER REST' : status === 'awaitingReady' ? 'YOUR NEXT SECTION' : 'YOUR STATIONS'}<span>{currentWorkNumber > 0 ? `${currentWorkNumber} OF ${contextRows.length}` : ''}</span></div>
        <div className={styles.lanes} style={{ '--lane-count': workout.participants } as CSSProperties}>
          {(['A', 'B'] as const).filter(role => role === 'A' || workout.participants === 2).map(role => <section className={styles.lane} data-athlete={role} key={role} aria-label={`Athlete ${role} station`}>
            <div className={styles.athleteLabel}><span className={styles.athleteBadge}>{role}</span><span>{names[role]}<small>{role === 'A' ? 'LEFT LANE' : 'RIGHT LANE'}</small></span><span className={styles.laneTime}>{Math.round((isRest ? nextWork?.durationMs ?? 0 : current.durationMs) / 1000)}s</span></div>
            <h2 data-testid={`movement-${role}`}>{showing?.[role]?.shortName ?? showing?.[role]?.name ?? 'All done'}</h2>
            <p>{showing?.[role] ? prescriptionText(showing[role]) : 'You’re at the finish.'}</p>
          </section>)}
        </div>
        <div className={styles.nextStrip}><span className={styles.nextLabel}>UP NEXT <Icon name="arrow" size={16} /></span><span>{nextWork ? `${nextWork.sectionIndex !== current.sectionIndex && section.transitionAfter === 'manualReady' ? 'Ready for next section, then ' : ''}${!isRest && projection.restBeforeNextMs ? `${displayTime(projection.restBeforeNextMs)} rest, then ` : ''}${nextWork.assignments?.A.name}${nextWork.assignments?.B ? ` / ${nextWork.assignments.B.name}` : ''}` : 'Finished · time to recover'}</span></div>
      </>}

      {view === 'context' && <section className={styles.contextSection} aria-label="Workout context">
        <div className={styles.contextHeading}><div><span className={styles.eyebrow}>THE GAME PLAN</span><h2>{section.title}</h2></div><button className={styles.quietButton} aria-pressed={following} onClick={() => setFollowing(value => !value)}><Icon name="focus" size={17} />{following ? 'Following workout' : 'Follow workout'}</button></div>
        <div className={styles.contextList} ref={context} onWheel={() => setFollowing(false)} onTouchMove={() => setFollowing(false)}>
          <div className={styles.contextColumns}><span>#</span><span>A · {names.A}</span><span>{workout.participants === 2 ? `B · ${names.B}` : ''}</span><span>WORK</span></div>
          {contextRows.map((item, index) => {
            const selected = item.anchor === focusAnchor;
            return <div key={item.anchor} ref={selected ? activeRow : undefined} className={styles.contextRow} data-active={selected} aria-current={selected ? 'step' : undefined}><span>{String(index + 1).padStart(2, '0')}</span><span>{item.assignments?.A.name}</span><span>{item.assignments?.B?.name ?? '—'}</span><span>{Math.round(item.durationMs / 1000)}s</span></div>;
          })}
        </div>
        <div className={styles.contextFootnote}>Assignments follow the current round. Authored rests are included in the total.</div>
      </section>}

      <div className={styles.controls}>
        <div className={styles.secondaryControls}>
          <button className={styles.iconButton} aria-label={projection.index === section.startIndex ? 'Restart interval' : 'Previous interval'} disabled={!canNavigate} onClick={() => send('previous', projection.occurrenceId)}><Icon name="previous" /></button>
          <button className={styles.iconButton} aria-label="Next interval" disabled={!canNavigate || projection.index === section.endIndex} onClick={() => send('next', projection.occurrenceId)}><Icon name="next" /></button>
        </div>
        {terminal ? <button className={styles.primaryButton} onClick={restart}><Icon name="play" />Train again</button> : <button className={styles.primaryButton} onClick={() => send(status === 'ready' ? 'play' : status === 'paused' ? 'resume' : status === 'awaitingReady' ? 'ready' : 'pause', projection.occurrenceId)}><Icon name={active ? 'pause' : 'play'} />{status === 'ready' ? 'Start workout' : status === 'paused' ? 'Resume workout' : status === 'awaitingReady' ? 'Start next section' : 'Pause workout'}</button>}
        <button className={styles.stopButton} disabled={editable} onClick={() => stopDialog.current?.showModal()}>End session</button>
      </div>
      {soundError && <p className={styles.notice} role="status">{soundError}</p>}
      <div className={styles.sessionLine}><span>ELAPSED <span ref={elapsed}>00:00</span>{projection.modified && <span className={styles.modified}> · MODIFIED</span>}</span><span>{status === 'ready' ? workout.prepMs ? `${Math.round(workout.prepMs / 1000)}-second prep. Find your rhythm.` : 'Start when you’re ready.' : isRest ? 'Breathe. Your next stations are above.' : 'Your pace. Keep moving.'}</span></div>
    </div>

    <div className={styles.bottomBar}><div className={styles.readiness}><span className={styles.smallDot} /><span>{preferences.soundMode === 'silent' ? 'Silent mode' : preferences.soundMode === 'voice' ? 'Voice + beeps' : 'Beeps only'}</span><span className={styles.readinessDivider}>·</span><span>{wakeStatus}</span></div><div className={styles.sharing}><a className={styles.quietButton} href={workoutHref(workout.id)}><Icon name="list" size={17} />Read through</a><a className={styles.quietButton} href="#/"><Icon name="grid" size={17} />All workouts</a><button className={styles.quietButton} onClick={() => exportWorkoutFile(workout)}><Icon name="download" size={17} />Export WOD</button></div></div>

    <dialog ref={stopDialog} className={styles.dialog} aria-labelledby="stop-title"><h2 id="stop-title">End this session?</h2><p>The timer will stop. You can start a new session whenever you’re ready.</p><div className={styles.dialogActions}><button className={styles.quietButton} onClick={() => stopDialog.current?.close()}>Keep training</button><button className={styles.primaryButton} onClick={() => { send('stop', engine.occurrenceId); stopDialog.current?.close(); }}>End session</button></div></dialog>
  </div>;
}
