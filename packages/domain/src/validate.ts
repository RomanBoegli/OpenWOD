import Ajv, { type ValidateFunction } from 'ajv';
import { SCHEMA_VERSION, WorkoutSchema, type Workout } from './schema';

export interface ValidationIssue { path: string; message: string }
export class WorkoutValidationError extends Error {
  constructor(public issues: ValidationIssue[]) {
    super(issues.map(issue => `${issue.path || '/'}: ${issue.message}`).join('\n'));
    this.name = 'WorkoutValidationError';
  }
}

/** Each schema gets its own Ajv instance: the model versions share $id names (WorkoutNode, WorkoutSection) that one instance cannot hold twice. */
export function compileSchema<T = unknown>(schema: object): ValidateFunction<T> {
  return new Ajv({ allErrors: true, strict: false }).compile<T>(schema);
}
const validateWorkout = compileSchema<Workout>(WorkoutSchema);

/** Bound depth and object count before recursive schema validation touches input. */
export function assertBounded(value: unknown) {
  const pending = [{ value, depth: 0 }];
  let count = 0;
  const visited = new Set<object>();
  while (pending.length) {
    const item = pending.pop()!;
    if (++count > 100_000 || item.depth > 32) throw new WorkoutValidationError([{ path: '/', message: 'Workout is too large or nested too deeply.' }]);
    if (item.value && typeof item.value === 'object') {
      if (visited.has(item.value)) throw new WorkoutValidationError([{ path: '/', message: 'Workout data must not contain cycles or shared object references.' }]);
      visited.add(item.value);
      for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 });
    }
  }
}

export function issuesOf(validator: ValidateFunction, fallback: string): ValidationIssue[] {
  return (validator.errors ?? []).slice(0, 12).map(error => ({ path: error.instancePath, message: error.message ?? fallback }));
}

/**
 * Brings an older workout model up to the current schema version. Version 2 is a strict superset of version 1
 * (new formats, a manual task node, richer targets and loads), so the migration only changes the version literal.
 * Newer versions are left untouched and fail validation with the version mismatch.
 */
export function migrateWorkout(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion === 1) return { ...record, schemaVersion: SCHEMA_VERSION };
  return value;
}

/** Validates an in-memory workout against the domain model (migrating older versions) and returns an isolated copy. */
export function parseWorkout(value: unknown): Workout {
  assertBounded(value);
  const migrated = migrateWorkout(value);
  if (!validateWorkout(migrated)) {
    const version = (migrated as { schemaVersion?: unknown } | null)?.schemaVersion;
    if (typeof version === 'number' && version > SCHEMA_VERSION) throw new WorkoutValidationError([{ path: '/schemaVersion', message: `Workout model version ${version} is newer than this app understands. Update the app to use it.` }]);
    throw new WorkoutValidationError(issuesOf(validateWorkout, 'Invalid workout.'));
  }
  return structuredClone(migrated);
}
