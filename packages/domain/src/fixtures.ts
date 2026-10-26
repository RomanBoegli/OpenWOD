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

export const fixtureWorkouts = [partnerCircuit, fullBodyPartner];

export function prescriptionText(value: Prescription): string {
  const targets = [value.reps ? `${value.reps} reps` : '', value.load ? `${value.load.value} ${value.load.unit}` : ''].filter(Boolean).join(' · ');
  return targets || value.notes || 'Steady effort. Your pace.';
}
