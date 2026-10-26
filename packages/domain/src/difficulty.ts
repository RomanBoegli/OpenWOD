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
  factors: { density: number; intensity: number; duration: number; load: number };
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

export function rateDifficulty(plan: ExecutionPlan): Difficulty {
  let workMs = 0;
  let restMs = 0;
  let weightedIntensity = 0;
  let loadMs = 0;
  const manualShare = new Map<number, number>();
  for (const section of plan.sections) {
    if (section.capMs === undefined || section.durationKind !== 'capped') continue;
    const manualTasks = plan.occurrences.slice(section.startIndex, section.endIndex + 1).filter(item => item.timing === 'manual' && !item.tasks).length;
    const timedMs = plan.occurrences.slice(section.startIndex, section.endIndex + 1).reduce((sum, item) => sum + item.durationMs, 0);
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
  // Density: share of (nominal) content that is work. Pure strength/skill rests pull it down; Tabata pushes it up.
  const density = workMs + restMs ? workMs / (workMs + restMs) : 0;
  const intensity = workMs ? weightedIntensity / workMs : 0;
  // Duration: 10 minutes of active content counts little; 60 minutes is the top of the scale.
  const duration = clamp01(((workMs + restMs) / 60_000 - 10) / 50);
  const load = workMs ? loadMs / workMs : 0;
  const factors = { density, intensity, duration, load };
  // Effort: how hard the work is, amplified by how little rest surrounds it. Continuous easy work stays easy.
  const effort = intensity * (0.5 + 0.5 * density);
  const score = Math.round(100 * clamp01(0.75 * effort + 0.15 * duration + 0.1 * load));
  // Calibration: stretching ~11, Tabata This ~37, a 20-minute 40s/10s partner circuit ~45, Fight Gone Bad ~53, a 20-minute
  // row/burpee EMOM ~59, 40 minutes of burpee Tabata ~65, a 47-minute HYROX run/station session ~70.
  const level: DifficultyLevel = score < 25 ? 1 : score < 45 ? 2 : score < 62 ? 3 : 4;
  return { level, label: DIFFICULTY_LABELS[level], score, factors };
}
