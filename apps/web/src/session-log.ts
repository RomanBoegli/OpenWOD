import type { SessionOutcome, SessionRecord } from '../../../packages/engine/src/records';
export type { SessionRecord, SessionOutcome } from '../../../packages/engine/src/records';

/**
 * Sessions on this device: logged when a workout finishes, was played to at least 80 % of its timed or capped
 * length, or was recovered from a checkpoint. The household server keeps the authoritative history; browser
 * storage holds the records written before the server milestone until they are moved.
 */

const KEY = 'openwod.sessions.v1';
export const SESSION_LIMIT = 500;
export const DONE_THRESHOLD = 0.8;

export function loadSessions(): SessionRecord[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter((item): item is SessionRecord => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.workoutId === 'string' && typeof item.finishedAt === 'string' && typeof item.activeMs === 'number')).slice(0, SESSION_LIMIT);
  } catch { return []; }
}

/** Does a session count as done? Completed always; an ended session when it covered enough of a known-length workout. */
export function countsAsDone(outcome: SessionOutcome, activeMs: number, plannedMs: number, open: boolean): boolean {
  if (outcome === 'completed' || outcome === 'capped') return true;
  if (open || plannedMs <= 0) return false;
  return activeMs / plannedMs >= DONE_THRESHOLD;
}

export type SessionSummary = Pick<SessionRecord, 'id' | 'workoutId' | 'finishedAt' | 'outcome' | 'completion'>;
/** A session counts as done on the cards when it finished or covered enough of the plan; an abandoned one is history, not a tick. */
export const isDone = (session: Pick<SessionRecord, 'outcome' | 'completion'>) => session.outcome !== 'aborted' || session.completion >= DONE_THRESHOLD;

export function lastDone<T extends SessionSummary>(sessions: T[], workoutId: string): T | undefined {
  return sessions.filter(item => item.workoutId === workoutId && isDone(item)).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))[0];
}

export function timesDone(sessions: SessionSummary[], workoutId: string): number {
  return sessions.filter(item => item.workoutId === workoutId && isDone(item)).length;
}

/** "today", "3 days ago", "2 months ago". */
export function agoText(iso: string, now = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}
