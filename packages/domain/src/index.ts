import Ajv from 'ajv';
import { WorkoutSchema, WorkoutFileSchema, type Workout } from './schema';
export * from './schema';

export interface ValidationIssue { path: string; message: string }
export class WorkoutValidationError extends Error {
  constructor(public issues: ValidationIssue[]) {
    super(issues.map(issue => `${issue.path || '/'}: ${issue.message}`).join('\n'));
    this.name = 'WorkoutValidationError';
  }
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile<Workout>(WorkoutSchema);
const validateFile = ajv.compile(WorkoutFileSchema);

// Bound depth and object count before recursive schema validation touches input.
function boundInput(value: unknown) {
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

export function parseWorkout(value: unknown): Workout {
  boundInput(value);
  if (!validate(value)) throw new WorkoutValidationError((validate.errors ?? []).slice(0, 12).map(error => ({ path: error.instancePath, message: error.message ?? 'Invalid workout.' })));
  return structuredClone(value);
}

export function parseWorkoutFile(text: string): Workout {
  if (new TextEncoder().encode(text).length > 1_048_576) throw new WorkoutValidationError([{ path: '/', message: 'Workout files must be no larger than 1 MB.' }]);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new WorkoutValidationError([{ path: '/', message: 'Choose a valid JSON workout file.' }]); }
  boundInput(value);
  if (!validateFile(value)) throw new WorkoutValidationError([{ path: '/', message: 'Unsupported workout file or capability. This player supports version 1 timed circuits.' }]);
  return parseWorkout((value as { workout: unknown }).workout);
}

export function canonicalJson(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, child]) => [key, sort(child)]));
    return item;
  };
  return JSON.stringify(sort(value), null, 2) + '\n';
}
