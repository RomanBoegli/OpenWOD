import YAML from 'yaml';
import { Type } from '@sinclair/typebox';
import { compileWorkout } from './compiler';
import { canonicalYaml, FILE_FORMAT, parseWorkoutFile, toFileDurations, toModelDurations, WorkoutFileSchemaV3 } from './exchange';
import type { Workout } from './schema';
import { assertBounded, compileSchema, issuesOf, parseWorkout, WorkoutValidationError } from './validate';

/**
 * Workout packs: one `.wods.yaml` file carrying several workouts and, optionally, the collections that group them
 * (SHR-01/02). Pack ids are local to the file; an import remaps them. Everything else is as in a single workout
 * file: human durations, canonical YAML, no anchors, bounded size.
 */
export const PACK_FORMAT = 'openwod.workoutPack';
export const PACK_VERSION = 1;
export const PACK_EXTENSION = '.wods.yaml';
export const MAX_PACK_BYTES = 4 * 1_048_576;
export const PACK_WORKOUT_LIMIT = 200;

export interface PackCollection { title: string; description?: string; workoutIds: string[] }
export interface WorkoutPack { title?: string; description?: string; workouts: Workout[]; collections: PackCollection[] }

const PackCollectionSchema = Type.Object({ title: Type.String({ minLength: 1, maxLength: 120 }), description: Type.Optional(Type.String({ maxLength: 500 })), workoutIds: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 500 }) }, { additionalProperties: false });
/** The pack file schema with human durations: the workout entries reuse the single-file document schema. */
export const WorkoutPackSchemaV1: Record<string, unknown> = {
  $id: 'WorkoutPackV1',
  type: 'object',
  additionalProperties: false,
  required: ['format', 'formatVersion', 'workouts'],
  properties: {
    format: { const: PACK_FORMAT, type: 'string' },
    formatVersion: { const: PACK_VERSION, type: 'integer' },
    title: { type: 'string', maxLength: 160 },
    description: { type: 'string', maxLength: 2000 },
    workouts: { type: 'array', minItems: 1, maxItems: PACK_WORKOUT_LIMIT, items: (WorkoutFileSchemaV3.properties as Record<string, unknown>).workout },
    collections: { type: 'array', maxItems: 50, items: PackCollectionSchema },
  },
};
const validatePack = compileSchema(WorkoutPackSchemaV1);
const fail = (path: string, message: string): never => { throw new WorkoutValidationError([{ path, message }]); };
const YAML_OPTIONS = { maxAliasCount: 0, uniqueKeys: true, prettyErrors: false } as const;

export function parsePackFile(text: string): WorkoutPack {
  if (new TextEncoder().encode(text).length > MAX_PACK_BYTES) fail('/', 'Workout packs must be no larger than 4 MB.');
  let document: unknown;
  try { document = YAML.parse(text, YAML_OPTIONS); } catch { fail('/', 'Choose a valid YAML or JSON workout pack.'); }
  assertBounded(document);
  const envelope = document && typeof document === 'object' ? document as { format?: unknown; formatVersion?: unknown } : {};
  if (envelope.format !== PACK_FORMAT) fail('/format', 'This is not an OpenWOD workout pack.');
  if (envelope.formatVersion !== PACK_VERSION) fail('/formatVersion', `Workout pack version ${String(envelope.formatVersion)} is newer than this app understands. Update the app to import it.`);
  if (!validatePack(document)) throw new WorkoutValidationError([{ path: '/', message: 'Unsupported workout pack content.' }, ...issuesOf(validatePack, 'Invalid value.')]);
  const model = toModelDurations(document) as { title?: string; description?: string; workouts: unknown[]; collections?: PackCollection[] };
  const workouts = model.workouts.map((item, index) => {
    try { const workout = parseWorkout(item); compileWorkout(workout); return workout; } catch (error) {
      if (error instanceof WorkoutValidationError) throw new WorkoutValidationError(error.issues.map(issue => ({ path: `/workouts/${index}${issue.path}`, message: issue.message })));
      return fail(`/workouts/${index}`, error instanceof Error ? error.message : 'This workout cannot be played.');
    }
  });
  const ids = new Set<string>();
  workouts.forEach((workout, index) => { if (ids.has(workout.id)) fail(`/workouts/${index}/id`, `Workout id "${workout.id}" appears twice in the pack.`); ids.add(workout.id); });
  const collections = (model.collections ?? []).map((collection, index) => {
    for (const id of collection.workoutIds) if (!ids.has(id)) fail(`/collections/${index}/workoutIds`, `Collection "${collection.title}" refers to "${id}", which is not in the pack.`);
    return { title: collection.title.trim(), ...(collection.description ? { description: collection.description } : {}), workoutIds: [...new Set(collection.workoutIds)] };
  });
  return { ...(model.title ? { title: model.title } : {}), ...(model.description ? { description: model.description } : {}), workouts, collections };
}

export function toPackFile(pack: WorkoutPack): Record<string, unknown> {
  return {
    format: PACK_FORMAT, formatVersion: PACK_VERSION,
    ...(pack.title ? { title: pack.title } : {}), ...(pack.description ? { description: pack.description } : {}),
    workouts: pack.workouts.map(workout => toFileDurations(structuredClone(workout))),
    ...(pack.collections.length ? { collections: pack.collections.map(collection => ({ title: collection.title, ...(collection.description ? { description: collection.description } : {}), workoutIds: [...collection.workoutIds] })) } : {}),
  };
}

export function serialisePackFile(pack: WorkoutPack): string {
  return canonicalYaml(toPackFile(pack));
}

export type SharedFile = { kind: 'workout'; workout: Workout } | { kind: 'pack'; pack: WorkoutPack };

/** Reads either a single workout file or a pack, deciding by the discriminator. */
export function parseSharedFile(text: string): SharedFile {
  let format: unknown;
  try { format = (YAML.parse(text.slice(0, 4096).split('\n').find(line => line.startsWith('format:')) ?? '', YAML_OPTIONS) as { format?: unknown } | null)?.format; } catch { format = undefined; }
  if (format === PACK_FORMAT) return { kind: 'pack', pack: parsePackFile(text) };
  if (format === FILE_FORMAT || format === undefined) return { kind: 'workout', workout: parseWorkoutFile(text) };
  return fail('/format', 'This is not an OpenWOD workout file or pack.');
}

/**
 * The SHR-06 comparison form: a workout's meaning with local identity mapped out. Ids, revisions, provenance and
 * every node id are removed; prescriptions, timing, attribution and structure stay. Two imports of the same file
 * compare equal here even though their ids differ.
 */
export function normaliseForComparison(workout: Workout): unknown {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== 'id').map(([key, child]) => [key, strip(child)]));
  };
  const { id: _id, revision: _revision, sharing: _sharing, schemaVersion: _version, ...rest } = workout;
  return strip(rest);
}
