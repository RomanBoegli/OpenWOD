import { useCallback, useRef, useState, type MouseEvent } from 'react';
import type { Workout } from '../../../packages/domain/src';

/**
 * Start on a library card, a workout's page or the logbook begins the session with that tap: the tap unlocks the
 * sound (AUD-08), the link shows a turning circle while the sound the workout plays is made ready, and the player it
 * then opens skips its own Start. The intent is one shot and short-lived, so a reload, a bookmark or the back button
 * still meet the ready screen, which has to ask for a tap of its own.
 */
const INTENT_MS = 5000;
let intent: { id: string; at: number } | undefined;

/** What a starting tap does to the sound: `unlock` within the tap, and `ready` resolves once the workout can sound as chosen. */
interface StartSound { unlock: () => void; ready: (workout?: Workout) => Promise<void> }
const NO_SOUND: StartSound = { unlock() {}, ready: () => Promise.resolve() };
let sound = NO_SOUND;

/** The app hands in what a starting tap does to the sound; returns the undo for an effect's cleanup. */
export function onStartSound(handlers: StartSound): () => void { sound = handlers; return () => { if (sound === handlers) sound = NO_SOUND; }; }

const pending = (workoutId: string) => intent !== undefined && intent.id === workoutId && performance.now() - intent.at < INTENT_MS;

/**
 * For the links to a play route. `start` is the click handler: it keeps the page until the sound is ready, then opens
 * the player. `starting` is the key of the link that is waiting, for its busy state. Without `workout` (a logbook copy
 * that is fetched first) only the output and the cues are waited for here, and its names by `startReady`.
 */
export function useStart() {
  const [starting, setStarting] = useState<string>();
  const busy = useRef(false);
  const start = useCallback((event: MouseEvent<HTMLAnchorElement>, workoutId: string, workout?: Workout, key = workoutId) => {
    // A click that opens another tab or window starts nothing here: that page meets the ready screen.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const href = event.currentTarget.href, from = location.href;
    sound.unlock();
    setStarting(key);
    void sound.ready(workout).then(() => {
      busy.current = false;
      // Left meanwhile, by Back or another link: that choice stands.
      if (location.href !== from) { setStarting(undefined); return; }
      intent = { id: workoutId, at: performance.now() };
      location.assign(href);
    });
  }, []);
  return { starting, start };
}

/** Resolves once a workout whose Start was just pressed can sound as chosen, and at once for any other: for a player that learns its workout late. */
export function startReady(workout: Workout): Promise<void> { return pending(workout.id) ? sound.ready(workout) : Promise.resolve(); }

/** Whether Start was just pressed for this workout, without using the intent up: for the route that decides what the player gets. */
export const startPending = (workoutId: string): boolean => pending(workoutId);

/** True once for the workout whose Start was just pressed. */
export function takeStart(workoutId: string): boolean {
  const hit = pending(workoutId);
  intent = undefined;
  return hit;
}
