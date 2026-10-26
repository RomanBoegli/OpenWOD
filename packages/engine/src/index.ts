import type { CompiledSection, ExecutionPlan, Occurrence, TaskItem, Timing } from '../../domain/src/compiler';
import type { SectionFormat } from '../../domain/src/schema';

export type Status = 'ready' | 'preparing' | 'running' | 'paused' | 'awaitingReady' | 'completed' | 'aborted';
export type CommandType = 'play' | 'pause' | 'resume' | 'next' | 'previous' | 'stop' | 'ready' | 'done' | 'finish' | 'switch' | 'skipTurn' | 'count' | 'undoCount';
export type Athlete = 'A' | 'B';
export type PauseReason = 'user' | 'hidden' | 'recovered';
export interface Command {
  id: string;
  occurrenceId: string;
  type: CommandType;
  reason?: 'user' | 'hidden';
  /** done: which athlete acknowledges a both-done task. */
  athlete?: Athlete;
  /** count: what to add; delta defaults to 1 and applies to reps only. */
  unit?: 'round' | 'rep';
  delta?: number;
}
export type EventPayload = Record<string, string | number | boolean>;
export interface EngineEvent { id: string; sequence: number; type: string; occurrenceId: string; activeMs: number; payload?: EventPayload }
/** What the primary clock stands for (UI-14). */
export type ClockScope = 'prep' | 'slot' | 'interval' | 'turn' | 'cap' | 'elapsed';
export interface ClockValues {
  remainingMs: number;
  durationMs: number;
  fraction: number;
  activeMs: number;
  sectionMs: number;
  /** Time since the current slot, turn or manual task began. */
  slotMs: number;
  capRemainingMs?: number;
  turnRemainingMs?: number;
}
export type Control = 'play' | 'pause' | 'resume' | 'ready' | 'stop' | 'next' | 'previous' | 'done' | 'done:A' | 'done:B' | 'finish' | 'switch' | 'skipTurn' | 'count:round' | 'count:rep' | 'undoCount';
export interface Acks { A: boolean; B: boolean; team: boolean }
export interface Split { occurrenceId: string; anchor: string; athlete: Athlete | 'team'; sectionMs: number; activeMs: number; turn?: number }
export interface Counter { rounds: number; reps: number }
export interface TurnState { athlete: Athlete; number: number; teamRound: number; skipped: number }
export interface SectionResult {
  sectionId: string;
  format: SectionFormat;
  outcome: 'completed' | 'capped' | 'finished';
  sectionMs: number;
  counter?: Counter;
  turns?: number;
  teamRounds?: number;
  skippedTurns?: number;
  /** Interval occurrences that ended without a Done (ENG-07: never inferred as failed). */
  unacknowledged: string[];
}
export interface Projection {
  sessionId: string;
  status: Status;
  occurrenceId: string;
  current: Occurrence;
  nextWork?: Occurrence;
  restBeforeNextMs: number;
  section: CompiledSection;
  index: number;
  modified: boolean;
  pauseReason?: PauseReason;
  format: SectionFormat;
  timing: Timing;
  clockScope: ClockScope;
  /** Only the commands the engine would accept right now. */
  controls: Control[];
  acks: Acks;
  tasks?: TaskItem[];
  counter?: Counter & { canUndo: boolean };
  turn?: TurnState & { roundsTarget?: number };
  interval?: { index: number; count: number };
  capMs?: number;
  results: SectionResult[];
}
interface CountStep { unit: 'round' | 'rep'; delta: number; previousReps: number }
export interface EngineSnapshot {
  version: 1;
  sessionId: string;
  status: Status;
  pausedFrom: 'running' | 'preparing';
  index: number;
  visit: number;
  phaseMs: number;
  activeMs: number;
  sectionMs: number;
  modified: boolean;
  pauseReason?: PauseReason;
  acks: { A?: number; B?: number; team?: number };
  counter: { rounds: number; reps: number; history: CountStep[] };
  turn?: TurnState;
  results: Record<string, SectionResult>;
  splits: Split[];
  unacknowledged: string[];
  commandIds: string[];
  events: EngineEvent[];
  revision: number;
}

type Due = { at: number; kind: 'prep' | 'cap' | 'slot' | 'turn' };
const FINISHABLE: SectionFormat[] = ['amrap', 'forTime', 'youGoIGo', 'strength'];

/** Pure timing/progression. All time enters through one injected monotonic clock. */
export class WorkoutEngine {
  readonly events: EngineEvent[] = [];
  revision = 0;
  private status: Status = 'ready';
  private pausedFrom: 'running' | 'preparing' = 'running';
  private index = 0;
  private visit = 0;
  private phaseMs = 0;
  private activeMs = 0;
  private sectionMs = 0;
  private anchor = 0;
  private modified = false;
  private pauseReason?: PauseReason;
  private commands = new Set<string>();
  private acks: { A?: number; B?: number; team?: number } = {};
  private counter = { rounds: 0, reps: 0, history: [] as CountStep[] };
  private turn?: TurnState;
  private results: Record<string, SectionResult> = {};
  private splits: Split[] = [];
  private unacknowledged: string[] = [];

  constructor(readonly plan: ExecutionPlan, private now: () => number, readonly sessionId = 'session') {
    this.resetOccurrenceState();
  }

  private get occurrence() { return this.plan.occurrences[this.index]; }
  private get section() { return this.plan.sections[this.occurrence.sectionIndex]; }
  private get isBlock() { return Boolean(this.occurrence.tasks); }
  get occurrenceId() {
    if (this.status === 'ready') return 'ready';
    if (this.preparing) return 'prep';
    const turn = this.turn ? `/turn:${this.turn.number}` : '';
    return `${this.occurrence.id}/visit:${this.visit}${turn}`;
  }
  private get preparing() { return this.status === 'preparing' || (this.status === 'paused' && this.pausedFrom === 'preparing'); }
  private get moving() { return this.status === 'running' || this.status === 'preparing'; }

  get clockScope(): ClockScope {
    if (this.preparing || this.status === 'ready') return this.plan.workout.prepMs ? 'prep' : this.scopeOf(this.occurrence, this.section);
    return this.scopeOf(this.occurrence, this.section);
  }
  private scopeOf(occurrence: Occurrence, section: CompiledSection): ClockScope {
    if (occurrence.timing === 'timed') return 'slot';
    if (occurrence.timing === 'interval') return 'interval';
    if (occurrence.tasks && section.youGoIGo?.turnMs) return 'turn';
    return section.capMs !== undefined ? 'cap' : 'elapsed';
  }

  readClocks(at = this.now()): ClockValues {
    const delta = this.moving ? Math.max(0, at - this.anchor) : 0;
    const running = this.status === 'running';
    const activeMs = this.activeMs + (running ? delta : 0);
    const sectionMs = this.sectionMs + (running ? delta : 0);
    const phase = this.phaseMs + delta;
    if (this.preparing) {
      const durationMs = this.plan.workout.prepMs;
      const slotMs = Math.min(durationMs, phase);
      const remainingMs = Math.max(0, durationMs - slotMs);
      return { durationMs, remainingMs, fraction: durationMs ? remainingMs / durationMs : 0, slotMs, activeMs, sectionMs };
    }
    const section = this.section;
    const capRemainingMs = section.capMs !== undefined ? Math.max(0, section.capMs - sectionMs) : undefined;
    const turnMs = section.youGoIGo?.turnMs;
    const turnRemainingMs = turnMs && this.isBlock ? Math.max(0, turnMs - phase) : undefined;
    const scope = this.scopeOf(this.occurrence, section);
    let durationMs = 0;
    let remainingMs = 0;
    let slotMs = phase;
    if (scope === 'slot' || scope === 'interval') {
      durationMs = this.occurrence.durationMs;
      slotMs = Math.min(durationMs, phase);
      remainingMs = Math.max(0, durationMs - slotMs);
    } else if (scope === 'turn') { durationMs = turnMs!; remainingMs = turnRemainingMs!; }
    else if (scope === 'cap') { durationMs = section.capMs!; remainingMs = capRemainingMs!; }
    const values: ClockValues = { durationMs, remainingMs, fraction: durationMs ? remainingMs / durationMs : 0, slotMs, activeMs, sectionMs };
    if (capRemainingMs !== undefined) values.capRemainingMs = capRemainingMs;
    if (turnRemainingMs !== undefined) values.turnRemainingMs = turnRemainingMs;
    return values;
  }

  /** The next due boundary, with cap before slot before turn when they coincide. */
  private get nextDue(): Due | undefined {
    if (!this.moving) return;
    if (this.preparing) return { at: this.anchor + this.plan.workout.prepMs - this.phaseMs, kind: 'prep' };
    const section = this.section;
    const candidates: Due[] = [];
    if (section.capMs !== undefined) candidates.push({ at: this.anchor + section.capMs - this.sectionMs, kind: 'cap' });
    if (this.occurrence.timing !== 'manual') candidates.push({ at: this.anchor + this.occurrence.durationMs - this.phaseMs, kind: 'slot' });
    const turnMs = section.youGoIGo?.turnMs;
    if (turnMs && this.isBlock) candidates.push({ at: this.anchor + turnMs - this.phaseMs, kind: 'turn' });
    let due: Due | undefined;
    for (const candidate of candidates) if (!due || candidate.at < due.at) due = candidate;
    return due;
  }
  get nextDeadline(): number | undefined { return this.nextDue?.at; }

  private freeze(at: number) {
    const delta = Math.max(0, at - this.anchor);
    this.phaseMs += delta;
    if (this.status === 'running') { this.activeMs += delta; this.sectionMs += delta; }
    this.anchor = at;
  }
  private emit(type: string, payload?: EventPayload) {
    const sequence = this.events.length + 1;
    const event: EngineEvent = { id: `${this.sessionId}:${sequence}`, sequence, type, occurrenceId: this.occurrenceId, activeMs: this.activeMs };
    if (payload) event.payload = payload;
    this.events.push(event);
    this.revision++;
  }
  private resetOccurrenceState() {
    this.acks = {};
    this.counter = { rounds: 0, reps: 0, history: [] };
    const occurrence = this.occurrence;
    this.turn = occurrence.tasks && this.section.format === 'youGoIGo' ? { athlete: 'A', number: 1, teamRound: 0, skipped: 0 } : undefined;
  }
  private get acknowledged() {
    const completion = this.occurrence.completion ?? 'team';
    return completion === 'team' ? this.acks.team !== undefined : this.acks.A !== undefined && this.acks.B !== undefined;
  }
  private resultFor(section: CompiledSection, outcome: SectionResult['outcome']): SectionResult {
    const result: SectionResult = { sectionId: section.id, format: section.format, outcome, sectionMs: this.sectionMs, unacknowledged: [...this.unacknowledged] };
    if (section.amrap && section.amrap.counter !== 'none') result.counter = { rounds: this.counter.rounds, reps: this.counter.reps };
    if (this.turn) { result.turns = this.turn.number - 1; result.teamRounds = this.turn.teamRound; result.skippedTurns = this.turn.skipped; }
    return result;
  }
  private split(athlete: Athlete | 'team') {
    const split: Split = { occurrenceId: this.occurrenceId, anchor: this.occurrence.anchor, athlete, sectionMs: this.sectionMs, activeMs: this.activeMs };
    if (this.turn) split.turn = this.turn.number;
    this.splits.push(split);
  }

  /** Ends the current occurrence and moves on: next occurrence, a Ready gate, or completion. */
  private advance(endCurrent = true) {
    if (endCurrent) this.emit('occurrenceEnded');
    const previous = this.occurrence;
    const previousSection = this.section;
    const result = this.results[previousSection.id] ?? this.resultFor(previousSection, 'completed'); // before per-occurrence state resets
    if (this.index === this.plan.occurrences.length - 1) {
      this.results[previousSection.id] = result;
      this.status = 'completed';
      this.emit('completed');
      return;
    }
    this.index++;
    this.phaseMs = 0;
    this.resetOccurrenceState();
    if (this.occurrence.sectionIndex !== previous.sectionIndex) {
      this.results[previousSection.id] = result;
      this.sectionMs = 0;
      this.unacknowledged = [];
      if (previousSection.transitionAfter === 'manualReady') {
        this.status = 'awaitingReady';
        this.emit('awaitingReady');
        return;
      }
    }
    this.emit('occurrenceStarted');
  }
  private endSection(outcome: SectionResult['outcome']) {
    const section = this.section;
    this.results[section.id] = this.resultFor(section, outcome);
    this.emit('sectionEnded', { outcome, sectionMs: this.sectionMs });
    this.index = section.endIndex;
    this.advance(false);
  }
  private handoff(reason: 'switch' | 'skip' | 'deadline') {
    const turn = this.turn!;
    this.split(turn.athlete);
    if (reason === 'skip') { turn.skipped++; this.modified = true; }
    if (turn.athlete === 'B') turn.teamRound++;
    turn.athlete = turn.athlete === 'A' ? 'B' : 'A';
    turn.number++;
    this.phaseMs = 0;
    this.emit(reason === 'skip' ? 'turnSkipped' : 'switched', { athlete: turn.athlete, turn: turn.number, teamRound: turn.teamRound });
    const target = this.section.youGoIGo?.rounds;
    if (target && turn.teamRound >= target) this.endSection('completed');
  }

  tick(at = this.now()) {
    for (;;) {
      const due = this.nextDue;
      if (!due || due.at > at) break;
      this.freeze(due.at);
      if (due.kind === 'prep') {
        this.status = 'running';
        this.phaseMs = 0;
        this.emit('occurrenceStarted');
      } else if (due.kind === 'cap') {
        this.emit('capReached', { sectionMs: this.sectionMs });
        this.endSection('capped');
      } else if (due.kind === 'slot') {
        if (this.occurrence.timing === 'interval' && !this.acknowledged) this.unacknowledged.push(this.occurrence.id);
        this.advance();
      } else this.handoff('deadline');
    }
  }

  command(command: Command): boolean {
    const at = this.now();
    this.tick(at); // Deadlines own their boundary before user input is considered.
    if (this.commands.has(command.id) || command.occurrenceId !== this.occurrenceId) return false;
    this.commands.add(command.id);
    const running = this.status === 'running';
    if (command.type === 'play' && this.status === 'ready') {
      this.anchor = at;
      this.status = this.plan.workout.prepMs ? 'preparing' : 'running';
      this.emit(this.preparing ? 'preparing' : 'occurrenceStarted');
      return true;
    }
    if (command.type === 'pause' && this.moving) {
      this.freeze(at);
      this.pausedFrom = this.status as 'running' | 'preparing';
      this.status = 'paused';
      this.pauseReason = command.reason ?? 'user';
      this.modified = true;
      this.emit('paused');
      return true;
    }
    if (command.type === 'resume' && this.status === 'paused') {
      this.anchor = at;
      this.status = this.pausedFrom;
      this.pauseReason = undefined;
      this.emit('resumed');
      return true;
    }
    if (command.type === 'ready' && this.status === 'awaitingReady') {
      this.anchor = at;
      this.status = 'running';
      this.emit('occurrenceStarted');
      return true;
    }
    if (command.type === 'stop' && !['ready', 'completed', 'aborted'].includes(this.status)) {
      if (this.moving) this.freeze(at);
      this.status = 'aborted';
      this.emit('aborted');
      return true;
    }
    if ((command.type === 'next' || command.type === 'previous') && this.canNavigate) {
      const nextIndex = this.index + (command.type === 'next' ? 1 : -1);
      const inSection = nextIndex >= 0 && nextIndex < this.plan.occurrences.length && this.plan.occurrences[nextIndex].sectionIndex === this.occurrence.sectionIndex;
      if (command.type === 'next' && !inSection) return false;
      if (this.moving) this.freeze(at);
      // Previous at a section's first occurrence restarts that occurrence (ENG-05); navigation never leaves the section.
      this.index = inSection ? nextIndex : this.index;
      this.phaseMs = 0;
      this.anchor = at;
      this.visit++;
      this.modified = true;
      this.resetOccurrenceState();
      this.emit('navigated');
      return true;
    }
    if (command.type === 'done' && running && this.canDone) {
      const completion = this.occurrence.completion ?? 'team';
      if (completion === 'team') {
        if (this.acks.team !== undefined) return false;
        this.freeze(at);
        this.acks.team = this.sectionMs;
        this.split('team');
        this.emit('done', { athlete: 'team' });
      } else {
        const athlete = command.athlete;
        if (!athlete || this.acks[athlete] !== undefined) return false;
        this.freeze(at);
        this.acks[athlete] = this.sectionMs;
        this.split(athlete);
        this.emit('done', { athlete });
      }
      if (this.occurrence.timing === 'manual' && this.acknowledged) this.advance();
      return true;
    }
    if (command.type === 'finish' && running && FINISHABLE.includes(this.section.format)) {
      this.freeze(at);
      const section = this.section;
      if (section.format === 'forTime' || section.format === 'strength') {
        const last = this.index === section.endIndex;
        if (last && !this.isBlock && this.occurrence.timing === 'manual' && !this.acknowledged) {
          // Finishing on the final task counts as its Done.
          this.acks.team = this.sectionMs;
          this.split('team');
          this.emit('done', { athlete: 'team' });
          this.advance();
          return true;
        }
        this.modified = true;
      }
      this.endSection('finished');
      return true;
    }
    if ((command.type === 'switch' || command.type === 'skipTurn') && running && this.canSwitch) {
      this.freeze(at);
      this.handoff(command.type === 'switch' ? 'switch' : 'skip');
      return true;
    }
    if (command.type === 'count' && running && this.canCount) {
      const unit = command.unit ?? 'round';
      if (unit === 'rep' && this.section.amrap?.counter !== 'roundsAndReps') return false;
      this.freeze(at);
      if (unit === 'round') {
        this.counter.history.push({ unit, delta: 1, previousReps: this.counter.reps });
        this.counter.rounds++;
        this.counter.reps = 0;
      } else {
        const delta = Math.min(1000, Math.max(1, Math.round(command.delta ?? 1)));
        this.counter.history.push({ unit, delta, previousReps: this.counter.reps });
        this.counter.reps += delta;
      }
      this.emit('counted', { rounds: this.counter.rounds, reps: this.counter.reps });
      return true;
    }
    if (command.type === 'undoCount' && running && this.canCount && this.counter.history.length) {
      this.freeze(at);
      const step = this.counter.history.pop()!;
      if (step.unit === 'round') this.counter.rounds--;
      this.counter.reps = step.unit === 'round' ? step.previousReps : this.counter.reps - step.delta;
      this.emit('countUndone', { rounds: this.counter.rounds, reps: this.counter.reps });
      return true;
    }
    return false;
  }

  private get canNavigate() {
    return (this.status === 'running' || (this.status === 'paused' && this.pausedFrom === 'running')) && this.section.format !== 'emom' && !this.isBlock;
  }
  private get canDone() { return !this.isBlock && this.occurrence.timing !== 'timed'; }
  private get canSwitch() { return this.isBlock && this.section.format === 'youGoIGo'; }
  private get canCount() { return this.isBlock && this.section.format === 'amrap' && this.section.amrap?.counter !== 'none'; }

  private controls(): Control[] {
    const controls: Control[] = [];
    if (this.status === 'ready') return ['play'];
    if (this.status === 'completed' || this.status === 'aborted') return controls;
    if (this.status === 'awaitingReady') return ['ready', 'stop'];
    if (this.status === 'paused') controls.push('resume', 'stop');
    else controls.push('pause', 'stop');
    if (this.canNavigate) {
      controls.push('previous');
      if (this.index < this.section.endIndex) controls.push('next');
    }
    if (this.status !== 'running') return controls;
    if (this.canDone) {
      if ((this.occurrence.completion ?? 'team') === 'team') { if (this.acks.team === undefined) controls.push('done'); }
      else {
        if (this.acks.A === undefined) controls.push('done:A');
        if (this.acks.B === undefined) controls.push('done:B');
      }
    }
    if (FINISHABLE.includes(this.section.format)) controls.push('finish');
    if (this.canSwitch) controls.push('switch', 'skipTurn');
    if (this.canCount) {
      controls.push('count:round');
      if (this.section.amrap?.counter === 'roundsAndReps') controls.push('count:rep');
      if (this.counter.history.length) controls.push('undoCount');
    }
    return controls;
  }

  project(): Projection {
    let nextWork: Occurrence | undefined;
    let restBeforeNextMs = 0;
    const includeCurrent = this.preparing || this.status === 'ready' || this.status === 'awaitingReady';
    if (!['completed', 'aborted'].includes(this.status)) {
      for (let index = this.index + (includeCurrent ? 0 : 1); index < this.plan.occurrences.length; index++) {
        const item = this.plan.occurrences[index];
        if (item.phase === 'work') { nextWork = item; break; }
        restBeforeNextMs += item.durationMs;
      }
    }
    const section = this.section;
    const occurrence = this.occurrence;
    const projection: Projection = {
      sessionId: this.sessionId, status: this.status, occurrenceId: this.occurrenceId, current: occurrence, nextWork, restBeforeNextMs, section, index: this.index, modified: this.modified, pauseReason: this.pauseReason,
      format: section.format, timing: occurrence.timing, clockScope: this.clockScope, controls: this.controls(),
      acks: { A: this.acks.A !== undefined, B: this.acks.B !== undefined, team: this.acks.team !== undefined },
      results: this.plan.sections.map(item => this.results[item.id]).filter((item): item is SectionResult => Boolean(item)),
    };
    if (occurrence.tasks) projection.tasks = occurrence.tasks;
    if (this.canCount) projection.counter = { rounds: this.counter.rounds, reps: this.counter.reps, canUndo: this.counter.history.length > 0 };
    if (this.turn) projection.turn = { ...this.turn, roundsTarget: section.youGoIGo?.rounds };
    if (occurrence.interval) projection.interval = occurrence.interval;
    if (section.capMs !== undefined) projection.capMs = section.capMs;
    return projection;
  }

  /** Serialisable state at `at`; never stores the clock anchor, so a restore can use any clock. */
  toJSON(at = this.now()): EngineSnapshot {
    const delta = this.moving ? Math.max(0, at - this.anchor) : 0;
    const running = this.status === 'running';
    return {
      version: 1, sessionId: this.sessionId, status: this.status, pausedFrom: this.pausedFrom, index: this.index, visit: this.visit,
      phaseMs: this.phaseMs + delta, activeMs: this.activeMs + (running ? delta : 0), sectionMs: this.sectionMs + (running ? delta : 0),
      modified: this.modified, pauseReason: this.pauseReason,
      acks: { ...this.acks }, counter: structuredClone(this.counter), turn: this.turn ? { ...this.turn } : undefined,
      results: structuredClone(this.results), splits: structuredClone(this.splits), unacknowledged: [...this.unacknowledged],
      commandIds: [...this.commands], events: structuredClone(this.events), revision: this.revision,
    };
  }

  /** Restores a snapshot paused (ENG-12): a moving snapshot comes back as paused with reason `recovered`, never auto-resumed. */
  static fromSnapshot(plan: ExecutionPlan, snapshot: EngineSnapshot, now: () => number): WorkoutEngine {
    const engine = new WorkoutEngine(plan, now, snapshot.sessionId);
    engine.index = snapshot.index;
    engine.visit = snapshot.visit;
    engine.phaseMs = snapshot.phaseMs;
    engine.activeMs = snapshot.activeMs;
    engine.sectionMs = snapshot.sectionMs;
    engine.modified = snapshot.modified;
    engine.pausedFrom = snapshot.pausedFrom;
    engine.acks = { ...snapshot.acks };
    engine.counter = structuredClone(snapshot.counter);
    engine.turn = snapshot.turn ? { ...snapshot.turn } : undefined;
    engine.results = structuredClone(snapshot.results);
    engine.splits = structuredClone(snapshot.splits);
    engine.unacknowledged = [...snapshot.unacknowledged];
    engine.commands = new Set(snapshot.commandIds);
    engine.events.push(...structuredClone(snapshot.events));
    engine.revision = snapshot.revision;
    engine.anchor = now();
    if (snapshot.status === 'running' || snapshot.status === 'preparing') {
      engine.pausedFrom = snapshot.status;
      engine.status = 'paused';
      engine.pauseReason = 'recovered';
      engine.modified = true;
      engine.emit('recovered');
    } else {
      engine.status = snapshot.status;
      engine.pauseReason = snapshot.pauseReason;
    }
    return engine;
  }
}

export function displayTime(ms: number, rounding: 'ceil' | 'floor' = 'ceil'): string {
  const seconds = Math[rounding](Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export interface WarningMarks { amberMs: number; redMs: number }
export const DEFAULT_WARNING_MARKS: WarningMarks = { amberMs: 10_000, redMs: 3000 };
/** Amber and red marks, capped to a quarter and a tenth of the slot so short intervals do not spend their whole length in warning (UI-13). */
/**
 * How deep the background pulse is, 0..1: the slot is three segments (work until the first marker, first marker
 * until the second, second marker until the end), and within each the intensity climbs from nothing to full shortly
 * before the segment ends (at 90 % of it), so every colour arrives soft and leaves at full strength.
 */
export function washDrain(remainingMs: number, durationMs: number, marks: WarningMarks = DEFAULT_WARNING_MARKS): number {
  if (!(durationMs > 0)) return 0;
  const amber = Math.min(marks.amberMs, durationMs * .25);
  const red = Math.min(marks.redMs, durationMs * .1);
  const remaining = Math.max(0, Math.min(remainingMs, durationMs));
  const [length, elapsed] = remaining > amber ? [durationMs - amber, durationMs - remaining] : remaining > red ? [amber - red, amber - remaining] : [red, red - remaining];
  return length > 0 ? Math.min(1, elapsed / (length * .9)) : 1;
}

export function warningLevel(remainingMs: number, durationMs: number, marks: WarningMarks = DEFAULT_WARNING_MARKS): 'normal' | 'amber' | 'red' {
  if (remainingMs <= Math.min(marks.redMs, durationMs * .1)) return 'red';
  if (remainingMs <= Math.min(marks.amberMs, durationMs * .25)) return 'amber';
  return 'normal';
}
