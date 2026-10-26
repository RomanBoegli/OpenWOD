import YAML from 'yaml';
import { WorkoutFileSchema, type Workout } from './schema';
import { ajv, assertBounded, issuesOf, parseWorkout, WorkoutValidationError } from './validate';
import { formatDuration, parseDuration } from './duration';

/**
 * Portable workout files. Version 2 is YAML with human durations ("40s", "1m30s", "1:30" or seconds as a number)
 * under keys without the Ms suffix. Version 1 is the earlier JSON form with integer-millisecond *Ms keys.
 * YAML 1.2 is a superset of JSON, so one parser reads both; the internal model is always integer milliseconds.
 */
export const FILE_FORMAT = 'wodva.workout';
export const FILE_VERSION = 2;
export const FILE_EXTENSION = '.wod.yaml';
export const MAX_FILE_BYTES = 1_048_576;

/** Model key → file key for version 2. */
export const DURATION_KEYS: Record<string, string> = { prepMs: 'prep', durationMs: 'duration', betweenChildrenRestMs: 'betweenChildrenRest', trailingRestMs: 'trailingRest', betweenIterationsRestMs: 'betweenIterationsRest' };
const MODEL_KEYS = Object.fromEntries(Object.entries(DURATION_KEYS).map(([model, file]) => [file, model]));
const DURATION_STRING_PATTERN = '^(?:\\d+ms|\\d+:\\d{2}(?::\\d{2})?|(?=.)(?:\\d+h)?(?:\\d+m)?(?:\\d+(?:\\.\\d+)?s)?)$';

/** Derives the version 2 file schema from the model schema: *Ms integer properties become human duration properties. */
function humaniseSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(humaniseSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const source = schema as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === '$id' && typeof value === 'string') result[key] = `${value}V2`;
    else if (key === '$ref' && typeof value === 'string') result[key] = `${value}V2`;
    else if (key === 'required' && Array.isArray(value)) result[key] = value.map(item => DURATION_KEYS[item as string] ?? item);
    else if (key === 'properties' && value && typeof value === 'object') {
      result[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, property]) => {
        if (name === 'formatVersion') return [name, { const: FILE_VERSION, type: 'integer' }];
        if (!(name in DURATION_KEYS)) return [name, humaniseSchema(property)];
        const { minimum = 0 } = property as { minimum?: number };
        return [DURATION_KEYS[name], { description: 'A duration such as 40s, 2m, 1m30s or 1:30; a bare number is seconds.', anyOf: [{ type: 'number', minimum: minimum / 1000 }, { type: 'string', pattern: DURATION_STRING_PATTERN }] }];
      }));
    } else result[key] = humaniseSchema(value);
  }
  return result;
}

export const WorkoutFileSchemaV2 = humaniseSchema(WorkoutFileSchema) as Record<string, unknown>;
const validateFileV1 = ajv.compile(WorkoutFileSchema);
const validateFileV2 = ajv.compile(WorkoutFileSchemaV2);

const fail = (path: string, message: string): never => { throw new WorkoutValidationError([{ path, message }]); };

/** Rewrites version 2 duration keys into model *Ms integers, in place on a cloned document. */
function toModelDurations(value: unknown, path = ''): unknown {
  if (Array.isArray(value)) return value.map((item, index) => toModelDurations(item, `${path}/${index}`));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const modelKey = MODEL_KEYS[key];
    if (modelKey) {
      if (modelKey in (value as object)) fail(`${path}/${key}`, `Use either ${key} or ${modelKey}, not both.`);
      try { result[modelKey] = parseDuration(child); } catch (error) { fail(`${path}/${key}`, error instanceof Error ? error.message : 'Invalid duration.'); }
    } else result[key] = toModelDurations(child, `${path}/${key}`);
  }
  return result;
}

/** Rewrites model *Ms integers into version 2 human durations. */
function toFileDurations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toFileDurations);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => key in DURATION_KEYS && typeof child === 'number' ? [DURATION_KEYS[key], formatDuration(child)] : [key, toFileDurations(child)]));
}

export function parseWorkoutFile(text: string): Workout {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) fail('/', 'Workout files must be no larger than 1 MB.');
  let document: unknown;
  try { document = YAML.parse(text, { maxAliasCount: 0, uniqueKeys: true, prettyErrors: false }); } catch { fail('/', 'Choose a valid YAML or JSON workout file.'); }
  assertBounded(document);
  const envelope = document && typeof document === 'object' ? document as { format?: unknown; formatVersion?: unknown; workout?: unknown } : {};
  if (envelope.format !== FILE_FORMAT) fail('/format', 'This is not a Wodva workout file.');
  if (envelope.formatVersion === 1) {
    if (!validateFileV1(document)) fail('/', 'Unsupported workout file or capability. This player supports timed circuits.');
    return parseWorkout(envelope.workout);
  }
  if (envelope.formatVersion === FILE_VERSION) {
    if (!validateFileV2(document)) throw new WorkoutValidationError([{ path: '/', message: 'Unsupported workout file or capability. This player supports timed circuits.' }, ...issuesOf(validateFileV2, 'Invalid value.')]);
    return parseWorkout((toModelDurations(document) as { workout: unknown }).workout);
  }
  return fail('/formatVersion', `Workout file version ${String(envelope.formatVersion)} is newer than this app understands. Update the app to import it.`);
}

const TOP_ORDER = ['format', 'formatVersion', 'workout'];
const KEY_ORDER = ['schemaVersion', 'id', 'revision', 'title', 'format', 'description', 'attribution', 'author', 'sourceUrl', 'licence', 'notes', 'equipment', 'participants', 'prep', 'prepMs', 'sections', 'type', 'transitionAfter', 'count', 'assignmentPolicy', 'betweenIterationsRest', 'betweenIterationsRestMs', 'betweenChildrenRest', 'betweenChildrenRestMs', 'trailingRest', 'trailingRestMs', 'duration', 'durationMs', 'kind', 'assignments', 'A', 'B', 'name', 'shortName', 'spokenName', 'reps', 'load', 'value', 'unit', 'body', 'children'];
const rank = (order: string[], key: string) => { const index = order.indexOf(key); return index === -1 ? order.length : index; };

function orderKeys(value: unknown, order = KEY_ORDER): unknown {
  if (Array.isArray(value)) return value.map(item => orderKeys(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => rank(order, a) - rank(order, b) || a.localeCompare(b, 'en')).map(([key, child]) => [key, orderKeys(child)]));
}

/** Readable, diff-stable YAML: human key order, two-space indent, no document markers, trailing newline. */
export function canonicalYaml(value: unknown): string {
  return YAML.stringify(orderKeys(value, TOP_ORDER), { indent: 2, lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN', aliasDuplicateObjects: false });
}

/** Alphabetical, two-space JSON; used for the published JSON Schemas. */
export function canonicalJson(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, child]) => [key, sort(child)]));
    return item;
  };
  return JSON.stringify(sort(value), null, 2) + '\n';
}

export function toWorkoutFile(workout: Workout): Record<string, unknown> {
  return { format: FILE_FORMAT, formatVersion: FILE_VERSION, workout: toFileDurations(structuredClone(workout)) };
}

export function serialiseWorkoutFile(workout: Workout): string {
  return canonicalYaml(toWorkoutFile(workout));
}
