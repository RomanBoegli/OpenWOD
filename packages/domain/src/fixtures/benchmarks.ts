import type { Prescription, Workout, WorkoutNode } from '../schema';

// ---------------------------------------------------------------------------------------------------------------
// CrossFit benchmarks ("the girls" and the hero workouts). Each follows its published structure. Loads use the
// published men's Rx as heavy and the women's Rx as medium, with a lighter level added as a common scaling; all
// are rounded to kilograms. Time caps on the for-time pieces are training suggestions, not part of the benchmark.
// Fran and Cindy live in ../fixtures.ts.
// ---------------------------------------------------------------------------------------------------------------

type Section = Workout['sections'][number];
type Task = Extract<WorkoutNode, { type: 'task' }>;

const NOTES = 'Follows the published benchmark. Heavy is the published men’s Rx, medium the women’s Rx, light a common scaling, rounded to kilograms.';
const attribution = (slug: string): Workout['attribution'] => ({ author: 'CrossFit', sourceUrl: `https://www.crossfit.com/benchmark/${slug}`, notes: NOTES });
const base = { schemaVersion: 2, revision: 1, prepMs: 10_000, participants: 1 } as const;

const task = (id: string, A: Prescription): Task => ({ id, type: 'task', assignments: { A } });
const kg = (light: number, medium: number, heavy: number) => ({ light: { value: light, unit: 'kg' as const }, medium: { value: medium, unit: 'kg' as const }, heavy: { value: heavy, unit: 'kg' as const } });
const m = (value: number) => ({ value, unit: 'm' as const });
const km = (value: number) => ({ value, unit: 'km' as const });
/** Fresh objects per call: the validator rejects shared references inside one workout. */
const mile = () => km(1.6);

const forTime = (id: string, title: string, capMs: number, body: WorkoutNode): Section => ({ id, title, format: 'forTime', transitionAfter: 'manualReady', capMs, body });
const sequence = (id: string, children: WorkoutNode[]): WorkoutNode => ({ id, type: 'sequence', children });
const rounds = (id: string, count: number, children: WorkoutNode[]): WorkoutNode => ({ id, type: 'repeat', count, body: sequence(`${id}-round`, children) });

const bar95 = () => kg(20, 30, 43);
const bar135 = () => kg(30, 43, 61);
const bar225 = () => kg(45, 70, 102);

// ------------------------------------------------------------------ The girls ------------------------------------------------------------------

/** 150 wall-ball shots for time. */
export const karen: Workout = {
  ...base, id: 'karen',
  title: 'Karen',
  description: 'One hundred and fifty wall-ball shots, nothing else. Break them into sets you can repeat from the first rep, because the last fifty decide the time. Scale the ball or the target height before you scale the count; the ten-minute cap is a training suggestion, not part of the benchmark.',
  attribution: attribution('karen'),
  equipment: ['Medicine ball', 'Wall'],
  sections: [forTime('karen-for-time', '150 wall balls', 600_000,
    task('karen-wall-balls', { name: 'Wall-ball shots', reps: 150, load: kg(4, 6, 9), notes: 'Rx 20 lb ball to a 10 ft target (14 lb to 9 ft)' }),
  )],
};

/** Three rounds of 400 m run, 21 kettlebell swings, 12 pull-ups. */
export const helen: Workout = {
  ...base, id: 'helen',
  title: 'Helen',
  description: 'Three rounds of a 400 metre run, twenty-one kettlebell swings and twelve pull-ups. Run at a pace that lets you pick up the bell straight away and swing unbroken; the pull-ups are where most people lose time. Scale the bell and use a band or jumping pull-ups if needed; the fifteen-minute cap is a training suggestion, not part of the benchmark.',
  attribution: attribution('helen'),
  equipment: ['Running route', 'Kettlebell', 'Pull-up bar'],
  sections: [forTime('helen-for-time', 'Three rounds', 900_000, rounds('helen-rounds', 3, [
    task('helen-run', { name: 'Run', distance: m(400) }),
    task('helen-swings', { name: 'Kettlebell swings', reps: 21, load: kg(12, 16, 24), notes: 'Rx 24 kg (16 kg); swing to overhead' }),
    task('helen-pull-ups', { name: 'Pull-ups', reps: 12 }),
  ]))],
};

/** Five rounds of 400 m run and 15 overhead squats. */
export const nancy: Workout = {
  ...base, id: 'nancy',
  title: 'Nancy',
  description: 'Five rounds of a 400 metre run and fifteen overhead squats. The squats are light, so the test is holding a stable overhead position while breathing hard; keep the runs honest but controlled. Scale to a bar you can hold overhead for fifteen unbroken reps; the twenty-minute cap is a training suggestion, not part of the benchmark.',
  attribution: attribution('nancy'),
  equipment: ['Running route', 'Barbell'],
  sections: [forTime('nancy-for-time', 'Five rounds', 1_200_000, rounds('nancy-rounds', 5, [
    task('nancy-run', { name: 'Run', distance: m(400) }),
    task('nancy-ohs', { name: 'Overhead squats', reps: 15, load: bar95(), notes: 'Rx 95 lb (65 lb)' }),
  ]))],
};

/** 30 clean and jerks for time. */
export const grace: Workout = {
  ...base, id: 'grace',
  title: 'Grace',
  description: 'Thirty clean and jerks as fast as you can. Quick singles with a tight turnaround usually beat sets that fall apart; keep the technique sharp as the bar gets heavy. Scale the load so every rep is a sound lift; the eight-minute cap is a training suggestion, not part of the benchmark.',
  attribution: attribution('grace'),
  equipment: ['Barbell'],
  sections: [forTime('grace-for-time', '30 clean and jerks', 480_000,
    task('grace-clean-and-jerks', { name: 'Clean and jerks', reps: 30, load: bar135(), notes: 'Rx 135 lb (95 lb); ground to overhead, any style' }),
  )],
};

/** 30 snatches for time. */
export const isabel: Workout = {
  ...base, id: 'isabel',
  title: 'Isabel',
  description: 'Thirty snatches for time at the same load as Grace. The snatch punishes sloppy pulls when you are tired, so choose a rhythm you can hold and keep the bar close. Power snatches are fine; scale the load well before the technique breaks. The eight-minute cap is a training suggestion, not part of the benchmark.',
  attribution: attribution('isabel'),
  equipment: ['Barbell'],
  sections: [forTime('isabel-for-time', '30 snatches', 480_000,
    task('isabel-snatches', { name: 'Snatches', reps: 30, load: bar135(), notes: 'Rx 135 lb (95 lb); ground to overhead in one movement' }),
  )],
};

/** 21-15-9 deadlifts and handstand push-ups. */
export const diane: Workout = {
  ...base, id: 'diane',
  title: 'Diane',
  description: 'Deadlifts and handstand push-ups, 21-15-9. The deadlift is heavy enough to demand a solid back, and the handstand push-ups will slow down quickly, so break both early. Scale the bar to about sixty percent of your max and use a box or pike push-ups for the handstands; the twelve-minute cap is a training suggestion, not part of the benchmark.',
  attribution: attribution('diane'),
  equipment: ['Barbell', 'Wall'],
  sections: [forTime('diane-for-time', '21-15-9', 720_000, sequence('diane-ladder', [21, 15, 9].flatMap(reps => [
    task(`diane-deadlifts-${reps}`, { name: 'Deadlifts', reps, load: bar225(), ...(reps === 21 ? { notes: 'Rx 225 lb (155 lb)' } : {}) }),
    task(`diane-hspu-${reps}`, { name: 'Handstand push-ups', shortName: 'HSPU', reps }),
  ])))],
};

/** 50-40-30-20-10 double-unders and sit-ups. */
export const annie: Workout = {
  ...base, id: 'annie',
  title: 'Annie',
  description: 'Double-unders and sit-ups, 50-40-30-20-10. It looks easy on paper and it is pure rhythm: relaxed shoulders on the rope, steady breathing on the floor, no rushing the transitions. Scale with single-unders at double the count if you are still learning the rope; the fifteen-minute cap is a training suggestion, not part of the benchmark.',
  attribution: attribution('annie'),
  equipment: ['Jump rope'],
  sections: [forTime('annie-for-time', '50-40-30-20-10', 900_000, sequence('annie-ladder', [50, 40, 30, 20, 10].flatMap(reps => [
    task(`annie-double-unders-${reps}`, { name: 'Double-unders', reps }),
    task(`annie-sit-ups-${reps}`, { name: 'Sit-ups', reps }),
  ])))],
};

/** 21-15-9 cleans and ring dips. */
export const elizabeth: Workout = {
  ...base, id: 'elizabeth',
  title: 'Elizabeth',
  description: 'Cleans and ring dips, 21-15-9. Squat cleans are the standard and they cook the legs, so settle into a cycle you can keep rather than chasing early speed; the dips fade fast once the triceps tire. Scale the bar or use power cleans, and swap ring dips for bar dips or push-ups; the fifteen-minute cap is a training suggestion, not part of the benchmark.',
  attribution: attribution('elizabeth'),
  equipment: ['Barbell', 'Rings'],
  sections: [forTime('elizabeth-for-time', '21-15-9', 900_000, sequence('elizabeth-ladder', [21, 15, 9].flatMap(reps => [
    task(`elizabeth-cleans-${reps}`, { name: 'Cleans', reps, load: bar135(), ...(reps === 21 ? { notes: 'Rx 135 lb (95 lb); squat cleans' } : {}) }),
    task(`elizabeth-ring-dips-${reps}`, { name: 'Ring dips', reps }),
  ])))],
};

/** 1000 m row, 50 thrusters, 30 pull-ups. */
export const jackie: Workout = {
  ...base, id: 'jackie',
  title: 'Jackie',
  description: 'A thousand metres on the rower, fifty thrusters with an empty bar, thirty pull-ups. Row hard but not all out, because the thrusters are light and are meant to be done in big sets; save a little for the pull-ups. Scale the thruster bar and break the pull-ups early; the fifteen-minute cap is a training suggestion, not part of the benchmark.',
  attribution: attribution('jackie'),
  equipment: ['Rowing machine', 'Barbell', 'Pull-up bar'],
  sections: [forTime('jackie-for-time', 'Row, thrusters, pull-ups', 900_000, sequence('jackie-chipper', [
    task('jackie-row', { name: 'Row', distance: m(1000) }),
    task('jackie-thrusters', { name: 'Thrusters', reps: 50, load: kg(10, 15, 20), notes: 'Rx 45 lb (35 lb)' }),
    task('jackie-pull-ups', { name: 'Pull-ups', reps: 30 }),
  ]))],
};

/** 100 pull-ups, 100 push-ups, 100 sit-ups, 100 air squats, each finished before the next. */
export const angie: Workout = {
  ...base, id: 'angie',
  title: 'Angie',
  description: 'One hundred each of pull-ups, push-ups, sit-ups and air squats, finishing one movement before starting the next. The pull-ups and push-ups are the whole workout; plan small, even sets from the first rep and keep the rest between them short. Scale the pull-ups with a band or ring rows and the push-ups from the knees; the twenty-five-minute cap is a training suggestion, not part of the benchmark.',
  attribution: attribution('angie'),
  equipment: ['Pull-up bar'],
  sections: [forTime('angie-for-time', 'Four hundreds', 1_500_000, sequence('angie-chipper', [
    task('angie-pull-ups', { name: 'Pull-ups', reps: 100 }),
    task('angie-push-ups', { name: 'Push-ups', reps: 100 }),
    task('angie-sit-ups', { name: 'Sit-ups', reps: 100 }),
    task('angie-squats', { name: 'Air squats', reps: 100 }),
  ]))],
};

// ------------------------------------------------------------------ Hero and tribute workouts ------------------------------------------------------------------

/** Run a mile, 100 pull-ups, 200 push-ups, 300 air squats, run a mile. */
export const murph: Workout = {
  ...base, id: 'murph',
  title: 'Murph',
  description: 'Run a mile, then one hundred pull-ups, two hundred push-ups and three hundred air squats, then run another mile. Partition the middle any way you like (twenty rounds of 5-10-15 is the usual choice); the weight vest is optional and the first run should feel easy. Scale the volume to a half Murph if the full one is out of reach today; the sixty-minute cap is a training suggestion, not part of the benchmark.',
  attribution: attribution('murph'),
  equipment: ['Running route', 'Pull-up bar'],
  sections: [forTime('murph-for-time', 'Murph', 3_600_000, sequence('murph-chipper', [
    task('murph-run-1', { name: 'Run', distance: mile(), notes: 'One mile; 20 lb (14 lb) vest if you wear one' }),
    task('murph-pull-ups', { name: 'Pull-ups', reps: 100, notes: 'Partition freely with the push-ups and squats' }),
    task('murph-push-ups', { name: 'Push-ups', reps: 200 }),
    task('murph-squats', { name: 'Air squats', reps: 300 }),
    task('murph-run-2', { name: 'Run', distance: mile(), notes: 'One mile' }),
  ]))],
};

/** Five rounds of 12 deadlifts, 9 hang power cleans, 6 push jerks. */
export const dt: Workout = {
  ...base, id: 'dt',
  title: 'DT',
  description: 'Five rounds of twelve deadlifts, nine hang power cleans and six push jerks on one barbell. Grip is the limiter: a common plan is eleven deadlifts, drop, one deadlift straight into the hang cleans, then eight cleans and a last clean into the jerks. Scale to a bar you can push jerk for six when tired; the twenty-minute cap is a training suggestion, not part of the benchmark.',
  attribution: attribution('dt'),
  equipment: ['Barbell'],
  sections: [forTime('dt-for-time', 'Five rounds', 1_200_000, rounds('dt-rounds', 5, [
    task('dt-deadlifts', { name: 'Deadlifts', reps: 12, load: kg(30, 47.5, 70), notes: 'Published Rx 155 lb / 70 kg (105 lb / 47.5 kg); one bar for all three lifts' }),
    task('dt-hang-power-cleans', { name: 'Hang power cleans', reps: 9, load: kg(30, 47.5, 70) }),
    task('dt-push-jerks', { name: 'Push jerks', reps: 6, load: kg(30, 47.5, 70) }),
  ]))],
};

/** Twenty minutes of 2 muscle-ups, 4 handstand push-ups, 8 heavy kettlebell swings. */
export const nate: Workout = {
  ...base, id: 'nate',
  title: 'Nate',
  description: 'As many rounds as possible in twenty minutes of two muscle-ups, four handstand push-ups and eight heavy kettlebell swings. The rounds are short, so the score is about never stopping: keep the gymnastics crisp and move straight to the bell. Scale muscle-ups to pull-ups plus dips, handstand push-ups to a box or pike, and the bell to a weight you can swing unbroken.',
  attribution: attribution('nate'),
  equipment: ['Rings', 'Wall', 'Kettlebell'],
  sections: [{ id: 'nate-amrap', title: 'AMRAP 20', format: 'amrap', transitionAfter: 'manualReady', capMs: 1_200_000, counter: 'roundsAndReps', body: sequence('nate-round', [
    task('nate-muscle-ups', { name: 'Muscle-ups', reps: 2 }),
    task('nate-hspu', { name: 'Handstand push-ups', shortName: 'HSPU', reps: 4 }),
    task('nate-swings', { name: 'Kettlebell swings', reps: 8, load: kg(16, 24, 32), notes: 'Published Rx 2 pood / 32 kg (1.5 pood / 24 kg)' }),
  ]) }],
};

/** 75 power snatches for time. */
export const randy: Workout = {
  ...base, id: 'randy',
  title: 'Randy',
  description: 'Seventy-five power snatches with a light bar, for time. It is a sprint that turns into a shoulder and grip test, so pick a set size early and stick to it rather than going out unbroken and stalling. Scale the load so the bar keeps cycling; the ten-minute cap is a training suggestion, not part of the benchmark.',
  attribution: attribution('randy'),
  equipment: ['Barbell'],
  sections: [forTime('randy-for-time', '75 power snatches', 600_000,
    task('randy-power-snatches', { name: 'Power snatches', reps: 75, load: kg(15, 25, 34), notes: 'Rx 75 lb (55 lb)' }),
  )],
};

/** 21-15-9 thrusters with 12-9-6 rope climbs. */
export const tommyV: Workout = {
  ...base, id: 'tommy-v',
  title: 'Tommy V',
  description: 'Thrusters 21-15-9 paired with rope climbs 12-9-6 on a fifteen-foot rope. The climbs are the long part; use your legs, descend under control and treat each one as its own rep rather than racing. Scale the thruster load and swap climbs for rope pulls from the floor or a fixed count of pull-ups; the twenty-five-minute cap is a training suggestion, not part of the benchmark.',
  attribution: attribution('tommy-v'),
  equipment: ['Barbell', 'Climbing rope'],
  sections: [forTime('tommy-v-for-time', 'Thrusters and rope climbs', 1_500_000, sequence('tommy-v-ladder', [[21, 12], [15, 9], [9, 6]].flatMap(([thrusters, climbs]) => [
    task(`tommy-v-thrusters-${thrusters}`, { name: 'Thrusters', reps: thrusters, load: kg(22.5, 35, 52), ...(thrusters === 21 ? { notes: 'Published Rx 115 lb / 52 kg (75 lb / 35 kg)' } : {}) }),
    task(`tommy-v-rope-climbs-${climbs}`, { name: 'Rope climbs', reps: climbs, ...(climbs === 12 ? { notes: '15 ft rope' } : {}) }),
  ])))],
};

/** Run a mile, row 2 km, run a mile. */
export const jerry: Workout = {
  ...base, id: 'jerry',
  title: 'Jerry',
  description: 'Run a mile, row two kilometres, run a mile. Three steady efforts with no movement to hide behind: hold the first run just under your threshold, row at a pace you could repeat, and empty the tank on the second run. Scale by shortening each piece rather than resting between them; the thirty-minute cap is a training suggestion, not part of the benchmark.',
  attribution: attribution('jerry'),
  equipment: ['Running route', 'Rowing machine'],
  sections: [forTime('jerry-for-time', 'Run, row, run', 1_800_000, sequence('jerry-sequence', [
    task('jerry-run-1', { name: 'Run', distance: mile(), notes: 'One mile' }),
    task('jerry-row', { name: 'Row', distance: km(2) }),
    task('jerry-run-2', { name: 'Run', distance: mile(), notes: 'One mile' }),
  ]))],
};

export const benchmarkWorkouts: Workout[] = [karen, helen, nancy, grace, isabel, diane, annie, elizabeth, jackie, angie, murph, dt, nate, randy, tommyV, jerry];
