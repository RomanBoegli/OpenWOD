import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { FILE_EXTENSION, serialiseWorkoutFile, type Workout } from '../../../packages/domain/src';
import { bundledWorkouts } from '../../../packages/domain/src/bundled';
import { prescriptionText } from '../../../packages/domain/src/prescription';
import type { Occurrence, TaskItem } from '../../../packages/domain/src/compiler';
import { FORMAT_LABELS, type Prescription } from '../../../packages/domain/src/schema';
import { displayTime, overallProgress, warningLevel, washDrain, washMorph, type ClockScope, type ClockValues, type Control, type SectionResult } from '../../../packages/engine/src';
import { useWorkout } from './use-workout';
import type { WorkoutAudio } from './audio';
import type { Preferences } from './preferences';
import { slugify } from './library-store';
import { workoutHref } from './router';
import { Icon } from './Icon';
import { Switch } from './Switch';
import { downloadBlob } from './download';
import { DifficultyChip } from './DifficultyChip';
import { LoadLevels } from './LevelChip';
import { AthletesChip } from './Chip';
import type { Catalogue } from '../../../packages/domain/src/catalogue';
import { collectPrescriptions } from '../../../packages/domain/src/library';
import { countsAsDone, type SessionRecord } from './session-log';
import { roundSessionTimes, sessionOutcome } from '../../../packages/engine/src/records';
import { deviceId } from './data/device';
import { DATA_MODE } from './data/mode';
import { PACK_EXTENSION, serialisePackFile, type WorkoutPack } from '../../../packages/domain/src/pack';
import { elapsedText, type Recovery } from './data/checkpoints';
import { holdSessionLock } from './data/session-lock';
import { rateDifficulty } from '../../../packages/domain/src/difficulty';
import { roundProgress, type RoundProgress } from '../../../packages/domain/src/outline';
import { RoundDonut, type RoundView } from './RoundDonut';
import styles from './App.module.css';
import own from './Player.module.css';

function Perimeter({ progress, width }: { progress: RefObject<SVGPathElement | null>; width: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    if (svg.current) observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  const { width: w, height: h } = size;
  // The stroke is centred on the path, so the inset grows with the width and the corner radius shrinks to keep the outer edge on the panel's rounding.
  const i = width / 2 + 2;
  const c = Math.max(4, 25 - i);
  const d = `M${w / 2} ${i}H${w - c - i}Q${w - i} ${i} ${w - i} ${c + i}V${h - c - i}Q${w - i} ${h - i} ${w - c - i} ${h - i}H${c + i}Q${i} ${h - i} ${i} ${h - c - i}V${c + i}Q${i} ${i} ${c + i} ${i}H${w / 2}`;
  return <svg className={styles.perimeter} ref={svg} aria-hidden="true" data-perimeter=""><path className={styles.borderTrack} d={d} /><path ref={progress} className={styles.borderProgress} pathLength="1" strokeDasharray="1 1" d={d} /></svg>;
}

const yamlBlob = (text: string) => new Blob([text], { type: 'application/yaml' });

export function exportWorkoutFile(workout: Workout) {
  downloadBlob(yamlBlob(serialiseWorkoutFile(workout)), `${slugify(workout.title)}${FILE_EXTENSION}`);
}

/** Several workouts and their collections as one .wods.yaml pack (SHR-01). */
export function exportPackFile(pack: WorkoutPack) {
  downloadBlob(yamlBlob(serialisePackFile(pack)), `${slugify(pack.title ?? 'openwod-pack')}${PACK_EXTENSION}`);
}

/** The one big number of a prescription: reps, calories, distance or a target time. */
export function primaryTarget(value: Prescription): { amount: string; unit: string } | undefined {
  if (value.reps) return { amount: String(value.reps), unit: value.reps === 1 ? 'rep' : 'reps' };
  if (value.calories) return { amount: String(value.calories), unit: 'cal' };
  if (value.distance) return { amount: String(value.distance.value), unit: value.distance.unit };
  if (value.timeMs) return { amount: displayTime(value.timeMs), unit: 'hold' };
  return undefined;
}

const CAPTIONS: Record<ClockScope, string> = { prep: 'PREP COUNTDOWN', slot: 'WORK REMAINING', interval: 'INTERVAL REMAINING', turn: 'TURN REMAINING', cap: 'TIME CAP REMAINING', elapsed: 'ELAPSED · NO CAP' };

export function resultText(result: SectionResult): string {
  const parts: string[] = [];
  if (result.counter) parts.push(`${result.counter.rounds} ${result.counter.rounds === 1 ? 'round' : 'rounds'}${result.counter.reps ? ` + ${result.counter.reps} reps` : ''}`);
  if (result.teamRounds !== undefined) parts.push(`${result.teamRounds} team ${result.teamRounds === 1 ? 'round' : 'rounds'}, ${result.turns} turns`);
  if (result.format === 'forTime' || result.format === 'strength') parts.push(displayTime(result.sectionMs, 'floor'));
  if (result.unacknowledged.length) parts.push(`${result.unacknowledged.length} unreported`);
  parts.push(result.outcome === 'capped' ? 'capped' : result.outcome === 'finished' ? 'finished early' : result.outcome === 'skipped' ? 'skipped' : 'completed');
  return parts.join(' · ');
}

interface PlayerProps {
  workout: Workout;
  audio: WorkoutAudio;
  preferences: Preferences;
  catalogue: Catalogue;
  onPreferencesChange: (update: (value: Preferences) => Preferences) => void;
  onPerformingChange: (performing: boolean) => void;
  onSessionEnd: (record: SessionRecord) => void;
  /** A session that ended without a record to keep still clears its checkpoint. */
  onSessionClear?: (sessionId: string) => void;
  /** Restore this checkpoint instead of starting fresh (ENG-12). */
  recovery?: Recovery;
}

export function Player({ workout: workoutProp, audio, preferences, catalogue, onPreferencesChange, onPerformingChange, onSessionEnd, onSessionClear, recovery }: PlayerProps) {
  // The session plays the workout it started with; an edit in the library never changes a running session (AT-14).
  const [workout] = useState(workoutProp);
  const { names, view, loadsFor, loadUnit, perimeterWidth, washGain, amberMs, redMs, markColors, progress, clockWeight, clockSize, nudgeSeconds } = preferences;
  const clockPercent = progress === 'percent';
  /** The clock nudge of the skip buttons and the J and L keys, as on a video player. */
  const nudgeMs = nudgeSeconds * 1000;
  /** Pair lanes show their athlete's amount; solo workouts show the men's amount with the women's in brackets. */
  const loadSex = (role: 'A' | 'B') => workout.participants === 2 ? loadsFor[role] : undefined;
  const setView = (next: 'focus' | 'context') => onPreferencesChange(value => ({ ...value, view: next }));
  const [following, setFollowing] = useState(true);
  const [highlight, setHighlight] = useState<string>();
  const stopDialog = useRef<HTMLDialogElement>(null);
  const helpDialog = useRef<HTMLDialogElement>(null);
  const context = useRef<HTMLDivElement>(null);
  const activeRow = useRef<HTMLDivElement>(null);
  const timer = useRef<HTMLDivElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const capClock = useRef<HTMLElement>(null);
  const turnClock = useRef<HTMLElement>(null);
  const border = useRef<SVGPathElement>(null);
  /** One fill per block of the overall bar (UI-24), written per frame. */
  const segmentFills = useRef<(HTMLSpanElement | null)[]>([]);
  const overallText = useRef<HTMLSpanElement>(null);
  const clockPercentRef = useRef<HTMLSpanElement>(null);
  const player = useRef<HTMLDivElement>(null);
  const donutFill = useRef<SVGPathElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const exitLayer = useRef<HTMLDivElement>(null);
  const lastLanes = useRef<{ key: string; node: HTMLDivElement; top: number; left: number; width: number }>(undefined);
  /** The block whose start card shows (UI-24), and the last block one was shown for. */
  const [intro, setIntro] = useState<number>();
  const introShown = useRef<number>(undefined);
  const { engine, plan, projection, send, subscribeClock, soundError, wakeStatus, restart, checkpointStatus, startedAt, flushCheckpoints } = useWorkout(workout, audio, { recovery });
  const [takenOver, setTakenOver] = useState(false);
  const { status, current, nextWork, section, format, timing, clockScope, controls, acks, tasks, counter, turn, interval } = projection;
  const isBlock = Boolean(tasks);
  const isPrep = status === 'preparing' || (status === 'paused' && projection.occurrenceId === 'prep');
  const isRest = current.phase !== 'work' && !isPrep;
  const terminal = status === 'completed' || status === 'aborted';
  const editable = status === 'ready' || terminal;
  const active = ['running', 'preparing'].includes(status);
  const showing = isRest ? nextWork?.assignments : current.assignments;
  const round = (isRest ? nextWork : current)?.rounds.at(-1) ?? current.rounds.at(-1);
  const bundled = bundledWorkouts.some(item => item.id === workout.id);
  const difficulty = useMemo(() => rateDifficulty(plan, preferences.difficulty), [plan, preferences.difficulty]);
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
  // The round donut (UI-24) follows the work in view: the movement now, the one a rest leads into, or the round a round rest closes.
  const progressById = useMemo(() => roundProgress(plan), [plan]);
  const roundView = ((): RoundView | undefined => {
    if (terminal || status === 'awaitingReady' || isBlock) return undefined;
    if (current.phase === 'roundRest') {
      let finished: RoundProgress | undefined;
      for (let index = projection.index - 1; index >= 0 && !finished; index--) finished = progressById.get(plan.occurrences[index].id);
      return finished && { ...finished, done: finished.size, active: false };
    }
    const focus = isRest ? nextWork : current;
    const at = focus && focus.sectionIndex === current.sectionIndex ? progressById.get(focus.id) : undefined;
    return at && { ...at, done: at.position - 1, active: !isRest && !isPrep && status !== 'ready' };
  })();
  const showDonut = Boolean(roundView && (roundView.size > 1 || roundView.rounds > 1));
  const donut = showDonut && roundView ? <RoundDonut view={roundView} timed={timing !== 'manual'} fill={donutFill} /> : null;
  // A new movement takes over (UI-24): the stations shown before slide out to the left while the new ones slide in
  // from the right. React has just removed the old element; it is parked, inert and without test ids, in an overlay at
  // its old place for the length of the animation. The first effect reads the last commit, the second records this one.
  const lanesKey = `${(isRest ? nextWork?.id : undefined) ?? current.id}/${turn?.number ?? 0}`;
  useLayoutEffect(() => {
    const last = lastLanes.current, layer = exitLayer.current;
    if (!last || last.key === lanesKey || !layer || !last.width || last.node.isConnected || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const node = last.node;
    for (const element of [node, ...node.querySelectorAll<HTMLElement>('*')]) { element.removeAttribute('data-testid'); element.removeAttribute('id'); element.style.animation = 'none'; }
    node.setAttribute('inert', '');
    Object.assign(node.style, { position: 'absolute', top: `${last.top}px`, left: `${last.left}px`, width: `${last.width}px`, margin: '0' });
    layer.replaceChildren(node);
    const exit = node.animate([{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'translateX(-96px) scale(.94)', filter: 'blur(6px)' }], { duration: 260, easing: 'cubic-bezier(.5, 0, .9, .4)', fill: 'forwards' });
    exit.onfinish = () => node.remove();
    return () => { exit.cancel(); node.remove(); };
  }, [lanesKey]);
  useLayoutEffect(() => {
    const node = lanesRef.current;
    lastLanes.current = node ? { key: lanesKey, node, top: node.offsetTop, left: node.offsetLeft, width: node.offsetWidth } : undefined;
  });
  // A card names each block as its work begins; it fades on its own and never moves the layout.
  useEffect(() => {
    if (status !== 'running' || isPrep || introShown.current === current.sectionIndex) return;
    introShown.current = current.sectionIndex;
    if (plan.sections.length > 1) setIntro(current.sectionIndex);
  }, [status, isPrep, current.sectionIndex, plan.sections.length]);
  useEffect(() => {
    if (intro === undefined) return;
    const hide = setTimeout(() => setIntro(undefined), 1800);
    return () => clearTimeout(hide);
  }, [intro]);

  useEffect(() => { onPerformingChange(!editable); }, [editable, onPerformingChange]);

  // This tab controls the session (ENG-14). When another tab claims it: pause, write the last checkpoint, let go.
  useEffect(() => {
    if (editable || takenOver) return;
    let released = false;
    const held = holdSessionLock(engine.sessionId, {
      onClaim: () => {
        if (released) return;
        released = true;
        send('pause', engine.occurrenceId);
        void flushCheckpoints().finally(() => { held.release(); setTakenOver(true); });
      },
    });
    return () => { released = true; held.release(); };
  }, [engine, editable, takenOver, flushCheckpoints, send]);
  // Clips and this workout's recorded movement names are decoded before Play so a session never waits on the network.
  useEffect(() => { void audio.preload(); void audio.prepareNames(collectPrescriptions(workout).map(item => audio.nameKey(item))); }, [audio, workout, catalogue]);
  useEffect(() => () => onPerformingChange(false), [onPerformingChange]);

  // Log the session once when it ends: completed always, an ended session when it covered enough of the plan.
  const logged = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!terminal || logged.current === engine.sessionId) return;
    logged.current = engine.sessionId;
    const activeMs = engine.readClocks().activeMs;
    const outcome = sessionOutcome(status, projection.results);
    const interrupted = engine.events.some(event => event.type === 'recovered');
    if (!interrupted && !countsAsDone(outcome, activeMs, plan.durationMs, plan.durationKind === 'open')) { onSessionClear?.(engine.sessionId); return; }
    const finishedAt = new Date().toISOString();
    onSessionEnd(roundSessionTimes({ id: engine.sessionId, workoutId: workout.id, workoutRevision: workout.revision, title: workout.title, startedAt: startedAt.current ?? finishedAt, finishedAt, outcome, interrupted, modified: projection.modified, completion: outcome === 'aborted' ? Math.min(1, activeMs / plan.durationMs) : 1, activeMs, results: projection.results, events: engine.events, workout, deviceId: deviceId() }));
  }, [terminal, status, engine, plan, workout, projection.results, projection.modified, onSessionEnd, onSessionClear, startedAt]);

  // Checkpoints make leaving safe; only when they fail does leaving mean losing the session, so ask then (AT-16).
  useEffect(() => {
    if (editable || checkpointStatus !== 'failed') return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [editable, checkpointStatus]);

  // Keyboard: Space pauses/resumes, Enter is Done or Switch, arrows navigate (NFR-08).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(target.tagName)) return;
      if (document.querySelector('dialog[open]')) return;
      const id = engine.occurrenceId;
      const controlsNow = engine.project().controls;
      if (event.key === '?') { helpDialog.current?.showModal(); return; }
      if (event.key === ' ') { event.preventDefault(); for (const control of ['pause', 'resume', 'ready', 'play'] as const) if (controlsNow.includes(control)) { send(control, id); return; } }
      else if (event.key === 'Enter') { event.preventDefault(); if (controlsNow.includes('done')) send('done', id); else if (controlsNow.includes('switch')) send('switch', id); }
      else if (event.key === 'ArrowRight' && event.shiftKey && controlsNow.includes('nextSection')) send('nextSection', id);
      else if (event.key === 'ArrowLeft' && event.shiftKey && controlsNow.includes('previousSection')) send('previousSection', id);
      else if (event.key === 'ArrowRight' && controlsNow.includes('next')) send('next', id);
      else if (event.key === 'ArrowLeft' && controlsNow.includes('previous')) send('previous', id);
      else if ((event.key === 'l' || event.key === 'L') && controlsNow.includes('nudge')) send('nudge', id, { delta: nudgeMs });
      else if ((event.key === 'j' || event.key === 'J') && controlsNow.includes('nudge')) send('nudge', id, { delta: -nudgeMs });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, send, nudgeMs]);

  // For time and strength count up in the big clock (UI-04); a cap stays secondary and drives the perimeter.
  const countUp = (format === 'forTime' || format === 'strength') && timing === 'manual' && !isBlock;
  const firstDisplayMs = countUp ? 0 : clockScope === 'cap' ? section.capMs ?? 0 : clockScope === 'elapsed' ? 0 : current.durationMs;
  useEffect(() => subscribeClock((clocks: ClockValues) => {
    if (segmentFills.current.some(Boolean) || overallText.current || clockPercentRef.current) {
      const overall = overallProgress(plan, engine.project(), clocks);
      if (clockPercentRef.current) { const text = `${Math.round(overall.fraction * 100)} %`; if (clockPercentRef.current.textContent !== text) clockPercentRef.current.textContent = text; }
      // The bar is split by block: blocks behind are full, the current one fills with its own share, the rest wait.
      segmentFills.current.forEach((fill, index) => {
        if (!fill) return;
        const width = `${Math.round((index < overall.sectionIndex ? 1 : index > overall.sectionIndex ? 0 : overall.sectionFraction) * 1000) / 10}%`;
        if (fill.style.width !== width) fill.style.width = width;
      });
      if (overallText.current) { const text = `${Math.round(overall.fraction * 100)} % DONE`; if (overallText.current.textContent !== text) overallText.current.textContent = text; }
    }
    if (timer.current) {
      const text = status === 'ready' ? displayTime(workout.prepMs || firstDisplayMs) : terminal ? displayTime(clocks.activeMs) : status === 'awaitingReady' ? displayTime(firstDisplayMs) : (clockScope === 'elapsed' || countUp) && !isPrep ? displayTime(clocks.sectionMs, 'floor') : displayTime(clocks.remainingMs);
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
    const fraction = status === 'ready' || status === 'awaitingReady' || clockScope === 'elapsed' ? 1 : clocks.fraction;
    if (border.current) border.current.style.strokeDashoffset = String(-(1 - fraction));
    if (donutFill.current?.dataset.timed === 'true') donutFill.current.style.strokeDasharray = `${(Number(donutFill.current.dataset.length) * (1 - fraction)).toFixed(4)} 1`;
    if (player.current) {
      // One opacity ramp over the whole slot; the marks only morph the colour (--to-amber, --to-red), never the strength.
      const timed = (status === 'running' || status === 'preparing' || status === 'paused') && clockScope !== 'elapsed';
      const drained = timed ? (!isRest && !isPrep ? washDrain(clocks.remainingMs, clocks.durationMs) : 1 - fraction).toFixed(3) : '0';
      if (player.current.style.getPropertyValue('--drained') !== drained) player.current.style.setProperty('--drained', drained);
      const warning = clockScope === 'elapsed' || status === 'ready' || status === 'awaitingReady' ? 'normal' : warningLevel(clocks.remainingMs, clocks.durationMs, { amberMs, redMs });
      if (player.current.dataset.warning !== warning) player.current.dataset.warning = warning;
      const morph = warning === 'normal' ? { amber: 0, red: 0 } : washMorph(clocks.remainingMs, clocks.durationMs, { amberMs, redMs });
      for (const [name, value] of [['--to-amber', morph.amber], ['--to-red', morph.red]] as const) {
        const text = value.toFixed(3);
        if (player.current.style.getPropertyValue(name) !== text) player.current.style.setProperty(name, text);
      }
    }
  }), [subscribeClock, status, terminal, workout.prepMs, firstDisplayMs, clockScope, countUp, amberMs, redMs, isRest, isPrep]);

  // The context list keeps the movement under way in its middle; the row's offset is already measured from the list.
  // The observer also re-centres when the list or the enlarged active row change size, and it fires once on its own.
  useEffect(() => {
    const list = context.current, row = activeRow.current;
    if (!following || view !== 'context' || !list || !row) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const observer = new ResizeObserver(() => list.scrollTo({ top: Math.max(0, row.offsetTop - (list.clientHeight - row.offsetHeight) / 2), behavior: reduced ? 'instant' : 'smooth' }));
    observer.observe(list); observer.observe(row);
    return () => observer.disconnect();
  }, [projection.occurrenceId, highlight, following, view]);

  const restLabel = current.phase === 'roundRest' ? 'Round rest' : current.phase === 'transition' ? 'Transition' : 'Block rest';
  const phaseLabel = status === 'ready' ? 'Ready when you are' : status === 'paused' ? projection.pauseReason === 'hidden' ? 'Paused · app was hidden' : projection.pauseReason === 'recovered' ? 'Recovered · paused' : 'Workout paused' : status === 'awaitingReady' ? 'Next block · ready?' : status === 'completed' ? 'Workout complete' : status === 'aborted' ? 'Workout ended' : isPrep ? 'Get ready' : isRest ? restLabel : format === 'amrap' ? 'AMRAP' : format === 'emom' ? 'Interval' : format === 'youGoIGo' ? `${turn?.athlete === 'B' ? names.B : names.A} works` : format === 'strength' ? 'Set' : timing === 'manual' ? 'Work · tap Done' : 'Work';
  const playerPhase = terminal ? 'complete' : status === 'paused' ? 'paused' : isRest ? 'rest' : isPrep ? 'prep' : status === 'ready' ? 'ready' : 'work';
  // The top line names the block; rounds are the donut's dots, so a repeat is only spelled out where no donut shows.
  const blockLabel = plan.sections.length > 1 ? `BLOCK ${current.sectionIndex + 1} / ${plan.sections.length}` : '';
  const positionLabel = format === 'emom' && interval ? `INTERVAL ${interval.index} / ${interval.count}` : format === 'youGoIGo' && turn ? `TEAM ROUND ${turn.teamRound + 1}${turn.roundsTarget ? ` / ${turn.roundsTarget}` : ''} · TURN ${turn.number}` : round && !showDonut ? `${format === 'strength' ? 'SET' : 'ROUND'} ${roundNumber} / ${round.count}` : blockLabel;
  const caption = terminal ? 'ACTIVE SESSION TIME' : status === 'ready' || isPrep ? 'PREP COUNTDOWN' : status === 'awaitingReady' ? countUp ? section.capMs ? 'NEXT BLOCK · COUNTS UP TO THE CAP' : 'NEXT BLOCK · NO CAP' : clockScope === 'cap' ? 'NEXT BLOCK · TIME CAP' : clockScope === 'elapsed' ? 'NEXT BLOCK · NO CAP' : 'FIRST WORK INTERVAL' : isRest ? 'REST REMAINING' : countUp ? section.capMs ? 'ELAPSED · CAP BELOW' : 'ELAPSED · NO CAP' : CAPTIONS[clockScope];
  const laneHeading = isRest ? 'COMING UP AFTER REST' : status === 'awaitingReady' ? 'YOUR NEXT BLOCK' : isBlock && format === 'amrap' ? 'ONE ROUND · REPEAT UNTIL THE CAP' : isBlock ? 'THE WORK UNIT' : 'YOUR STATIONS';
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
    return <section className={`${styles.lane} ${own.lane}`} data-athlete={role} data-active={activeLane} data-block={isBlock && format === 'youGoIGo' ? 'turns' : undefined} key={role} aria-label={`Athlete ${role} station`}>
      <div className={styles.athleteLabel}><span className={styles.athleteBadge}>{role}</span><span>{names[role]}<small>{role === 'A' ? 'LEFT LANE' : 'RIGHT LANE'}</small></span>{timing !== 'manual' && <span className={styles.laneTime}>{Math.round((isRest ? nextWork?.durationMs ?? 0 : current.durationMs) / 1000)}s</span>}</div>
      {isBlock && format === 'youGoIGo' ? <>
        <h2 data-testid={`movement-${role}`}>{activeLane ? 'Your turn' : 'Rest'}</h2>
        <ul className={own.unit}>{unitTasks.map(task => { const lanePrescription = task.assignments[role] ?? task.assignments.A; const amount = primaryTarget(lanePrescription); return <li key={task.nodeId}>{amount && <>{amount.amount}<small>{amount.unit}</small></>}<span>{lanePrescription.shortName ?? lanePrescription.name}</span><LoadLevels load={lanePrescription.load} unit={loadUnit} sex={loadSex(role)} /></li>; })}</ul>
      </> : <>
        {target && <div className={own.target}><strong>{target.amount}</strong><small>{target.unit}</small></div>}
        <h2 data-testid={`movement-${role}`}>{item?.shortName ?? item?.name ?? 'All done'}</h2>
        {item?.load ? <span className={own.loadLine}><LoadLevels load={item.load} unit={loadUnit} sex={loadSex(role)} /></span> : null}
        <p>{item ? target || item.load ? item.notes ?? '' : prescriptionText(item) : 'You’re at the finish.'}</p>
      </>}
      {state && <span className={own.laneState} data-state={state.state}>{state.state === 'done' || state.state === 'waiting' ? <Icon name="check" size={14} /> : null}{state.label}</span>}
      {can(`done:${role}`) && <button className={`${styles.primaryButton} ${own.laneDone}`} onClick={() => send('done', projection.occurrenceId, { athlete: role })}><Icon name="check" />{names[role]} done</button>}
    </section>;
  };

  if (takenOver) return <div className={styles.screen}>
    <section className={styles.recovery} role="region" aria-label="Taken over"><div><strong>Another tab took over this session.</strong><p>“{workout.title}” continues there; this tab no longer controls the clock. Close it, or reopen the session here.</p></div><div className={styles.dialogActions}><a className={styles.quietButton} href="#/">Back to library</a><button className={styles.primaryButton} onClick={() => window.location.reload()}><Icon name="play" />Reopen here</button></div></section>
  </div>;

  return <div className={styles.screen} data-performing={!editable} data-view={view}>
    <div className={styles.workoutHeading}>
      <div>
        <div className={styles.eyebrow}><a href="#/">YOUR LIBRARY</a> <span>/</span> <a href={workoutHref(workout.id)}>{pair ? 'PARTNER SESSION' : 'SOLO SESSION'}</a>{!bundled && <><span>/</span>{DATA_MODE === 'server' ? 'SAVED FOR THE HOUSEHOLD' : 'SAVED ON THIS DEVICE'}</>}</div>
        <h1>{workout.title}</h1>
        {workout.description && <p className={styles.description}>{workout.description}</p>}
        <div className={styles.metadata}><span><Icon name="clock" size={16} />{plan.durationKind === 'open' ? 'Open-ended' : `${plan.durationKind === 'capped' ? 'Up to ' : ''}${displayTime(plan.durationMs + workout.prepMs)} incl. prep`}</span><AthletesChip participants={workout.participants} /><DifficultyChip difficulty={difficulty} /></div>
      </div>
      <div className={styles.viewSwitch} aria-label="Player view"><button aria-pressed={view === 'focus'} onClick={() => setView('focus')}><Icon name="focus" size={17} />Focus</button><button aria-pressed={view === 'context'} onClick={() => setView('context')}><Icon name="list" size={17} />Context</button></div>
    </div>

    <div className={styles.player} ref={player} data-boundary={status === 'awaitingReady' ? 'end' : intro !== undefined && intro === current.sectionIndex ? 'start' : undefined} data-phase={playerPhase} data-scope={clockScope} data-progress={progress} data-warning="normal" data-wash={preferences.wash} data-clock-weight={clockWeight} data-clock-size={clockSize} style={{ '--perimeter-width': `${perimeterWidth}px`, '--wash-gain': String(washGain / 100), '--wash-min': String(washGain / 600), ...(markColors.first ? { '--phase-amber': markColors.first } : {}), ...(markColors.second ? { '--phase-red': markColors.second } : {}) } as CSSProperties}>
      <Perimeter progress={border} width={perimeterWidth} />
      <div ref={exitLayer} className={own.exitLayer} aria-hidden="true" />
      {status === 'awaitingReady' && current.sectionIndex > 0 ? (() => {
        const finished = plan.sections[current.sectionIndex - 1];
        const result = projection.results.find(item => item.sectionId === finished.id);
        return <div key={`end-${finished.id}`} className={own.blockCard} data-kind="end" data-testid="block-card"><Icon name="check" size={20} /><span>BLOCK {current.sectionIndex} DONE</span><strong>{finished.title}</strong>{result && <small>{resultText(result)}</small>}</div>;
      })() : intro !== undefined && intro === current.sectionIndex && !terminal ? <div key={`start-${intro}`} className={own.blockCard} data-kind="start" data-testid="block-card" aria-hidden="true">
        <span>BLOCK {intro + 1} OF {plan.sections.length}</span><strong>{section.title}</strong><small>{[FORMAT_LABELS[format], roundView && roundView.rounds > 1 ? `${roundView.rounds} rounds` : '', section.capMs ? `cap ${displayTime(section.capMs)}` : ''].filter(Boolean).join(' · ')}</small>
      </div> : null}
      <div className={styles.playerTop}><span><span className={styles.liveDot} />{section.title}<span className={own.keyHint}>{FORMAT_LABELS[format].toUpperCase()}</span></span><span><span className={styles.position}>{positionLabel}</span>{!editable && <button className={styles.iconButton} aria-label={view === 'focus' ? 'Switch to context view' : 'Switch to focus view'} onClick={() => setView(view === 'focus' ? 'context' : 'focus')}><Icon name={view === 'focus' ? 'list' : 'focus'} size={18} /></button>}</span></div>
      {progress !== 'off' && <div className={styles.overall} data-testid="overall-progress" aria-label="Overall progress"><span className={styles.overallTrack}>{plan.sections.map((item, index) => <span key={item.id} className={styles.overallSegment} data-segment={index} style={{ flexGrow: item.endIndex - item.startIndex + 1 }}><span ref={element => { segmentFills.current[index] = element; }} className={styles.overallFill} /></span>)}</span>{progress === 'detail' && <span ref={overallText} className={styles.overallText}>0 % DONE</span>}</div>}
      <div className={styles.clockBlock}>
        <div className={styles.phase} role="status" aria-live="polite">{phaseLabel}</div>
        <div className={styles.clockLine}>{donut}<div ref={timer} className={styles.timer} data-testid="primary-timer" aria-label="Primary timer">{displayTime(workout.prepMs || firstDisplayMs)}</div>{clockPercent && <span ref={clockPercentRef} className={styles.clockPercent} aria-label="Progress beside the clock">0 %</span>}</div>
        <div className={styles.clockCaption}>{caption}</div>
        {!terminal && !editable && ((projection.capMs !== undefined && (clockScope !== 'cap' || countUp)) || clockScope === 'turn' || (isBlock && format === 'youGoIGo')) && <div className={own.secondaryClock}>
          {projection.capMs !== undefined && (clockScope !== 'cap' || countUp) && <span>CAP<strong ref={capClock}>{displayTime(projection.capMs)}</strong></span>}
          {isBlock && format === 'youGoIGo' && clockScope !== 'turn' && <span>TURN<strong ref={turnClock}>00:00</strong></span>}
        </div>}
      </div>

      {terminal ? <div className={styles.finishMessage}><span className={styles.finishIcon}><Icon name="check" size={28} /></span><h2>{status === 'completed' ? 'That’s a good session.' : 'Every bit of movement counts.'}</h2><p>{status === 'completed' ? 'Take a breath. Grab some water. You earned it.' : 'Your session has ended.'}</p>
        {projection.results.length > 0 && <ul className={own.resultList} aria-label="Block results">{projection.results.map(result => <li key={result.sectionId}><span>{plan.sections.find(item => item.id === result.sectionId)?.title ?? result.sectionId}</span><span>{resultText(result)}</span></li>)}</ul>}
      </div> : <>
        <div className={styles.laneHeading}>{laneHeading}<span>{roundView && roundView.size > 1 ? `MOVEMENT ${roundView.position} / ${roundView.size}` : ''}</span></div>
        {isBlock && format === 'amrap' ? <>
          {fitWarning && <p className={own.fitWarning}>Long block: {unitTasks.length} movements may not all fit on a small screen. Use the Context view to scroll.</p>}
          <ul className={own.taskList} aria-label="AMRAP block">{unitTasks.map((task, index) => <li key={task.nodeId} className={own.taskRow} data-pair={pair} data-highlight={highlight === task.nodeId} onClick={() => setHighlight(value => value === task.nodeId ? undefined : task.nodeId)}>
            <span className={own.taskIndex}>{index + 1}</span>
            {(['A', 'B'] as const).filter(role => role === 'A' || pair).map(role => { const item = task.assignments[role]!; const amount = primaryTarget(item); return <span key={role} className={own.taskCell} data-role={role}>{amount && <strong>{amount.amount}<small>{amount.unit}</small></strong>}<span>{item.shortName ?? item.name}</span><LoadLevels load={item.load} unit={loadUnit} sex={loadSex(role)} /></span>; })}
          </li>)}</ul>
          <p className={own.taskHint}>Tap a row to mark where you are. It never changes the clock.</p>
        </> : <div key={lanesKey} ref={lanesRef} className={styles.lanes} style={{ '--lane-count': workout.participants } as CSSProperties}>{(['A', 'B'] as const).filter(role => role === 'A' || pair).map(lane)}</div>}

        {(can('done') || can('switch') || can('finish') || can('count:round')) && <div className={own.actionBar} data-counter={Boolean(can('count:round') && counter)}>
          {can('done') && <button className={own.bigAction} data-testid="done" onClick={() => send('done', projection.occurrenceId)}><Icon name="check" size={26} />{timing === 'interval' ? 'Done · rest until next' : format === 'strength' ? 'Set done' : 'Done'}</button>}
          {can('switch') && <button className={own.bigAction} data-testid="switch" onClick={() => send('switch', projection.occurrenceId)}><Icon name="switch" size={26} />Switch to {turn?.athlete === 'A' ? names.B : names.A}</button>}
          {can('count:round') && counter && <div className={own.counter} aria-label="Round counter">
            <span className={own.counterValue}><strong data-testid="rounds">{counter.rounds}</strong><small>rounds</small></span>
            {can('count:rep') && <span className={own.counterValue}><strong data-testid="reps">{counter.reps}</strong><small>reps</small></span>}
            <button className={own.counterButton} onClick={() => send('count', projection.occurrenceId, { unit: 'round' })}><Icon name="plus" size={18} />Round</button>
            {can('count:rep') && <button className={own.counterButton} onClick={() => send('count', projection.occurrenceId, { unit: 'rep' })}><Icon name="plus" size={18} />Rep</button>}
            <button className={own.counterButton} disabled={!can('undoCount')} aria-label="Undo last count" onClick={() => send('undoCount', projection.occurrenceId)}><Icon name="undo" size={18} /></button>
          </div>}
          {can('skipTurn') && <button className={own.secondaryAction} onClick={() => send('skipTurn', projection.occurrenceId)}><Icon name="skip" size={18} />Skip turn</button>}
          {can('finish') && <button className={own.secondaryAction} data-testid="finish" onClick={() => send('finish', projection.occurrenceId)}><Icon name="flag" size={18} />Finish block</button>}
        </div>}
        <div className={styles.nextStrip} data-empty={!nextWork}><span className={styles.nextLabel}>UP NEXT <Icon name="arrow" size={16} /></span><span>{nextWork ? `${nextWork.sectionIndex !== current.sectionIndex && section.transitionAfter === 'manualReady' ? 'Ready for next block, then ' : ''}${!isRest && projection.restBeforeNextMs ? `${displayTime(projection.restBeforeNextMs)} rest, then ` : ''}${nextWork.tasks ? `${FORMAT_LABELS[plan.sections[nextWork.sectionIndex].format]} block` : `${nextWork.assignments?.A.name}${nextWork.assignments?.B && nextWork.assignments.B.name !== nextWork.assignments.A.name ? ` / ${nextWork.assignments.B.name}` : ''}`}` : 'Finished · time to recover'}</span></div>
      </>}

      {view === 'context' && <section className={styles.contextSection} aria-label="Workout context">
        <div className={styles.contextHeading}><div><span className={styles.eyebrow}>THE GAME PLAN</span><h2>{section.title}</h2></div><Switch compact checked={following} onChange={setFollowing} label="Stick to movement" /></div>
        <div className={styles.contextList} ref={context} onWheel={() => setFollowing(false)} onTouchMove={() => setFollowing(false)}>
          <div className={styles.contextColumns}><span>#</span><span>{pair ? names.A : 'MOVEMENT'}</span><span>{pair ? names.B : ''}</span><span>{isBlock ? 'TARGET' : 'WORK'}</span></div>
          {contextRows.map((item, index) => {
            const selected = isBlock ? highlight === item.anchor : item.anchor === focusAnchor;
            // Everything the focus view shows for a lane: name, target, the load levels and the notes.
            const cell = (role: 'A' | 'B', lanePrescription?: Prescription) => {
              if (!lanePrescription) return '—';
              const amount = primaryTarget(lanePrescription);
              return <>{lanePrescription.name}{amount ? ` · ${amount.amount} ${amount.unit}` : ''}{(lanePrescription.load || lanePrescription.notes) && <span className={own.contextDetail}>{lanePrescription.load && <LoadLevels load={lanePrescription.load} unit={loadUnit} sex={loadSex(role)} />}{lanePrescription.notes && <span>{lanePrescription.notes}</span>}</span>}</>;
            };
            const done = !isBlock && !selected && (current.phase === 'roundRest' ? true : index + 1 < currentWorkNumber);
            return <div key={item.anchor} ref={selected ? activeRow : undefined} className={styles.contextRow} data-active={selected} data-done={done || undefined} aria-current={selected ? 'step' : undefined}><span>{done ? <Icon name="check" size={12} /> : String(index + 1).padStart(2, '0')}</span><span>{cell('A', item.A)}</span><span>{pair ? cell('B', item.B) : '—'}</span><span>{item.durationMs !== undefined ? `${Math.round(item.durationMs / 1000)}s` : 'done'}</span></div>;
          })}
        </div>
        <div className={styles.contextFootnote}>{isBlock ? 'The whole block, in order. The clock only knows the cap.' : 'Assignments follow the current round. Authored rests are included in the total.'}</div>
      </section>}

      {/* Laid out like a disc player: section and interval back on the left, play and end in the middle, forward on the right. */}
      <div className={styles.controls}>
        <div className={styles.transport} data-side="back">
          {plan.sections.length > 1 && <button className={styles.iconButton} aria-label={current.sectionIndex === 0 ? 'Restart block' : 'Previous block'} disabled={!can('previousSection')} onClick={() => send('previousSection', projection.occurrenceId)}><Icon name="sectionPrevious" /></button>}
          <button className={styles.iconButton} aria-label={projection.index === section.startIndex ? 'Restart interval' : 'Previous interval'} disabled={!can('previous')} onClick={() => send('previous', projection.occurrenceId)}><Icon name="previous" /></button>
          <button className={styles.iconButton} aria-label={`Back ${nudgeSeconds} seconds`} disabled={!can('nudge')} onClick={() => send('nudge', projection.occurrenceId, { delta: -nudgeMs })}><Icon name="rewind" label={String(nudgeSeconds)} /></button>
        </div>
        <div className={styles.transportCentre}>
        {terminal ? <button className={styles.primaryButton} onClick={restart}><Icon name="play" />Train again</button> : <button className={styles.primaryButton} onClick={() => send(status === 'ready' ? 'play' : status === 'paused' ? 'resume' : status === 'awaitingReady' ? 'ready' : 'pause', projection.occurrenceId)}><Icon name={active ? 'pause' : 'play'} />{status === 'ready' ? 'Start workout' : status === 'paused' ? 'Resume workout' : status === 'awaitingReady' ? 'Start next block' : 'Pause workout'}</button>}
        <button className={styles.stopButton} disabled={editable} onClick={() => stopDialog.current?.showModal()}><Icon name="close" size={16} />End session</button>
        </div>
        <div className={styles.transport} data-side="forward">
          <button className={styles.iconButton} aria-label={`Forward ${nudgeSeconds} seconds`} disabled={!can('nudge')} onClick={() => send('nudge', projection.occurrenceId, { delta: nudgeMs })}><Icon name="fastForward" label={String(nudgeSeconds)} /></button>
          <button className={styles.iconButton} aria-label="Next interval" disabled={!can('next')} onClick={() => send('next', projection.occurrenceId)}><Icon name="next" /></button>
          {plan.sections.length > 1 && <button className={styles.iconButton} aria-label="Next block" disabled={!can('nextSection')} onClick={() => send('nextSection', projection.occurrenceId)}><Icon name="sectionNext" /></button>}
        </div>
      </div>
      {status === 'paused' && projection.pauseReason === 'recovered' && recovery && <section className={styles.recovery} role="dialog" aria-label="Interrupted session">
        <div><strong>Interrupted session · saved {elapsedText(Date.now() - new Date(recovery.checkpoint.savedAt).getTime())}</strong><p>{[`Block ${current.sectionIndex + 1} of ${plan.sections.length}`, turn ? `${turn.athlete === 'A' ? names.A : names.B}’s turn · team round ${turn.teamRound + 1}` : round ? `Round ${round.iteration}` : '', clockScope === 'elapsed' ? `${displayTime(engine.readClocks().activeMs, 'floor')} elapsed` : `${displayTime(engine.readClocks().remainingMs)} left`].filter(Boolean).join(' · ')}. Time since the save is not counted; nothing was marked done for you.</p></div>
        <div className={styles.dialogActions}><button className={styles.quietButton} onClick={() => send('stop', projection.occurrenceId)}><Icon name="close" size={16} />End session</button><button className={styles.primaryButton} onClick={() => send('resume', projection.occurrenceId)}><Icon name="play" />Resume</button></div>
      </section>}
      {soundError && <p className={styles.notice} role="status">{soundError}</p>}
      <div className={styles.sessionLine}><span>ELAPSED <span ref={elapsed}>00:00</span>{projection.modified && <span className={styles.modified}> · MODIFIED</span>}{checkpointStatus === 'failed' && <span className={styles.warnText}> · <Icon name="alert" size={11} />NOT SAVING PROGRESS ON THIS DEVICE</span>}</span><span>{status === 'ready' ? workout.prepMs ? `${Math.round(workout.prepMs / 1000)}-second prep. Find your rhythm.` : 'Start when you’re ready.' : isPrep ? 'Find your rhythm.' : isRest ? 'Breathe. Your next stations are above.' : timing === 'manual' && !isBlock ? 'Tap Done when the work is finished.' : format === 'emom' ? 'The next interval starts on the clock.' : ''}</span></div>
    </div>

    <div className={styles.bottomBar}><div className={styles.readiness}><span className={styles.smallDot} /><span>{preferences.soundMode === 'silent' ? 'Silent mode' : preferences.soundMode === 'voice' ? 'Voice + beeps' : 'Beeps only'}</span><span className={styles.readinessDivider}>·</span><span>{wakeStatus}</span><span className={styles.readinessDivider}>·</span><button className={`${styles.quietButton} ${styles.keysButton}`} onClick={() => helpDialog.current?.showModal()}><span className={styles.kbd}>?</span>Keys</button></div><div className={styles.sharing}><a className={styles.quietButton} href={workoutHref(workout.id)}><Icon name="list" size={17} />Details</a><a className={styles.quietButton} href="#/"><Icon name="grid" size={17} />All workouts</a><button className={styles.quietButton} onClick={() => exportWorkoutFile(workout)}><Icon name="download" size={17} />Export WOD</button></div></div>

    <dialog ref={helpDialog} className={styles.dialog} aria-labelledby="help-title"><div className={styles.dialogHeading}><h2 id="help-title">Keyboard</h2><button className={styles.iconButton} aria-label="Close keyboard help" onClick={() => helpDialog.current?.close()}><Icon name="close" /></button></div><ul className={styles.shortcuts}><li><span className={styles.kbd}>Space</span>Start, pause, resume, or Ready</li><li><span className={styles.kbd}>Enter</span>Done, or Switch in you-go-I-go</li><li><span className={styles.kbd}>←</span><span className={styles.kbd}>→</span>Previous or next interval</li><li><span className={styles.kbd}>Shift</span><span className={styles.kbd}>←</span><span className={styles.kbd}>→</span>Previous or next block</li><li><span className={styles.kbd}>J</span><span className={styles.kbd}>L</span>Back or forward {nudgeSeconds} seconds on the clock</li><li><span className={styles.kbd}>?</span>This sheet</li></ul></dialog>
    <dialog ref={stopDialog} className={styles.dialog} aria-labelledby="stop-title"><h2 id="stop-title">End this session?</h2><p>The timer will stop. You can start a new session whenever you’re ready.</p><div className={styles.dialogActions}><button className={styles.quietButton} onClick={() => stopDialog.current?.close()}>Keep training</button><button className={`${styles.primaryButton} ${styles.dangerFill}`} onClick={() => { send('stop', engine.occurrenceId); stopDialog.current?.close(); }}>End session</button></div></dialog>
  </div>;
}
