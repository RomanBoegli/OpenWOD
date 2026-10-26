import { Type, type Static } from '@sinclair/typebox';
import { SECTION_FORMATS, WorkoutSchema, type Workout } from '../../domain/src/schema';
import type { EngineEvent, SectionResult, Status } from './index';

/**
 * The record of one played session, as the player writes it and the server stores it. It carries the workout
 * document as it was played (DAT-09: archiving or editing the workout later never changes history), the engine's
 * section results and its event log, and the DAT-04 flags: `interrupted` when the session was recovered from a
 * checkpoint, `modified` when the player navigated or skipped.
 */
export type SessionOutcome = 'completed' | 'capped' | 'aborted';
export interface SessionCorrection { correctedAt: string; previousResults: SectionResult[]; note?: string }
export interface SessionRecord {
  id: string;
  workoutId: string;
  workoutRevision: number;
  title: string;
  startedAt: string;
  finishedAt: string;
  outcome: SessionOutcome;
  interrupted: boolean;
  modified: boolean;
  /** Share of the planned duration that was played (1 for completed, otherwise activeMs / planned). */
  completion: number;
  activeMs: number;
  results: SectionResult[];
  events: EngineEvent[];
  /** The workout as played; present on upload and on a single-session read, omitted from lists. */
  workout?: Workout;
  deviceId: string;
  /** Server-managed: 1 when stored, +1 per score correction. */
  revision?: number;
  corrections?: SessionCorrection[];
}

export const EVENT_LIMIT = 20_000;
const iso = Type.String({ minLength: 10, maxLength: 40 });
const id = Type.String({ minLength: 1, maxLength: 200 });
export const SectionResultSchema = Type.Object({
  sectionId: id,
  format: Type.Union(SECTION_FORMATS.map(format => Type.Literal(format))),
  outcome: Type.Union([Type.Literal('completed'), Type.Literal('capped'), Type.Literal('finished')]),
  sectionMs: Type.Integer({ minimum: 0 }),
  counter: Type.Optional(Type.Object({ rounds: Type.Integer({ minimum: 0 }), reps: Type.Integer({ minimum: 0 }) }, { additionalProperties: false })),
  turns: Type.Optional(Type.Integer({ minimum: 0 })),
  teamRounds: Type.Optional(Type.Integer({ minimum: 0 })),
  skippedTurns: Type.Optional(Type.Integer({ minimum: 0 })),
  unacknowledged: Type.Array(id, { maxItems: 10_000 }),
}, { additionalProperties: false });
export const EngineEventSchema = Type.Object({
  id, sequence: Type.Integer({ minimum: 0 }), type: Type.String({ minLength: 1, maxLength: 40 }), occurrenceId: id, activeMs: Type.Integer({ minimum: 0 }),
  payload: Type.Optional(Type.Record(Type.String({ maxLength: 40 }), Type.Union([Type.String({ maxLength: 200 }), Type.Number(), Type.Boolean()]))),
}, { additionalProperties: false });
export const SessionCorrectionSchema = Type.Object({ correctedAt: iso, previousResults: Type.Array(SectionResultSchema, { maxItems: 100 }), note: Type.Optional(Type.String({ maxLength: 500 })) }, { additionalProperties: false });
export const SessionRecordSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 120 }),
  workoutId: Type.String({ minLength: 1, maxLength: 120 }),
  workoutRevision: Type.Integer({ minimum: 1 }),
  title: Type.String({ minLength: 1, maxLength: 160 }),
  startedAt: iso,
  finishedAt: iso,
  outcome: Type.Union([Type.Literal('completed'), Type.Literal('capped'), Type.Literal('aborted')]),
  interrupted: Type.Boolean(),
  modified: Type.Boolean(),
  completion: Type.Number({ minimum: 0, maximum: 1 }),
  activeMs: Type.Integer({ minimum: 0 }),
  results: Type.Array(SectionResultSchema, { maxItems: 100 }),
  events: Type.Array(EngineEventSchema, { maxItems: EVENT_LIMIT }),
  workout: Type.Optional(WorkoutSchema),
  deviceId: Type.String({ minLength: 1, maxLength: 80 }),
  revision: Type.Optional(Type.Integer({ minimum: 1 })),
  corrections: Type.Optional(Type.Array(SessionCorrectionSchema, { maxItems: 100 })),
}, { $id: 'SessionRecord', additionalProperties: false });
export type SessionRecordDocument = Static<typeof SessionRecordSchema>;

/** Completed unless the engine aborted, capped when any section ran into its cap. */
export function sessionOutcome(status: Status, results: SectionResult[]): SessionOutcome {
  if (status === 'aborted') return 'aborted';
  return results.some(result => result.outcome === 'capped') ? 'capped' : 'completed';
}
