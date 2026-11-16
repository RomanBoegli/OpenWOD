import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compileWorkout } from '../../../packages/domain/src/compiler';
import type { Workout } from '../../../packages/domain/src';
import { WorkoutEngine, type ClockValues, type Command, type CommandType, type Status } from '../../../packages/engine/src';
import type { WorkoutAudio } from './audio';
import { newId } from './ids';
import { applyProgress, lastSaved, writeCheckpoint, writeProgress, WriteQueue, type Checkpoint, type CheckpointStatus, type Progress, type Recovery } from './data/checkpoints';
import { liveUplink, type LiveController } from './data/live-sessions';

declare global {
  interface Window {
    __openwodTest?: { advance: (ms: number) => void; snapshot: () => { projection: ReturnType<WorkoutEngine['project']>; clocks: ClockValues; events: WorkoutEngine['events'] }; command: (type: CommandType, extra?: Partial<Command>) => boolean; flushCheckpoints: () => Promise<void>; checkpointRevision: () => number };
  }
}

export interface WorkoutOptions {
  /** A checkpoint to restore instead of starting fresh; the engine comes back paused with reason `recovered`. */
  recovery?: Recovery;
}

const PROGRESS_INTERVAL_MS = 1000;
/** While running, the progress record also goes to the household server this often (ENG-15), counted on the engine's clock. */
const UPLINK_INTERVAL_MS = 3000;

/** Hosts one engine per session: schedules its next deadline, feeds audio and clock subscribers, writes checkpoints, and owns platform concerns. */
export function useWorkout(workout: Workout, audio: WorkoutAudio, options: WorkoutOptions = {}) {
  // The recovery applies to the first engine only; later renders may drop it without restarting the session.
  const [recovery] = useState(options.recovery);
  const clockOffset = useRef(0);
  const [session, setSession] = useState(0);
  const [checkpointStatus, setCheckpointStatus] = useState<CheckpointStatus>('unknown');
  // Browser tests advance only this injected clock; time spent waiting for UI or storage never moves it.
  const now = useCallback(() => __OPENWOD_TEST__ ? clockOffset.current : performance.now(), []);
  // One engine per (workout, session). Compile and session identity happen exactly once per session; a recovery only applies to the first.
  // `restoredRevision` is the revision a restored engine came back with: until it moves, no command has been taken since.
  const { engine, restoredRevision } = useMemo(() => {
    const plan = compileWorkout(workout);
    if (!recovery || session !== 0) return { engine: new WorkoutEngine(plan, now, newId()), restoredRevision: -1 };
    const restored = WorkoutEngine.fromSnapshot(plan, applyProgress(structuredClone(recovery.checkpoint.snapshot), recovery.progress), now);
    return { engine: restored, restoredRevision: restored.revision };
  }, [workout, session, recovery, now]);
  const startedAt = useRef<string | undefined>(recovery?.checkpoint.startedAt);
  // Checkpoints and progress records are written off the timing path; the first failure is reported once (AT-16).
  const queues = useMemo(() => {
    const report = (status: CheckpointStatus) => setCheckpointStatus(current => current === 'failed' && status === 'ok' ? 'ok' : status);
    return { checkpoint: new WriteQueue<Checkpoint>(writeCheckpoint, report), progress: new WriteQueue<Progress>(writeProgress, report) };
  }, []);
  // The household server gets every checkpoint too and, every few seconds, the progress record, so another device can
  // continue the session (ENG-15). One uplink per session; the clock never waits for it, and a failed send is not this
  // device's storage failing. It answers when another device has taken the session, or has finished it already.
  const [elsewhere, setElsewhere] = useState<{ sessionId: string; controller?: LiveController }>();
  const uplink = useMemo(() => liveUplink({ onTakenOver: controller => setElsewhere({ sessionId: engine.sessionId, controller }), onFinished: () => setElsewhere({ sessionId: engine.sessionId }) }), [engine]);
  /** The session this player has handed over (another tab or device controls it): it writes and commands nothing any more. */
  const detached = useRef<string>(undefined);
  const lastCheckpoint = useRef<Checkpoint>(undefined);
  const lastProgress = useRef(0);
  const lastUplink = useRef(0);
  const checkpointRevision = useRef(-1);
  const [projected, setProjected] = useState(() => ({ engine, projection: engine.project() }));
  if (projected.engine !== engine) setProjected({ engine, projection: engine.project() });
  const projection = projected.projection;
  const [soundError, setSoundError] = useState('');
  const [wakeStatus, setWakeStatus] = useState('Checking screen wake');
  const revision = useRef(-1);
  const listeners = useRef(new Set<(clocks: ClockValues) => void>());
  const scheduleRef = useRef<() => void>(() => {});
  const lastNavigation = useRef(-Infinity);
  // The player owns sound errors while mounted and hands the handler back to the app afterwards.
  useEffect(() => { const previous = audio.onError; audio.onError = setSoundError; return () => { audio.onError = previous; }; }, [audio]);

  /** Writes the checkpoint of the engine as it stands, on this device and to the household server. */
  const save = useCallback((status: Status) => {
    if (detached.current === engine.sessionId) return;
    if (['preparing', 'running'].includes(status)) startedAt.current ??= new Date().toISOString();
    // A restored session that has taken no command yet is still the save it came from: it keeps that save's time, so
    // another reload tells the same age, and after a hand-over the note of where it came from (ENG-12, ENG-15).
    const untouched = recovery && engine.revision === restoredRevision ? recovery : undefined;
    const checkpoint: Checkpoint = {
      sessionId: engine.sessionId, workoutId: workout.id, workoutRevision: workout.revision, workout, snapshot: engine.toJSON(), revision: engine.revision, status,
      savedAt: untouched ? lastSaved(untouched) : new Date().toISOString(), startedAt: startedAt.current, ...(untouched?.checkpoint.handover ? { handover: untouched.checkpoint.handover } : {}),
    };
    checkpointRevision.current = engine.revision;
    lastCheckpoint.current = checkpoint;
    queues.checkpoint.push(checkpoint);
    // Written while the page is hidden (the pause of a hidden app), the send must outlive the page.
    uplink.push({ checkpoint, ...(document.hidden ? { keepalive: true } : {}) });
    lastProgress.current = lastUplink.current = now();
  }, [engine, restoredRevision, recovery, workout, queues, uplink, now]);

  /** Offers the household server what this device holds now. The uplink sends only what the server lacks, so asking again is free. */
  const offer = useCallback((keepalive: boolean) => {
    const checkpoint = lastCheckpoint.current;
    if (!checkpoint || checkpoint.sessionId !== engine.sessionId || detached.current === engine.sessionId) return;
    const { status } = engine.project();
    if (status === 'ready' || status === 'completed' || status === 'aborted') return;
    const progress: Progress | undefined = status === 'running' && checkpoint.revision === engine.revision ? { sessionId: engine.sessionId, checkpointRevision: engine.revision, ...engine.offsets(), savedAt: new Date().toISOString() } : undefined;
    uplink.push({ checkpoint, ...(progress ? { progress } : {}), ...(keepalive ? { keepalive } : {}) });
  }, [engine, uplink]);

  const refresh = useCallback(() => {
    // The horn's blast holds the clock at each boundary; other tones keep the plan's exact timing.
    engine.boundaryHoldMs = audio.boundaryHoldMs;
    engine.tick();
    const next = engine.project();
    if (revision.current !== engine.revision) {
      revision.current = engine.revision;
      setProjected({ engine, projection: next });
      if (next.status === 'completed' || next.status === 'aborted') uplink.end(engine.sessionId);
      else if (next.status !== 'ready') save(next.status);
    } else if (next.status === 'running' && detached.current !== engine.sessionId && now() - lastProgress.current >= PROGRESS_INTERVAL_MS) {
      lastProgress.current = now();
      const progress: Progress = { sessionId: engine.sessionId, checkpointRevision: engine.revision, ...engine.offsets(), savedAt: new Date().toISOString() };
      queues.progress.push(progress);
      if (lastCheckpoint.current?.revision === engine.revision && now() - lastUplink.current >= UPLINK_INTERVAL_MS) { lastUplink.current = now(); uplink.push({ checkpoint: lastCheckpoint.current, progress }); }
    }
    const clocks = engine.readClocks();
    if (!__OPENWOD_TEST__) audio.update(next, clocks);
    for (const listener of listeners.current) listener(clocks);
  }, [engine, audio, queues, uplink, save, now]);

  useEffect(() => {
    let frame = 0;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    revision.current = -1;
    const schedule = () => {
      if (deadline) clearTimeout(deadline);
      if (frame) cancelAnimationFrame(frame);
      refresh();
      // One timeout for the next semantic deadline; frames only repaint clocks in between. Open-ended manual work has no
      // deadline but its elapsed clocks still move, so frames continue while running.
      const live = () => engine.nextDeadline !== undefined || engine.project().status === 'running';
      if (!__OPENWOD_TEST__ && live() && !document.hidden && !disposed) {
        if (engine.nextDeadline !== undefined) deadline = setTimeout(schedule, Math.max(1, engine.nextDeadline - now()));
        const animate = () => {
          if (disposed || document.hidden) return;
          refresh();
          if (live()) frame = requestAnimationFrame(animate);
        };
        frame = requestAnimationFrame(animate);
      }
    };
    scheduleRef.current = schedule;
    schedule();
    const hidden = () => {
      if (document.hidden) {
        engine.command({ id: newId(), occurrenceId: engine.occurrenceId, type: 'pause', reason: 'hidden' });
        audio.cancel();
      }
      schedule();
      // On the way out the browser finishes the send without the page; back in view, a send that failed is made up for.
      offer(document.hidden);
    };
    const leaving = () => offer(true);
    const online = () => offer(false);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leaving);
    window.addEventListener('online', online);
    if (__OPENWOD_TEST__) window.__openwodTest = {
      advance(ms) { clockOffset.current += ms; schedule(); },
      snapshot() { return { projection: engine.project(), clocks: engine.readClocks(), events: engine.events }; },
      command(type, extra = {}) { const accepted = engine.command({ id: newId(), occurrenceId: engine.occurrenceId, type, ...extra }); schedule(); return accepted; },
      flushCheckpoints: async () => { await queues.checkpoint.flush(); await queues.progress.flush(); await uplink.flush(); },
      checkpointRevision: () => checkpointRevision.current,
    };
    return () => { disposed = true; if (deadline) clearTimeout(deadline); cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', leaving); window.removeEventListener('online', online); if (__OPENWOD_TEST__) delete window.__openwodTest; };
  }, [engine, refresh, offer, audio, queues, uplink, now]);

  // Leaving the player mid-session (Back, a link in the header) is a pause: the checkpoint says so at once, on this
  // device and on the server, and the library offers the session again (ENG-12). Only the unmount does this, whatever
  // the engine is by then, hence the ref.
  const leave = useRef(() => {});
  leave.current = () => { if (detached.current !== engine.sessionId && engine.command({ id: newId(), occurrenceId: engine.occurrenceId, type: 'pause' })) save('paused'); };
  useEffect(() => () => leave.current(), []);

  useEffect(() => {
    let lock: WakeLockSentinel | undefined;
    let disposed = false;
    if (!('wakeLock' in navigator)) { setWakeStatus('Screen wake unavailable'); return; }
    if (!window.isSecureContext) { setWakeStatus('HTTPS needed for screen wake'); return; }
    if (!['preparing', 'running'].includes(projection.status)) { setWakeStatus('Screen wake ready'); return; }
    navigator.wakeLock.request('screen').then(value => {
      if (disposed) { void value.release(); return; }
      lock = value;
      setWakeStatus('Screen stays awake');
      value.addEventListener('release', () => { if (!disposed) setWakeStatus('Screen wake released'); });
    }).catch(() => { if (!disposed) setWakeStatus('Screen wake unavailable'); });
    return () => { disposed = true; void lock?.release(); };
  }, [projection.status]);

  // A sound-mode change cancels queued cues and lets the next refresh schedule under the new mode.
  useEffect(() => { audio.cancel(); scheduleRef.current(); }, [audio, audio.mode]);
  useEffect(() => () => audio.cancel(), [audio]);

  const send = useCallback((type: CommandType, occurrenceId: string, extra: Pick<Command, 'athlete' | 'unit' | 'delta'> = {}) => {
    if (detached.current === engine.sessionId) return;
    if (['next', 'previous', 'nextSection', 'previousSection', 'switch', 'skipTurn', 'finish'].includes(type)) {
      if (performance.now() - lastNavigation.current < 350) return;
      lastNavigation.current = performance.now();
    }
    if (['play', 'resume', 'ready'].includes(type) && !__OPENWOD_TEST__) void audio.unlock();
    engine.command({ id: newId(), occurrenceId, type, ...extra });
    scheduleRef.current();
  }, [engine, audio]);

  const subscribeClock = useCallback((listener: (clocks: ClockValues) => void) => {
    listeners.current.add(listener);
    listener(engine.readClocks());
    return () => { listeners.current.delete(listener); };
  }, [engine]);

  const restart = useCallback(() => { audio.reset(); clockOffset.current = 0; startedAt.current = undefined; setSession(value => value + 1); }, [audio]);

  /** Everything on its way is written: to this device and, as far as the server answers, to the household. */
  const flushCheckpoints = useCallback(async () => { await queues.checkpoint.flush(); await queues.progress.flush(); await uplink.flush(); }, [queues, uplink]);

  /**
   * Hands the session over for good, to another tab (ENG-14) or another device (ENG-15): pauses, writes the last
   * checkpoint to this device, and from then on this player saves nothing and takes no command, so it can never
   * overwrite what the new controller writes. Resolves when this device's writes have settled.
   */
  const detach = useCallback(async () => {
    if (detached.current !== engine.sessionId) {
      engine.command({ id: newId(), occurrenceId: engine.occurrenceId, type: 'pause' });
      audio.cancel();
      scheduleRef.current();
      detached.current = engine.sessionId;
    }
    await queues.checkpoint.flush(); await queues.progress.flush();
  }, [engine, audio, queues]);

  return {
    engine, plan: engine.plan, projection, send, subscribeClock, soundError, wakeStatus, restart, checkpointStatus, startedAt, flushCheckpoints, detach,
    /** True while a restored session has taken no command since it was restored. */
    pristine: engine.revision === restoredRevision,
    /** The server's word that this session is another device's now (`controller`), or finished already (none). */
    elsewhere: elsewhere?.sessionId === engine.sessionId ? elsewhere : undefined,
  };
}
