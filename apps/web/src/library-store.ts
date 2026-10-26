import { parseWorkout, type Workout } from '../../../packages/domain/src';
import { compileWorkout } from '../../../packages/domain/src/compiler';

const KEY = 'openwod.library.v1';
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

export { freeWorkoutId, slugify } from '../../../packages/domain/src/library';

// ---- Editor drafts -------------------------------------------------------------------------------------------
import type { BuilderDraft } from '../../../packages/domain/src/builder';

export interface StoredDraft { id: string; draft: BuilderDraft; updatedAt: string; mode: 'create' | 'replace'; /** File name when the draft came from an import. */ importedFrom?: string }
const DRAFTS_KEY = 'openwod.drafts.v1';
/** The single draft for a brand-new workout; editing an existing workout uses that workout's ID. */
export const NEW_DRAFT_ID = 'new';

export function loadDrafts(): StoredDraft[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter((item): item is StoredDraft => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && item.draft && Array.isArray(item.draft.sections) && typeof item.updatedAt === 'string' && ['create', 'replace'].includes(item.mode))).slice(0, 20).map(item => ({ ...item, ...(typeof item.importedFrom === 'string' ? { importedFrom: item.importedFrom.slice(0, 200) } : { importedFrom: undefined }) }));
  } catch { return []; }
}

export function persistDrafts(drafts: StoredDraft[]): string | undefined {
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); return undefined; } catch { return 'This device could not save the draft. Keep this tab open or export when done.'; }
}
