import YAML from 'yaml';
import { WorkoutFileSchema, WorkoutSchema, type Workout } from './schema';
import { assertBounded, compileSchema, issuesOf, parseWorkout, WorkoutValidationError } from './validate';
import { formatDuration, parseDuration } from './duration';

/**
 * Portable workout files. Versions 2 and 3 are YAML with human durations ("40s", "1m30s", "1:30" or seconds as a
 * number) under keys without the Ms suffix; version 3 adds the manual formats, targets and load levels of model
 * version 2. Version 1 is the earlier JSON form with integer-millisecond *Ms keys. YAML 1.2 is a superset of JSON,
 * so one parser reads all of them; the internal model is always integer milliseconds.
 */
export const FILE_FORMAT = 'openwod.workout';
/** Files written before the rename; still read, never written. */
export const LEGACY_FILE_FORMAT = 'wodva.workout';
export const FILE_VERSION = 3;
export const FILE_EXTENSION = '.wod.yaml';
export const MAX_FILE_BYTES = 1_048_576;

/** Model key → file key for versions 2 and 3. */
export const DURATION_KEYS: Record<string, string> = {
  prepMs: 'prep', durationMs: 'duration', betweenChildrenRestMs: 'betweenChildrenRest', trailingRestMs: 'trailingRest', betweenIterationsRestMs: 'betweenIterationsRest',
  capMs: 'cap', intervalMs: 'interval', turnMs: 'turn', timeMs: 'time',
};
const MODEL_KEYS = Object.fromEntries(Object.entries(DURATION_KEYS).map(([model, file]) => [file, model]));
const DURATION_STRING_PATTERN = '^(?:\\d+ms|\\d+:\\d{2}(?::\\d{2})?|(?=.)(?:\\d+h)?(?:\\d+m)?(?:\\d+(?:\\.\\d+)?s)?)$';

/** Derives a human-duration file schema from a model schema: *Ms integer properties become duration properties. */
function humaniseSchema(schema: unknown, version: number): unknown {
  const suffix = `V${version}`;
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(source)) {
      if (key === '$id' && typeof child === 'string') result[key] = `${child}${suffix}`;
      else if (key === '$ref' && typeof child === 'string') result[key] = `${child}${suffix}`;
      else if (key === 'required' && Array.isArray(child)) result[key] = child.map(item => DURATION_KEYS[item as string] ?? item);
      else if (key === 'properties' && child && typeof child === 'object') {
        result[key] = Object.fromEntries(Object.entries(child as Record<string, unknown>).map(([name, property]) => {
          if (name === 'formatVersion') return [name, { const: version, type: 'integer' }];
          if (!(name in DURATION_KEYS)) return [name, walk(property)];
          const { minimum = 0 } = property as { minimum?: number };
          return [DURATION_KEYS[name], { description: 'A duration such as 40s, 2m, 1m30s or 1:30; a bare number is seconds.', anyOf: [{ type: 'number', minimum: minimum / 1000 }, { type: 'string', pattern: DURATION_STRING_PATTERN }] }];
        }));
      } else result[key] = walk(child);
    }
    return result;
  };
  return walk(schema);
}

/** Version 2: the version-1 model (timed circuits only, schemaVersion 1) with human durations. */
export const WorkoutFileSchemaV2 = humaniseSchema(WorkoutFileSchema, 2) as Record<string, unknown>;
/** Version 3: the current model with human durations. */
export const WorkoutFileSchemaV3 = humaniseSchema({ ...WorkoutFileSchema, properties: { ...WorkoutFileSchema.properties, format: { const: FILE_FORMAT, type: 'string' }, workout: WorkoutSchema } }, 3) as Record<string, unknown>;
const validateFileV1 = compileSchema(WorkoutFileSchema);
const validateFileV2 = compileSchema(WorkoutFileSchemaV2);
const validateFileV3 = compileSchema(WorkoutFileSchemaV3);

const fail = (path: string, message: string): never => { throw new WorkoutValidationError([{ path, message }]); };

/** Rewrites human duration keys into model *Ms integers, on a cloned document. */
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

/** Rewrites model *Ms integers into human durations. */
function toFileDurations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toFileDurations);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => key in DURATION_KEYS && typeof child === 'number' ? [DURATION_KEYS[key], formatDuration(child)] : [key, toFileDurations(child)]));
}

const UNSUPPORTED = 'Unsupported workout file or capability for this file version.';

export function parseWorkoutFile(text: string): Workout {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) fail('/', 'Workout files must be no larger than 1 MB.');
  let document: unknown;
  try { document = YAML.parse(text, { maxAliasCount: 0, uniqueKeys: true, prettyErrors: false }); } catch { fail('/', 'Choose a valid YAML or JSON workout file.'); }
  assertBounded(document);
  const envelope = document && typeof document === 'object' ? document as { format?: unknown; formatVersion?: unknown; workout?: unknown } : {};
  if (envelope.format !== FILE_FORMAT && envelope.format !== LEGACY_FILE_FORMAT) fail('/format', 'This is not an OpenWOD workout file.');
  // Either name is accepted for every version; the frozen version 1 and 2 schemas carry the earlier name, version 3 the current one.
  envelope.format = envelope.formatVersion === FILE_VERSION ? FILE_FORMAT : LEGACY_FILE_FORMAT;
  if (envelope.formatVersion === 1) {
    if (!validateFileV1(document)) fail('/', UNSUPPORTED);
    return parseWorkout(envelope.workout);
  }
  if (envelope.formatVersion === 2) {
    if (!validateFileV2(document)) throw new WorkoutValidationError([{ path: '/', message: UNSUPPORTED }, ...issuesOf(validateFileV2, 'Invalid value.')]);
    return parseWorkout((toModelDurations(document) as { workout: unknown }).workout);
  }
  if (envelope.formatVersion === FILE_VERSION) {
    if (!validateFileV3(document)) throw new WorkoutValidationError([{ path: '/', message: UNSUPPORTED }, ...issuesOf(validateFileV3, 'Invalid value.')]);
    return parseWorkout((toModelDurations(document) as { workout: unknown }).workout);
  }
  return fail('/formatVersion', `Workout file version ${String(envelope.formatVersion)} is newer than this app understands. Update the app to import it.`);
}

const TOP_ORDER = ['format', 'formatVersion', 'workout'];
const KEY_ORDER = [
  'schemaVersion', 'id', 'revision', 'title', 'format', 'description', 'attribution', 'author', 'sourceUrl', 'licence', 'notes', 'equipment', 'participants', 'prep', 'prepMs', 'sections',
  'type', 'transitionAfter', 'cap', 'capMs', 'interval', 'intervalMs', 'intervals', 'counter', 'rounds', 'turn', 'turnMs',
  'count', 'assignmentPolicy', 'completion', 'betweenIterationsRest', 'betweenIterationsRestMs', 'betweenChildrenRest', 'betweenChildrenRestMs', 'trailingRest', 'trailingRestMs', 'duration', 'durationMs', 'kind',
  'assignments', 'A', 'B', 'movement', 'name', 'shortName', 'spokenName', 'reps', 'calories', 'distance', 'time', 'timeMs', 'load', 'light', 'medium', 'heavy', 'value', 'unit', 'body', 'children',
];
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
