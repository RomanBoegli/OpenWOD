import type { Prescription, Workout, WorkoutNode } from '../schema';

// ---------------------------------------------------------------------------------------------------------------
// Coach programs: standalone pieces curated from CrossFit class programs shared in a members chat. Each workout is
// one part of a class (a metcon, an EMOM, an interval block or a strength block), never the whole class. Loads
// follow the program's men's (heavy) and women's (medium) values with a lighter level added by Wodva.
// ---------------------------------------------------------------------------------------------------------------

type Section = Workout['sections'][number];
type Task = Extract<WorkoutNode, { type: 'task' }>;
type Completion = NonNullable<Task['completion']>;

const ATTRIBUTION: Workout['attribution'] = { author: 'Coach programming, shared in a members chat', notes: 'Curated from a CrossFit class program; loads are training suggestions with light/medium/heavy levels added by Wodva.' };
const base = { schemaVersion: 2, revision: 1, prepMs: 10_000, attribution: ATTRIBUTION } as const;

const task = (id: string, A: Prescription): Task => ({ id, type: 'task', assignments: { A } });
/** A pair task where both athletes share the prescription. */
const pairTask = (id: string, A: Prescription, completion?: Completion): Task => ({ id, type: 'task', assignments: { A, B: structuredClone(A) }, ...(completion ? { completion } : {}) });
const timed = (id: string, name: string, durationMs: number, extra: Partial<Prescription> = {}): WorkoutNode => ({ id, type: 'timed', durationMs, assignments: { A: { name, ...extra } } });
const rest = (id: string, durationMs: number): WorkoutNode => ({ id, type: 'rest', kind: 'blockRest', durationMs });
const kg = (light: number, medium: number, heavy: number) => ({ light: { value: light, unit: 'kg' as const }, medium: { value: medium, unit: 'kg' as const }, heavy: { value: heavy, unit: 'kg' as const } });
const percent = (light: number, medium: number, heavy: number) => ({ light: { value: light, unit: 'percent' as const }, medium: { value: medium, unit: 'percent' as const }, heavy: { value: heavy, unit: 'percent' as const } });
const m = (value: number) => ({ value, unit: 'm' as const });

const amrap = (id: string, title: string, capMs: number, children: WorkoutNode[], counter: Section['counter'] = 'roundsAndReps'): Section => ({ id, title, format: 'amrap', transitionAfter: 'manualReady', capMs, counter, body: { id: `${id}-round`, type: 'sequence', children } });
const emom = (id: string, title: string, intervalMs: number, intervals: number, children: WorkoutNode[]): Section => ({ id, title, format: 'emom', transitionAfter: 'manualReady', intervalMs, intervals, body: children.length === 1 ? children[0] : { id: `${id}-stations`, type: 'sequence', children } });
const forTime = (id: string, title: string, body: WorkoutNode, capMs?: number): Section => ({ id, title, format: 'forTime', transitionAfter: 'manualReady', ...(capMs ? { capMs } : {}), body });
const circuit = (id: string, title: string, body: WorkoutNode): Section => ({ id, title, format: 'timedCircuit', transitionAfter: 'manualReady', body });

// ------------------------------------------------------------------ AMRAP ------------------------------------------------------------------

/** Program 6, long metcon: a 25-minute AMRAP with a rowing lead-in and a minute of rest built into every round. */
export const rackAndRun: Workout = {
  ...base, id: 'rack-and-run-amrap-25',
  title: 'Rack & Run AMRAP 25',
  description: 'Twenty-five minutes: row, then five of everything on one barbell, then a minute of rest before the next round. The rest is part of the round, so take it by your own watch and go again. Pick a bar you can clean unbroken when tired.',
  equipment: ['Rowing machine', 'Barbell'], participants: 1,
  sections: [amrap('rack-run', 'AMRAP 25', 1_500_000, [
    task('rack-run-row', { name: 'Row', distance: m(600), notes: '500 m if scaling' }),
    task('rack-run-burpees-1', { name: 'Burpees over bar', reps: 5 }),
    task('rack-run-deadlifts', { name: 'Deadlifts', reps: 5, load: kg(25, 40, 55), notes: 'Program: 50–60 kg men, 35–42.5 kg women; one bar for all lifts' }),
    task('rack-run-cleans', { name: 'Cleans', reps: 5, load: kg(25, 40, 55) }),
    task('rack-run-s2oh', { name: 'Shoulder-to-overhead', shortName: 'S2OH', reps: 5, load: kg(25, 40, 55) }),
    task('rack-run-burpees-2', { name: 'Burpees over bar', reps: 5 }),
    task('rack-run-rest', { name: 'Rest', timeMs: 60_000, notes: 'One minute by your own watch, then start the next round' }),
  ])],
};

/** Program 11, metcon: two ten-minute AMRAPs with two minutes between them. */
export const doubleAmrap10: Workout = {
  ...base, id: 'double-amrap-10',
  title: 'Double AMRAP 10',
  description: 'Two ten-minute AMRAPs of row, toes-to-bar, front squats and burpees over the bar, scored as rounds plus reps. Rest two minutes between the two, then tap Ready. Aim to match the first score in the second half.',
  equipment: ['Rowing machine', 'Pull-up bar', 'Barbell'], participants: 1,
  sections: [1, 2].map(part => amrap(`double-amrap-${part}`, `AMRAP 10, part ${part}`, 600_000, [
    task(`double-amrap-${part}-row`, { name: 'Row', calories: 21, notes: '17 cal if scaling' }),
    task(`double-amrap-${part}-t2b`, { name: 'Toes-to-bar', reps: 12 }),
    task(`double-amrap-${part}-front-squats`, { name: 'Front squats', reps: 9, load: kg(30, 42.5, 60) }),
    task(`double-amrap-${part}-burpees`, { name: 'Burpees over bar', reps: 6 }),
  ])),
};

/** Program 12, metcon: three four-minute AMRAPs with ninety seconds between them. */
export const tripleAmrap4: Workout = {
  ...base, id: 'triple-amrap-4',
  title: 'Triple AMRAP 4',
  description: 'Three four-minute sprints: row, double dumbbell clean and jerks, bar muscle-ups, then as many farmers carry shuttles as you can in the time left. Ninety seconds of rest between the sprints, then tap Ready. Go hard; the rest is coming.',
  equipment: ['Rowing machine', 'Dumbbells', 'Pull-up bar'], participants: 1,
  sections: [1, 2, 3].map(part => amrap(`triple-amrap-${part}`, `AMRAP 4, part ${part}`, 240_000, [
    task(`triple-amrap-${part}-row`, { name: 'Row', calories: 21, notes: '17 cal if scaling' }),
    task(`triple-amrap-${part}-clean-jerks`, { name: 'Double dumbbell clean and jerks', shortName: 'DB clean & jerks', reps: 15, load: kg(12, 17.5, 22.5), notes: 'Load per dumbbell' }),
    task(`triple-amrap-${part}-muscle-ups`, { name: 'Bar muscle-ups', reps: 9, notes: '15 pull-ups if scaling' }),
    task(`triple-amrap-${part}-shuttles`, { name: 'Farmers carry shuttles', shortName: 'Carry shuttles', distance: m(7.5), load: kg(12, 17.5, 22.5), notes: 'Max lengths in the time left; count each as a rep' }),
  ])),
};

/** Program 16, metcon: fourteen minutes of fourteens. */
export const fourteensAmrap: Workout = {
  ...base, id: 'fourteens-amrap-14',
  title: 'Fourteens AMRAP 14',
  description: 'Fourteen minutes of fourteen toes-to-bar, fourteen calories on the rower, fourteen thrusters and fourteen lateral burpees over the bar. Break the toes-to-bar early and keep the thrusters to two sets at most.',
  equipment: ['Pull-up bar', 'Rowing machine', 'Barbell'], participants: 1,
  sections: [amrap('fourteens', 'AMRAP 14', 840_000, [
    task('fourteens-t2b', { name: 'Toes-to-bar', reps: 14 }),
    task('fourteens-row', { name: 'Row', calories: 14, notes: '12 cal if scaling' }),
    task('fourteens-thrusters', { name: 'Thrusters', reps: 14, load: kg(20, 30, 43) }),
    task('fourteens-burpees', { name: 'Lateral burpees over bar', shortName: 'Lateral burpees', reps: 14 }),
  ])],
};

/** Program 21, metcon: an ascending ladder of pull-ups, farmers carries and burpees over the dumbbells. */
export const pullCarryBurpeeLadder: Workout = {
  ...base, id: 'pull-carry-burpee-ladder',
  title: 'Pull, carry, burpee ladder',
  description: 'An ascending ladder: one pull-up, one lane of farmers carry and one burpee over the dumbbells, then two of each, then three, and so on for fifteen minutes. The program allows twelve to fifteen minutes; the cap here is fifteen. Score the completed rounds.',
  equipment: ['Pull-up bar', 'Dumbbells'], participants: 1,
  sections: [amrap('ladder', 'AMRAP 15', 900_000, [
    task('ladder-pull-ups', { name: 'Pull-ups', notes: 'Round 1: 1 rep, round 2: 2 reps, and so on' }),
    task('ladder-carry', { name: 'Dumbbell farmers carry', shortName: 'Farmers carry', load: kg(12, 17.5, 22.5), notes: 'Lane lengths climb with the round; no grips' }),
    task('ladder-burpees', { name: 'Burpees over dumbbells', shortName: 'Burpees over DB', notes: 'Reps climb with the round' }),
  ], 'rounds')],
};

/** Program 17, metcon: two three-minute windows with fixed work and max toes-to-bar in the remainder. */
export const threeMinuteWindows: Workout = {
  ...base, id: 'three-minute-windows',
  title: 'Two 3-minute windows',
  description: 'Two three-minute windows with two minutes of rest between them. Finish the fixed work fast, then do as many toes-to-bar as you can before the clock runs out; the toes-to-bar count is your score, so tap the rep counter. Scale the handstand walk to wall walks or bear crawls.',
  equipment: ['Barbell', 'Plyo box', 'Pull-up bar'], participants: 1,
  sections: [
    amrap('window-1', 'Window 1', 180_000, [
      task('window-1-deadlifts', { name: 'Deadlifts', reps: 12, load: kg(40, 65, 85) }),
      task('window-1-box-jump-overs', { name: 'Box jump overs', reps: 12, notes: 'Step down' }),
      task('window-1-hs-walk', { name: 'Handstand walk', distance: m(14) }),
      task('window-1-t2b', { name: 'Toes-to-bar', notes: 'Max reps in the time left: count them as reps' }),
    ]),
    amrap('window-2', 'Window 2', 180_000, [
      task('window-2-power-cleans', { name: 'Power cleans', reps: 8, load: kg(30, 45, 65) }),
      task('window-2-s2oh', { name: 'Shoulder-to-overhead', shortName: 'S2OH', reps: 8, load: kg(30, 45, 65) }),
      task('window-2-hs-walk', { name: 'Handstand walk', distance: m(14) }),
      task('window-2-t2b', { name: 'Toes-to-bar', notes: 'Max reps in the time left: count them as reps' }),
    ]),
  ],
};

// ------------------------------------------------------------------ EMOM -------------------------------------------------------------------

/** Program 1, metcon: wall balls, row, burpee box jump overs, rest, five times through. */
export const wallBallRowBurpeeEmom: Workout = {
  ...base, id: 'wall-ball-row-burpee-emom-20',
  title: 'Wall ball, row, burpee EMOM 20',
  description: 'Every minute for twenty minutes: a minute of wall balls, a minute on the rower, a minute of burpee box jump overs, a minute of rest; five rounds. Finish the work, then recover until the next minute starts. Trim the reps if you cannot finish inside 45 seconds.',
  equipment: ['Medicine ball', 'Rowing machine', 'Plyo box'], participants: 1,
  sections: [emom('wbrb', 'EMOM 20', 60_000, 20, [
    task('wbrb-wall-balls', { name: 'Wall balls', reps: 21, notes: 'Big, unbroken sets if you can' }),
    task('wbrb-row', { name: 'Row', calories: 15, notes: '12 cal if scaling; strong pulls, save the legs' }),
    task('wbrb-burpees', { name: 'Burpee box jump overs', shortName: 'Burpee box overs', reps: 9, notes: 'Steady rhythm, no pauses' }),
    task('wbrb-rest', { name: 'Rest', notes: 'Bring the breathing back under control' }),
  ])],
};

/** Program 2, strength part: curls, push-ups and sit-ups, four rounds of three stations. */
export const summerBodyEmom: Workout = {
  ...base, id: 'curls-push-ups-sit-ups-emom-12',
  title: 'Summer-body EMOM 12',
  description: 'Three stations, four rounds: biceps curls, push-ups and sit-ups, each on its own minute. The program calls it an EMOM 20, but three stations times four rounds is twelve minutes, so the clock runs twelve. Reps drop 14-12-10-8 across the rounds while the curl weight goes up.',
  equipment: ['Dumbbells'], participants: 1,
  sections: [emom('summer', 'EMOM 12', 60_000, 12, [
    task('summer-curls', { name: 'Biceps curls', reps: 8, notes: '14-12-10-8 across the rounds; add weight each round' }),
    task('summer-push-ups', { name: 'Push-ups', reps: 8, notes: '14-12-10-8 across the rounds; plate on the back if easy' }),
    task('summer-sit-ups', { name: 'Sit-ups', notes: 'A steady set; V-ups if you want more' }),
  ])],
};

/** Program 7, long metcon: twenty rounds of row, burpees and one clean and jerk every two minutes. */
export const rowBurpeeCleanJerkE2mom: Workout = {
  ...base, id: 'row-burpee-clean-jerk-e2mom-40',
  title: 'Row, burpee, clean & jerk E2MOM 40',
  description: 'Every two minutes for forty minutes: eighteen calories on the rower, four burpees over the rower and one clean and jerk at about seventy percent. Twenty rounds is long, so settle into a row pace that leaves time for a clean lift and a breath.',
  equipment: ['Rowing machine', 'Barbell'], participants: 1,
  sections: [emom('rbcj', 'E2MOM 40', 120_000, 20, [
    task('rbcj-round', { name: 'Row 18 cal, 4 burpees over rower, 1 clean & jerk', shortName: 'Row, burpees, C&J', calories: 18, load: percent(65, 70, 75), notes: '15 cal if scaling; the load is the clean & jerk at 70–75 %' }),
  ])],
};

/** Program 17, upper-body strength endurance: handstand push-ups, overhead lunges and wall balls. */
export const overheadEnduranceEmom: Workout = {
  ...base, id: 'overhead-endurance-emom-20',
  title: 'Overhead endurance EMOM 20',
  description: 'Four stations, five rounds: thirty seconds of strict handstand push-ups, ten dumbbell overhead walking lunge steps, thirty seconds of kipping handstand push-ups, twenty wall balls. Pick a handstand push-up variation you can keep moving for the full thirty seconds.',
  equipment: ['Wall', 'Dumbbells', 'Medicine ball'], participants: 1,
  sections: [emom('overhead', 'EMOM 20', 60_000, 20, [
    task('overhead-strict-hspu', { name: 'Strict handstand push-ups', shortName: 'Strict HSPU', timeMs: 30_000, notes: '30 s of work; pike push-ups to scale' }),
    task('overhead-lunges', { name: 'Dumbbell overhead walking lunges', shortName: 'DB overhead lunges', reps: 10, notes: 'Two dumbbells overhead; 45 s cap' }),
    task('overhead-kipping-hspu', { name: 'Kipping handstand push-ups', shortName: 'Kipping HSPU', timeMs: 30_000, notes: '30 s of work' }),
    task('overhead-wall-balls', { name: 'Wall balls', reps: 20, notes: 'Standard ball and target; 45 s cap' }),
  ])],
};

/** Program 19, metcon: five stations of bar work, lunges, wall balls and recovery. */
export const barLungeWallBallEmom: Workout = {
  ...base, id: 'bar-lunge-wall-ball-emom-20',
  title: 'Bar, lunge & wall ball EMOM 20',
  description: 'Five stations, four rounds: thirty seconds of toes-to-bar, sixteen metres of single-dumbbell overhead lunges, thirty seconds of chest-to-bar pull-ups, twenty-four wall balls, then a minute of easy skiing or biking. The recovery minute is part of the plan; use it.',
  equipment: ['Pull-up bar', 'Dumbbells', 'Medicine ball', 'SkiErg'], participants: 1,
  sections: [emom('blwb', 'EMOM 20', 60_000, 20, [
    task('blwb-t2b', { name: 'Toes-to-bar', timeMs: 30_000, notes: '30 s of work' }),
    task('blwb-lunges', { name: 'Dumbbell overhead walking lunges', shortName: 'DB overhead lunges', distance: m(16), load: kg(15, 22.5, 30), notes: 'One dumbbell, 2 × 8 m; switch arms halfway' }),
    task('blwb-c2b', { name: 'Chest-to-bar pull-ups', shortName: 'C2B pull-ups', timeMs: 30_000, notes: '30 s of work' }),
    task('blwb-wall-balls', { name: 'Wall balls', reps: 24, load: kg(4, 6, 9) }),
    task('blwb-recovery', { name: 'Active recovery', notes: 'Easy SkiErg or bike' }),
  ])],
};

// ----------------------------------------------------------------- For time ----------------------------------------------------------------

/** Program 4, metcon: a mirrored chipper for a pair. */
export const partnerMirrorChipper: Workout = {
  ...base, id: 'partner-mirror-chipper',
  title: 'Partner mirror chipper',
  description: 'A chipper for two that climbs down and back up: row, wall balls, slam balls, handstand push-ups, burpees over the rower, then the same steps in reverse. One athlete works at a time; split every step however you like and tap Done when a step is finished.',
  equipment: ['Rowing machine', 'Medicine ball', 'Slam ball', 'Wall'], participants: 2,
  sections: [forTime('mirror', 'Chipper', { id: 'mirror-steps', type: 'sequence', children: [
    pairTask('mirror-row-1', { name: 'Row', calories: 50, notes: 'Split as you like' }, 'team'),
    pairTask('mirror-wall-balls-1', { name: 'Wall balls', reps: 40, load: kg(6, 9, 12) }, 'team'),
    pairTask('mirror-slam-balls-1', { name: 'Slam ball ground-to-overhead', shortName: 'Slam ball G2OH', reps: 30, load: kg(12, 20, 30) }, 'team'),
    pairTask('mirror-hspu-1', { name: 'Handstand push-ups', shortName: 'HSPU', reps: 20 }, 'team'),
    pairTask('mirror-burpees', { name: 'Burpees over rower', reps: 10 }, 'team'),
    pairTask('mirror-hspu-2', { name: 'Handstand push-ups', shortName: 'HSPU', reps: 20 }, 'team'),
    pairTask('mirror-slam-balls-2', { name: 'Slam ball ground-to-overhead', shortName: 'Slam ball G2OH', reps: 30, load: kg(12, 20, 30) }, 'team'),
    pairTask('mirror-wall-balls-2', { name: 'Wall balls', reps: 40, load: kg(6, 9, 12) }, 'team'),
    pairTask('mirror-row-2', { name: 'Row', calories: 50, notes: 'Split as you like' }, 'team'),
  ] })],
};

/** Program 18, metcon: a synchronised chipper for a pair, down and back up. */
export const synchroSnatchChipper: Workout = {
  ...base, id: 'synchro-snatch-chipper',
  title: 'Synchro snatch chipper',
  description: 'Ten to fifty and back down for a pair. The lunges, box jump overs and sit-ups are synchronised, so both of you tap Done; the squat snatches and dumbbell thrusters are shared, so split them and tap Done once. Keep the snatch bar at a weight you can cycle in singles without misses.',
  equipment: ['Dumbbells', 'Barbell', 'Plyo box', 'AbMat'], participants: 2,
  sections: [forTime('synchro', 'Chipper', { id: 'synchro-steps', type: 'sequence', children: [
    pairTask('synchro-lunges-1', { name: 'Dumbbell overhead lunges', shortName: 'DB overhead lunges', reps: 10, notes: 'Synchro, one dumbbell each' }, 'both'),
    pairTask('synchro-snatches-1', { name: 'Squat snatches', reps: 20, load: kg(30, 42, 61), notes: 'Split as you like' }, 'team'),
    pairTask('synchro-box-jump-overs-1', { name: 'Box jump overs', reps: 30, notes: 'Synchro' }, 'both'),
    pairTask('synchro-thrusters-1', { name: 'Single-dumbbell thrusters', shortName: 'DB thrusters', reps: 40, notes: 'Split as you like' }, 'team'),
    pairTask('synchro-sit-ups', { name: 'AbMat sit-ups', reps: 50, notes: 'Synchro: clap hands at the top' }, 'both'),
    pairTask('synchro-thrusters-2', { name: 'Single-dumbbell thrusters', shortName: 'DB thrusters', reps: 40, notes: 'Split as you like' }, 'team'),
    pairTask('synchro-box-jump-overs-2', { name: 'Box jump overs', reps: 30, notes: 'Synchro' }, 'both'),
    pairTask('synchro-snatches-2', { name: 'Squat snatches', reps: 20, load: kg(30, 42, 61), notes: 'Split as you like' }, 'team'),
    pairTask('synchro-lunges-2', { name: 'Dumbbell overhead lunges', shortName: 'DB overhead lunges', reps: 10, notes: 'Synchro, one dumbbell each' }, 'both'),
  ] })],
};

/** Program 26, metcon: a descending ladder where the bar gets heavier and the pulling gets harder. */
export const pullAndPressLadder: Workout = {
  ...base, id: 'pull-and-press-ladder',
  title: 'Pull & press ladder',
  description: 'Three rungs, twelve-minute cap: 15-12-9 pull-ups, shoulder-to-overhead and hang cleans, then 12-9-6 with chest-to-bar and a heavier bar, then 9-6-3 with bar muscle-ups and the heaviest bar. The minute of rest after each rung is timed for you. Change plates during the rest.',
  equipment: ['Pull-up bar', 'Barbell'], participants: 1,
  sections: [forTime('ladder-ft', 'Ladder', { id: 'ladder-ft-rungs', type: 'sequence', children: [
    task('ladder-ft-pull-ups', { name: 'Pull-ups', reps: 15 }),
    task('ladder-ft-s2oh-1', { name: 'Shoulder-to-overhead', shortName: 'S2OH', reps: 12, load: kg(30, 43, 60) }),
    task('ladder-ft-hang-cleans-1', { name: 'Hang cleans', reps: 9, load: kg(30, 43, 60) }),
    rest('ladder-ft-rest-1', 60_000),
    task('ladder-ft-c2b', { name: 'Chest-to-bar pull-ups', shortName: 'C2B pull-ups', reps: 12 }),
    task('ladder-ft-s2oh-2', { name: 'Shoulder-to-overhead', shortName: 'S2OH', reps: 9, load: kg(35, 50, 70) }),
    task('ladder-ft-hang-cleans-2', { name: 'Hang cleans', reps: 6, load: kg(35, 50, 70) }),
    rest('ladder-ft-rest-2', 60_000),
    task('ladder-ft-muscle-ups', { name: 'Bar muscle-ups', reps: 9 }),
    task('ladder-ft-s2oh-3', { name: 'Shoulder-to-overhead', shortName: 'S2OH', reps: 6, load: kg(40, 60, 85) }),
    task('ladder-ft-hang-cleans-3', { name: 'Hang cleans', reps: 3, load: kg(40, 60, 85) }),
  ] }, 720_000)],
};

/** Program 20, metcon: three rounds of ski, double-unders and bar muscle-ups. */
export const skiSkipMuscleUp: Workout = {
  ...base, id: 'ski-skip-muscle-up-rounds',
  title: 'Ski, skip, muscle-up × 3',
  description: 'Three rounds for time: 250 metres on the SkiErg, fifty double-unders, five bar muscle-ups. Short and sharp, so ski hard and keep the rope relaxed. Scale the muscle-ups to chest-to-bar or jumping muscle-ups.',
  equipment: ['SkiErg', 'Jump rope', 'Pull-up bar'], participants: 1,
  sections: [forTime('ssm', 'Three rounds', { id: 'ssm-rounds', type: 'repeat', count: 3, body: { id: 'ssm-round', type: 'sequence', children: [
    task('ssm-ski', { name: 'SkiErg', distance: m(250) }),
    task('ssm-double-unders', { name: 'Double-unders', reps: 50 }),
    task('ssm-muscle-ups', { name: 'Bar muscle-ups', reps: 5 }),
  ] } })],
};

/** Program 25, metcon: four mixed rounds with thirty seconds of rest, nineteen-minute cap. */
export const mixedRoundsUnder19: Workout = {
  ...base, id: 'mixed-rounds-under-19',
  title: 'Mixed rounds under 19',
  description: 'Four rounds for time under a nineteen-minute cap: squats, lunges, sit-ups, a short row, hand-release push-ups and ring rows, with thirty seconds of timed rest after each round. Nothing here is heavy, so the aim is to keep moving at one steady pace.',
  equipment: ['Plates', 'AbMat', 'Rowing machine', 'Rings'], participants: 1,
  sections: [forTime('mixed-rounds', 'Four rounds', { id: 'mixed-rounds-repeat', type: 'repeat', count: 4, betweenIterationsRestMs: 30_000, body: { id: 'mixed-rounds-round', type: 'sequence', children: [
    task('mixed-rounds-squats', { name: 'Air squats to a plate', shortName: 'Squats to plate', reps: 21 }),
    task('mixed-rounds-lunges', { name: 'Lunges', reps: 21 }),
    task('mixed-rounds-sit-ups', { name: 'AbMat sit-ups', reps: 15 }),
    task('mixed-rounds-row', { name: 'Row', calories: 15 }),
    task('mixed-rounds-push-ups', { name: 'Hand-release push-ups', shortName: 'HR push-ups', reps: 9 }),
    task('mixed-rounds-ring-rows', { name: 'Ring rows', reps: 9, notes: 'Or barbell rows in the rack' }),
  ] } }, 1_140_000)],
};

// -------------------------------------------------------------- Timed intervals ------------------------------------------------------------

/** Program 4, grip and core: ten intervals of 45 seconds on, 20 off, alternating a pinch hold and a suitcase carry. */
export const gripAndCoreIntervals: Workout = {
  ...base, id: 'grip-and-core-intervals',
  title: 'Grip & core intervals',
  description: 'Ten intervals of 45 seconds on and 20 seconds off, alternating a plate pinch hold with a kettlebell suitcase carry. Hold the plates or hang from the bar for the whole interval; on the carry, stand tall and switch hands halfway.',
  equipment: ['Plates', 'Kettlebell'], participants: 1,
  sections: [circuit('grip', 'Grip & core', { id: 'grip-rounds', type: 'repeat', count: 5, betweenIterationsRestMs: 20_000, body: { id: 'grip-pair', type: 'sequence', betweenChildrenRestMs: 20_000, children: [
    timed('grip-pinch', 'Plate pinch hold', 45_000, { notes: 'Or a dead hang from the bar' }),
    timed('grip-carry', 'Kettlebell suitcase carry', 45_000, { shortName: 'Suitcase carry', notes: 'Switch hands halfway' }),
  ] } })],
};

/** Program 8, part C: eight rowing intervals of 1:30 on, 1:00 off. */
export const rowIntervals8x90: Workout = {
  ...base, id: 'row-intervals-8x90',
  title: 'Row intervals 8 × 1:30',
  description: 'Eight rowing intervals of ninety seconds with a minute off between them. Pick a hard pace you can repeat eight times and hold it from the first stroke to the last; the score is how little the splits drift.',
  equipment: ['Rowing machine'], participants: 1,
  sections: [circuit('row-intervals', 'Row intervals', { id: 'row-intervals-rounds', type: 'repeat', count: 8, betweenIterationsRestMs: 60_000, body: timed('row-intervals-work', 'Row', 90_000, { notes: 'Hard, constant pace' }) })],
};

/** Program 1, gymnastics and core: eight intervals of 40 on, 40 off, rotating double-unders and toes-to-bar into a core hold. */
export const skipAndToes40: Workout = {
  ...base, id: 'skip-and-toes-40-40',
  title: 'Skip & toes 40/40',
  description: 'Eight intervals of forty seconds on and forty off, alternating double-unders with toes-to-bar that end in a twenty-second core hold. Relaxed kip, tight midline, quality over quantity.',
  equipment: ['Jump rope', 'Pull-up bar'], participants: 1,
  sections: [circuit('skip-toes', 'Gymnastics & core', { id: 'skip-toes-rounds', type: 'repeat', count: 4, betweenIterationsRestMs: 40_000, body: { id: 'skip-toes-pair', type: 'sequence', betweenChildrenRestMs: 40_000, children: [
    timed('skip-toes-double-unders', 'Double-unders', 40_000, { reps: 40, notes: 'Done early? Hold a hollow position' }),
    timed('skip-toes-t2b', 'Toes-to-bar into core hold', 40_000, { shortName: 'T2B + core hold', notes: 'T2B, then a 20 s hollow hold' }),
  ] } })],
};

// ----------------------------------------------------------------- Strength ----------------------------------------------------------------

/** Program 13, strength A: seven back squat sets every 2:30, reps falling as the load climbs. */
export const squatPowerE230: Workout = {
  ...base, id: 'squat-power-e2-30',
  title: 'Squat power E2:30',
  description: 'Seven sets of back squats on a 2:30 clock, reps falling from six to two while the load climbs from sixty percent to a heavy double. No grinding reps: if you do not know your percentages, work up cleanly to a heavy double. Tap Done after each set; two minutes of rest are timed for you.',
  equipment: ['Barbell', 'Squat rack'], participants: 1,
  sections: [{ id: 'squat-power', title: 'Back squat', format: 'strength', transitionAfter: 'manualReady', body: { id: 'squat-power-sets', type: 'sequence', betweenChildrenRestMs: 120_000, children: [
    task('squat-power-set-1', { name: 'Back squat', reps: 6, load: percent(55, 60, 65) }),
    task('squat-power-set-2', { name: 'Back squat', reps: 5, load: percent(65, 70, 75) }),
    task('squat-power-set-3', { name: 'Back squat', reps: 4, load: percent(70, 75, 80) }),
    task('squat-power-set-4', { name: 'Back squat', reps: 3, load: percent(75, 80, 85) }),
    task('squat-power-set-5', { name: 'Back squat', reps: 3, load: percent(80, 82.5, 85), notes: 'Program: 82–85 %' }),
    task('squat-power-set-6', { name: 'Back squat', reps: 2, load: percent(85, 86.5, 88), notes: 'Program: 85–88 %' }),
    task('squat-power-set-7', { name: 'Back squat', reps: 2, notes: 'RPE 8–9: a heavy double, no grind' }),
  ] } }],
};

/** Program 6, strength: six sets of three pause front squats. */
export const pauseFrontSquat6x3: Workout = {
  ...base, id: 'pause-front-squat-6x3',
  title: 'Pause front squat 6 × 3',
  description: 'Six sets of three front squats with a one- to two-second pause in the bottom, starting around sixty-five percent and building only while the position stays strong. Heavy but clean. Tap Done after each set; ninety seconds of rest are timed, and the program allows up to two minutes.',
  equipment: ['Barbell', 'Squat rack'], participants: 1,
  sections: [{ id: 'pause-fs', title: 'Pause front squat', format: 'strength', transitionAfter: 'manualReady', body: { id: 'pause-fs-sets', type: 'repeat', count: 6, betweenIterationsRestMs: 90_000, body: task('pause-fs-set', { name: 'Pause front squat', reps: 3, load: percent(60, 65, 70), notes: '1–2 s pause in the bottom; build only if position holds' }) } }],
};

// --------------------------------------------------------------- You go, I go --------------------------------------------------------------

/** Program 9, metcon: twelve alternating sprint rounds, six each. */
export const rowBurpeeDumbbellSprints: Workout = {
  ...base, id: 'row-burpee-dumbbell-sprints',
  title: 'You go, I go sprints 12',
  description: 'Twelve sprint rounds, six each: fifteen calories on the rower, eight burpee box jump overs and six single-dumbbell clean and jerks, then tap Switch while your partner goes. You get about ninety seconds of rest every turn, so the dumbbell should be heavy and the row should hurt.',
  equipment: ['Rowing machine', 'Plyo box', 'Dumbbells'], participants: 2,
  sections: [{ id: 'sprints-12', title: 'Sprints', format: 'youGoIGo', transitionAfter: 'manualReady', rounds: 6, body: { id: 'sprints-12-turn', type: 'sequence', children: [
    pairTask('sprints-12-row', { name: 'Row', calories: 15, notes: '12 cal if scaling' }),
    pairTask('sprints-12-burpees', { name: 'Burpee box jump overs', shortName: 'Burpee box overs', reps: 8, notes: 'Twist: box jump over, then burpee box jump over, one side' }),
    pairTask('sprints-12-clean-jerks', { name: 'Single-dumbbell clean and jerks', shortName: 'DB clean & jerks', reps: 6, load: kg(15, 25, 35), notes: 'Heavy: it should be challenging' }),
  ] } }],
};

export const coachWorkouts: Workout[] = [
  rackAndRun, doubleAmrap10, tripleAmrap4, fourteensAmrap, pullCarryBurpeeLadder, threeMinuteWindows,
  wallBallRowBurpeeEmom, summerBodyEmom, rowBurpeeCleanJerkE2mom, overheadEnduranceEmom, barLungeWallBallEmom,
  partnerMirrorChipper, synchroSnatchChipper, pullAndPressLadder, skiSkipMuscleUp, mixedRoundsUnder19,
  gripAndCoreIntervals, rowIntervals8x90, skipAndToes40,
  squatPowerE230, pauseFrontSquat6x3,
  rowBurpeeDumbbellSprints,
];
