/**
 * Start on a library card, a workout's page or the logbook begins the session with that tap: the tap unlocks the
 * sound (AUD-08) and the player it leads to skips its own Start. The intent is one shot and short-lived, so a reload,
 * a bookmark or the back button still meet the ready screen, which has to ask for a tap of its own.
 */
const INTENT_MS = 5000;
let intent: { id: string; at: number } | undefined;
let unlock = () => {};

/** The app hands in what a starting tap unlocks; returns the undo for an effect's cleanup. */
export function onStartUnlock(run: () => void): () => void { unlock = run; return () => { if (unlock === run) unlock = () => {}; }; }

/** For the click handler of a link to a play route. */
export function requestStart(workoutId: string) { intent = { id: workoutId, at: performance.now() }; unlock(); }

/** True once for the workout whose Start was just pressed. */
export function takeStart(workoutId: string): boolean {
  const hit = intent !== undefined && intent.id === workoutId && performance.now() - intent.at < INTENT_MS;
  intent = undefined;
  return hit;
}
