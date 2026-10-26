import type { ExecutionPlan, Occurrence } from '../../domain/src/compiler';

export type Status = 'ready' | 'preparing' | 'running' | 'paused' | 'awaitingReady' | 'completed' | 'aborted';
export type CommandType = 'play' | 'pause' | 'resume' | 'next' | 'previous' | 'stop' | 'ready';
export interface Command { id: string; occurrenceId: string; type: CommandType; reason?: 'user' | 'hidden' }
export interface EngineEvent { id: string; sequence: number; type: string; occurrenceId: string; activeMs: number }
export interface ClockValues { remainingMs: number; durationMs: number; fraction: number; activeMs: number; sectionMs: number; slotMs: number }
export interface Projection {
  sessionId: string;
  status: Status;
  occurrenceId: string;
  current: Occurrence;
  nextWork?: Occurrence;
  restBeforeNextMs: number;
  section: ExecutionPlan['sections'][number];
  index: number;
  modified: boolean;
  pauseReason?: 'user' | 'hidden';
}

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
  private pauseReason?: 'user' | 'hidden';
  private commands = new Set<string>();

  constructor(readonly plan: ExecutionPlan, private now: () => number, readonly sessionId = 'session') {}

  private get occurrence() { return this.plan.occurrences[this.index]; }
  get occurrenceId() {
    if (this.status === 'ready') return 'ready';
    if (this.status === 'preparing' || (this.status === 'paused' && this.pausedFrom === 'preparing')) return 'prep';
    return `${this.occurrence.id}/visit:${this.visit}`;
  }
  private get preparing() { return this.status === 'preparing' || (this.status === 'paused' && this.pausedFrom === 'preparing'); }
  private get moving() { return this.status === 'running' || this.status === 'preparing'; }

  readClocks(at = this.now()): ClockValues {
    const delta = this.moving ? Math.max(0, at - this.anchor) : 0;
    const durationMs = this.preparing ? this.plan.workout.prepMs : this.occurrence.durationMs;
    const slotMs = Math.min(durationMs, this.phaseMs + delta);
    const remainingMs = Math.max(0, durationMs - slotMs);
    return { durationMs, remainingMs, fraction: durationMs ? remainingMs / durationMs : 0, slotMs, activeMs: this.activeMs + (this.status === 'running' ? delta : 0), sectionMs: this.sectionMs + (this.status === 'running' ? delta : 0) };
  }

  get nextDeadline(): number | undefined {
    if (!this.moving) return;
    return this.anchor + (this.preparing ? this.plan.workout.prepMs : this.occurrence.durationMs) - this.phaseMs;
  }

  private freeze(at: number) {
    const delta = Math.max(0, at - this.anchor);
    this.phaseMs += delta;
    if (this.status === 'running') { this.activeMs += delta; this.sectionMs += delta; }
    this.anchor = at;
  }
  private emit(type: string) {
    const sequence = this.events.length + 1;
    this.events.push({ id: `${this.sessionId}:${sequence}`, sequence, type, occurrenceId: this.occurrenceId, activeMs: this.activeMs });
    this.revision++;
  }

  tick(at = this.now()) {
    while (this.nextDeadline !== undefined && this.nextDeadline <= at) {
      const boundary = this.nextDeadline;
      this.freeze(boundary);
      if (this.status === 'preparing') {
        this.status = 'running';
        this.phaseMs = 0;
        this.emit('occurrenceStarted');
        continue;
      }
      this.emit('occurrenceEnded');
      if (this.index === this.plan.occurrences.length - 1) {
        this.status = 'completed';
        this.emit('completed');
        break;
      }
      const previous = this.occurrence;
      this.index++;
      this.phaseMs = 0;
      if (this.occurrence.sectionIndex !== previous.sectionIndex) {
        this.sectionMs = 0;
        if (this.plan.sections[previous.sectionIndex].transitionAfter === 'manualReady') {
          this.status = 'awaitingReady';
          this.emit('awaitingReady');
          break;
        }
      }
      this.emit('occurrenceStarted');
    }
  }

  command(command: Command): boolean {
    const at = this.now();
    this.tick(at); // Deadlines own their boundary before user input is considered.
    if (this.commands.has(command.id) || command.occurrenceId !== this.occurrenceId) return false;
    this.commands.add(command.id);
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
    if ((command.type === 'next' || command.type === 'previous') && (this.status === 'running' || (this.status === 'paused' && this.pausedFrom === 'running'))) {
      const nextIndex = this.index + (command.type === 'next' ? 1 : -1);
      if (nextIndex < 0 || nextIndex >= this.plan.occurrences.length || this.plan.occurrences[nextIndex].sectionIndex !== this.occurrence.sectionIndex) return false;
      if (this.moving) this.freeze(at);
      this.index = nextIndex;
      this.phaseMs = 0;
      this.anchor = at;
      this.visit++;
      this.modified = true;
      this.emit('navigated');
      return true;
    }
    return false;
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
    return { sessionId: this.sessionId, status: this.status, occurrenceId: this.occurrenceId, current: this.occurrence, nextWork, restBeforeNextMs, section: this.plan.sections[this.occurrence.sectionIndex], index: this.index, modified: this.modified, pauseReason: this.pauseReason };
  }
}

export function displayTime(ms: number, rounding: 'ceil' | 'floor' = 'ceil'): string {
  const seconds = Math[rounding](Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function warningLevel(remainingMs: number, durationMs: number): 'normal' | 'amber' | 'red' {
  if (remainingMs <= Math.min(3000, durationMs * .1)) return 'red';
  if (remainingMs <= Math.min(10_000, durationMs * .25)) return 'amber';
  return 'normal';
}
