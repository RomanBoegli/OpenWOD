import type { Workout } from '../../../../packages/domain/src/schema';
import type { EngineSnapshot, Status } from '../../../../packages/engine/src';
import type { SessionRecord } from '../../../../packages/engine/src/records';
import { idbGetAll, idbPut, transaction } from './idb';
import { outboxEvents, type OutboxItem } from './outbox';

/**
 * Durable session state on this device (ENG-11/12, DAT-02): a full checkpoint after every accepted command and
 * transition, plus a small progress record about once a second that names the checkpoint it extends. Recovery
 * applies a progress record only to its own checkpoint, so incompatible records are never combined.
 */
export interface Checkpoint {
  sessionId: string;
  workoutId: string;
  workoutRevision: number;
  /** The workout as it is being played; an edit to the library never changes a running session (AT-14). */
  workout: Workout;
  snapshot: EngineSnapshot;
  revision: number;
  status: Status;
  savedAt: string;
  startedAt?: string;
}
export interface Progress { sessionId: string; checkpointRevision: number; phaseMs: number; activeMs: number; sectionMs: number; savedAt: string }
export interface Recovery { checkpoint: Checkpoint; progress?: Progress }
export type CheckpointStatus = 'unknown' | 'ok' | 'failed';

/** Keeps only the latest value and writes it after the one in flight; the timing path never waits on it. */
export class WriteQueue<T> {
  private latest: T | undefined;
  private inFlight: Promise<void> | undefined;
  private failed = false;
  constructor(private readonly write: (value: T) => Promise<void>, private readonly onStatus: (status: CheckpointStatus, error?: unknown) => void) {}
  push(value: T) {
    this.latest = value;
    if (!this.inFlight) this.inFlight = this.drain();
  }
  private async drain() {
    while (this.latest !== undefined) {
      const value = this.latest;
      this.latest = undefined;
      try { await this.write(value); if (this.failed) { this.failed = false; } this.onStatus('ok'); } catch (error) { if (!this.failed) { this.failed = true; this.onStatus('failed', error); } }
    }
    this.inFlight = undefined;
  }
  async flush() { while (this.inFlight) await this.inFlight; }
}

export const writeCheckpoint = (checkpoint: Checkpoint) => idbPut('checkpoints', checkpoint);
export const writeProgress = (progress: Progress) => idbPut('progress', progress);

/** Sessions that were moving when the page went away, newest first. */
export async function listRecoveries(): Promise<Recovery[]> {
  const [checkpoints, progress] = await Promise.all([idbGetAll<Checkpoint>('checkpoints'), idbGetAll<Progress>('progress')]);
  return checkpoints
    .filter(checkpoint => checkpoint.status !== 'completed' && checkpoint.status !== 'aborted' && checkpoint.status !== 'ready')
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .map(checkpoint => { const record = progress.find(item => item.sessionId === checkpoint.sessionId); return { checkpoint, ...(record && record.checkpointRevision === checkpoint.revision ? { progress: record } : {}) }; });
}

/** Applies a progress record to the checkpoint it names: only the clock offsets move, nothing else. */
export function applyProgress(snapshot: EngineSnapshot, progress?: Progress): EngineSnapshot {
  if (!progress || progress.checkpointRevision !== snapshot.revision || progress.activeMs < snapshot.activeMs) return snapshot;
  return { ...snapshot, phaseMs: progress.phaseMs, activeMs: progress.activeMs, sectionMs: progress.sectionMs };
}

export const clearSession = (sessionId: string) => transaction(['checkpoints', 'progress'], 'readwrite', get => { get('checkpoints').delete(sessionId); get('progress').delete(sessionId); });

/** Ends a session on this device in one transaction: its checkpoint and progress go, its record (if any) enters the outbox. */
export async function finishSession(sessionId: string, record?: SessionRecord): Promise<void> {
  await transaction(['checkpoints', 'progress', 'outbox'], 'readwrite', get => {
    get('checkpoints').delete(sessionId);
    get('progress').delete(sessionId);
    if (record) get('outbox').put({ id: `session:${record.id}`, kind: 'session', body: record, createdAt: new Date().toISOString(), attempts: 0, nextAttemptAt: 0, state: 'pending' } satisfies OutboxItem);
  });
  if (record) outboxEvents.dispatchEvent(new Event('change'));
}


/** "just now", "4 min ago", "2 h ago", "3 days ago". */
export function elapsedText(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
