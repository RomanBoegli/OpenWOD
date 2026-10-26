import type { LoadLevel, LoadValue, Prescription, Workout, WorkoutNode } from './schema';
import { coachWorkouts } from './fixtures/coach';

export { coachWorkouts };

const pair = (A: string, B: string) => ({ A: { name: A }, B: { name: B } });
const slot = (id: string, A: string, B: string, durationMs = 40_000): WorkoutNode => ({ id, type: 'timed', durationMs, assignments: pair(A, B) });

export const partnerCircuit: Workout = {
  schemaVersion: 2, id: 'partner-circuit', revision: 1,
  title: 'Partner circuit',
  description: 'Four stations. Five rounds. A little friendly competition. Share the work and keep each other moving.',
  equipment: ['Rowing machine', 'Kettlebell'], participants: 2, prepMs: 10_000,
  sections: [{
    id: 'conditioning', title: 'Conditioning', format: 'timedCircuit', transitionAfter: 'manualReady',
    body: {
      id: 'circuit', type: 'repeat', count: 5, betweenIterationsRestMs: 60_000,
      body: { id: 'stations', type: 'sequence', betweenChildrenRestMs: 10_000, children: [
        slot('slot-1', 'Row', 'Kettlebell swings'),
        slot('slot-2', 'Kettlebell swings', 'Row'),
        slot('slot-3', 'Burpees', 'Air squats'),
        slot('slot-4', 'Air squats', 'Burpees'),
      ] },
    },
  }],
};

const blocks = [
  { title: 'Legs & strength', rows: [['Air squats', 'Dumbbell thrusters'], ['Jump squats', 'Goblet squats'], ['Mountain climbers', 'Romanian deadlifts'], ['Burpees', 'Alternating lunges']] },
  { title: 'Upper body & arms', rows: [['Push-ups', 'Bent-over rows'], ['Plank shoulder taps', 'Shoulder press'], ['Triceps dips', 'Biceps curls'], ['Burpees', 'Overhead triceps extensions']] },
  { title: 'Abs & core', rows: [['Sit-ups', 'Russian twists'], ['Bicycle crunches', 'Dumbbell deadlifts'], ['Plank', 'Farmer march'], ['Mountain climbers', 'Dumbbell woodchoppers']] },
  { title: 'HYROX finisher', rows: [['High knees', 'Dumbbell hang cleans'], ['Skater jumps', 'Dumbbell thrusters'], ['Burpees', 'Alternating lunges'], ['Jump squats', 'Biceps curls']] },
];

function togetherSection(id: string, title: string, names: string[]): Workout['sections'][number] {
  return { id, title, format: 'timedCircuit', transitionAfter: 'manualReady', body: { id: `${id}-sequence`, type: 'sequence', children: names.map((name, index) => slot(`${id}-${index + 1}`, name, name, 60_000)) } };
}

export const fullBodyPartner: Workout = {
  schemaVersion: 2, id: 'full-body-partner', revision: 1,
  title: 'Full body partner workout',
  description: 'Bodyweight meets dumbbells. Switch task columns each round, then take two minutes to recover before the next block.',
  equipment: ['Dumbbells', 'Exercise mat'], participants: 2, prepMs: 10_000,
  sections: [
    togetherSection('warm-up', 'Warm-up', ['Jumping jacks', 'Air squats', 'Arm circles & shoulder mobility', 'Alternating lunges', 'Inchworms']),
    ...blocks.map((block, index): Workout['sections'][number] => {
      const id = `block-${index + 1}`;
      return { id, title: block.title, format: 'timedCircuit', transitionAfter: 'manualReady', body: {
        id: `${id}-body`, type: 'sequence', children: [
          { id: `${id}-rounds`, type: 'repeat', count: 2, assignmentPolicy: 'alternate', body: {
            id: `${id}-stations`, type: 'sequence', betweenChildrenRestMs: 20_000, trailingRestMs: 20_000,
            children: block.rows.map(([A, B], row) => slot(`${id}-slot-${row + 1}`, A, B)),
          } },
          { id: `${id}-rest`, type: 'rest', kind: 'blockRest', durationMs: 120_000 },
        ],
      } };
    }),
    togetherSection('cool-down', 'Cool-down', ['Quad stretch', 'Hamstring stretch', 'Hip flexor stretch', 'Chest & shoulder stretch', 'Deep breathing']),
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Sourced examples. CrossFit benchmarks follow their published structure; HYROX sessions are training variations
// of the published race structure, with timed intervals in place of race distances and loads (never official).
// ---------------------------------------------------------------------------------------------------------------

type Section = Workout['sections'][number];
const solo = (id: string, name: string, durationMs: number, extra: Partial<Prescription> = {}): WorkoutNode => ({ id, type: 'timed', durationMs, assignments: { A: { name, ...extra } } });
const section = (id: string, title: string, body: WorkoutNode, transitionAfter: Section['transitionAfter'] = 'manualReady'): Section => ({ id, title, format: 'timedCircuit', transitionAfter, body });

/** Five Tabata blocks of 8 × 20 s on / 10 s off with a minute between movements: 23:10 active. */
export const tabataThis: Workout = {
  schemaVersion: 2, id: 'tabata-this', revision: 1,
  title: 'Tabata This',
  description: 'Five movements, each as a Tabata: eight rounds of 20 seconds on and 10 seconds off, with a minute to walk to the next station. Your score per movement is your weakest interval, so pace the first one like the eighth.',
  attribution: { author: 'CrossFit', sourceUrl: 'https://www.crossfit.com/benchmark/tabata-this', notes: 'Follows the published benchmark structure. Score each movement by its lowest interval; the row counts calories.' },
  equipment: ['Rowing machine', 'Pull-up bar'], participants: 1, prepMs: 10_000,
  sections: [section('tabata', 'Tabata This', {
    id: 'tabata-stations', type: 'sequence', betweenChildrenRestMs: 60_000,
    children: [['row', 'Row', 'Score calories'], ['squat', 'Air squats', ''], ['pull-up', 'Pull-ups', ''], ['push-up', 'Push-ups', ''], ['sit-up', 'Sit-ups', '']].map(([id, name, notes]) => ({
      id: `tabata-${id}`, type: 'repeat', count: 8, betweenIterationsRestMs: 10_000,
      body: solo(`tabata-${id}-work`, name, 20_000, notes ? { notes } : {}),
    } as WorkoutNode)),
  })],
};

/** Three rounds of five one-minute stations with a minute off between rounds: 17:00 active. */
export const fightGoneBad: Workout = {
  schemaVersion: 2, id: 'fight-gone-bad', revision: 1,
  title: 'Fight Gone Bad',
  description: 'Three five-minute rounds that mimic a fight: five stations, one minute each, the clock never stops, one minute to breathe between rounds. Count every rep and every rowing calorie.',
  attribution: { author: 'CrossFit', sourceUrl: 'https://www.crossfit.com/workout/2013/09/22', notes: 'Follows the published benchmark structure. Loads shown are the published Rx; scale freely.' },
  equipment: ['Medicine ball', 'Barbell', 'Plyo box', 'Rowing machine'], participants: 1, prepMs: 10_000,
  sections: [section('fgb', 'Fight Gone Bad', {
    id: 'fgb-rounds', type: 'repeat', count: 3, betweenIterationsRestMs: 60_000,
    body: { id: 'fgb-stations', type: 'sequence', children: [
      solo('fgb-wall-ball', 'Wall balls', 60_000, { shortName: 'Wall balls', notes: 'Rx 20 lb ball to a 10 ft target (14 lb / 9 ft)' }),
      solo('fgb-sdhp', 'Sumo deadlift high pulls', 60_000, { shortName: 'SDHP', spokenName: 'sumo deadlift high pulls', notes: 'Rx 75 lb (55 lb)' }),
      solo('fgb-box-jump', 'Box jumps', 60_000, { notes: 'Rx 20 in box; step-ups to scale' }),
      solo('fgb-push-press', 'Push presses', 60_000, { notes: 'Rx 75 lb (55 lb)' }),
      solo('fgb-row', 'Row', 60_000, { notes: 'Score calories' }),
    ] },
  })],
};

/** Ten rounds of a two-minute EMOM pair: 20:00 active. */
export const rowBurpeeEmom: Workout = {
  schemaVersion: 2, id: 'row-burpee-emom-20', revision: 1,
  title: 'Row & burpee EMOM 20',
  description: 'Every minute on the minute for twenty minutes: odd minutes row for calories, even minutes burpees. Finish the work, then rest until the next minute starts. Pick targets you can hold for all ten rounds.',
  attribution: { author: 'Wodva', notes: 'An EMOM in the CrossFit sense: work starts on each minute boundary whether or not the previous set is done.' },
  equipment: ['Rowing machine'], participants: 1, prepMs: 10_000,
  sections: [section('emom', 'EMOM 20', {
    id: 'emom-rounds', type: 'repeat', count: 10,
    body: { id: 'emom-minutes', type: 'sequence', children: [
      solo('emom-row', 'Row', 60_000, { notes: '12 calories, then rest until the minute' }),
      solo('emom-burpees', 'Burpees', 60_000, { reps: 10, notes: 'Then rest until the minute' }),
    ] },
  })],
};

const HYROX_STATIONS: [string, string][] = [['skierg', 'SkiErg'], ['sled-push', 'Sled push'], ['sled-pull', 'Sled pull'], ['burpee-broad-jumps', 'Burpee broad jumps'], ['row', 'Row'], ['farmers-carry', 'Farmers carry'], ['sandbag-lunges', 'Sandbag lunges'], ['wall-balls', 'Wall balls']];
const HYROX_SOURCE = { author: 'Wodva', sourceUrl: 'https://hyrox.com/the-fitness-race/', notes: 'A training variation of the published HYROX race structure (8 runs, 8 stations). Timed intervals replace race distances and loads; nothing here is an official prescription. Swap stations you lack: a heavy carry for the sled, a treadmill or shuttle for the run.' };

/** Eight run-plus-station pairs at a steady pace with short transitions: 47:30 active. */
export const hyroxPaceIntervals: Workout = {
  schemaVersion: 2, id: 'hyrox-pace-intervals', revision: 1,
  title: 'HYROX pace intervals',
  description: 'The race shape at training length: eight three-minute runs, each followed by two minutes on the next station, with thirty seconds to transition. Hold the run pace you want on race day and keep the stations steady.',
  attribution: HYROX_SOURCE,
  equipment: ['Treadmill or running route', 'SkiErg', 'Sled', 'Rowing machine', 'Kettlebells', 'Sandbag', 'Medicine ball'], participants: 1, prepMs: 10_000,
  sections: [section('hyrox-sim', 'Runs and stations', {
    id: 'hyrox-sim-sequence', type: 'sequence', betweenChildrenRestMs: 30_000,
    children: HYROX_STATIONS.flatMap(([id, name], index) => [solo(`hyrox-run-${index + 1}`, 'Run', 180_000, { notes: 'Race pace' }), solo(`hyrox-${id}`, name, 120_000)]),
  })],
};

/** Two partner blocks: a shared run, then two rounds of paired stations that swap each round: 14:00 active. */
export const hyroxDoublesCircuit: Workout = {
  schemaVersion: 2, id: 'hyrox-doubles-circuit', revision: 1,
  title: 'HYROX doubles circuit',
  description: 'Run together, then split the stations the way a doubles team does: 45 seconds on, 15 to swap, and the columns trade after each round so both of you touch every station.',
  attribution: HYROX_SOURCE,
  equipment: ['SkiErg', 'Sled', 'Rowing machine', 'Kettlebells', 'Sandbag', 'Medicine ball'], participants: 2, prepMs: 10_000,
  sections: [[['skierg', 'SkiErg', 'sled-push', 'Sled push'], ['sled-pull', 'Sled pull', 'burpee-broad-jumps', 'Burpee broad jumps']], [['row', 'Row', 'farmers-carry', 'Farmers carry'], ['sandbag-lunges', 'Sandbag lunges', 'wall-balls', 'Wall balls']]].map((rows, index): Section => {
    const id = `doubles-${index + 1}`;
    return section(id, `Block ${index + 1}`, { id: `${id}-body`, type: 'sequence', children: [
      slot(`${id}-run`, 'Run together', 'Run together', 180_000),
      { id: `${id}-rounds`, type: 'repeat', count: 2, assignmentPolicy: 'alternate', body: {
        id: `${id}-stations`, type: 'sequence', betweenChildrenRestMs: 15_000, trailingRestMs: 15_000,
        children: rows.map(([idA, nameA, , nameB]) => slot(`${id}-${idA}`, nameA, nameB, 45_000)),
      } },
    ] });
  }),
};

/** Twenty-four one-minute slots cycling run, station, wall balls: 24:00 active. */
export const hyroxEngineEmom: Workout = {
  schemaVersion: 2, id: 'hyrox-engine-emom-24', revision: 1,
  title: 'HYROX engine EMOM 24',
  description: 'Every minute for 24 minutes: a hard minute of running, a minute on the next station, a minute of wall balls. Eight cycles cover all eight stations. Keep moving for the full minute; the next one starts whether you are ready or not.',
  attribution: HYROX_SOURCE,
  equipment: ['Treadmill or running route', 'SkiErg', 'Sled', 'Rowing machine', 'Kettlebells', 'Sandbag', 'Medicine ball'], participants: 1, prepMs: 10_000,
  sections: [section('engine', 'EMOM 24', {
    id: 'engine-sequence', type: 'sequence',
    children: HYROX_STATIONS.flatMap(([id, name], index) => [solo(`engine-run-${index + 1}`, 'Run', 60_000, { notes: 'Hard but repeatable' }), solo(`engine-${id}`, name, 60_000), solo(`engine-wall-balls-${index + 1}`, 'Wall balls', 60_000, { notes: 'Steady reps' })]),
  })],
};

export const timedWorkouts = [partnerCircuit, fullBodyPartner, tabataThis, fightGoneBad, rowBurpeeEmom, hyroxPaceIntervals, hyroxDoublesCircuit, hyroxEngineEmom];

/** The load an athlete at `level` lifts: their level, else the nearest defined level, else the single value. */
export function resolveLoad(load: Prescription['load'], level: LoadLevel = 'medium'): LoadValue | undefined {
  if (!load) return undefined;
  if ('value' in load) return load;
  return load[level] ?? load.medium ?? load.light ?? load.heavy;
}

export function loadText(load: LoadValue | undefined): string {
  if (!load) return '';
  return load.unit === 'percent' ? `${load.value} % 1RM` : `${load.value} ${load.unit}`;
}

export function distanceText(distance: Prescription['distance']): string {
  return distance ? `${distance.value} ${distance.unit}` : '';
}

/** Targets as a short line: "21 reps · 43 kg", "12 cal", "1 km". Falls back to notes, then a steady-effort hint. */
export function prescriptionText(value: Prescription, level: LoadLevel = 'medium'): string {
  const targets = [
    value.reps ? `${value.reps} reps` : '',
    value.calories ? `${value.calories} cal` : '',
    distanceText(value.distance),
    value.timeMs ? `${Math.round(value.timeMs / 1000)} s` : '',
    loadText(resolveLoad(value.load, level)),
  ].filter(Boolean).join(' · ');
  return targets || value.notes || 'Steady effort. Your pace.';
}

// ---------------------------------------------------------------------------------------------------------------
// Manual formats: AMRAP, For time, EMOM with Done, you-go-I-go, strength sets and a mixed session (AT-22).
// ---------------------------------------------------------------------------------------------------------------

type Task = Extract<WorkoutNode, { type: 'task' }>;
const task = (id: string, A: Prescription, B?: Prescription, completion?: Task['completion']): Task => ({ id, type: 'task', assignments: B ? { A, B } : { A }, ...(completion ? { completion } : {}) });
const kg = (light: number, medium: number, heavy: number) => ({ light: { value: light, unit: 'kg' as const }, medium: { value: medium, unit: 'kg' as const }, heavy: { value: heavy, unit: 'kg' as const } });
const percent = (light: number, medium: number, heavy: number) => ({ light: { value: light, unit: 'percent' as const }, medium: { value: medium, unit: 'percent' as const }, heavy: { value: heavy, unit: 'percent' as const } });

/** Twenty minutes of 5 pull-ups, 10 push-ups, 15 air squats. */
export const cindy: Workout = {
  schemaVersion: 2, id: 'cindy', revision: 1,
  title: 'Cindy',
  description: 'As many rounds as possible in twenty minutes of five pull-ups, ten push-ups and fifteen air squats. Count rounds on the screen; the timer never tells you what to do next, you do.',
  attribution: { author: 'CrossFit', sourceUrl: 'https://www.crossfit.com/benchmark/cindy', notes: 'Follows the published benchmark. Scale pull-ups with a band or ring rows.' },
  equipment: ['Pull-up bar'], participants: 1, prepMs: 10_000,
  sections: [{ id: 'cindy-amrap', title: 'AMRAP 20', format: 'amrap', transitionAfter: 'manualReady', capMs: 1_200_000, counter: 'roundsAndReps', body: {
    id: 'cindy-round', type: 'sequence', children: [
      task('cindy-pull-ups', { name: 'Pull-ups', reps: 5 }),
      task('cindy-push-ups', { name: 'Push-ups', reps: 10 }),
      task('cindy-squats', { name: 'Air squats', reps: 15 }),
    ],
  } }],
};

/** 21-15-9 thrusters and pull-ups for time, ten-minute cap. */
export const fran: Workout = {
  schemaVersion: 2, id: 'fran', revision: 1,
  title: 'Fran',
  description: 'Thrusters and pull-ups, 21-15-9, as fast as you can. Tap Done after each set; the clock counts up and stops when you finish or at ten minutes.',
  attribution: { author: 'CrossFit', sourceUrl: 'https://www.crossfit.com/benchmark/fran', notes: 'Follows the published benchmark. Heavy is the published men’s Rx (95 lb), medium the women’s Rx (65 lb), light the published beginner load (45 lb), rounded to kilograms.' },
  equipment: ['Barbell', 'Pull-up bar'], participants: 1, prepMs: 10_000,
  sections: [{ id: 'fran-for-time', title: '21-15-9', format: 'forTime', transitionAfter: 'manualReady', capMs: 600_000, body: {
    id: 'fran-ladder', type: 'sequence', children: [21, 15, 9].flatMap(reps => [
      task(`fran-thrusters-${reps}`, { name: 'Thrusters', reps, load: kg(20, 30, 43) }),
      task(`fran-pull-ups-${reps}`, { name: 'Pull-ups', reps }),
    ]),
  } }],
};

/** Sixteen one-minute intervals: one athlete rows while the other does burpees, then they swap. */
export const partnerEmom16: Workout = {
  schemaVersion: 2, id: 'partner-emom-16', revision: 1,
  title: 'Partner EMOM 16',
  description: 'Every minute for sixteen minutes. Odd minutes: A rows twelve calories while B does ten burpees. Even minutes: swap. Tap Done when both of you are finished and rest until the next minute; the clock does not wait.',
  attribution: { author: 'Wodva', notes: 'An EMOM in the CrossFit sense: work starts on each minute boundary whether or not the previous set was reported.' },
  equipment: ['Rowing machine'], participants: 2, prepMs: 10_000,
  sections: [{ id: 'emom16', title: 'EMOM 16', format: 'emom', transitionAfter: 'manualReady', intervalMs: 60_000, intervals: 16, body: {
    id: 'emom16-minutes', type: 'sequence', children: [
      task('emom16-odd', { name: 'Row', calories: 12 }, { name: 'Burpees', reps: 10 }, 'team'),
      task('emom16-even', { name: 'Burpees', reps: 10 }, { name: 'Row', calories: 12 }, 'team'),
    ],
  } }],
};

/** Alternating turns of a short row-and-burpee sprint under a twelve-minute cap. */
export const partnerSprints: Workout = {
  schemaVersion: 2, id: 'you-go-i-go-sprints', revision: 1,
  title: 'You go, I go sprints',
  description: 'One athlete works while the other rests: ten calories on the rower and five burpees, then tap Switch. A turn plus a B turn makes one team round. Keep the turns short and the rests honest; twelve minutes total.',
  attribution: { author: 'Wodva', notes: 'A you-go-I-go sprint format common in partner classes.' },
  equipment: ['Rowing machine'], participants: 2, prepMs: 10_000,
  sections: [{ id: 'sprints', title: 'Sprints', format: 'youGoIGo', transitionAfter: 'manualReady', capMs: 720_000, body: {
    id: 'sprints-turn', type: 'sequence', children: [
      task('sprints-row', { name: 'Row', calories: 10 }, { name: 'Row', calories: 10 }),
      task('sprints-burpees', { name: 'Burpees', reps: 5 }, { name: 'Burpees', reps: 5 }),
    ],
  } }],
};

/** Run, sled, run: distances are acknowledged by hand, never timed out. */
export const runSledRun: Workout = {
  schemaVersion: 2, id: 'run-sled-run', revision: 1,
  title: 'Run, sled, run',
  description: 'One kilometre run, fifty metres of sled push, one kilometre run. Tap Done when a distance is covered; the clock counts up and records each split. No cap: finish what you start.',
  attribution: { author: 'Wodva', notes: 'A HYROX-style run and station sequence. The sled load levels are training suggestions, not race prescriptions.' },
  equipment: ['Running route', 'Sled'], participants: 1, prepMs: 10_000,
  sections: [{ id: 'rsr', title: 'Run, sled, run', format: 'forTime', transitionAfter: 'manualReady', body: {
    id: 'rsr-sequence', type: 'sequence', children: [
      task('rsr-run-1', { name: 'Run', distance: { value: 1, unit: 'km' } }),
      task('rsr-sled', { name: 'Sled push', distance: { value: 50, unit: 'm' }, load: kg(50, 75, 100) }),
      task('rsr-run-2', { name: 'Run', distance: { value: 1, unit: 'km' } }),
    ],
  } }],
};

/** Five sets of five back squats with two minutes between sets. */
export const backSquatFives: Workout = {
  schemaVersion: 2, id: 'back-squat-5x5', revision: 1,
  title: 'Back squat 5 × 5',
  description: 'Five sets of five at a weight you could lift for seven. Tap Done after each set; the two-minute rest starts on its own and the next set waits for you.',
  attribution: { author: 'Wodva', notes: 'Percentages are of a recent one-rep max; the levels are conservative, moderate and demanding.' },
  equipment: ['Barbell', 'Squat rack'], participants: 1, prepMs: 10_000,
  sections: [{ id: 'bs', title: 'Back squat', format: 'strength', transitionAfter: 'manualReady', body: {
    id: 'bs-sets', type: 'repeat', count: 5, betweenIterationsRestMs: 120_000,
    body: task('bs-set', { name: 'Back squat', reps: 5, load: percent(65, 75, 85) }),
  } }],
};

/** AT-22: a timed warm-up, a manual strength block with timed rests, then a capped AMRAP; each with its own clock. */
export const mixedSession: Workout = {
  schemaVersion: 2, id: 'mixed-session', revision: 1,
  title: 'Mixed session',
  description: 'Three minutes of timed warm-up, three sets of deadlifts at your own pace with ninety seconds between, then a ten-minute AMRAP of kettlebell swings, box step-ups and sit-ups. Ready gates separate the three parts.',
  attribution: { author: 'Wodva' },
  equipment: ['Barbell', 'Kettlebell', 'Plyo box'], participants: 1, prepMs: 10_000,
  sections: [
    section('mixed-warm-up', 'Warm-up', { id: 'mixed-warm-up-sequence', type: 'sequence', children: [solo('mixed-jacks', 'Jumping jacks', 60_000), solo('mixed-squats', 'Air squats', 60_000), solo('mixed-hinges', 'Hip hinges', 60_000)] }),
    { id: 'mixed-strength', title: 'Deadlifts', format: 'strength', transitionAfter: 'manualReady', body: { id: 'mixed-deadlift-sets', type: 'repeat', count: 3, betweenIterationsRestMs: 90_000, body: task('mixed-deadlift', { name: 'Deadlift', reps: 5, load: percent(60, 70, 80) }) } },
    { id: 'mixed-amrap', title: 'AMRAP 10', format: 'amrap', transitionAfter: 'manualReady', capMs: 600_000, body: { id: 'mixed-amrap-round', type: 'sequence', children: [
      task('mixed-swings', { name: 'Kettlebell swings', reps: 15, load: kg(12, 16, 24) }),
      task('mixed-step-ups', { name: 'Box step-ups', reps: 12 }),
      task('mixed-sit-ups', { name: 'Sit-ups', reps: 15 }),
    ] } },
  ],
};

export const formatWorkouts = [cindy, fran, partnerEmom16, partnerSprints, runSledRun, backSquatFives, mixedSession];

export const fixtureWorkouts = [...timedWorkouts, ...formatWorkouts, ...coachWorkouts];
