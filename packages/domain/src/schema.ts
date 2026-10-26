import { Type, type Static } from '@sinclair/typebox';

const id = Type.String({ minLength: 1, maxLength: 120, pattern: '^[a-zA-Z0-9_.:-]+$' });
const label = Type.String({ minLength: 1, maxLength: 160 });
const duration = Type.Integer({ minimum: 1, maximum: 86_400_000 });
const restDuration = Type.Integer({ minimum: 0, maximum: 86_400_000 });

export const PrescriptionSchema = Type.Object({
  name: label,
  shortName: Type.Optional(label),
  spokenName: Type.Optional(label),
  reps: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  load: Type.Optional(Type.Object({ value: Type.Number({ minimum: 0, maximum: 10_000 }), unit: Type.Union([Type.Literal('kg'), Type.Literal('lb')]) }, { additionalProperties: false })),
  notes: Type.Optional(Type.String({ maxLength: 500 })),
}, { additionalProperties: false });
export type Prescription = Static<typeof PrescriptionSchema>;

export const NodeSchema = Type.Recursive(Self => Type.Union([
  Type.Object({ id, type: Type.Literal('timed'), durationMs: duration, assignments: Type.Object({ A: PrescriptionSchema, B: Type.Optional(PrescriptionSchema) }, { additionalProperties: false }) }, { additionalProperties: false }),
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

export const WorkoutSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  id,
  revision: Type.Integer({ minimum: 1 }),
  title: label,
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  attribution: Type.Optional(AttributionSchema),
  equipment: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 30 }),
  participants: Type.Union([Type.Literal(1), Type.Literal(2)]),
  prepMs: Type.Integer({ minimum: 0, maximum: 60_000 }),
  sections: Type.Array(Type.Object({
    id,
    title: label,
    format: Type.Literal('timedCircuit'),
    transitionAfter: Type.Union([Type.Literal('manualReady'), Type.Literal('automatic')]),
    body: NodeSchema,
  }, { additionalProperties: false }), { minItems: 1, maxItems: 100 }),
}, { $id: 'Workout', additionalProperties: false });
export type Workout = Static<typeof WorkoutSchema>;

/** Version 1 exchange envelope (JSON, integer-millisecond keys). Version 2 is derived from it in exchange.ts. */
export const WorkoutFileSchema = Type.Object({
  format: Type.Literal('wodva.workout'),
  formatVersion: Type.Literal(1),
  workout: WorkoutSchema,
}, { $id: 'WorkoutFile', additionalProperties: false });
export type WorkoutFile = Static<typeof WorkoutFileSchema>;
