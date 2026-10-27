import type { ExecutionPlan, Occurrence } from './compiler';
import type { Prescription } from './schema';

/**
 * A projected difficulty derived only from the workout's specification: how dense the work is, how demanding the
 * movements are by name, how long the session runs, and whether loads are prescribed. It is a heuristic for
 * choosing a session, not a measurement of anyone's effort.
 *
 * Manual work has no authored duration, so the heuristic assumes one: a capped block (AMRAP, you-go-I-go) is
 * continuous work for its whole cap; manual tasks in a capped section share the cap; tasks in an open section
 * count 60 seconds each, strength sets 30 seconds. Manual work is assumed 85 % dense (nobody moves continuously
 * through an AMRAP). These nominal times exist only here and never reach the player.
 */
export type DifficultyLevel = 1 | 2 | 3 | 4;
export type DifficultyLabel = 'Light' | 'Moderate' | 'Hard' | 'Brutal';
export interface Difficulty {
  level: DifficultyLevel;
  label: DifficultyLabel;
  /** 0 to 100. */
  score: number;
  factors: { density: number; intensity: number; duration: number; load: number; length: number };
}

/**
 * The knobs of the formula, calibrated on the bundled workouts by default and adjustable per device so the
 * judgements match the person reading them.
 */
export interface DifficultyCalibration {
  /** Minutes of content at which effort counts in full; shorter pieces are discounted by the square root of their share, so two minutes of anything stays Light. */
  fullEffortMinutes: number;
  /** Minutes of content at which the length factor reaches its top. */
  longMinutes: number;
  /** Relative weights of effort, length and load; only their proportions matter. */
  weights: { effort: number; duration: number; load: number };
  /** Scores (0..100) at which Moderate, Hard and Brutal start. */
  thresholds: { moderate: number; hard: number; brutal: number };
}

export const DEFAULT_CALIBRATION: DifficultyCalibration = { fullEffortMinutes: 15, longMinutes: 60, weights: { effort: 75, duration: 15, load: 10 }, thresholds: { moderate: 25, hard: 45, brutal: 62 } };
export const CALIBRATION_RANGES = { fullEffortMinutes: [3, 60], longMinutes: [20, 180], weight: [0, 100], threshold: [1, 100] } as const;

const bounded = (value: unknown, [min, max]: readonly [number, number], fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : fallback;

/** Clamps every knob into its range, keeps the long mark above the full-effort mark, orders the thresholds, and never lets all weights be zero. */
export function normaliseCalibration(value: unknown): DifficultyCalibration {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<DifficultyCalibration> & { weights?: Partial<DifficultyCalibration['weights']>; thresholds?: Partial<DifficultyCalibration['thresholds']> };
  const fullEffortMinutes = bounded(raw.fullEffortMinutes, CALIBRATION_RANGES.fullEffortMinutes, DEFAULT_CALIBRATION.fullEffortMinutes);
  const longMinutes = Math.max(fullEffortMinutes + 5, bounded(raw.longMinutes, CALIBRATION_RANGES.longMinutes, DEFAULT_CALIBRATION.longMinutes));
  const weights = { effort: bounded(raw.weights?.effort, CALIBRATION_RANGES.weight, DEFAULT_CALIBRATION.weights.effort), duration: bounded(raw.weights?.duration, CALIBRATION_RANGES.weight, DEFAULT_CALIBRATION.weights.duration), load: bounded(raw.weights?.load, CALIBRATION_RANGES.weight, DEFAULT_CALIBRATION.weights.load) };
  if (weights.effort + weights.duration + weights.load === 0) weights.effort = 1;
  const moderate = bounded(raw.thresholds?.moderate, CALIBRATION_RANGES.threshold, DEFAULT_CALIBRATION.thresholds.moderate);
  const hard = Math.max(moderate, bounded(raw.thresholds?.hard, CALIBRATION_RANGES.threshold, DEFAULT_CALIBRATION.thresholds.hard));
  const brutal = Math.max(hard, bounded(raw.thresholds?.brutal, CALIBRATION_RANGES.threshold, DEFAULT_CALIBRATION.thresholds.brutal));
  return { fullEffortMinutes, longMinutes, weights, thresholds: { moderate, hard, brutal } };
}

export const DIFFICULTY_LABELS: Record<DifficultyLevel, DifficultyLabel> = { 1: 'Light', 2: 'Moderate', 3: 'Hard', 4: 'Brutal' };

/** Keyword → intensity on a 0..1 scale. Matched against the normalised movement name; the first match wins, default 0.5. */
const INTENSITY_RULES: [RegExp, number][] = [
  [/stretch|breath|mobility|arm circle|foam roll|cool.?down|walk\b|march/, 0.15],
  [/plank hold|hold\b|dead hang|bird dog|glute bridge|cat.?cow|child/, 0.25],
  [/\bplank\b|sit.?up|crunch|twist|superman|hollow/, 0.4],
  [/burpee|thruster|sprint|\brun\b|running|sled|wall ball|box jump|jump squat|skater|mountain climber|high knee|hang clean|clean and jerk|snatch|devil press|assault|echo bike|ski\b|ski erg|double.?under|man.?maker|sandbag|wallball|muscle.?up|rope climb/, 0.9],
  [/row|rowing|bike|cycling|kettlebell swing|kb swing|lunge|push.?up|pull.?up|squat|deadlift|press|dip|farmer|carry|jumping jack|step.?up|inchworm|woodchop|toes.?to.?bar|clean|jerk/, 0.6],
];

export function movementIntensity(name: string): number {
  const text = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  for (const [pattern, intensity] of INTENSITY_RULES) if (pattern.test(text)) return intensity;
  return 0.5;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const NOMINAL_TASK_MS = 60_000;
const NOMINAL_SET_MS = 30_000;
const MANUAL_DENSITY = 0.85;

/** High-volume targets push a manual task's intensity up a notch. */
function volumeBoost(lanes: Prescription[]): number {
  return lanes.some(lane => (lane.reps ?? 0) >= 15 || (lane.calories ?? 0) >= 15) ? 0.1 : 0;
}

export function rateDifficulty(plan: ExecutionPlan, calibration: DifficultyCalibration = DEFAULT_CALIBRATION): Difficulty {
  let workMs = 0;
  let restMs = 0;
  let weightedIntensity = 0;
  let loadMs = 0;
  const manualShare = new Map<number, number>();
  for (const section of plan.sections) {
    if (section.capMs === undefined || section.durationKind !== 'capped') continue;
    // The rest after the section runs outside the cap (BLD-14), so it does not shorten the time left for the tasks.
    const capped = plan.occurrences.slice(section.startIndex, section.restAfter?.index ?? section.endIndex + 1);
    const manualTasks = capped.filter(item => item.timing === 'manual' && !item.tasks).length;
    const timedMs = capped.reduce((sum, item) => sum + item.durationMs, 0);
    if (manualTasks) manualShare.set(plan.sections.indexOf(section), Math.max(0, section.capMs - timedMs) / manualTasks);
  }
  const nominal = (occurrence: Occurrence): number => {
    if (occurrence.timing !== 'manual') return occurrence.durationMs;
    const section = plan.sections[occurrence.sectionIndex];
    if (occurrence.tasks) return section.capMs ?? NOMINAL_TASK_MS * occurrence.tasks.length;
    return manualShare.get(occurrence.sectionIndex) ?? (section.format === 'strength' ? NOMINAL_SET_MS : NOMINAL_TASK_MS);
  };
  for (const occurrence of plan.occurrences) {
    if (occurrence.phase !== 'work') { restMs += occurrence.durationMs; continue; }
    const ms = occurrence.timing === 'manual' ? nominal(occurrence) * MANUAL_DENSITY : nominal(occurrence);
    if (occurrence.timing === 'manual') restMs += nominal(occurrence) - ms;
    workMs += ms;
    const lanes = occurrence.tasks ? occurrence.tasks.flatMap(task => [task.assignments.A, task.assignments.B]).filter((lane): lane is Prescription => Boolean(lane)) : [occurrence.assignments?.A, occurrence.assignments?.B].filter((lane): lane is Prescription => Boolean(lane));
    const base = lanes.length ? lanes.reduce((sum, lane) => sum + movementIntensity(lane.name), 0) / lanes.length : 0.5;
    const intensity = Math.min(1, base + (occurrence.timing === 'manual' ? volumeBoost(lanes) : 0));
    weightedIntensity += intensity * ms;
    if (lanes.some(lane => lane.load)) loadMs += ms;
  }
  const { fullEffortMinutes, longMinutes, weights, thresholds } = calibration;
  const totalMinutes = (workMs + restMs) / 60_000;
  // Density: share of (nominal) content that is work. Pure strength/skill rests pull it down; Tabata pushes it up.
  const density = workMs + restMs ? workMs / (workMs + restMs) : 0;
  const intensity = workMs ? weightedIntensity / workMs : 0;
  // Length: a short piece cannot be hard however dense it is. Below the full-effort mark the effort and the load are
  // discounted by the square root of the share (a quarter of the length keeps half the effort).
  const length = Math.sqrt(clamp01(totalMinutes / fullEffortMinutes));
  // Duration: content beyond the full-effort mark adds its own points, up to the long mark.
  const duration = clamp01((totalMinutes - fullEffortMinutes) / (longMinutes - fullEffortMinutes));
  const load = (workMs ? loadMs / workMs : 0) * length;
  const factors = { density, intensity, duration, load, length };
  // Effort: how hard the work is, amplified by how little rest surrounds it. Continuous easy work stays easy.
  const effort = intensity * (0.5 + 0.5 * density) * length;
  const weightSum = weights.effort + weights.duration + weights.load;
  const score = Math.round(100 * clamp01((weights.effort * effort + weights.duration * duration + weights.load * load) / weightSum));
  // Default calibration: stretching ~11, a single Tabata ~29, Fran ~47, a 20-minute 40s/10s partner circuit ~45,
  // Fight Gone Bad ~53, Murph ~69, 40 minutes of burpee Tabata ~66, a 47-minute HYROX run/station session ~70.
  const level: DifficultyLevel = score < thresholds.moderate ? 1 : score < thresholds.hard ? 2 : score < thresholds.brutal ? 3 : 4;
  return { level, label: DIFFICULTY_LABELS[level], score, factors };
}
