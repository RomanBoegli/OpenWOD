import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compileWorkout } from '../../../packages/domain/src/compiler';
import type { Workout } from '../../../packages/domain/src';
import { WorkoutEngine, type ClockValues, type Command, type CommandType } from '../../../packages/engine/src';
import type { WorkoutAudio } from './audio';

declare const __OPENWOD_TEST__: boolean;
declare global {
  interface Window {
    __openwodTest?: { advance: (ms: number) => void; snapshot: () => { projection: ReturnType<WorkoutEngine['project']>; clocks: ClockValues; events: WorkoutEngine['events'] }; command: (type: CommandType, extra?: Partial<Command>) => boolean };
  }
}

/** Hosts one engine per session: schedules its next deadline, feeds audio and clock subscribers, and owns platform concerns. */
export function useWorkout(workout: Workout, audio: WorkoutAudio) {
  const clockOffset = useRef(0);
  const [session, setSession] = useState(0);
  // One engine per (workout, session). Compile and session identity happen exactly once per session.
  const engine = useMemo(() => new WorkoutEngine(compileWorkout(workout), () => performance.now() + clockOffset.current, crypto.randomUUID()), [workout, session]);
  const [projected, setProjected] = useState(() => ({ engine, projection: engine.project() }));
  if (projected.engine !== engine) setProjected({ engine, projection: engine.project() });
  const projection = projected.projection;
  const [soundError, setSoundError] = useState('');
  const [wakeStatus, setWakeStatus] = useState('Checking screen wake');
  const revision = useRef(-1);
  const listeners = useRef(new Set<(clocks: ClockValues) => void>());
  const scheduleRef = useRef<() => void>(() => {});
  const lastNavigation = useRef(-Infinity);
  audio.onError = setSoundError;

  const refresh = useCallback(() => {
    engine.tick();
    const next = engine.project();
    if (revision.current !== engine.revision) {
      revision.current = engine.revision;
      setProjected({ engine, projection: next });
    }
    const clocks = engine.readClocks();
    if (!__OPENWOD_TEST__) audio.update(next, clocks);
    for (const listener of listeners.current) listener(clocks);
  }, [engine, audio]);

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
      if (live() && !document.hidden && !disposed) {
        if (engine.nextDeadline !== undefined) deadline = setTimeout(schedule, Math.max(1, engine.nextDeadline - (performance.now() + clockOffset.current)));
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
        engine.command({ id: crypto.randomUUID(), occurrenceId: engine.occurrenceId, type: 'pause', reason: 'hidden' });
        audio.cancel();
      }
      schedule();
    };
    document.addEventListener('visibilitychange', hidden);
    if (__OPENWOD_TEST__) window.__openwodTest = {
      advance(ms) { clockOffset.current += ms; schedule(); },
      snapshot() { return { projection: engine.project(), clocks: engine.readClocks(), events: engine.events }; },
      command(type, extra = {}) { const accepted = engine.command({ id: crypto.randomUUID(), occurrenceId: engine.occurrenceId, type, ...extra }); schedule(); return accepted; },
    };
    return () => { disposed = true; if (deadline) clearTimeout(deadline); cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', hidden); if (__OPENWOD_TEST__) delete window.__openwodTest; };
  }, [engine, refresh, audio]);

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
    if (['next', 'previous', 'switch', 'skipTurn', 'finish'].includes(type)) {
      if (performance.now() - lastNavigation.current < 350) return;
      lastNavigation.current = performance.now();
    }
    if (['play', 'resume', 'ready'].includes(type) && !__OPENWOD_TEST__) void audio.unlock();
    engine.command({ id: crypto.randomUUID(), occurrenceId, type, ...extra });
    scheduleRef.current();
  }, [engine, audio]);

  const subscribeClock = useCallback((listener: (clocks: ClockValues) => void) => {
    listeners.current.add(listener);
    listener(engine.readClocks());
    return () => { listeners.current.delete(listener); };
  }, [engine]);

  const restart = useCallback(() => { audio.reset(); clockOffset.current = 0; setSession(value => value + 1); }, [audio]);

  return { engine, plan: engine.plan, projection, send, subscribeClock, soundError, wakeStatus, restart };
}
