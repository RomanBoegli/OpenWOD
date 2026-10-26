import { parseWorkout, type Workout } from '../../../packages/domain/src';
import { compileWorkout } from '../../../packages/domain/src/compiler';

const KEY = 'wodva.library.v1';
export const SAVED_LIMIT = 100;

/** Imported workouts kept on this device until server persistence arrives. Invalid entries are dropped, never approximated. */
export function loadSavedWorkouts(): Workout[] {
  try {
    const raw = localStorage.getItem(KEY);
    const stored: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(stored)) return [];
    const valid: Workout[] = [];
    for (const item of stored.slice(0, SAVED_LIMIT)) {
      try { const workout = parseWorkout(item); compileWorkout(workout); valid.push(workout); } catch { /* Skip entries this version cannot play. */ }
    }
    return valid;
  } catch { return []; }
}

/** Returns a user-facing message when the library could not be written. */
export function persistSavedWorkouts(workouts: Workout[]): string | undefined {
  try {
    localStorage.setItem(KEY, JSON.stringify(workouts));
    return undefined;
  } catch {
    return 'This device could not save the library. Imported workouts will be gone after a reload.';
  }
}

export function slugify(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workout';
}

/** A free workout ID for a copy: keeps the authored ID when free, otherwise appends a counter. */
export function freeWorkoutId(wanted: string, taken: Set<string>): string {
  if (!taken.has(wanted)) return wanted;
  for (let counter = 2; ; counter++) {
    const candidate = `${wanted}-${counter}`.slice(0, 120);
    if (!taken.has(candidate)) return candidate;
  }
}
