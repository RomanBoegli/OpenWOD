import { Type, type Static } from '@sinclair/typebox';

const id = Type.String({ minLength: 1, maxLength: 120, pattern: '^[a-zA-Z0-9_.:-]+$' });
const label = Type.String({ minLength: 1, maxLength: 160 });
const duration = Type.Integer({ minimum: 1, maximum: 86_400_000 });
const restDuration = Type.Integer({ minimum: 0, maximum: 86_400_000 });

/**
 * One load: an absolute weight, or a percentage of a one-rep max (display only, never executed). `value` is the
 * men's (or only) amount; `women` is the women's amount in the same unit, shown in brackets for solo workouts and
 * on its own in a woman's lane of a pair workout. Percentages are of each athlete's own maximum, so they carry no
 * `women` value (the compiler rejects it).
 */
export const LoadValueSchema = Type.Object({
  value: Type.Number({ minimum: 0, maximum: 10_000 }),
  women: Type.Optional(Type.Number({ minimum: 0, maximum: 10_000 })),
  unit: Type.Union([Type.Literal('kg'), Type.Literal('lb'), Type.Literal('percent')]),
}, { additionalProperties: false });
export type LoadValue = Static<typeof LoadValueSchema>;

/** Loads by level. A single LoadValue (the version 1 shape) applies to every level. */
export const LoadLevelsSchema = Type.Object({
  light: Type.Optional(LoadValueSchema),
  medium: Type.Optional(LoadValueSchema),
  heavy: Type.Optional(LoadValueSchema),
}, { additionalProperties: false, minProperties: 1 });
export type LoadLevels = Static<typeof LoadLevelsSchema>;
export const LOAD_LEVELS = ['light', 'medium', 'heavy'] as const;
export type LoadLevel = typeof LOAD_LEVELS[number];

export const PrescriptionSchema = Type.Object({
  /** Optional id of the movement record this prescription was picked from; the names below stay authoritative, so a file is complete without any catalogue. */
  movement: Type.Optional(Type.String({ pattern: '^[a-z0-9][a-z0-9-]{0,79}$', maxLength: 80 })),
  name: label,
  shortName: Type.Optional(label),
  spokenName: Type.Optional(label),
  reps: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  calories: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  distance: Type.Optional(Type.Object({ value: Type.Number({ exclusiveMinimum: 0, maximum: 1_000_000 }), unit: Type.Union([Type.Literal('m'), Type.Literal('km')]) }, { additionalProperties: false })),
  /** A target time or hold, informational only; it never drives execution. */
  timeMs: Type.Optional(duration),
  load: Type.Optional(Type.Union([LoadValueSchema, LoadLevelsSchema])),
  notes: Type.Optional(Type.String({ maxLength: 500 })),
}, { additionalProperties: false });
export type Prescription = Static<typeof PrescriptionSchema>;

const assignments = Type.Object({ A: PrescriptionSchema, B: Type.Optional(PrescriptionSchema) }, { additionalProperties: false });

export const NodeSchema = Type.Recursive(Self => Type.Union([
  Type.Object({ id, type: Type.Literal('timed'), durationMs: duration, assignments }, { additionalProperties: false }),
  /** Manual work with no execution duration: the athletes report completion. `completion` is the pair rule (BLD-06). */
  Type.Object({ id, type: Type.Literal('task'), assignments, completion: Type.Optional(Type.Union([Type.Literal('team'), Type.Literal('both')])) }, { additionalProperties: false }),
  Type.Object({ id, type: Type.Literal('rest'), durationMs: duration, kind: Type.Optional(Type.Union([Type.Literal('transition'), Type.Literal('roundRest'), Type.Literal('blockRest')])) }, { additionalProperties: false }),
  Type.Object({ id, type: Type.Literal('sequence'), betweenChildrenRestMs: Type.Optional(restDuration), trailingRestMs: Type.Optional(restDuration), children: Type.Array(Self, { minItems: 1, maxItems: 1000 }) }, { additionalProperties: false }),
  Type.Object({ id, type: Type.Literal('repeat'), count: Type.Integer({ minimum: 1, maximum: 999 }), betweenIterationsRestMs: Type.Optional(restDuration), assignmentPolicy: Type.Optional(Type.Union([Type.Literal('fixed'), Type.Literal('alternate')])), body: Self }, { additionalProperties: false }),
]), { $id: 'WorkoutNode' });
export type WorkoutNode = Static<typeof NodeSchema>;

export const AttributionSchema = Type.Object({
  author: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  sourceUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 500, pattern: '^https?://' })),
  licence: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
  notes: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
}, { additionalProperties: false });
export type Attribution = Static<typeof AttributionSchema>;

const count = Type.Integer({ minimum: 1, maximum: 999 });

/**
 * A section picks its format. Format-specific settings are optional at the schema level (Ajv cannot hold one
 * recursive node schema inside several union members); the compiler enforces which settings each format needs:
 * amrap → capMs (+ counter); emom → intervalMs, intervals; forTime → optional capMs; youGoIGo → capMs or rounds,
 * optional turnMs; timedCircuit and strength → none.
 */
export const SectionSchema = Type.Object({
  id,
  title: label,
  format: Type.Union([Type.Literal('timedCircuit'), Type.Literal('amrap'), Type.Literal('emom'), Type.Literal('forTime'), Type.Literal('youGoIGo'), Type.Literal('strength')]),
  transitionAfter: Type.Union([Type.Literal('manualReady'), Type.Literal('automatic')]),
  capMs: Type.Optional(duration),
  intervalMs: Type.Optional(duration),
  intervals: Type.Optional(count),
  counter: Type.Optional(Type.Union([Type.Literal('roundsAndReps'), Type.Literal('rounds'), Type.Literal('none')])),
  rounds: Type.Optional(count),
  turnMs: Type.Optional(duration),
  body: NodeSchema,
}, { additionalProperties: false });
export type WorkoutSection = Static<typeof SectionSchema>;
export type SectionFormat = WorkoutSection['format'];
export const SECTION_FORMATS: SectionFormat[] = ['timedCircuit', 'amrap', 'emom', 'forTime', 'youGoIGo', 'strength'];
export const FORMAT_LABELS: Record<SectionFormat, string> = { timedCircuit: 'Timed circuit', amrap: 'AMRAP', emom: 'EMOM', forTime: 'For time', youGoIGo: 'You go, I go', strength: 'Strength' };
/** One sentence per format, shown in the editor and in the authoring guide. */
export const FORMAT_HELP: Record<SectionFormat, string> = {
  timedCircuit: 'Movements with fixed seconds and explicit rests. The clock drives everything.',
  amrap: 'One block of movements, repeated as many times as the cap allows. Athletes count rounds on the screen.',
  emom: 'Work starts on every interval boundary. Done shows rest until the next one; the boundary never waits.',
  forTime: 'Ordered movements, each ended by Done. The clock counts up, with an optional cap.',
  youGoIGo: 'One athlete works through the unit while the other rests, then Switch. An A turn plus a B turn is one team round.',
  strength: 'Sets at your own pace, each ended by Done, with a timed rest between sets. Loads can be levelled or a percentage of 1RM.',
};

export const SCHEMA_VERSION = 2;

/**
 * Sharing provenance (SHR-05): a stable identity that travels with the file, separate from the local id and revision.
 * `sourceRevision` is the author's revision at export; a derivative records what it came from and gets its own id.
 */
export const SharingSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 120 }),
  sourceRevision: Type.Integer({ minimum: 1 }),
  derivedFrom: Type.Optional(Type.Object({ id: Type.String({ minLength: 1, maxLength: 120 }), sourceRevision: Type.Integer({ minimum: 1 }) }, { additionalProperties: false })),
}, { additionalProperties: false });
export type Sharing = Static<typeof SharingSchema>;

export const WorkoutSchema = Type.Object({
  schemaVersion: Type.Literal(SCHEMA_VERSION),
  id,
  revision: Type.Integer({ minimum: 1 }),
  sharing: Type.Optional(SharingSchema),
  title: label,
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  attribution: Type.Optional(AttributionSchema),
  equipment: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 30 }),
  participants: Type.Union([Type.Literal(1), Type.Literal(2)]),
  prepMs: Type.Integer({ minimum: 0, maximum: 60_000 }),
  sections: Type.Array(SectionSchema, { minItems: 1, maxItems: 100 }),
}, { $id: 'Workout', additionalProperties: false });
export type Workout = Static<typeof WorkoutSchema>;

export const FILE_FORMAT = 'openwod.workout';
export const FILE_VERSION = 3;
/** The exchange envelope on the model side (integer-millisecond keys); exchange.ts derives the human-duration file schema from it. */
export const WorkoutFileSchema = Type.Object({
  format: Type.Literal(FILE_FORMAT),
  formatVersion: Type.Literal(FILE_VERSION),
  workout: WorkoutSchema,
}, { $id: 'WorkoutFile', additionalProperties: false });
export type WorkoutFile = Static<typeof WorkoutFileSchema>;
