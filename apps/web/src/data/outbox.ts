import { mergeMasterData, type MasterData } from '../../../../packages/domain/src/master-data';
import type { Workout } from '../../../../packages/domain/src/schema';
import type { SessionRecord } from '../../../../packages/engine/src/records';
import { ApiError, NetworkError } from './client';
import { backend } from './backend';
import { idbDelete, idbGetAll, idbPut, StorageUnavailableError, transaction } from './idb';

/**
 * Writes that have not reached the server yet (DAT-02/03). Every item is idempotent on the server side: sessions by
 * id, workouts and master data by expected revision. The flush is single-flight, retries with backoff, and never
 * blocks the player.
 */
export type OutboxKind = 'session' | 'workout' | 'archive' | 'master' | 'deleteSession';
export type OutboxState = 'pending' | 'rejected' | 'conflict';
export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  /** The session record, the workout document, the archived or deleted id, or the master-data document. */
  body: SessionRecord | Workout | { id: string } | MasterData;
  expectedRevision?: number;
  createdAt: string;
  attempts: number;
  nextAttemptAt: number;
  state: OutboxState;
  error?: string;
  /** On a workout conflict: what the server holds now. */
  current?: { revision: number; document?: Workout };
}

export const MASTER_ITEM_ID = 'master';
export const outboxEvents = new EventTarget();
const notify = () => outboxEvents.dispatchEvent(new Event('change'));

/** 2 s, 4 s, 8 s … capped at one minute. */
export const nextDelay = (attempts: number) => Math.min(60_000, 2000 * 2 ** Math.max(0, attempts - 1));

export type Failure = 'retry' | 'rejected' | 'conflict';
/** Network and server errors are retried; a validation error never will succeed; a revision conflict needs a decision. */
export function classifyFailure(error: unknown): Failure {
  if (error instanceof NetworkError) return 'retry';
  if (error instanceof ApiError) return error.status === 409 ? 'conflict' : error.status >= 500 ? 'retry' : 'rejected';
  return 'retry';
}

export const listOutbox = (): Promise<OutboxItem[]> => idbGetAll<OutboxItem>('outbox').then(items => items.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
export const removeOutboxItem = (id: string) => idbDelete('outbox', id).then(notify);
/** The outbox id of a finished session's upload (checkpoints.ts finishSession) and of its deletion. */
export const sessionItemId = (sessionId: string) => `session:${sessionId}`;
export const deleteSessionItemId = (sessionId: string) => `delete-session:${sessionId}`;
/** Drops every queued write (after a restore replaced the household they were meant for). */
export const clearOutbox = () => transaction(['outbox'], 'readwrite', get => { get('outbox').clear(); }).then(notify);

export async function enqueue(item: Omit<OutboxItem, 'createdAt' | 'attempts' | 'nextAttemptAt' | 'state'>): Promise<void> {
  await idbPut('outbox', { ...item, createdAt: new Date().toISOString(), attempts: 0, nextAttemptAt: 0, state: 'pending' } satisfies OutboxItem);
  notify();
}

/** Re-queues a conflicted or rejected item with a new body (after the user decided). */
export async function requeue(item: OutboxItem, changes: Partial<OutboxItem>): Promise<void> {
  await idbPut('outbox', { ...item, ...changes, attempts: 0, nextAttemptAt: 0, state: 'pending', error: undefined, current: undefined } satisfies OutboxItem);
  notify();
}

export interface FlushResult { uploaded: OutboxItem[]; failed: OutboxItem[]; skipped: number }
let inFlight: Promise<FlushResult> | undefined;

/** Uploads every pending item whose retry time has come. Safe to call from anywhere; concurrent calls share one run. */
export function flush(now = Date.now()): Promise<FlushResult> {
  inFlight ??= run(now).finally(() => { inFlight = undefined; });
  return inFlight;
}

async function run(now: number): Promise<FlushResult> {
  const result: FlushResult = { uploaded: [], failed: [], skipped: 0 };
  let items: OutboxItem[];
  try { items = await listOutbox(); } catch (error) { if (error instanceof StorageUnavailableError) return result; throw error; }
  for (const item of items) {
    if (item.state !== 'pending' || item.nextAttemptAt > now) { result.skipped++; continue; }
    try {
      await upload(item);
      await idbDelete('outbox', item.id);
      result.uploaded.push(item);
    } catch (error) {
      const failure = classifyFailure(error);
      const message = error instanceof Error ? error.message : String(error);
      const attempts = item.attempts + 1;
      const next: OutboxItem = failure === 'retry'
        ? { ...item, attempts, nextAttemptAt: now + nextDelay(attempts), error: message }
        : { ...item, attempts, state: failure, error: message, ...(error instanceof ApiError && error.payload?.current ? { current: error.payload.current as OutboxItem['current'] } : {}) };
      await idbPut('outbox', next);
      result.failed.push(next);
      if (failure === 'retry') { result.skipped += items.length - items.indexOf(item) - 1; break; } // The server is away: stop hammering it this round.
    }
  }
  if (result.uploaded.length || result.failed.length) notify();
  return result;
}

async function upload(item: OutboxItem): Promise<void> {
  switch (item.kind) {
    case 'session': await backend.putSession(item.body as SessionRecord); return;
    case 'workout': await backend.putWorkout(item.body as Workout, item.expectedRevision ?? 0); return;
    case 'archive': await backend.archiveWorkout((item.body as { id: string }).id, item.expectedRevision); return;
    case 'deleteSession': await backend.deleteSession((item.body as { id: string }).id); return;
    case 'master': {
      try { await backend.putMasterData(item.body as MasterData, item.expectedRevision ?? 0); } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
        // Someone else saved settings meanwhile: fold ours on top of theirs and try once more.
        const server = await backend.getMasterData();
        await backend.putMasterData(mergeMasterData(item.body as MasterData, server.document), server.revision);
      }
      return;
    }
  }
}
