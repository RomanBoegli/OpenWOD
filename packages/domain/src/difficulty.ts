import type { ExecutionPlan } from './compiler';

/**
 * A projected difficulty derived only from the workout's specification: how dense the work is, how demanding the
 * movements are by name, how long the session runs, and whether loads are prescribed. It is a heuristic for
 * choosing a session, not a measurement of anyone's effort.
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
  [/burpee|thruster|sprint|\brun\b|running|sled|wall ball|box jump|jump squat|skater|mountain climber|high knee|hang clean|clean and jerk|snatch|devil press|assault|echo bike|ski\b|ski erg|double.?under|man.?maker|sandbag|wallball/, 0.9],
  [/row|rowing|bike|cycling|kettlebell swing|kb swing|lunge|push.?up|pull.?up|squat|deadlift|press|dip|farmer|carry|jumping jack|step.?up|inchworm|woodchop/, 0.6],
];

export function movementIntensity(name: string): number {
  const text = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  for (const [pattern, intensity] of INTENSITY_RULES) if (pattern.test(text)) return intensity;
  return 0.5;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function rateDifficulty(plan: ExecutionPlan): Difficulty {
  let workMs = 0;
  let restMs = 0;
  let weightedIntensity = 0;
  let loadMs = 0;
  for (const occurrence of plan.occurrences) {
    if (occurrence.phase !== 'work') { restMs += occurrence.durationMs; continue; }
    workMs += occurrence.durationMs;
    const lanes = [occurrence.assignments?.A, occurrence.assignments?.B].filter(Boolean);
    const intensity = lanes.length ? lanes.reduce((sum, lane) => sum + movementIntensity(lane!.name), 0) / lanes.length : 0.5;
    weightedIntensity += intensity * occurrence.durationMs;
    if (lanes.some(lane => lane!.load)) loadMs += occurrence.durationMs;
  }
  // Density: share of timed content that is work. Pure strength/skill rests pull it down; Tabata pushes it up.
  const density = workMs + restMs ? workMs / (workMs + restMs) : 0;
  const intensity = workMs ? weightedIntensity / workMs : 0;
  // Duration: 10 minutes of active content counts little; 60 minutes is the top of the scale.
  const duration = clamp01((plan.durationMs / 60_000 - 10) / 50);
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
