import type { Workout } from './schema';
import { bundledCollections, bundledWorkouts, type BundledCollection } from './generated/bundled';

/**
 * The workout registry: every file under workouts/<collection>/ at the repository root, bundled at build time by
 * scripts/bundle-workouts.ts. The files are the source of truth; this module only looks them up.
 */
export { bundledCollections, bundledWorkouts, type BundledCollection };

const byId = new Map(bundledWorkouts.map(workout => [workout.id, workout]));

/** A bundled workout by id. Throws when the registry has no such file; callers that may miss use `bundledWorkouts.find`. */
export function bundledWorkout(id: string): Workout {
  const workout = byId.get(id);
  if (!workout) throw new Error(`No bundled workout "${id}" under workouts/.`);
  return workout;
}
