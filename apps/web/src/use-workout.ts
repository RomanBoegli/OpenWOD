import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compileWorkout } from '../../../packages/domain/src/compiler';
import type { Workout } from '../../../packages/domain/src';
import { WorkoutEngine, type ClockValues, type Command, type CommandType } from '../../../packages/engine/src';
import type { WorkoutAudio } from './audio';
import { newId } from './ids';
import { applyProgress, writeCheckpoint, writeProgress, WriteQueue, type Checkpoint, type CheckpointStatus, type Progress, type Recovery } from './data/checkpoints';

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
  const engine = useMemo(() => {
    const plan = compileWorkout(workout);
    if (recovery && session === 0) return WorkoutEngine.fromSnapshot(plan, applyProgress(structuredClone(recovery.checkpoint.snapshot), recovery.progress), now);
    return new WorkoutEngine(plan, now, newId());
  }, [workout, session, recovery, now]);
  const startedAt = useRef<string | undefined>(recovery?.checkpoint.startedAt);
  // Checkpoints and progress records are written off the timing path; the first failure is reported once (AT-16).
  const queues = useMemo(() => {
    const report = (status: CheckpointStatus) => setCheckpointStatus(current => current === 'failed' && status === 'ok' ? 'ok' : status);
    return { checkpoint: new WriteQueue<Checkpoint>(writeCheckpoint, report), progress: new WriteQueue<Progress>(writeProgress, report) };
  }, []);
  const lastProgress = useRef(0);
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

  const refresh = useCallback(() => {
    // The horn's blast holds the clock at each boundary; other tones keep the plan's exact timing.
    engine.boundaryHoldMs = audio.boundaryHoldMs;
    engine.tick();
    const next = engine.project();
    if (revision.current !== engine.revision) {
      revision.current = engine.revision;
      setProjected({ engine, projection: next });
      if (next.status !== 'ready' && next.status !== 'completed' && next.status !== 'aborted') {
        if (['preparing', 'running'].includes(next.status)) startedAt.current ??= new Date().toISOString();
        checkpointRevision.current = engine.revision;
        queues.checkpoint.push({ sessionId: engine.sessionId, workoutId: workout.id, workoutRevision: workout.revision, workout, snapshot: engine.toJSON(), revision: engine.revision, status: next.status, savedAt: new Date().toISOString(), startedAt: startedAt.current });
        lastProgress.current = now();
      }
    } else if (next.status === 'running' && now() - lastProgress.current >= PROGRESS_INTERVAL_MS) {
      lastProgress.current = now();
      queues.progress.push({ sessionId: engine.sessionId, checkpointRevision: engine.revision, ...engine.offsets(), savedAt: new Date().toISOString() });
    }
    const clocks = engine.readClocks();
    if (!__OPENWOD_TEST__) audio.update(next, clocks);
    for (const listener of listeners.current) listener(clocks);
  }, [engine, audio, workout, queues, now]);

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
    };
    document.addEventListener('visibilitychange', hidden);
    if (__OPENWOD_TEST__) window.__openwodTest = {
      advance(ms) { clockOffset.current += ms; schedule(); },
      snapshot() { return { projection: engine.project(), clocks: engine.readClocks(), events: engine.events }; },
      command(type, extra = {}) { const accepted = engine.command({ id: newId(), occurrenceId: engine.occurrenceId, type, ...extra }); schedule(); return accepted; },
      flushCheckpoints: async () => { await queues.checkpoint.flush(); await queues.progress.flush(); },
      checkpointRevision: () => checkpointRevision.current,
    };
    return () => { disposed = true; if (deadline) clearTimeout(deadline); cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', hidden); if (__OPENWOD_TEST__) delete window.__openwodTest; };
  }, [engine, refresh, audio, queues, now]);

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

  const flushCheckpoints = useCallback(async () => { await queues.checkpoint.flush(); await queues.progress.flush(); }, [queues]);

  return { engine, plan: engine.plan, projection, send, subscribeClock, soundError, wakeStatus, restart, checkpointStatus, startedAt, flushCheckpoints };
}
