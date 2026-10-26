import type { SectionResult } from '../../../packages/engine/src';

/**
 * Completed sessions on this device, logged behind the scenes when a workout finishes or was played to at least 80 %
 * of its timed or capped length. The server milestone moves these into SQLite; until then they are a convenience.
 */
export interface SessionRecord {
  id: string;
  workoutId: string;
  title: string;
  startedAt: string;
  finishedAt: string;
  outcome: 'completed' | 'aborted';
  /** Share of the planned duration that was played (1 for completed, otherwise activeMs / planned). */
  completion: number;
  activeMs: number;
  results: SectionResult[];
}

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

export function persistSessions(sessions: SessionRecord[]): string | undefined {
  try { localStorage.setItem(KEY, JSON.stringify(sessions)); return undefined; } catch { return 'This device could not save the session log.'; }
}

/** Does a session count as done? Completed always; an ended session when it covered enough of a known-length workout. */
export function countsAsDone(outcome: SessionRecord['outcome'], activeMs: number, plannedMs: number, open: boolean): boolean {
  if (outcome === 'completed') return true;
  if (open || plannedMs <= 0) return false;
  return activeMs / plannedMs >= DONE_THRESHOLD;
}

export function lastDone(sessions: SessionRecord[], workoutId: string): SessionRecord | undefined {
  return sessions.filter(item => item.workoutId === workoutId).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))[0];
}

export function timesDone(sessions: SessionRecord[], workoutId: string): number {
  return sessions.filter(item => item.workoutId === workoutId).length;
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
