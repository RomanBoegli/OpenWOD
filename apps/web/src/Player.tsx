import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { FILE_EXTENSION, serialiseWorkoutFile, type Workout } from '../../../packages/domain/src';
import { bundledWorkouts } from '../../../packages/domain/src/bundled';
import { prescriptionText } from '../../../packages/domain/src/prescription';
import type { Assignments, ExecutionPlan, Occurrence, TaskItem, Timing } from '../../../packages/domain/src/compiler';
import { FORMAT_LABELS, type Prescription, type SectionFormat } from '../../../packages/domain/src/schema';
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
import { isQuickTimer } from '../../../packages/domain/src/quick-timer';
import { countsAsDone, type SessionRecord } from './session-log';
import { roundSessionTimes, sessionOutcome } from '../../../packages/engine/src/records';
import { deviceId } from './data/device';
import { stillOnly as reducedMotion, useCameo } from './cameo';
import { DATA_MODE } from './data/mode';
import { PACK_EXTENSION, serialisePackFile, type WorkoutPack } from '../../../packages/domain/src/pack';
import { elapsedText, lastSaved, type Recovery } from './data/checkpoints';
import { sessionHeadline } from './data/live-sessions';
import { holdSessionLock } from './data/session-lock';
import type { LiveOffers } from './data/use-live-sessions';
import { rateDifficulty } from '../../../packages/domain/src/difficulty';
import { roundProgress, type RoundProgress } from '../../../packages/domain/src/outline';
import { RoundDonut, type RoundView } from './RoundDonut';
import { loadStageZoom, saveStageZoom, STAGE_ZOOMS, stepStageZoom } from './stage-zoom';
import { takeStart } from './start';
import { useResolvedTheme } from './theme';
import styles from './App.module.css';
import own from './Player.module.css';

function Perimeter({ progress, width }: { progress: RefObject<SVGPathElement | null>; width: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  useLayoutEffect(() => {
    const node = svg.current;
    if (!node) return;
    // Measured here, before the first paint, so the ring is never drawn for a frame of a made-up size; the observer follows every resize and turn.
    const measure = (width: number, height: number) => setSize(last => last.width === width && last.height === height ? last : { width, height });
    const box = node.getBoundingClientRect();
    measure(box.width, box.height);
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width, entry.contentRect.height));
    observer.observe(node);
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
function primaryTarget(value: Prescription): { amount: string; unit: string } | undefined {
  if (value.reps) return { amount: String(value.reps), unit: value.reps === 1 ? 'rep' : 'reps' };
  if (value.calories) return { amount: String(value.calories), unit: 'cal' };
  if (value.distance) return { amount: String(value.distance.value), unit: value.distance.unit };
  if (value.timeMs) return { amount: displayTime(value.timeMs), unit: 'hold' };
  return undefined;
}

const CAPTIONS: Record<ClockScope, string> = { prep: 'PREP COUNTDOWN', slot: 'WORK REMAINING', interval: 'INTERVAL REMAINING', turn: 'TURN REMAINING', cap: 'TIME CAP REMAINING', elapsed: 'ELAPSED · NO CAP' };

function resultText(result: SectionResult): string {
  const parts: string[] = [];
  if (result.counter) parts.push(`${result.counter.rounds} ${result.counter.rounds === 1 ? 'round' : 'rounds'}${result.counter.reps ? ` + ${result.counter.reps} reps` : ''}`);
  if (result.teamRounds !== undefined) parts.push(`${result.teamRounds} team ${result.teamRounds === 1 ? 'round' : 'rounds'}, ${result.turns} turns`);
  if (result.format === 'forTime' || result.format === 'strength') parts.push(displayTime(result.sectionMs, 'floor'));
  if (result.unacknowledged.length) parts.push(`${result.unacknowledged.length} unreported`);
  parts.push(result.outcome === 'capped' ? 'capped' : result.outcome === 'finished' ? 'finished early' : result.outcome === 'skipped' ? 'skipped' : 'completed');
  return parts.join(' · ');
}

type Role = 'A' | 'B';
interface LaneState { state: 'waiting' | 'rest' | 'active'; label: string }
/**
 * One station as the stage draws it: the lanes or a block's list, and the action bar under them. The live one is read from
 * the session; the ruler's come from the plan, each with all the furniture its block can show at once (UI-27).
 */
interface Station {
  key: string;
  format: SectionFormat;
  timing: Timing;
  /** The lanes' movements; none once the work is over. */
  assignments?: Assignments;
  /** A block's whole list (AMRAP, you-go-I-go). */
  tasks?: TaskItem[];
  /** The slot's length beside the athlete's name, where the clock and not a tap ends the work. */
  seconds?: number;
  state: Partial<Record<Role, LaneState>>;
  /** You-go-I-go: the lane that waits, and who takes over on Switch. */
  resting?: Role;
  switchTo?: Role;
  controls: readonly Control[];
  counter?: { rounds: number; reps: number };
}
/** What every station of a session is drawn with: the athletes' names and how loads read. */
interface StageLook { names: Record<Role, string>; loadUnit: Preferences['loadUnit']; loadsFor?: Preferences['loadsFor']; pair: boolean; /** A quick timer (UI-30): no station and no block list, only the actions that keep a score. */ plain?: boolean }
/** What only the live station has: the taps, the row marked in a block, the key of its entrance and the nodes the player measures. */
interface StageLive {
  lanesKey: string;
  lanes: RefObject<HTMLDivElement | null>;
  body: RefObject<HTMLDivElement | null>;
  highlight?: string;
  onHighlight: (nodeId: string) => void;
  act: (type: 'done' | 'switch' | 'skipTurn' | 'finish' | 'count' | 'undoCount', extra?: { athlete?: Role; unit?: 'round' | 'rep' }) => void;
}

/** Where a node stands inside the layer that floats over the frame. */
const placeIn = (layer: HTMLElement, node: HTMLElement) => { const box = node.getBoundingClientRect(), frame = layer.getBoundingClientRect(); return { top: box.top - frame.top, left: box.left - frame.left, width: box.width }; };
/** The engine's own list of the formats a block of which can be finished early. */
const FINISHABLE: SectionFormat[] = ['amrap', 'forTime', 'youGoIGo', 'strength'];
const TURN_STATES = { A: { state: 'active', label: 'YOUR TURN' }, B: { state: 'rest', label: 'REST · NEXT UP' } } as const;
const reportedIn = (timing: Timing, both: boolean): LaneState => timing === 'interval' ? { state: 'rest', label: 'DONE · REST' } : { state: 'waiting', label: both ? 'DONE · WAITING' : 'DONE' };

/**
 * Every distinct station of the plan, for the ruler (UI-27). A station whose furniture changes while it shows comes once
 * per state, so the tallest of them is found whatever the layout does with a button or a lane state: before anyone has
 * reported in, with one athlete done, and with the interval's rest after Done.
 */
function planStations(plan: ExecutionPlan): Station[] {
  const found = new Map<string, Station>();
  const add = (station: Omit<Station, 'key'>) => { const key = JSON.stringify(station); if (!found.has(key)) found.set(key, { ...station, key }); };
  for (const occurrence of plan.occurrences) {
    if (occurrence.phase !== 'work') continue;
    const section = plan.sections[occurrence.sectionIndex];
    const { format } = section, { timing, tasks } = occurrence;
    const finish: Control[] = FINISHABLE.includes(format) ? ['finish'] : [];
    const base = { format, timing, seconds: timing === 'manual' ? undefined : Math.round(occurrence.durationMs / 1000), state: {} };
    if (tasks) {
      if (format === 'youGoIGo') add({ ...base, tasks, state: TURN_STATES, resting: 'B', switchTo: 'B', controls: ['switch', 'skipTurn', ...finish] });
      else add({ ...base, tasks, controls: section.amrap?.counter === 'none' ? finish : ['count:round', ...(section.amrap?.counter === 'roundsAndReps' ? ['count:rep' as const] : []), 'undoCount', ...finish], counter: { rounds: 88, reps: 88 } });
      continue;
    }
    const lanes = { ...base, assignments: occurrence.assignments };
    if (timing === 'timed') { add({ ...lanes, controls: finish }); continue; }
    const both = occurrence.completion === 'both', done = reportedIn(timing, both);
    if (both) {
      add({ ...lanes, controls: ['done:A', 'done:B', ...finish] });
      add({ ...lanes, state: { A: done }, controls: ['done:B', ...finish] });
    } else add({ ...lanes, controls: ['done', ...finish] });
    if (timing === 'interval') add({ ...lanes, state: { A: done, B: done }, controls: finish });
  }
  return [...found.values()];
}

/**
 * The stations and their action bar, for the live station and for the ruler's copies alike, so the room the ruler measures
 * is the room the stage takes. Without `live` it is such a copy: no test id, no name for a screen reader, no handler, no ref.
 */
function StageBody({ station, look, live }: { station: Station; look: StageLook; live?: StageLive }) {
  const { names, loadUnit, pair, plain } = look;
  const sex = (role: Role) => look.loadsFor?.[role];
  // A quick timer keeps the round counter of an AMRAP and the Done that stops a For time clock; an interval's Done has nothing to report.
  const has = (control: Control) => station.controls.includes(control) && !(plain && control === 'done' && station.format !== 'forTime');
  const unit = station.tasks ?? [];
  const turns = Boolean(station.tasks) && station.format === 'youGoIGo';
  const roles = (['A', 'B'] as const).filter(role => role === 'A' || pair);
  const lane = (role: Role) => {
    const item = station.assignments?.[role];
    const target = item && primaryTarget(item);
    const state = station.state[role];
    // A solo station (UI-29) is one row across the stage: the target, or the seconds of a timed movement, then the movement, then
    // its load. It carries no badge and no name, there being nobody to tell apart.
    if (!pair) {
      const text = item ? target || item.load ? item.notes ?? '' : prescriptionText(item) : 'You’re at the finish.';
      return <section className={styles.lane} data-solo data-athlete={live && role} key={role} aria-label={live && 'Station'}>
        <div className={styles.soloLead}>{target ? <div className={own.target}><strong>{target.amount}</strong><small>{target.unit}</small></div> : station.seconds !== undefined ? <div className={own.target} data-kind="time"><strong>{station.seconds}</strong><small>s</small></div> : null}</div>
        <div className={styles.soloName}><h2 data-testid={live && `movement-${role}`}>{item?.shortName ?? item?.name ?? 'All done'}</h2>{text && <p>{text}</p>}</div>
        <div className={styles.soloSide}>
          {item?.load ? <span className={own.loadLine}><LoadLevels load={item.load} unit={loadUnit} sex={sex(role)} /></span> : null}
          {target && station.seconds !== undefined && <span className={styles.laneTime}>{station.seconds}s</span>}
          {state && <span className={own.laneState} data-state={state.state}>{state.state === 'waiting' ? <Icon name="check" size={14} /> : null}{state.label}</span>}
        </div>
      </section>;
    }
    return <section className={`${styles.lane} ${own.lane}`} data-athlete={live && role} data-active={station.resting !== role} data-block={turns ? 'turns' : undefined} key={role} aria-label={live && `Athlete ${role} station`}>
      <div className={styles.athleteLabel}><span className={styles.athleteBadge}>{role}</span><span>{names[role]}</span>{station.seconds !== undefined && <span className={styles.laneTime}>{station.seconds}s</span>}</div>
      {turns ? <>
        <h2 data-testid={live && `movement-${role}`}>{station.resting === role ? 'Rest' : 'Your turn'}</h2>
        <ul className={own.unit}>{unit.map(task => { const lanePrescription = task.assignments[role] ?? task.assignments.A; const amount = primaryTarget(lanePrescription); return <li key={task.nodeId}>{amount && <>{amount.amount}<small>{amount.unit}</small></>}<span>{lanePrescription.shortName ?? lanePrescription.name}</span><LoadLevels load={lanePrescription.load} unit={loadUnit} sex={sex(role)} /></li>; })}</ul>
      </> : <>
        {target && <div className={own.target}><strong>{target.amount}</strong><small>{target.unit}</small></div>}
        <h2 data-testid={live && `movement-${role}`}>{item?.shortName ?? item?.name ?? 'All done'}</h2>
        {item?.load ? <span className={own.loadLine}><LoadLevels load={item.load} unit={loadUnit} sex={sex(role)} /></span> : null}
        <p>{item ? target || item.load ? item.notes ?? '' : prescriptionText(item) : 'You’re at the finish.'}</p>
      </>}
      {state && <span className={own.laneState} data-state={state.state}>{state.state === 'waiting' ? <Icon name="check" size={14} /> : null}{state.label}</span>}
      {has(`done:${role}`) && <button className={`${styles.primaryButton} ${own.laneDone}`} onClick={() => live?.act('done', { athlete: role })}><Icon name="check" />{names[role]} done</button>}
    </section>;
  };
  return <div className={own.stageBody} ref={live?.body}>
    {plain ? null : station.tasks && station.format === 'amrap' ? <>
      {unit.length > 8 && <p className={own.fitWarning}>Long block: {unit.length} movements may not all fit on a small screen. Use the Context view to scroll.</p>}
      <ul className={own.taskList} aria-label={live && 'AMRAP block'}>{unit.map((task, index) => <li key={task.nodeId} className={own.taskRow} data-pair={pair} data-highlight={live?.highlight === task.nodeId} onClick={() => live?.onHighlight(task.nodeId)}>
        <span className={own.taskIndex}>{index + 1}</span>
        {roles.map(role => { const item = task.assignments[role]!; const amount = primaryTarget(item); return <span key={role} className={own.taskCell} data-role={role}>{amount && <strong>{amount.amount}<small>{amount.unit}</small></strong>}<span>{item.shortName ?? item.name}</span><LoadLevels load={item.load} unit={loadUnit} sex={sex(role)} /></span>; })}
      </li>)}</ul>
      <p className={own.taskHint}>Tap a row to mark where you are. It never changes the clock.</p>
    </> : <div key={live?.lanesKey} ref={live?.lanes} className={styles.lanes} style={{ '--lane-count': pair ? 2 : 1 } as CSSProperties}>{roles.map(lane)}</div>}
    {(has('done') || has('switch') || has('finish') || has('count:round')) && <div className={own.actionBar} data-counter={Boolean(has('count:round') && station.counter)}>
      {has('done') && <button className={own.bigAction} data-testid={live && 'done'} onClick={() => live?.act('done')}><Icon name="check" size={26} />{station.timing === 'interval' ? 'Done · rest until next' : station.format === 'strength' ? 'Set done' : 'Done'}</button>}
      {has('switch') && <button className={own.bigAction} data-testid={live && 'switch'} onClick={() => live?.act('switch')}><Icon name="switch" size={26} />Switch to {names[station.switchTo ?? 'A']}</button>}
      {has('count:round') && station.counter && <div className={own.counter} aria-label={live && 'Round counter'}>
        <span className={own.counterValue}><strong data-testid={live && 'rounds'}>{station.counter.rounds}</strong><small>rounds</small></span>
        {has('count:rep') && <span className={own.counterValue}><strong data-testid={live && 'reps'}>{station.counter.reps}</strong><small>reps</small></span>}
        <button className={own.counterButton} onClick={() => live?.act('count', { unit: 'round' })}><Icon name="plus" size={18} />Round</button>
        {has('count:rep') && <button className={own.counterButton} onClick={() => live?.act('count', { unit: 'rep' })}><Icon name="plus" size={18} />Rep</button>}
        <button className={own.counterButton} disabled={!has('undoCount')} aria-label={live && 'Undo last count'} onClick={() => live?.act('undoCount')}><Icon name="undo" size={18} /></button>
      </div>}
      {has('skipTurn') && <button className={own.secondaryAction} onClick={() => live?.act('skipTurn')}><Icon name="skip" size={18} />Skip turn</button>}
      {has('finish') && <button className={own.secondaryAction} data-testid={live && 'finish'} onClick={() => live?.act('finish')}><Icon name="flag" size={18} />Finish block</button>}
    </div>}
  </div>;
}

/**
 * The ruler (UI-27): every station of the plan laid out unseen, one on top of the other at the stage's own width, so its
 * height is the tallest station's. Inert and hidden from every reader; it renders again only when the plan or the look changes.
 */
const StageRuler = memo(function StageRuler({ stations, look, stack }: { stations: Station[]; look: StageLook; stack: RefObject<HTMLDivElement | null> }) {
  return <div className={own.ruler} aria-hidden="true" inert><div ref={stack} className={own.rulerStack}>{stations.map(station => <StageBody key={station.key} station={station} look={look} />)}</div></div>;
});

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
  /** Opens the app's keyboard sheet (Shortcuts.tsx). */
  onShortcuts: () => void;
  /** Restore this checkpoint instead of starting fresh (ENG-12). */
  recovery?: Recovery;
  /** Sessions running on other devices of the household (ENG-15): this one steps aside when it is among them, and before Start one of this workout is offered. */
  live?: LiveOffers;
}

export function Player({ workout: workoutProp, audio, preferences, catalogue, onPreferencesChange, onPerformingChange, onSessionEnd, onSessionClear, onShortcuts, recovery, live }: PlayerProps) {
  // The session plays the workout it started with; an edit in the library never changes a running session (AT-14).
  const [workout] = useState(workoutProp);
  const { names, loadsFor, loadUnit, perimeterWidth, washGain, amberMs, redMs, markColors, pauseColor, nudgeSeconds } = preferences;
  /** A quick timer (UI-30) is the clock alone: no station, no game plan and no Up next, in the focus view whatever the preference. */
  const timerOnly = isQuickTimer(workout);
  const view = timerOnly ? 'focus' : preferences.view;
  /** The milestone and paused colours are chosen per theme; the one in effect goes on the frame below. */
  const theme = useResolvedTheme(preferences.theme);
  /** What of the session's progress shows, each part on its own: the bar across the top, the percentage under it, the percentage beside the clock, and the round donut. */
  const shown = preferences.progress;
  /** The clock nudge of the skip buttons and the J and L keys, as on a video player. */
  const nudgeMs = nudgeSeconds * 1000;
  /** Pair lanes show their athlete's amount; solo workouts show the men's amount with the women's in brackets. */
  const loadSex = (role: 'A' | 'B') => workout.participants === 2 ? loadsFor[role] : undefined;
  const setView = (next: 'focus' | 'context') => onPreferencesChange(value => ({ ...value, view: next }));
  // The fun buttons (UI-31, UI-32): a party horn and the Just do it clip, for whoever switched them on. Both are sound, so Silent
  // mode has neither, and with reduced motion the clip stays away.
  const fun = preferences.funButtons && preferences.soundMode !== 'silent';
  const stillOnly = reducedMotion();
  const { on: cameo, toggle: toggleCameo, props: cameoProps } = useCameo(preferences.beepVolume);
  const partyHorn = useCallback(() => { void audio.playPartyHorn(); }, [audio]);
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
  /** One fill per block of the overall bar (UI-24), written per frame. */
  const segmentFills = useRef<(HTMLSpanElement | null)[]>([]);
  const overallText = useRef<HTMLSpanElement>(null);
  const clockPercentRef = useRef<HTMLSpanElement>(null);
  const player = useRef<HTMLDivElement>(null);
  const donutFill = useRef<SVGPathElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const stageBody = useRef<HTMLDivElement>(null);
  const rulerStack = useRef<HTMLDivElement>(null);
  const exitLayer = useRef<HTMLDivElement>(null);
  const lastLanes = useRef<{ key: string; node: HTMLDivElement; top: number; left: number; width: number }>(undefined);
  /** The block whose start card shows (UI-24), and the last block one was shown for. */
  const [intro, setIntro] = useState<number>();
  const introShown = useRef<number>(undefined);
  const { engine, plan, projection, send, subscribeClock, soundError, wakeStatus, restart, checkpointStatus, startedAt, detach, pristine, elsewhere } = useWorkout(workout, audio, { recovery });
  /** Who controls the session instead of this player: another tab (ENG-14), another device, or nobody because it was finished there (ENG-15). */
  const [takenOver, setTakenOver] = useState<{ by: 'tab' } | { by: 'device'; label: string } | { by: 'finished' }>();
  /** A claim of a session from another device is under way: one at a time. */
  const [claiming, setClaiming] = useState(false);
  const claim = (sessionId: string) => { if (!live) return; setClaiming(true); void live.onContinue(sessionId).finally(() => setClaiming(false)); };
  /** The note of a session taken over from another device, until it is resumed here. */
  const handover = pristine ? recovery?.checkpoint.handover : undefined;
  const { status, current, nextWork, section, format, timing, clockScope, controls, acks, tasks, counter, turn, interval } = projection;
  const isBlock = Boolean(tasks);
  const isPrep = status === 'preparing' || (status === 'paused' && projection.occurrenceId === 'prep');
  const isRest = current.phase !== 'work' && !isPrep;
  const terminal = status === 'completed' || status === 'aborted';
  const editable = status === 'ready' || terminal;
  /** The fun buttons show from the first second of a session to its finish screen. */
  const funShown = fun && status !== 'ready';
  // The stations' zoom (UI-33), this browser's own: what was asked for, and what the frame shows of it.
  const [zoomWish, setZoomWish] = useState(loadStageZoom);
  const [zoom, setZoom] = useState(zoomWish);
  const funNow = useRef({ horn: false, clip: false });
  funNow.current = { horn: funShown, clip: funShown && !stillOnly };
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
  const showDonut = Boolean(shown.donut && roundView && (roundView.size > 1 || roundView.rounds > 1));
  const donut = showDonut && roundView ? <RoundDonut view={roundView} timed={timing !== 'manual'} fill={donutFill} counts={timerOnly ? 'rounds' : 'movements'} /> : null;
  // A new movement takes over (UI-24): the stations shown before slide out to the left while the new ones slide in
  // from the right. React has just removed the old element; it is parked, inert and without test ids, in an overlay at
  // its old place for the length of the animation. The first effect reads the last commit, the second records this one.
  const lanesKey = `${(isRest ? nextWork?.id : undefined) ?? current.id}/${turn?.number ?? 0}`;
  useLayoutEffect(() => {
    const last = lastLanes.current, layer = exitLayer.current;
    if (!last || last.key === lanesKey || !layer || !last.width || last.node.isConnected || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const node = last.node;
    // The new stations stand where the old ones stood, so they give the place as it is now: a resize or a turn of the screen since the last commit renders nothing here and leaves the record behind.
    const here = lanesRef.current?.offsetWidth ? placeIn(layer, lanesRef.current) : undefined;
    const place = here ?? last;
    for (const element of [node, ...node.querySelectorAll<HTMLElement>('*')]) { element.removeAttribute('data-testid'); element.removeAttribute('id'); element.style.animation = 'none'; }
    node.setAttribute('inert', '');
    Object.assign(node.style, { position: 'absolute', top: `${place.top}px`, left: `${place.left}px`, width: `${place.width}px`, margin: '0' });
    layer.replaceChildren(node);
    const exit = node.animate([{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'translateX(-96px) scale(.94)', filter: 'blur(6px)' }], { duration: 260, easing: 'cubic-bezier(.5, 0, .9, .4)', fill: 'forwards' });
    exit.onfinish = () => node.remove();
    return () => { exit.cancel(); node.remove(); };
  }, [lanesKey]);
  useLayoutEffect(() => {
    const node = lanesRef.current, layer = exitLayer.current;
    lastLanes.current = node && layer ? { key: lanesKey, node, ...placeIn(layer, node) } : undefined;
  });
  // The room the stage keeps (UI-27): the tallest station of the plan as the ruler measures it at this frame's width, written
  // straight to the frame, so no render waits on it and a resize or a turn measures again by itself. Should a live station
  // ever stand taller than the ruler said, the room grows to it and stays there for as long as the frame keeps its size.
  const stations = useMemo(() => planStations(plan), [plan]);
  /** The session has more than one slot of work, so Up next has something to say before the last of them. */
  const several = useMemo(() => plan.occurrences.filter(item => item.phase === 'work').length > 1, [plan]);
  const look = useMemo<StageLook>(() => ({ names, loadUnit, loadsFor: workout.participants === 2 ? loadsFor : undefined, pair: workout.participants === 2, plain: timerOnly }), [names, loadUnit, loadsFor, workout.participants, timerOnly]);
  const ruled = !editable && view === 'focus';
  // The zoom (UI-33) is applied here too, where the room is measured, because what was asked for is not always what the frame
  // can hold: a step above 100 % that makes the frame scroll or presses a station is taken back step by step, at once and
  // again after a resize or a turn. A step of 100 % or less is never refused.
  const zoomable = !editable && !timerOnly;
  useLayoutEffect(() => {
    const frame = player.current, stack = ruled ? rulerStack.current : null;
    if (!frame || editable) return;
    let seen = 0, size = '';
    const measure = () => {
      if (!stack) return;
      const now = `${window.innerWidth}x${window.innerHeight}`;
      if (now !== size) { size = now; seen = 0; }
      seen = Math.max(seen, stageBody.current?.getBoundingClientRect().height ?? 0);
      const room = `${Math.ceil(Math.max(stack.getBoundingClientRect().height, seen))}px`;
      if (frame.style.getPropertyValue('--stage-room') !== room) frame.style.setProperty('--stage-room', room);
    };
    const holds = () => frame.scrollHeight <= frame.clientHeight + 1 && ![...frame.querySelectorAll('section[data-athlete]')].some(lane => lane.scrollHeight > lane.clientHeight + 1);
    const fit = () => {
      let index = zoomable ? Math.max(0, (STAGE_ZOOMS as readonly number[]).indexOf(zoomWish)) : STAGE_ZOOMS.indexOf(1);
      for (;; index--) {
        frame.style.setProperty('--stage-zoom', String(STAGE_ZOOMS[index]));
        seen = 0;
        measure();
        if (STAGE_ZOOMS[index] <= 1 || holds()) break;
      }
      setZoom(STAGE_ZOOMS[index]);
    };
    fit();
    const observer = new ResizeObserver(measure);
    if (stack) observer.observe(stack);
    if (stack && stageBody.current) observer.observe(stageBody.current);
    window.addEventListener('resize', fit);
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); frame.style.removeProperty('--stage-room'); frame.style.removeProperty('--stage-zoom'); };
  }, [ruled, editable, zoomable, zoomWish]);
  const canZoom = { out: zoomable && zoom > STAGE_ZOOMS[0], in: zoomable && zoom < STAGE_ZOOMS[STAGE_ZOOMS.length - 1] && zoom >= zoomWish };
  /** A step from what the frame shows, which is what the buttons are read against. */
  const stepZoom = (by: 1 | -1) => { if (by === 1 ? !canZoom.in : !canZoom.out) return; const next = stepStageZoom(zoom, by); saveStageZoom(next); setZoomWish(next); };
  const zoomNow = useRef(stepZoom);
  zoomNow.current = stepZoom;
  // The CAP or TURN line under the clock keeps its row for the whole session once any block of the plan shows one, so its coming and going between blocks never moves the digits.
  const secondaryLine = useMemo(() => plan.occurrences.some(item => {
    if (item.phase !== 'work') return false;
    const part = plan.sections[item.sectionIndex];
    const turns = Boolean(item.tasks) && part.format === 'youGoIGo';
    const counted = (part.format === 'forTime' || part.format === 'strength') && item.timing === 'manual' && !item.tasks;
    return turns || (part.capMs !== undefined && (item.timing !== 'manual' || counted));
  }), [plan]);
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

  // Start was pressed on the card or the workout's page (start.ts): the session begins with that tap, not with a second Start here.
  // An interrupted session never starts by itself; it asks first (ENG-12).
  useEffect(() => { if (takeStart(workout.id) && !recovery) send('play', engine.occurrenceId); }, []);
  useEffect(() => { onPerformingChange(!editable); }, [editable, onPerformingChange]);

  // This tab controls the session (ENG-14). When another tab claims it: pause, write the last checkpoint, let go.
  useEffect(() => {
    if (editable || takenOver) return;
    let released = false;
    const held = holdSessionLock(engine.sessionId, {
      onClaim: () => {
        if (released) return;
        released = true;
        void detach().finally(() => { held.release(); setTakenOver({ by: 'tab' }); });
      },
    });
    return () => { released = true; held.release(); };
  }, [engine, editable, takenOver, detach]);
  // Another device continues this session (ENG-15): the uplink was told so, or the household's list names another
  // controller. Pause, write what is pending, then drop this device's checkpoint so nothing here offers the session as
  // interrupted, and step aside. The lock above goes with it. No label means the session was finished there already.
  const continuedOn = elsewhere ? elsewhere.controller?.deviceLabel ?? '' : live?.sessions.find(item => item.id === engine.sessionId)?.deviceLabel;
  useEffect(() => {
    if (continuedOn === undefined || editable || takenOver) return;
    setTakenOver(continuedOn ? { by: 'device', label: continuedOn } : { by: 'finished' });
    void detach().then(() => onSessionClear?.(engine.sessionId));
  }, [continuedOn, editable, takenOver, detach, engine, onSessionClear]);
  // Clips and this workout's recorded movement names are decoded before Play so a session never waits on the network.
  useEffect(() => { void audio.preload(); if (!timerOnly) void audio.prepareNames(collectPrescriptions(workout).map(item => audio.nameKey(item))); }, [audio, workout, catalogue, timerOnly]);
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
    // A player that handed its session over is inert: no key reaches an engine that holds no lock (AT-21).
    if (takenOver) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(target.tagName)) return;
      if (document.querySelector('dialog[open]')) return;
      const id = engine.occurrenceId;
      const controlsNow = engine.project().controls;
      if (event.key === '?') { onShortcuts(); return; }
      if (event.key === ' ') { event.preventDefault(); for (const control of ['pause', 'resume', 'ready', 'play'] as const) if (controlsNow.includes(control)) { send(control, id); return; } }
      else if (event.key === 'Enter') { event.preventDefault(); if (controlsNow.includes('done')) send('done', id); else if (controlsNow.includes('switch')) send('switch', id); }
      else if (event.key === 'ArrowRight' && event.shiftKey && controlsNow.includes('nextSection')) send('nextSection', id);
      else if (event.key === 'ArrowLeft' && event.shiftKey && controlsNow.includes('previousSection')) send('previousSection', id);
      else if (event.key === 'ArrowRight' && controlsNow.includes('next')) send('next', id);
      else if (event.key === 'ArrowLeft' && controlsNow.includes('previous')) send('previous', id);
      else if ((event.key === 'l' || event.key === 'L') && controlsNow.includes('nudge')) send('nudge', id, { delta: nudgeMs });
      else if ((event.key === 'j' || event.key === 'J') && controlsNow.includes('nudge')) send('nudge', id, { delta: -nudgeMs });
      else if ((event.key === 'h' || event.key === 'H') && funNow.current.horn) partyHorn();
      else if ((event.key === 'd' || event.key === 'D') && funNow.current.clip) toggleCameo();
      else if (event.key === '+' || event.key === '=') zoomNow.current(1);
      else if (event.key === '-' || event.key === '_') zoomNow.current(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, send, nudgeMs, takenOver, partyHorn, toggleCameo]);

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

  // The context list keeps the movement under way in its middle. The row is placed by what it measures on screen against
  // the list, which holds for a zoomed row too (UI-33).
  // The observer also re-centres when the list or the enlarged active row change size, and it fires once on its own.
  useEffect(() => {
    const list = context.current, row = activeRow.current;
    if (!following || view !== 'context' || !list || !row) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const observer = new ResizeObserver(() => { const box = list.getBoundingClientRect(), at = row.getBoundingClientRect(); list.scrollTo({ top: Math.max(0, list.scrollTop + at.top - box.top - (list.clientHeight - at.height) / 2), behavior: reduced ? 'instant' : 'smooth' }); });
    observer.observe(list); observer.observe(row);
    return () => observer.disconnect();
  }, [projection.occurrenceId, highlight, following, view]);

  const capLine = projection.capMs !== undefined && (clockScope !== 'cap' || countUp);
  /** What the last line of the frame says beside the elapsed time. */
  const sessionHint = status === 'ready' ? workout.prepMs ? `${Math.round(workout.prepMs / 1000)}-second prep. Find your rhythm.` : 'Start when you’re ready.' : isPrep ? 'Find your rhythm.' : isRest ? timerOnly ? 'Breathe.' : 'Breathe. Your next stations are above.' : timing === 'manual' && !isBlock ? 'Tap Done when the work is finished.' : format === 'emom' ? 'The next interval starts on the clock.' : '';
  const turnLine = isBlock && format === 'youGoIGo' && clockScope !== 'turn';
  const restLabel = timerOnly ? 'Rest' : current.phase === 'roundRest' ? 'Round rest' : current.phase === 'transition' ? 'Transition' : 'Block rest';
  const phaseLabel = status === 'ready' ? 'Ready when you are' : status === 'paused' ? projection.pauseReason === 'hidden' ? 'Paused · app was hidden' : projection.pauseReason === 'recovered' ? 'Recovered · paused' : 'Workout paused' : status === 'awaitingReady' ? 'Next block · ready?' : status === 'completed' ? 'Workout complete' : status === 'aborted' ? 'Workout ended' : isPrep ? 'Get ready' : isRest ? restLabel : format === 'amrap' ? 'AMRAP' : format === 'emom' ? 'Interval' : format === 'youGoIGo' ? `${turn?.athlete === 'B' ? names.B : names.A} works` : format === 'strength' ? 'Set' : timing === 'manual' ? 'Work · tap Done' : 'Work';
  const playerPhase = terminal ? 'complete' : status === 'paused' ? 'paused' : isRest ? 'rest' : isPrep ? 'prep' : status === 'ready' ? 'ready' : 'work';
  // The top line names the block; rounds are the donut's dots, so a repeat is only spelled out where no donut shows.
  const blockLabel = plan.sections.length > 1 ? `BLOCK ${current.sectionIndex + 1} / ${plan.sections.length}` : '';
  const positionLabel = format === 'emom' && interval ? `INTERVAL ${interval.index} / ${interval.count}` : format === 'youGoIGo' && turn ? `TEAM ROUND ${turn.teamRound + 1}${turn.roundsTarget ? ` / ${turn.roundsTarget}` : ''} · TURN ${turn.number}` : round && !showDonut ? `${format === 'strength' ? 'SET' : 'ROUND'} ${roundNumber} / ${round.count}` : blockLabel;
  const caption = terminal ? 'ACTIVE SESSION TIME' : status === 'ready' || isPrep ? 'PREP COUNTDOWN' : status === 'awaitingReady' ? countUp ? section.capMs ? 'NEXT BLOCK · COUNTS UP TO THE CAP' : 'NEXT BLOCK · NO CAP' : clockScope === 'cap' ? 'NEXT BLOCK · TIME CAP' : clockScope === 'elapsed' ? 'NEXT BLOCK · NO CAP' : 'FIRST WORK INTERVAL' : isRest ? 'REST REMAINING' : countUp ? section.capMs ? 'ELAPSED · CAP BELOW' : 'ELAPSED · NO CAP' : CAPTIONS[clockScope];
  const laneHeading = isRest ? 'COMING UP AFTER REST' : status === 'awaitingReady' ? 'YOUR NEXT BLOCK' : isBlock && format === 'amrap' ? 'ONE ROUND · REPEAT UNTIL THE CAP' : isBlock ? 'THE WORK UNIT' : pair ? 'YOUR STATIONS' : 'YOUR STATION';

  const laneState = (role: Role): LaneState | undefined => {
    if (!active && status !== 'paused') return undefined;
    if (format === 'youGoIGo' && turn) return turn.athlete === role ? TURN_STATES.A : TURN_STATES.B;
    const both = current.completion === 'both';
    return (both ? acks[role] : acks.team) ? reportedIn(timing, both) : undefined;
  };
  // The station in view, as the stage draws it: what the session shows now, where the ruler's copies show what the plan can.
  const station: Station = {
    key: 'live', format, timing, assignments: showing, tasks, controls, counter,
    seconds: timing === 'manual' ? undefined : Math.round((isRest ? nextWork?.durationMs ?? 0 : current.durationMs) / 1000),
    state: { A: laneState('A'), B: laneState('B') },
    resting: format === 'youGoIGo' && turn && !isRest ? turn.athlete === 'A' ? 'B' : 'A' : undefined,
    switchTo: turn?.athlete === 'A' ? 'B' : 'A',
  };
  const stageLive: StageLive = { lanesKey, lanes: lanesRef, body: stageBody, highlight, onHighlight: nodeId => setHighlight(value => value === nodeId ? undefined : nodeId), act: (type, extra) => send(type, projection.occurrenceId, extra) };

  if (takenOver) return <div className={styles.screen}>
    {takenOver.by === 'tab'
      ? <section className={styles.recovery} role="region" aria-label="Taken over"><div><strong>Another tab took over this session.</strong><p>“{workout.title}” continues there; this tab no longer controls the clock. Close it, or reopen the session here.</p></div><div className={styles.dialogActions}><a className={styles.quietButton} href="#/">Back to library</a><button className={styles.primaryButton} onClick={() => window.location.reload()}><Icon name="play" />Reopen here</button></div></section>
      : <section className={styles.recovery} role="region" aria-label="Continued on another device"><div><strong>{takenOver.by === 'device' ? `Continued on ${takenOver.label}.` : 'Finished on another device.'}</strong></div><div className={styles.dialogActions}><a className={styles.quietButton} href="#/">Back to library</a>{takenOver.by === 'device' && live && <button className={styles.primaryButton} disabled={claiming} onClick={() => claim(engine.sessionId)}><Icon name="play" />Take it back here</button>}</div></section>}
  </div>;

  return <div className={styles.screen} data-performing={!editable} data-view={view}>
    <div className={styles.workoutHeading}>
      <div>
        <div className={styles.eyebrow}><a href="#/">YOUR LIBRARY</a> <span>/</span> <a href={workoutHref(workout.id)}>{timerOnly ? 'QUICK TIMER' : pair ? 'PARTNER SESSION' : 'SOLO SESSION'}</a>{!bundled && !timerOnly && <><span>/</span>{DATA_MODE === 'server' ? 'SAVED FOR THE HOUSEHOLD' : 'SAVED ON THIS DEVICE'}</>}</div>
        <h1>{workout.title}</h1>
        {workout.description && <p className={styles.description}>{workout.description}</p>}
        <div className={styles.metadata}><span><Icon name="clock" size={16} />{plan.durationKind === 'open' ? 'Open-ended' : `${plan.durationKind === 'capped' ? 'Up to ' : ''}${displayTime(plan.durationMs + workout.prepMs)} incl. prep`}</span>{!timerOnly && <><AthletesChip participants={workout.participants} /><DifficultyChip difficulty={difficulty} /></>}</div>
      </div>
      {!timerOnly && <div className={styles.viewSwitch} aria-label="Player view"><button aria-pressed={view === 'focus'} onClick={() => setView('focus')}><Icon name="focus" size={17} />Focus</button><button aria-pressed={view === 'context'} onClick={() => setView('context')}><Icon name="list" size={17} />Context</button></div>}
    </div>

    <div className={styles.player} ref={player} data-timer={timerOnly || undefined} data-boundary={status === 'awaitingReady' ? 'end' : intro !== undefined && intro === current.sectionIndex ? 'start' : undefined} data-phase={playerPhase} data-scope={clockScope} data-bar={shown.bar} data-bar-percent={shown.barPercent} data-clock-percent={shown.clockPercent} data-donut={shown.donut} data-warning="normal" data-wash={preferences.wash} style={{ '--perimeter-width': `${perimeterWidth}px`, '--wash-gain': String(washGain / 100), '--wash-min': String(washGain / 600), ...(markColors.first[theme] ? { '--phase-amber': markColors.first[theme] } : {}), ...(markColors.second[theme] ? { '--phase-red': markColors.second[theme] } : {}), ...(pauseColor[theme] ? { '--phase-paused': pauseColor[theme] } : {}) } as CSSProperties}>
      <Perimeter progress={border} width={perimeterWidth} />
      <div ref={exitLayer} className={own.exitLayer} aria-hidden="true" />
      {status === 'awaitingReady' && current.sectionIndex > 0 ? (() => {
        const finished = plan.sections[current.sectionIndex - 1];
        const result = projection.results.find(item => item.sectionId === finished.id);
        return <div key={`end-${finished.id}`} className={own.blockCard} data-kind="end" data-testid="block-card"><Icon name="check" size={20} /><span>BLOCK {current.sectionIndex} DONE</span><strong>{finished.title}</strong>{result && <small>{resultText(result)}</small>}</div>;
      })() : intro !== undefined && intro === current.sectionIndex && !terminal ? <div key={`start-${intro}`} className={own.blockCard} data-kind="start" data-testid="block-card" aria-hidden="true">
        <span>BLOCK {intro + 1} OF {plan.sections.length}</span><strong>{section.title}</strong><small>{[FORMAT_LABELS[format], roundView && roundView.rounds > 1 ? `${roundView.rounds} rounds` : '', section.capMs ? `cap ${displayTime(section.capMs)}` : ''].filter(Boolean).join(' · ')}</small>
      </div> : null}
      <div className={styles.playerTop}><span><span className={styles.liveDot} />{timerOnly ? workout.title : section.title}{!timerOnly && <span className={own.keyHint}>{FORMAT_LABELS[format].toUpperCase()}</span>}</span><span><span className={styles.position}>{positionLabel}</span>{zoomable && <><button className={styles.iconButton} data-zoom aria-label="Zoom out" title="Smaller stations (-)" disabled={!canZoom.out} onClick={() => stepZoom(-1)}><Icon name="minus" size={18} /></button><button className={styles.iconButton} data-zoom aria-label="Zoom in" title="Larger stations (+)" disabled={!canZoom.in} onClick={() => stepZoom(1)}><Icon name="plus" size={18} /></button></>}{funShown && <button className={styles.iconButton} aria-label="Party horn" title="Party horn (H)" onClick={partyHorn}><Icon name="horn" size={18} /></button>}{funShown && !stillOnly && <button className={styles.iconButton} aria-label="Just do it" title="Just do it (D)" aria-pressed={cameo} onClick={toggleCameo}><Icon name="bolt" size={18} /></button>}{!editable && !timerOnly && <button className={styles.iconButton} aria-label={view === 'focus' ? 'Switch to context view' : 'Switch to focus view'} onClick={() => setView(view === 'focus' ? 'context' : 'focus')}><Icon name={view === 'focus' ? 'list' : 'focus'} size={18} /></button>}</span></div>
      {(shown.bar || shown.barPercent) && <div className={styles.overall} aria-label="Overall progress">{shown.bar && <span className={styles.overallTrack} data-testid="overall-progress">{plan.sections.map((item, index) => <span key={item.id} className={styles.overallSegment} data-segment={index} style={{ flexGrow: item.endIndex - item.startIndex + 1 }}><span ref={element => { segmentFills.current[index] = element; }} className={styles.overallFill} /></span>)}</span>}{shown.barPercent && <span ref={overallText} className={styles.overallText}>0 % DONE</span>}</div>}
      <div className={styles.clockBlock}>
        <div className={styles.phase} role="status" aria-live="polite">{phaseLabel}</div>
        <div className={styles.clockLine}>{donut}<div ref={timer} className={styles.timer} data-testid="primary-timer" aria-label="Primary timer">{displayTime(workout.prepMs || firstDisplayMs)}</div>{shown.clockPercent && <span ref={clockPercentRef} className={styles.clockPercent} aria-label="Progress beside the clock">0 %</span>}</div>
        <div className={styles.clockCaption}>{caption}</div>
        {!terminal && !editable && (capLine || turnLine || secondaryLine) && <div className={own.secondaryClock} data-idle={!(capLine || turnLine) || undefined}>
          {capLine && <span>CAP<strong ref={capClock}>{displayTime(projection.capMs!)}</strong></span>}
          {turnLine && <span>TURN<strong ref={turnClock}>00:00</strong></span>}
          {!(capLine || turnLine) && <span>&nbsp;</span>}
        </div>}
      </div>

      {terminal ? <div className={styles.finishMessage}><span className={styles.finishIcon}><Icon name="check" size={28} /></span><h2>{status === 'completed' ? 'That’s a good session.' : 'Every bit of movement counts.'}</h2><p>{status === 'completed' ? 'Take a breath. Grab some water. You earned it.' : 'Your session has ended.'}</p>
        {projection.results.length > 0 && <ul className={own.resultList} aria-label="Block results">{projection.results.map(result => <li key={result.sectionId}><span>{plan.sections.find(item => item.id === result.sectionId)?.title ?? result.sectionId}</span><span>{resultText(result)}</span></li>)}</ul>}
      </div> : <>
        {!timerOnly && <div className={styles.laneHeading}>{laneHeading}<span>{roundView && roundView.size > 1 ? `MOVEMENT ${roundView.position} / ${roundView.size}` : ''}</span></div>}
        <div className={own.stage}><StageBody station={station} look={look} live={stageLive} /></div>
        {/* A quick AMRAP lists its rounds like a stopwatch its laps (UI-30): the latest on top, each with the time it took and the time it ended at. */}
        {timerOnly && counter && <ol className={own.laps} aria-label="Rounds">{counter.laps.map((at, index, all) => {
          const seconds = (ms: number) => Math.round(ms / 1000) * 1000;
          const number = counter.rounds - all.length + index + 1;
          return <li key={number}><span>Round {number}</span><strong>{displayTime(seconds(at) - seconds(index ? all[index - 1] : 0), 'floor')}</strong><small>{displayTime(seconds(at), 'floor')}</small></li>;
        }).reverse()}</ol>}
        {timerOnly ? <div className={styles.nextStrip} data-timer /> : <div className={styles.nextStrip} data-empty={!nextWork} data-kept={several || undefined}><span className={styles.nextLabel}>UP NEXT <Icon name="arrow" size={16} /></span><span>{nextWork ? `${nextWork.sectionIndex !== current.sectionIndex && section.transitionAfter === 'manualReady' ? 'Ready for next block, then ' : ''}${!isRest && projection.restBeforeNextMs ? `${displayTime(projection.restBeforeNextMs)} rest, then ` : ''}${nextWork.tasks ? `${FORMAT_LABELS[plan.sections[nextWork.sectionIndex].format]} block` : `${nextWork.assignments?.A.name}${nextWork.assignments?.B && nextWork.assignments.B.name !== nextWork.assignments.A.name ? ` / ${nextWork.assignments.B.name}` : ''}`}` : 'Finished · time to recover'}</span></div>}
      </>}

      {view === 'context' && <section className={styles.contextSection} aria-label="Workout context">
        <div className={styles.contextHeading}><div><span className={styles.eyebrow}>THE GAME PLAN</span><h2>{section.title}</h2></div><Switch compact checked={following} onChange={setFollowing} label="Stick to movement" /></div>
        <div className={styles.contextList} ref={context} style={{ '--plan-lanes': pair ? 2 : 1 } as CSSProperties} onWheel={() => setFollowing(false)} onTouchMove={() => setFollowing(false)}>
          <div className={styles.contextColumns}><span>#</span><span>{pair ? names.A : 'MOVEMENT'}</span>{pair && <span>{names.B}</span>}<span>{isBlock ? 'TARGET' : 'WORK'}</span></div>
          {contextRows.map((item, index) => {
            const selected = isBlock ? highlight === item.anchor : item.anchor === focusAnchor;
            // Everything the focus view shows for a lane: name, target, the load levels and the notes.
            const cell = (role: 'A' | 'B', lanePrescription?: Prescription) => {
              if (!lanePrescription) return '—';
              const amount = primaryTarget(lanePrescription);
              return <>{lanePrescription.name}{amount ? ` · ${amount.amount} ${amount.unit}` : ''}{(lanePrescription.load || lanePrescription.notes) && <span className={own.contextDetail}>{lanePrescription.load && <LoadLevels load={lanePrescription.load} unit={loadUnit} sex={loadSex(role)} />}{lanePrescription.notes && <span>{lanePrescription.notes}</span>}</span>}</>;
            };
            const done = !isBlock && !selected && (current.phase === 'roundRest' ? true : index + 1 < currentWorkNumber);
            return <div key={item.anchor} ref={selected ? activeRow : undefined} className={styles.contextRow} data-active={selected} data-done={done || undefined} aria-current={selected ? 'step' : undefined}><span>{done ? <Icon name="check" size={12} /> : String(index + 1).padStart(2, '0')}</span><span>{cell('A', item.A)}</span>{pair && <span>{cell('B', item.B)}</span>}<span>{item.durationMs !== undefined ? `${Math.round(item.durationMs / 1000)}s` : 'done'}</span></div>;
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
      {status === 'ready' && live && live.sessions.filter(item => item.workoutId === workout.id).map(item => <section key={item.id} className={styles.recovery} role="region" aria-label="Session on another device">
        <div><strong>{sessionHeadline(item)} · updated {elapsedText(live.ageMs(item))}</strong></div>
        <div className={styles.dialogActions}><button className={styles.primaryButton} disabled={claiming} onClick={() => claim(item.id)}><Icon name="play" />Continue here</button></div>
      </section>)}
      {/* A restored session asks before it goes on (ENG-12). One taken over from another device says where it comes from, also when it was paused there (ENG-15). */}
      {recovery && ((status === 'paused' && projection.pauseReason === 'recovered') || (handover && (status === 'paused' || status === 'awaitingReady'))) && <section className={styles.recovery} role="dialog" aria-label={handover ? 'Continued session' : 'Interrupted session'}>
        <div><strong>{handover ? `Continued from ${handover.from}` : 'Interrupted session'} · saved {elapsedText(Date.now() - new Date(handover?.savedAt ?? lastSaved(recovery)).getTime())}</strong><p>{[`Block ${current.sectionIndex + 1} of ${plan.sections.length}`, turn ? `${turn.athlete === 'A' ? names.A : names.B}’s turn · team round ${turn.teamRound + 1}` : round ? `Round ${round.iteration}` : '', clockScope === 'elapsed' ? `${displayTime(engine.readClocks().activeMs, 'floor')} elapsed` : `${displayTime(engine.readClocks().remainingMs)} left`].filter(Boolean).join(' · ')}. Time since the save is not counted; nothing was marked done for you.</p></div>
        <div className={styles.dialogActions}><button className={styles.quietButton} onClick={() => send('stop', projection.occurrenceId)}><Icon name="close" size={16} />End session</button><button className={styles.primaryButton} onClick={() => send(status === 'awaitingReady' ? 'ready' : 'resume', projection.occurrenceId)}><Icon name="play" />{status === 'awaitingReady' ? 'Start next block' : 'Resume'}</button></div>
      </section>}
      {soundError && <p className={styles.notice} role="status">{soundError}</p>}
      <div className={styles.sessionLine}><span>ELAPSED <span ref={elapsed}>00:00</span>{projection.modified && <span className={styles.modified}> · MODIFIED</span>}{checkpointStatus === 'failed' && <span className={styles.warnText}> · <Icon name="alert" size={11} />NOT SAVING PROGRESS ON THIS DEVICE</span>}</span><span>{sessionHint}</span></div>
      {/* The Just do it clip (UI-32) stands over the frame, takes no tap and moves nothing. Its element waits without a file until the first tap. */}
      {fun && !stillOnly && <div className={own.cameo} data-on={cameo} aria-hidden="true"><video {...cameoProps} /></div>}
      {ruled && <StageRuler stations={stations} look={look} stack={rulerStack} />}
    </div>

    <div className={styles.bottomBar}><div className={styles.readiness}><span className={styles.smallDot} /><span>{preferences.soundMode === 'silent' ? 'Silent mode' : preferences.soundMode === 'voice' ? 'Voice + beeps' : 'Beeps only'}</span><span className={styles.readinessDivider}>·</span><span>{wakeStatus}</span><span className={styles.readinessDivider}>·</span><button className={`${styles.quietButton} ${styles.keysButton}`} onClick={onShortcuts}><span className={styles.kbd}>?</span>Keys</button></div><div className={styles.sharing}><a className={styles.quietButton} href={workoutHref(workout.id)}><Icon name={timerOnly ? 'clock' : 'list'} size={17} />{timerOnly ? 'Timer settings' : 'Details'}</a><a className={styles.quietButton} href="#/"><Icon name="grid" size={17} />All workouts</a>{!timerOnly && <button className={styles.quietButton} onClick={() => exportWorkoutFile(workout)}><Icon name="download" size={17} />Export WOD</button>}</div></div>

    <dialog ref={stopDialog} className={styles.dialog} aria-labelledby="stop-title"><h2 id="stop-title">End this session?</h2><p>The timer will stop. You can start a new session whenever you’re ready.</p><div className={styles.dialogActions}><button className={styles.quietButton} onClick={() => stopDialog.current?.close()}>Keep training</button><button className={`${styles.primaryButton} ${styles.dangerFill}`} onClick={() => { send('stop', engine.occurrenceId); stopDialog.current?.close(); }}>End session</button></div></dialog>
  </div>;
}
