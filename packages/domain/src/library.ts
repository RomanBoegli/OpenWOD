import { compileWorkout } from './compiler';
import { rateDifficulty, type Difficulty, type DifficultyLevel } from './difficulty';
import type { Workout, WorkoutNode } from './schema';

/** Presentation-ready facts about a workout, computed once per library entry. */
export interface WorkoutSummary {
  id: string;
  title: string;
  description: string;
  participants: 1 | 2;
  equipment: string[];
  movements: string[];
  sections: number;
  /** Timed content excluding prep and manual Ready waits. */
  activeMs: number;
  /** Timed content including the prep countdown. */
  totalMs: number;
  difficulty: Difficulty;
}

export type DurationBucket = 'short' | 'medium' | 'long';
export type LibrarySort = 'title' | 'shortest' | 'longest' | 'easiest' | 'hardest';
export interface LibraryFilter { query?: string; participants?: 1 | 2; equipment?: string; duration?: DurationBucket; difficulty?: DifficultyLevel }

const SHORT_MAX_MS = 20 * 60_000;
const MEDIUM_MAX_MS = 40 * 60_000;

export function durationBucket(totalMs: number): DurationBucket {
  return totalMs <= SHORT_MAX_MS ? 'short' : totalMs <= MEDIUM_MAX_MS ? 'medium' : 'long';
}

function collectMovements(node: WorkoutNode, into: string[]) {
  if (node.type === 'timed') {
    for (const prescription of [node.assignments.A, node.assignments.B]) if (prescription && !into.includes(prescription.name)) into.push(prescription.name);
  } else if (node.type === 'sequence') node.children.forEach(child => collectMovements(child, into));
  else if (node.type === 'repeat') collectMovements(node.body, into);
}

export function summariseWorkout(workout: Workout): WorkoutSummary {
  const plan = compileWorkout(workout);
  const movements: string[] = [];
  for (const section of workout.sections) collectMovements(section.body, movements);
  return {
    id: workout.id, title: workout.title, description: workout.description ?? '', participants: workout.participants,
    equipment: [...workout.equipment], movements, sections: workout.sections.length,
    activeMs: plan.durationMs, totalMs: plan.durationMs + workout.prepMs, difficulty: rateDifficulty(plan),
  };
}

const normalise = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();

/** Every whitespace-separated query token must appear in the title, description, a movement or an equipment item. */
export function matchesFilter(summary: WorkoutSummary, filter: LibraryFilter): boolean {
  if (filter.participants && summary.participants !== filter.participants) return false;
  if (filter.equipment && !summary.equipment.some(item => normalise(item) === normalise(filter.equipment!))) return false;
  if (filter.duration && durationBucket(summary.totalMs) !== filter.duration) return false;
  if (filter.difficulty && summary.difficulty.level !== filter.difficulty) return false;
  const tokens = normalise(filter.query ?? '').split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = normalise([summary.title, summary.description, ...summary.movements, ...summary.equipment].join('\n'));
  return tokens.every(token => haystack.includes(token));
}

export function sortSummaries<T extends WorkoutSummary>(summaries: T[], sort: LibrarySort): T[] {
  const compare: Record<LibrarySort, (a: T, b: T) => number> = {
    title: (a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }),
    shortest: (a, b) => a.totalMs - b.totalMs || a.title.localeCompare(b.title, 'en'),
    longest: (a, b) => b.totalMs - a.totalMs || a.title.localeCompare(b.title, 'en'),
    easiest: (a, b) => a.difficulty.score - b.difficulty.score || a.title.localeCompare(b.title, 'en'),
    hardest: (a, b) => b.difficulty.score - a.difficulty.score || a.title.localeCompare(b.title, 'en'),
  };
  return [...summaries].sort(compare[sort]);
}

/** All equipment names across the library, deduplicated case-insensitively and alphabetised. */
export function equipmentOptions(summaries: WorkoutSummary[]): string[] {
  const seen = new Map<string, string>();
  for (const summary of summaries) for (const item of summary.equipment) if (!seen.has(normalise(item))) seen.set(normalise(item), item);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}
