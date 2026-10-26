import type { Catalogue } from './catalogue';
import { compileWorkout, type DurationKind } from './compiler';
import { searchScore, type SearchField } from './search';
import { rateDifficulty, type Difficulty, type DifficultyCalibration, type DifficultyLevel } from './difficulty';
import type { Prescription, SectionFormat, Workout, WorkoutNode } from './schema';

/** Presentation-ready facts about a workout, computed once per library entry. */
export interface WorkoutSummary {
  id: string;
  title: string;
  description: string;
  participants: 1 | 2;
  /** Equipment as declared by the author. */
  equipment: string[];
  /** Declared equipment plus what the movement names imply, deduplicated. */
  equipmentNeeded: string[];
  movements: string[];
  formats: SectionFormat[];
  sections: number;
  /** Timed content excluding prep and manual Ready waits; capped manual sections count their cap. */
  activeMs: number;
  /** Timed content including the prep countdown. */
  totalMs: number;
  durationKind: DurationKind;
  difficulty: Difficulty;
  /** Ids of the collections this workout belongs to (set by the app, not the model). */
  collections: string[];
}

export type DurationBucket = 'short' | 'medium' | 'long';
export type LibrarySort = 'title' | 'shortest' | 'longest' | 'easiest' | 'hardest';
/** Filters accumulate: a list matches when the workout has ANY of the chosen values; lists combine with AND. */
export interface LibraryFilter {
  query?: string;
  participants?: 1 | 2;
  /** Any of these equipment items is needed. */
  equipment?: string[];
  /** Only workouts whose needed equipment is covered by this list; an empty list means bodyweight only. */
  onlyEquipment?: string[];
  duration?: DurationBucket[];
  difficulty?: DifficultyLevel[];
  format?: SectionFormat[];
  /** Any of these collection ids. */
  collections?: string[];
}

const SHORT_MAX_MS = 20 * 60_000;
const MEDIUM_MAX_MS = 40 * 60_000;

export function durationBucket(totalMs: number): DurationBucket {
  return totalMs <= SHORT_MAX_MS ? 'short' : totalMs <= MEDIUM_MAX_MS ? 'medium' : 'long';
}

/** Every prescription in a workout, in authored order, each name once. */
export function collectPrescriptions(workout: Workout): Prescription[] {
  const found: Prescription[] = [];
  const walk = (node: WorkoutNode) => {
    if (node.type === 'timed' || node.type === 'task') {
      for (const prescription of [node.assignments.A, node.assignments.B]) if (prescription && !found.some(item => item.name === prescription.name)) found.push(prescription);
    } else if (node.type === 'sequence') node.children.forEach(walk);
    else if (node.type === 'repeat') walk(node.body);
  };
  for (const section of workout.sections) walk(section.body);
  return found;
}

/** Movement keyword → the equipment it implies. Checked against normalised movement names; every match counts. */
const EQUIPMENT_RULES: [RegExp, string][] = [
  [/barbell|thruster|deadlift|clean|jerk|snatch|back squat|front squat|overhead squat|push press|strict press|bench press|sumo deadlift/, 'Barbell'],
  [/\brow\b|rowing|rower/, 'Rowing machine'],
  [/assault|echo bike|air bike|bike erg|\bbike\b|cycling/, 'Bike'],
  [/ski ?erg|\bski\b/, 'SkiErg'],
  [/box jump|box step|step.?over|step.?up/, 'Plyo box'],
  [/wall ?ball|medicine ball|med ball/, 'Medicine ball'],
  [/slam ball/, 'Slam ball'],
  [/double.?under|single.?under|jump rope|skipping/, 'Jump rope'],
  [/pull.?up|chin.?up|toes.?to.?bar|knee raise|dead hang|bar muscle|chest.?to.?bar|hanging/, 'Pull-up bar'],
  [/ring (row|dip|muscle|support)|rings\b|ring muscle/, 'Rings'],
  [/kettlebell|\bkb\b/, 'Kettlebell'],
  [/dumbbell|\bdb\b/, 'Dumbbells'],
  [/bench press|floor press|bench\b/, 'Bench'],
  [/sled/, 'Sled'],
  [/sandbag/, 'Sandbag'],
  [/rope climb/, 'Climbing rope'],
  [/handstand|wall walk|hspu/, 'Wall'],
];

export const normalise = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();
/** Loose identity for equipment names: case, accents and a trailing plural s are ignored ("Kettlebells" ≈ "kettlebell"). */
export const equipmentKey = (name: string) => normalise(name).replace(/\s+/g, ' ').replace(/s$/, '');

/**
 * Equipment implied by movement names. A barbell is only inferred when nothing says the lift is done with a
 * dumbbell, kettlebell or ball, and not at all when the author declared handheld weights but no barbell.
 */
export function inferEquipment(movements: string[], declared: string[] = []): string[] {
  const found: string[] = [];
  const declaredText = normalise(declared.join(' '));
  const noBarbell = /dumbbell|kettlebell/.test(declaredText) && !/barbell/.test(declaredText);
  for (const movement of movements) {
    const text = normalise(movement);
    const handheld = noBarbell || /dumbbell|\bdb\b|kettlebell|\bkb\b|sandbag|medicine ball|wall ?ball|slam ball|goblet|single.?arm|one.?arm/.test(text);
    for (const [pattern, equipment] of EQUIPMENT_RULES) {
      if (equipment === 'Barbell' && handheld) continue;
      if (pattern.test(text) && !found.includes(equipment)) found.push(equipment);
    }
  }
  return found;
}

export interface SummaryOptions {
  /** Maps an equipment name to its canonical spelling (master data merges). */
  canonicalEquipment?: (name: string) => string;
  collections?: string[];
  /** When given, equipment comes from the movement records of recognised movements; keywords only cover the rest. */
  catalogue?: Catalogue;
  /** The device's difficulty calibration; the defaults otherwise. */
  difficulty?: DifficultyCalibration;
}

export function summariseWorkout(workout: Workout, options: SummaryOptions = {}): WorkoutSummary {
  const plan = compileWorkout(workout);
  const prescriptions = collectPrescriptions(workout);
  const movements = prescriptions.map(item => item.name);
  const canonical = options.canonicalEquipment ?? ((name: string) => name);
  const known = options.catalogue ? prescriptions.filter(item => options.catalogue!.resolve(item)) : [];
  const unknown = prescriptions.filter(item => !known.includes(item)).map(item => item.name);
  const inferred = [...known.flatMap(item => options.catalogue!.equipmentOf(item)), ...inferEquipment(unknown, workout.equipment)];
  const equipmentNeeded: string[] = [];
  for (const item of [...workout.equipment, ...inferred].map(canonical)) if (!equipmentNeeded.some(known => equipmentKey(known) === equipmentKey(item) || normalise(known).includes(normalise(item)))) equipmentNeeded.push(item);
  const formats: SectionFormat[] = [];
  for (const section of workout.sections) if (!formats.includes(section.format)) formats.push(section.format);
  return {
    id: workout.id, title: workout.title, description: workout.description ?? '', participants: workout.participants,
    equipment: [...workout.equipment], equipmentNeeded, movements, formats, sections: workout.sections.length,
    activeMs: plan.durationMs, totalMs: plan.durationMs + workout.prepMs, durationKind: plan.durationKind, difficulty: rateDifficulty(plan, options.difficulty),
    collections: options.collections ?? [],
  };
}

/** The weighted fields the library search ranks: title first, then movements and equipment, then the description. */
export const searchFields = (summary: WorkoutSummary): SearchField[] => [
  { text: summary.title, weight: 3 },
  { text: summary.movements.join(' '), weight: 2 },
  { text: summary.equipmentNeeded.join(' '), weight: 1.5 },
  { text: summary.description, weight: 1 },
];

/** Every query token must match (exactly, as a prefix, inside a word or with a small typo) in some searched field. */
export function matchesFilter(summary: WorkoutSummary, filter: LibraryFilter): boolean {
  if (filter.participants && summary.participants !== filter.participants) return false;
  if (filter.equipment?.length && !filter.equipment.some(wanted => summary.equipmentNeeded.some(item => equipmentKey(item) === equipmentKey(wanted)))) return false;
  if (filter.onlyEquipment) {
    const owned = filter.onlyEquipment.map(equipmentKey);
    if (!summary.equipmentNeeded.every(item => owned.includes(equipmentKey(item)))) return false;
  }
  if (filter.duration?.length && !filter.duration.includes(durationBucket(summary.totalMs))) return false;
  if (filter.difficulty?.length && !filter.difficulty.includes(summary.difficulty.level)) return false;
  if (filter.format?.length && !filter.format.some(format => summary.formats.includes(format))) return false;
  if (filter.collections?.length && !filter.collections.some(id => summary.collections.includes(id))) return false;
  return searchScore(filter.query ?? '', searchFields(summary)) > 0;
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

/** All needed equipment names across the library, deduplicated loosely and alphabetised. */
export function equipmentOptions(summaries: WorkoutSummary[]): string[] {
  const seen = new Map<string, string>();
  for (const summary of summaries) for (const item of summary.equipmentNeeded) if (!seen.has(equipmentKey(item))) seen.set(equipmentKey(item), item);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}
