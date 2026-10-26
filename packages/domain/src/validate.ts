import Ajv, { type ValidateFunction } from 'ajv';
import { WorkoutSchema, type Workout } from './schema';

export interface ValidationIssue { path: string; message: string }
export class WorkoutValidationError extends Error {
  constructor(public issues: ValidationIssue[]) {
    super(issues.map(issue => `${issue.path || '/'}: ${issue.message}`).join('\n'));
    this.name = 'WorkoutValidationError';
  }
}

export const ajv = new Ajv({ allErrors: true, strict: false });
const validateWorkout = ajv.compile<Workout>(WorkoutSchema);

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

/** Validates an in-memory workout against the domain model and returns an isolated copy. */
export function parseWorkout(value: unknown): Workout {
  assertBounded(value);
  if (!validateWorkout(value)) throw new WorkoutValidationError(issuesOf(validateWorkout, 'Invalid workout.'));
  return structuredClone(value);
}
