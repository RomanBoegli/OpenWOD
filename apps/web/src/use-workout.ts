import { useCallback, useEffect, useRef, useState } from 'react';
import { compileWorkout } from '../../../packages/domain/src/compiler';
import type { Workout } from '../../../packages/domain/src';
import { WorkoutEngine, type ClockValues, type CommandType } from '../../../packages/engine/src';
import { WorkoutAudio, type SoundMode } from './audio';

declare const __WODVA_TEST__: boolean;
declare global {
  interface Window {
    __wodvaTest?: { advance: (ms: number) => void; snapshot: () => { projection: ReturnType<WorkoutEngine['project']>; clocks: ClockValues; events: WorkoutEngine['events'] } };
  }
}

export function useWorkout(workout: Workout, mode: SoundMode) {
  const clockOffset = useRef(0);
  const audio = useRef<WorkoutAudio | undefined>(undefined);
  audio.current ??= new WorkoutAudio();
  audio.current.mode = mode;
  const [engine, setEngine] = useState(() => new WorkoutEngine(compileWorkout(workout), () => performance.now() + clockOffset.current, crypto.randomUUID()));
  const [projection, setProjection] = useState(() => engine.project());
  const [soundError, setSoundError] = useState('');
  const [wakeStatus, setWakeStatus] = useState('Checking screen wake');
  const [clockSignal, setClockSignal] = useState(0);
  const revision = useRef(-1);
  const listeners = useRef(new Set<(clocks: ClockValues) => void>());
  const scheduleRef = useRef<() => void>(() => {});
  const lastNavigation = useRef(-Infinity);
  audio.current.onError = setSoundError;

  useEffect(() => {
    audio.current?.reset();
    clockOffset.current = 0;
    const next = new WorkoutEngine(compileWorkout(workout), () => performance.now() + clockOffset.current, crypto.randomUUID());
    revision.current = -1;
    setEngine(next);
    setProjection(next.project());
  }, [workout]);

  const refresh = useCallback(() => {
    engine.tick();
    const next = engine.project();
    if (revision.current !== engine.revision) {
      revision.current = engine.revision;
      setProjection(next);
    }
    const clocks = engine.readClocks();
    if (!__WODVA_TEST__) audio.current?.update(next, clocks);
    for (const listener of listeners.current) listener(clocks);
  }, [engine]);

  useEffect(() => {
    let frame = 0;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const schedule = () => {
      if (deadline) clearTimeout(deadline);
      if (frame) cancelAnimationFrame(frame);
      refresh();
      if (engine.nextDeadline !== undefined && !document.hidden && !disposed) {
        deadline = setTimeout(schedule, Math.max(1, engine.nextDeadline - (performance.now() + clockOffset.current)));
        const animate = () => {
          if (disposed || document.hidden) return;
          refresh();
          if (engine.nextDeadline !== undefined) frame = requestAnimationFrame(animate);
        };
        frame = requestAnimationFrame(animate);
      }
    };
    scheduleRef.current = schedule;
    schedule();
    const hidden = () => {
      if (document.hidden) {
        engine.command({ id: crypto.randomUUID(), occurrenceId: engine.occurrenceId, type: 'pause', reason: 'hidden' });
        audio.current?.cancel();
      }
      schedule();
    };
    document.addEventListener('visibilitychange', hidden);
    if (__WODVA_TEST__) window.__wodvaTest = {
      advance(ms) { clockOffset.current += ms; schedule(); setClockSignal(value => value + 1); },
      snapshot() { return { projection: engine.project(), clocks: engine.readClocks(), events: engine.events }; },
    };
    return () => { disposed = true; if (deadline) clearTimeout(deadline); cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', hidden); if (__WODVA_TEST__) delete window.__wodvaTest; };
  }, [engine, refresh]);

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

  useEffect(() => { audio.current?.cancel(); scheduleRef.current(); }, [mode]);
  useEffect(() => () => audio.current?.cancel(), []);

  const send = useCallback((type: CommandType, occurrenceId: string) => {
    if (type === 'next' || type === 'previous') {
      if (performance.now() - lastNavigation.current < 350) return;
      lastNavigation.current = performance.now();
    }
    if (['play', 'resume', 'ready'].includes(type) && !__WODVA_TEST__) void audio.current?.unlock();
    engine.command({ id: crypto.randomUUID(), occurrenceId, type });
    scheduleRef.current();
  }, [engine]);

  const subscribeClock = useCallback((listener: (clocks: ClockValues) => void) => {
    listeners.current.add(listener);
    listener(engine.readClocks());
    return () => { listeners.current.delete(listener); };
  }, [engine]);

  return { engine, plan: engine.plan, projection, send, subscribeClock, audio: audio.current, soundError, wakeStatus, clockSignal };
}
