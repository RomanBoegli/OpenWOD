import type { Prescription, Workout, WorkoutNode } from './schema';

const pair = (A: string, B: string) => ({ A: { name: A }, B: { name: B } });
const slot = (id: string, A: string, B: string, durationMs = 40_000): WorkoutNode => ({ id, type: 'timed', durationMs, assignments: pair(A, B) });

export const partnerCircuit: Workout = {
  schemaVersion: 1, id: 'partner-circuit', revision: 1,
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
  schemaVersion: 1, id: 'full-body-partner', revision: 1,
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
  schemaVersion: 1, id: 'tabata-this', revision: 1,
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
  schemaVersion: 1, id: 'fight-gone-bad', revision: 1,
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
  schemaVersion: 1, id: 'row-burpee-emom-20', revision: 1,
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
  schemaVersion: 1, id: 'hyrox-pace-intervals', revision: 1,
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
  schemaVersion: 1, id: 'hyrox-doubles-circuit', revision: 1,
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
  schemaVersion: 1, id: 'hyrox-engine-emom-24', revision: 1,
  title: 'HYROX engine EMOM 24',
  description: 'Every minute for 24 minutes: a hard minute of running, a minute on the next station, a minute of wall balls. Eight cycles cover all eight stations. Keep moving for the full minute; the next one starts whether you are ready or not.',
  attribution: HYROX_SOURCE,
  equipment: ['Treadmill or running route', 'SkiErg', 'Sled', 'Rowing machine', 'Kettlebells', 'Sandbag', 'Medicine ball'], participants: 1, prepMs: 10_000,
  sections: [section('engine', 'EMOM 24', {
    id: 'engine-sequence', type: 'sequence',
    children: HYROX_STATIONS.flatMap(([id, name], index) => [solo(`engine-run-${index + 1}`, 'Run', 60_000, { notes: 'Hard but repeatable' }), solo(`engine-${id}`, name, 60_000), solo(`engine-wall-balls-${index + 1}`, 'Wall balls', 60_000, { notes: 'Steady reps' })]),
  })],
};

export const fixtureWorkouts = [partnerCircuit, fullBodyPartner, tabataThis, fightGoneBad, rowBurpeeEmom, hyroxPaceIntervals, hyroxDoublesCircuit, hyroxEngineEmom];

export function prescriptionText(value: Prescription): string {
  const targets = [value.reps ? `${value.reps} reps` : '', value.load ? `${value.load.value} ${value.load.unit}` : ''].filter(Boolean).join(' · ');
  return targets || value.notes || 'Steady effort. Your pace.';
}
