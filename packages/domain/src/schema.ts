import { Type, type Static } from '@sinclair/typebox';

const id = Type.String({ minLength: 1, maxLength: 120, pattern: '^[a-zA-Z0-9_.:-]+$' });
const label = Type.String({ minLength: 1, maxLength: 160 });
const duration = Type.Integer({ minimum: 1, maximum: 86_400_000 });
const restDuration = Type.Integer({ minimum: 0, maximum: 86_400_000 });

/** One load: an absolute weight, or a percentage of a one-rep max (display only, never executed). */
export const LoadValueSchema = Type.Object({
  value: Type.Number({ minimum: 0, maximum: 10_000 }),
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

export const SCHEMA_VERSION = 2;

export const WorkoutSchema = Type.Object({
  schemaVersion: Type.Literal(SCHEMA_VERSION),
  id,
  revision: Type.Integer({ minimum: 1 }),
  title: label,
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  attribution: Type.Optional(AttributionSchema),
  equipment: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 30 }),
  participants: Type.Union([Type.Literal(1), Type.Literal(2)]),
  prepMs: Type.Integer({ minimum: 0, maximum: 60_000 }),
  sections: Type.Array(SectionSchema, { minItems: 1, maxItems: 100 }),
}, { $id: 'Workout', additionalProperties: false });
export type Workout = Static<typeof WorkoutSchema>;

/** Version 1 exchange envelope (JSON, integer-millisecond keys, schemaVersion 1). Versions 2 and 3 are derived in exchange.ts. */
export const WorkoutFileSchema = Type.Object({
  format: Type.Literal('wodva.workout'),
  formatVersion: Type.Literal(1),
  workout: Type.Object({ ...WorkoutSchema.properties, schemaVersion: Type.Literal(1) }, { $id: 'WorkoutV1', additionalProperties: false }),
}, { $id: 'WorkoutFile', additionalProperties: false });
export type WorkoutFile = Static<typeof WorkoutFileSchema>;
