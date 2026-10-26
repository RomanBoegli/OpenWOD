import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { FILE_EXTENSION, serialiseWorkoutFile, type Workout } from '../../../packages/domain/src';
import { fixtureWorkouts, prescriptionText } from '../../../packages/domain/src/fixtures';
import type { Occurrence, TaskItem } from '../../../packages/domain/src/compiler';
import { FORMAT_LABELS, type LoadLevel, type Prescription } from '../../../packages/domain/src/schema';
import { displayTime, warningLevel, type ClockScope, type ClockValues, type Control, type SectionResult } from '../../../packages/engine/src';
import { useWorkout } from './use-workout';
import type { WorkoutAudio } from './audio';
import type { Preferences } from './preferences';
import { slugify } from './library-store';
import { workoutHref } from './router';
import { Icon } from './Icon';
import { DifficultyChip } from './DifficultyChip';
import { hasLevels, LevelPicker, LoadLine } from './LevelChip';
import { rateDifficulty } from '../../../packages/domain/src/difficulty';
import styles from './App.module.css';
import own from './Player.module.css';

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

/** The one big number of a prescription: reps, calories, distance or a target time. */
export function primaryTarget(value: Prescription): { amount: string; unit: string } | undefined {
  if (value.reps) return { amount: String(value.reps), unit: value.reps === 1 ? 'rep' : 'reps' };
  if (value.calories) return { amount: String(value.calories), unit: 'cal' };
  if (value.distance) return { amount: String(value.distance.value), unit: value.distance.unit };
  if (value.timeMs) return { amount: displayTime(value.timeMs), unit: 'hold' };
  return undefined;
}

/** Does any prescription in the workout offer per-level loads? */
export function workoutHasLevels(workout: Workout): boolean {
  const visit = (node: Workout['sections'][number]['body']): boolean => node.type === 'timed' || node.type === 'task' ? [node.assignments.A, node.assignments.B].some(lane => lane && hasLevels(lane.load)) : node.type === 'sequence' ? node.children.some(visit) : node.type === 'repeat' ? visit(node.body) : false;
  return workout.sections.some(section => visit(section.body));
}

const CAPTIONS: Record<ClockScope, string> = { prep: 'PREP COUNTDOWN', slot: 'WORK REMAINING', interval: 'INTERVAL REMAINING', turn: 'TURN REMAINING', cap: 'TIME CAP REMAINING', elapsed: 'ELAPSED · NO CAP' };

function resultText(result: SectionResult): string {
  const parts: string[] = [];
  if (result.counter) parts.push(`${result.counter.rounds} ${result.counter.rounds === 1 ? 'round' : 'rounds'}${result.counter.reps ? ` + ${result.counter.reps} reps` : ''}`);
  if (result.teamRounds !== undefined) parts.push(`${result.teamRounds} team ${result.teamRounds === 1 ? 'round' : 'rounds'}, ${result.turns} turns`);
  if (result.format === 'forTime' || result.format === 'strength') parts.push(displayTime(result.sectionMs, 'floor'));
  if (result.unacknowledged.length) parts.push(`${result.unacknowledged.length} unreported`);
  parts.push(result.outcome === 'capped' ? 'capped' : result.outcome === 'finished' ? 'finished early' : 'completed');
  return parts.join(' · ');
}

interface PlayerProps {
  workout: Workout;
  audio: WorkoutAudio;
  preferences: Preferences;
  onPreferencesChange: (update: (value: Preferences) => Preferences) => void;
  onPerformingChange: (performing: boolean) => void;
}

export function Player({ workout, audio, preferences, onPreferencesChange, onPerformingChange }: PlayerProps) {
  const { names, view, levels } = preferences;
  const setView = (next: 'focus' | 'context') => onPreferencesChange(value => ({ ...value, view: next }));
  const setLevels = (next: { A: LoadLevel; B: LoadLevel }) => onPreferencesChange(value => ({ ...value, levels: next }));
  const [following, setFollowing] = useState(true);
  const [highlight, setHighlight] = useState<string>();
  const stopDialog = useRef<HTMLDialogElement>(null);
  const context = useRef<HTMLDivElement>(null);
  const activeRow = useRef<HTMLDivElement>(null);
  const timer = useRef<HTMLDivElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const capClock = useRef<HTMLElement>(null);
  const turnClock = useRef<HTMLElement>(null);
  const border = useRef<SVGPathElement>(null);
  const player = useRef<HTMLDivElement>(null);
  const { engine, plan, projection, send, subscribeClock, soundError, wakeStatus, restart } = useWorkout(workout, audio);
  const { status, current, nextWork, section, format, timing, clockScope, controls, acks, tasks, counter, turn, interval } = projection;
  const isBlock = Boolean(tasks);
  const isPrep = status === 'preparing' || (status === 'paused' && projection.occurrenceId === 'prep');
  const isRest = current.phase !== 'work' && !isPrep;
  const terminal = status === 'completed' || status === 'aborted';
  const editable = status === 'ready' || terminal;
  const active = ['running', 'preparing'].includes(status);
  const showing = isRest ? nextWork?.assignments : current.assignments;
  const round = (isRest ? nextWork : current)?.rounds.at(-1) ?? current.rounds.at(-1);
  const bundled = fixtureWorkouts.some(item => item.id === workout.id);
  const difficulty = useMemo(() => rateDifficulty(plan), [plan]);
  const usesLevels = useMemo(() => workoutHasLevels(workout), [workout]);
  const can = (control: Control) => controls.includes(control);
  const pair = workout.participants === 2;

  // One row per content anchor in the current section, showing the assignments of the current round; blocks list their tasks.
  const roundNumber = round?.iteration ?? 1;
  const contextRows = useMemo<{ anchor: string; A?: Prescription; B?: Prescription; durationMs?: number }[]>(() => {
    if (tasks) return tasks.map(task => ({ anchor: task.nodeId, A: task.assignments.A, B: task.assignments.B }));
    const rows = new Map<string, Occurrence>();
    for (const item of plan.occurrences) {
      if (item.sectionIndex !== current.sectionIndex || item.phase !== 'work') continue;
      const iteration = item.rounds.at(-1)?.iteration ?? 1;
      if (!rows.has(item.anchor) || iteration === roundNumber) rows.set(item.anchor, item);
    }
    return [...rows.values()].map(item => ({ anchor: item.anchor, A: item.assignments?.A, B: item.assignments?.B, durationMs: item.timing === 'manual' ? undefined : item.durationMs }));
  }, [plan, current.sectionIndex, roundNumber, tasks]);
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

  // Keyboard: Space pauses/resumes, Enter is Done or Switch, arrows navigate (NFR-08).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(target.tagName)) return;
      if (document.querySelector('dialog[open]')) return;
      const id = engine.occurrenceId;
      const controlsNow = engine.project().controls;
      if (event.key === ' ') { event.preventDefault(); for (const control of ['pause', 'resume', 'ready', 'play'] as const) if (controlsNow.includes(control)) { send(control, id); return; } }
      else if (event.key === 'Enter') { event.preventDefault(); if (controlsNow.includes('done')) send('done', id); else if (controlsNow.includes('switch')) send('switch', id); }
      else if (event.key === 'ArrowRight' && controlsNow.includes('next')) send('next', id);
      else if (event.key === 'ArrowLeft' && controlsNow.includes('previous')) send('previous', id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, send]);

  // For time and strength count up in the big clock (UI-04); a cap stays secondary and drives the perimeter.
  const countUp = (format === 'forTime' || format === 'strength') && timing === 'manual' && !isBlock;
  const firstDisplayMs = countUp ? 0 : clockScope === 'cap' ? section.capMs ?? 0 : clockScope === 'elapsed' ? 0 : current.durationMs;
  useEffect(() => subscribeClock((clocks: ClockValues) => {
    if (timer.current) {
      const text = status === 'ready' ? displayTime(workout.prepMs || firstDisplayMs) : terminal ? displayTime(clocks.activeMs) : status === 'awaitingReady' ? displayTime(firstDisplayMs) : clockScope === 'elapsed' || countUp ? displayTime(clocks.sectionMs, 'floor') : displayTime(clocks.remainingMs);
      if (timer.current.textContent !== text) timer.current.textContent = text;
    }
    if (elapsed.current) {
      const text = displayTime(clocks.activeMs, 'floor');
      if (elapsed.current.textContent !== text) elapsed.current.textContent = text;
    }
    if (capClock.current && clocks.capRemainingMs !== undefined) {
      const text = displayTime(clocks.capRemainingMs);
      if (capClock.current.textContent !== text) capClock.current.textContent = text;
    }
    if (turnClock.current) {
      const text = displayTime(clocks.slotMs, 'floor');
      if (turnClock.current.textContent !== text) turnClock.current.textContent = text;
    }
    if (border.current) border.current.style.strokeDashoffset = String(-(1 - (status === 'ready' || status === 'awaitingReady' || clockScope === 'elapsed' ? 1 : clocks.fraction)));
    if (player.current) {
      const warning = clockScope === 'elapsed' || status === 'ready' || status === 'awaitingReady' ? 'normal' : warningLevel(clocks.remainingMs, clocks.durationMs);
      if (player.current.dataset.warning !== warning) player.current.dataset.warning = warning;
    }
  }), [subscribeClock, status, terminal, workout.prepMs, firstDisplayMs, clockScope, countUp]);

  useEffect(() => {
    if (following && view === 'context' && activeRow.current && context.current) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      context.current.scrollTo({ top: Math.max(0, activeRow.current.offsetTop - context.current.offsetTop - 80), behavior: reduced ? 'instant' : 'smooth' });
    }
  }, [projection.occurrenceId, following, view]);

  const restLabel = current.phase === 'roundRest' ? 'Round rest' : current.phase === 'transition' ? 'Transition' : 'Block rest';
  const phaseLabel = status === 'ready' ? 'Ready when you are' : status === 'paused' ? projection.pauseReason === 'hidden' ? 'Paused · app was hidden' : projection.pauseReason === 'recovered' ? 'Recovered · paused' : 'Workout paused' : status === 'awaitingReady' ? 'Next section · ready?' : status === 'completed' ? 'Workout complete' : status === 'aborted' ? 'Workout ended' : isPrep ? 'Get ready' : isRest ? restLabel : format === 'amrap' ? 'AMRAP' : format === 'emom' ? 'Interval' : format === 'youGoIGo' ? `${turn?.athlete === 'B' ? names.B : names.A} works` : format === 'strength' ? 'Set' : timing === 'manual' ? 'Work · tap Done' : 'Work';
  const playerPhase = terminal ? 'complete' : status === 'paused' ? 'paused' : isRest ? 'rest' : isPrep || status === 'ready' ? 'prep' : 'work';
  const positionLabel = format === 'emom' && interval ? `INTERVAL ${interval.index} / ${interval.count}` : format === 'youGoIGo' && turn ? `TEAM ROUND ${turn.teamRound + 1}${turn.roundsTarget ? ` / ${turn.roundsTarget}` : ''} · TURN ${turn.number}` : format === 'strength' && round ? `SET ${roundNumber} / ${round.count}` : round ? `ROUND ${roundNumber} / ${round.count}` : `SECTION ${current.sectionIndex + 1} / ${plan.sections.length}`;
  const caption = terminal ? 'ACTIVE SESSION TIME' : status === 'ready' || isPrep ? 'PREP COUNTDOWN' : status === 'awaitingReady' ? countUp ? section.capMs ? 'NEXT SECTION · COUNTS UP TO THE CAP' : 'NEXT SECTION · NO CAP' : clockScope === 'cap' ? 'NEXT SECTION · TIME CAP' : clockScope === 'elapsed' ? 'NEXT SECTION · NO CAP' : 'FIRST WORK INTERVAL' : isRest ? 'REST REMAINING' : countUp ? section.capMs ? 'ELAPSED · CAP BELOW' : 'ELAPSED · NO CAP' : CAPTIONS[clockScope];
  const laneHeading = isRest ? 'COMING UP AFTER REST' : status === 'awaitingReady' ? 'YOUR NEXT SECTION' : isBlock && format === 'amrap' ? 'THE BLOCK · AS MANY ROUNDS AS YOU CAN' : isBlock ? 'THE WORK UNIT' : 'YOUR STATIONS';
  const unitTasks = (tasks ?? []) as TaskItem[];
  const fitWarning = isBlock && format === 'amrap' && unitTasks.length > 8;

  const laneState = (role: 'A' | 'B'): { state: 'done' | 'waiting' | 'rest' | 'active'; label: string } | undefined => {
    if (!active && status !== 'paused') return undefined;
    if (format === 'youGoIGo' && turn) return turn.athlete === role ? { state: 'active', label: 'YOUR TURN' } : { state: 'rest', label: 'REST · NEXT UP' };
    const completion = current.completion ?? 'team';
    const done = completion === 'team' ? acks.team : acks[role];
    if (!done) return undefined;
    if (timing === 'interval') return { state: 'rest', label: 'DONE · REST' };
    return { state: 'waiting', label: completion === 'both' ? 'DONE · WAITING' : 'DONE' };
  };

  const lane = (role: 'A' | 'B') => {
    const item = showing?.[role];
    const target = item && primaryTarget(item);
    const state = laneState(role);
    const activeLane = format !== 'youGoIGo' || !turn || turn.athlete === role || isRest;
    return <section className={`${styles.lane} ${own.lane}`} data-athlete={role} data-active={activeLane} key={role} aria-label={`Athlete ${role} station`}>
      <div className={styles.athleteLabel}><span className={styles.athleteBadge}>{role}</span><span>{names[role]}<small>{role === 'A' ? 'LEFT LANE' : 'RIGHT LANE'}</small></span>{timing !== 'manual' && <span className={styles.laneTime}>{Math.round((isRest ? nextWork?.durationMs ?? 0 : current.durationMs) / 1000)}s</span>}</div>
      {isBlock && format === 'youGoIGo' ? <>
        <h2 data-testid={`movement-${role}`}>{activeLane ? 'Your turn' : 'Rest'}</h2>
        <ul className={own.unit}>{unitTasks.map(task => { const lanePrescription = task.assignments[role] ?? task.assignments.A; const amount = primaryTarget(lanePrescription); return <li key={task.nodeId}>{amount && <>{amount.amount}<small>{amount.unit}</small></>}<span>{lanePrescription.shortName ?? lanePrescription.name}</span><LoadLine load={lanePrescription.load} level={levels[role]} /></li>; })}</ul>
      </> : <>
        {target && <div className={own.target}><strong>{target.amount}</strong><small>{target.unit}</small></div>}
        <h2 data-testid={`movement-${role}`}>{item?.shortName ?? item?.name ?? 'All done'}</h2>
        {item?.load ? <LoadLine load={item.load} level={levels[role]} className={own.loadLine} /> : null}
        <p>{item ? target || item.load ? item.notes ?? '' : prescriptionText(item, levels[role]) : 'You’re at the finish.'}</p>
      </>}
      {state && <span className={own.laneState} data-state={state.state}>{state.state === 'done' || state.state === 'waiting' ? <Icon name="check" size={14} /> : null}{state.label}</span>}
      {can(`done:${role}`) && <button className={`${styles.primaryButton} ${own.laneDone}`} onClick={() => send('done', projection.occurrenceId, { athlete: role })}><Icon name="check" />{names[role]} done</button>}
    </section>;
  };

  return <div className={styles.screen} data-performing={!editable} data-view={view}>
    <div className={styles.workoutHeading}>
      <div>
        <div className={styles.eyebrow}><a href="#/">YOUR LIBRARY</a> <span>/</span> <a href={workoutHref(workout.id)}>{pair ? 'PARTNER SESSION' : 'SOLO SESSION'}</a>{!bundled && <><span>/</span>SAVED ON THIS DEVICE</>}</div>
        <h1>{workout.title}</h1>
        {workout.description && <p className={styles.description}>{workout.description}</p>}
        <div className={styles.metadata}><span><Icon name="clock" size={16} />{plan.durationKind === 'open' ? 'Open-ended' : `${plan.durationKind === 'capped' ? 'Up to ' : ''}${displayTime(plan.durationMs + workout.prepMs)} incl. prep`}</span><span><Icon name={pair ? 'users' : 'user'} size={16} />{pair ? '2 athletes' : 'Solo'}</span><span>{[...new Set(plan.sections.map(item => FORMAT_LABELS[item.format]))].join(' · ')}</span>{workout.equipment.length > 0 && <span className={styles.equipment}>{workout.equipment.join(' + ')}</span>}<DifficultyChip difficulty={difficulty} /></div>
      </div>
      <div className={styles.viewSwitch} aria-label="Player view"><button aria-pressed={view === 'focus'} onClick={() => setView('focus')}><Icon name="focus" size={17} />Focus</button><button aria-pressed={view === 'context'} onClick={() => setView('context')}><Icon name="list" size={17} />Context</button></div>
    </div>

    {status === 'ready' && usesLevels && <div className={own.levelSetup}><h3>Today’s load level</h3><p>Each movement shows the weight for the chosen level: blue is light, red is medium, black is heavy. Change it any time in settings.</p><LevelPicker levels={levels} participants={workout.participants} names={names} onChange={setLevels} compact /></div>}

    <div className={styles.player} ref={player} data-phase={playerPhase} data-scope={clockScope} data-warning="normal">
      <Perimeter progress={border} />
      <div className={styles.playerTop}><span><span className={styles.liveDot} />{section.title}<span className={own.keyHint}>{FORMAT_LABELS[format].toUpperCase()}</span></span><span>{positionLabel}{!editable && <button className={styles.iconButton} aria-label={view === 'focus' ? 'Switch to context view' : 'Switch to focus view'} onClick={() => setView(view === 'focus' ? 'context' : 'focus')}><Icon name={view === 'focus' ? 'list' : 'focus'} size={18} /></button>}</span></div>
      <div className={styles.clockBlock}>
        <div className={styles.phase} role="status" aria-live="polite">{phaseLabel}</div>
        <div ref={timer} className={styles.timer} data-testid="primary-timer" aria-label="Primary timer">{displayTime(workout.prepMs || firstDisplayMs)}</div>
        <div className={styles.clockCaption}>{caption}</div>
        {!terminal && !editable && ((section.capMs !== undefined && (clockScope !== 'cap' || countUp)) || clockScope === 'turn' || (isBlock && format === 'youGoIGo')) && <div className={own.secondaryClock}>
          {section.capMs !== undefined && (clockScope !== 'cap' || countUp) && <span>CAP<strong ref={capClock}>{displayTime(section.capMs)}</strong></span>}
          {isBlock && format === 'youGoIGo' && clockScope !== 'turn' && <span>TURN<strong ref={turnClock}>00:00</strong></span>}
        </div>}
      </div>

      {terminal ? <div className={styles.finishMessage}><span className={styles.finishIcon}><Icon name="check" size={28} /></span><h2>{status === 'completed' ? 'That’s a good session.' : 'Every bit of movement counts.'}</h2><p>{status === 'completed' ? 'Take a breath. Grab some water. You earned it.' : 'Your session has ended.'}</p>
        {projection.results.length > 0 && <ul className={own.resultList} aria-label="Section results">{projection.results.map(result => <li key={result.sectionId}><span>{plan.sections.find(item => item.id === result.sectionId)?.title ?? result.sectionId}</span><span>{resultText(result)}</span></li>)}</ul>}
      </div> : <>
        <div className={styles.laneHeading}>{laneHeading}<span>{!isBlock && currentWorkNumber > 0 ? `${currentWorkNumber} OF ${contextRows.length}` : ''}</span></div>
        {isBlock && format === 'amrap' ? <>
          {fitWarning && <p className={own.fitWarning}>Long block: {unitTasks.length} movements may not all fit on a small screen. Use the Context view to scroll.</p>}
          <ul className={own.taskList} aria-label="AMRAP block">{unitTasks.map((task, index) => <li key={task.nodeId} className={own.taskRow} data-pair={pair} data-highlight={highlight === task.nodeId} onClick={() => setHighlight(value => value === task.nodeId ? undefined : task.nodeId)}>
            <span className={own.taskIndex}>{index + 1}</span>
            {(['A', 'B'] as const).filter(role => role === 'A' || pair).map(role => { const item = task.assignments[role]!; const amount = primaryTarget(item); return <span key={role} className={own.taskCell} data-role={role}>{amount && <strong>{amount.amount}<small>{amount.unit}</small></strong>}<span>{item.shortName ?? item.name}</span><LoadLine load={item.load} level={levels[role]} /></span>; })}
          </li>)}</ul>
          <p className={own.taskHint}>Tap a row to mark where you are. It never changes the clock.</p>
        </> : <div className={styles.lanes} style={{ '--lane-count': workout.participants } as CSSProperties}>{(['A', 'B'] as const).filter(role => role === 'A' || pair).map(lane)}</div>}

        {(can('done') || can('switch') || can('finish') || can('count:round')) && <div className={own.actionBar}>
          {can('done') && <button className={own.bigAction} data-testid="done" onClick={() => send('done', projection.occurrenceId)}><Icon name="check" size={26} />{timing === 'interval' ? 'Done · rest until next' : format === 'strength' ? 'Set done' : 'Done'}</button>}
          {can('switch') && <button className={own.bigAction} data-testid="switch" onClick={() => send('switch', projection.occurrenceId)}><Icon name="switch" size={26} />Switch to {turn?.athlete === 'A' ? names.B : names.A}</button>}
          {can('count:round') && counter && <div className={own.counter} aria-label="Round counter">
            <span className={own.counterValue}><strong data-testid="rounds">{counter.rounds}</strong><small>rounds</small></span>
            {can('count:rep') && <span className={own.counterValue}><strong data-testid="reps">{counter.reps}</strong><small>reps</small></span>}
            <button className={own.counterButton} onClick={() => send('count', projection.occurrenceId, { unit: 'round' })}><Icon name="plus" size={18} />Round</button>
            {can('count:rep') && <button className={own.counterButton} onClick={() => send('count', projection.occurrenceId, { unit: 'rep' })}><Icon name="plus" size={18} />Rep</button>}
            <button className={own.counterButton} disabled={!can('undoCount')} aria-label="Undo last count" onClick={() => send('undoCount', projection.occurrenceId)}><Icon name="undo" size={18} /></button>
          </div>}
          {can('skipTurn') && <button className={styles.quietButton} onClick={() => send('skipTurn', projection.occurrenceId)}><Icon name="skip" size={16} />Skip turn</button>}
          {can('finish') && <button className={styles.quietButton} data-testid="finish" onClick={() => send('finish', projection.occurrenceId)}><Icon name="flag" size={16} />Finish section</button>}
        </div>}
        <div className={styles.nextStrip}><span className={styles.nextLabel}>UP NEXT <Icon name="arrow" size={16} /></span><span>{nextWork ? `${nextWork.sectionIndex !== current.sectionIndex && section.transitionAfter === 'manualReady' ? 'Ready for next section, then ' : ''}${!isRest && projection.restBeforeNextMs ? `${displayTime(projection.restBeforeNextMs)} rest, then ` : ''}${nextWork.tasks ? `${FORMAT_LABELS[plan.sections[nextWork.sectionIndex].format]} block` : `${nextWork.assignments?.A.name}${nextWork.assignments?.B ? ` / ${nextWork.assignments.B.name}` : ''}`}` : 'Finished · time to recover'}</span></div>
      </>}

      {view === 'context' && <section className={styles.contextSection} aria-label="Workout context">
        <div className={styles.contextHeading}><div><span className={styles.eyebrow}>THE GAME PLAN</span><h2>{section.title}</h2></div><button className={styles.quietButton} aria-pressed={following} onClick={() => setFollowing(value => !value)}><Icon name="focus" size={17} />{following ? 'Following workout' : 'Follow workout'}</button></div>
        <div className={styles.contextList} ref={context} onWheel={() => setFollowing(false)} onTouchMove={() => setFollowing(false)}>
          <div className={styles.contextColumns}><span>#</span><span>A · {names.A}</span><span>{pair ? `B · ${names.B}` : ''}</span><span>{isBlock ? 'TARGET' : 'WORK'}</span></div>
          {contextRows.map((item, index) => {
            const selected = isBlock ? highlight === item.anchor : item.anchor === focusAnchor;
            const cell = (lanePrescription?: Prescription) => lanePrescription ? `${lanePrescription.name}${primaryTarget(lanePrescription) ? ` · ${primaryTarget(lanePrescription)!.amount} ${primaryTarget(lanePrescription)!.unit}` : ''}` : '—';
            return <div key={item.anchor} ref={selected ? activeRow : undefined} className={styles.contextRow} data-active={selected} aria-current={selected ? 'step' : undefined}><span>{String(index + 1).padStart(2, '0')}</span><span>{cell(item.A)}</span><span>{pair ? cell(item.B) : '—'}</span><span>{item.durationMs !== undefined ? `${Math.round(item.durationMs / 1000)}s` : 'done'}</span></div>;
          })}
        </div>
        <div className={styles.contextFootnote}>{isBlock ? 'The whole block, in order. The clock only knows the cap.' : 'Assignments follow the current round. Authored rests are included in the total.'}</div>
      </section>}

      <div className={styles.controls}>
        <div className={styles.secondaryControls}>
          <button className={styles.iconButton} aria-label={projection.index === section.startIndex ? 'Restart interval' : 'Previous interval'} disabled={!can('previous')} onClick={() => send('previous', projection.occurrenceId)}><Icon name="previous" /></button>
          <button className={styles.iconButton} aria-label="Next interval" disabled={!can('next')} onClick={() => send('next', projection.occurrenceId)}><Icon name="next" /></button>
        </div>
        {terminal ? <button className={styles.primaryButton} onClick={restart}><Icon name="play" />Train again</button> : <button className={styles.primaryButton} onClick={() => send(status === 'ready' ? 'play' : status === 'paused' ? 'resume' : status === 'awaitingReady' ? 'ready' : 'pause', projection.occurrenceId)}><Icon name={active ? 'pause' : 'play'} />{status === 'ready' ? 'Start workout' : status === 'paused' ? 'Resume workout' : status === 'awaitingReady' ? 'Start next section' : 'Pause workout'}</button>}
        <button className={styles.stopButton} disabled={editable} onClick={() => stopDialog.current?.showModal()}>End session</button>
      </div>
      {soundError && <p className={styles.notice} role="status">{soundError}</p>}
      <div className={styles.sessionLine}><span>ELAPSED <span ref={elapsed}>00:00</span>{projection.modified && <span className={styles.modified}> · MODIFIED</span>}</span><span>{status === 'ready' ? workout.prepMs ? `${Math.round(workout.prepMs / 1000)}-second prep. Find your rhythm.` : 'Start when you’re ready.' : isRest ? 'Breathe. Your next stations are above.' : timing === 'manual' && !isBlock ? 'Tap Done when the work is finished.' : format === 'emom' ? 'The next interval starts on the clock.' : 'Your pace. Keep moving.'}</span></div>
    </div>

    <div className={styles.bottomBar}><div className={styles.readiness}><span className={styles.smallDot} /><span>{preferences.soundMode === 'silent' ? 'Silent mode' : preferences.soundMode === 'voice' ? 'Voice + beeps' : 'Beeps only'}</span><span className={styles.readinessDivider}>·</span><span>{wakeStatus}</span><span className={styles.readinessDivider}>·</span><span>Space pauses · Enter is Done or Switch · arrows move</span></div><div className={styles.sharing}><a className={styles.quietButton} href={workoutHref(workout.id)}><Icon name="list" size={17} />Read through</a><a className={styles.quietButton} href="#/"><Icon name="grid" size={17} />All workouts</a><button className={styles.quietButton} onClick={() => exportWorkoutFile(workout)}><Icon name="download" size={17} />Export WOD</button></div></div>

    <dialog ref={stopDialog} className={styles.dialog} aria-labelledby="stop-title"><h2 id="stop-title">End this session?</h2><p>The timer will stop. You can start a new session whenever you’re ready.</p><div className={styles.dialogActions}><button className={styles.quietButton} onClick={() => stopDialog.current?.close()}>Keep training</button><button className={styles.primaryButton} onClick={() => { send('stop', engine.occurrenceId); stopDialog.current?.close(); }}>End session</button></div></dialog>
  </div>;
}
