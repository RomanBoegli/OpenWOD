import { useCallback, useEffect, useRef, useState } from 'react';
import { adoptSession, type Checkpoint, type Recovery } from './checkpoints';
import { ApiError } from './client';
import { StorageUnavailableError } from './idb';
import { controlledElsewhere, handoverNote, HANDOVER, liveSessions, type LiveSessionItem } from './live-sessions';

/**
 * The household's running sessions as this device sees them (ENG-15): the ones another device controls, which this
 * one may continue. Read at start, whenever the user comes back (visible, focus, online) and every ten seconds while
 * the page is visible, so a session started elsewhere shows up without a reload. The static shape has no server and
 * therefore no hand-over: the list stays empty and nothing is ever requested.
 */
export interface LiveSessions {
  /** Sessions running on other devices, the one heard from last first. This device's own session is never listed. */
  sessions: LiveSessionItem[];
  /** How long ago the server last heard from the session's device, by the server's clock, so two device clocks never have to agree. */
  ageMs: (session: LiveSessionItem) => number;
  /**
   * Claims the session for this device and writes it into this device's checkpoints, where the ordinary recovery
   * finds it and restores it paused (ENG-12). The checkpoint notes the device it came from (`handover`), so the player
   * can say so when it asks before continuing. The other device steps aside at its next save. Resolves with what was
   * taken over, or with undefined and a `notice` when it could not be.
   */
  continueHere: (id: string) => Promise<Recovery | undefined>;
  /** Removes a live session from the server for every device, for one whose device is gone. A session still running somewhere appears again. */
  discard: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  /** Why the last `continueHere` or `discard` failed. */
  notice: string;
  clearNotice: () => void;
}

/** What a screen needs to offer the sessions other devices run: the list, how old each is, and the claim that opens one here. */
export type LiveOffers = Pick<LiveSessions, 'sessions' | 'ageMs'> & { onContinue: (sessionId: string) => Promise<void> };

const POLL_MS = 10_000;
const GONE = 'That session is no longer running. It was finished or discarded.';
const NO_STORAGE = 'This browser cannot store anything, so the session cannot continue here. Take it back on the other device.';
const reason = (error: unknown) => error instanceof StorageUnavailableError ? NO_STORAGE : error instanceof ApiError && (error.status === 404 || error.status === 409) ? GONE : error instanceof Error ? error.message : String(error);

export function useLiveSessions(): LiveSessions {
  const [sessions, setSessions] = useState<LiveSessionItem[]>([]);
  const latest = useRef(sessions);
  latest.current = sessions;
  const [notice, setNotice] = useState('');
  /** The server's clock minus this device's, from the last answer. */
  const offset = useRef(0);
  /** Counts the fetches, so only the newest answer is shown and none after the hook is gone. */
  const turn = useRef(0);

  const refresh = useCallback(async () => {
    if (!HANDOVER) return;
    const mine = ++turn.current;
    try {
      const list = await liveSessions.list();
      if (mine !== turn.current) return;
      const skew = Date.parse(list.now) - Date.now();
      offset.current = Number.isFinite(skew) ? skew : 0;
      const next = controlledElsewhere(list.sessions);
      // An empty list keeps its identity, so a poll that found nothing renders nothing. One with sessions renders
      // every time: the age shown beside a session moves on even when the session itself did not.
      setSessions(current => current.length || next.length ? next : current);
    } catch (error) {
      // Offline, the last list stays (a claim would say so). A server that does not know the route has no live sessions.
      if (mine === turn.current && error instanceof ApiError) setSessions(current => current.length ? [] : current);
    }
  }, []);

  useEffect(() => {
    if (!HANDOVER) return;
    void refresh();
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const again = () => { void refresh(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', again);
    window.addEventListener('online', again);
    const timer = setInterval(visible, POLL_MS);
    return () => { turn.current++; document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', again); window.removeEventListener('online', again); clearInterval(timer); };
  }, [refresh]);

  const ageMs = useCallback((session: LiveSessionItem) => Math.max(0, Date.now() + offset.current - Date.parse(session.updatedAt)), []);

  const continueHere = useCallback(async (id: string): Promise<Recovery | undefined> => {
    if (!HANDOVER) return undefined;
    try {
      // The claim answers with the new controller, so the device the session comes from is read before it.
      const from = latest.current.find(item => item.id === id) ?? await liveSessions.get(id).catch(() => undefined);
      const claimed = await liveSessions.claim(id);
      const progress = claimed.progress?.checkpointRevision === claimed.checkpoint.revision ? claimed.progress : undefined;
      const handover = handoverNote(from, offset.current);
      const checkpoint: Checkpoint = { ...claimed.checkpoint, ...(handover ? { handover } : {}) };
      await adoptSession(checkpoint, progress);
      // This device controls it now. The list must say so at once, even if the read below fails: a player that still
      // found its own session listed under another device would step aside for a controller that is itself.
      setSessions(current => current.filter(item => item.id !== id));
      setNotice('');
      return { checkpoint, ...(progress ? { progress } : {}) };
    } catch (error) {
      setNotice(reason(error));
      return undefined;
    } finally { await refresh(); }
  }, [refresh]);

  const discard = useCallback(async (id: string) => {
    if (!HANDOVER) return;
    setSessions(current => current.filter(item => item.id !== id));
    try { await liveSessions.remove(id); setNotice(''); } catch (error) { setNotice(reason(error)); }
    await refresh();
  }, [refresh]);

  const clearNotice = useCallback(() => setNotice(''), []);

  return { sessions, ageMs, continueHere, discard, refresh, notice, clearNotice };
}
