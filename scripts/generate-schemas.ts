import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { WorkoutSchema, WorkoutFileSchema } from '../packages/domain/src/schema';
import { canonicalJson } from '../packages/domain/src/index';
import { fixtureWorkouts } from '../packages/domain/src/fixtures';

await mkdir('schemas', { recursive: true });
for (const [name, schema] of Object.entries({ 'workout.v1': WorkoutSchema, 'workout-file.v1': WorkoutFileSchema })) {
  const filename = `schemas/${name}.schema.json`;
  const content = canonicalJson({ $schema: 'http://json-schema.org/draft-07/schema#', ...schema });
  if (process.argv.includes('--check')) {
    if (await readFile(filename, 'utf8') !== content) throw new Error(`${filename} is out of date. Run npm run schemas:generate.`);
  } else await writeFile(filename, content);
}

await mkdir('examples/workouts', { recursive: true });
for (const workout of fixtureWorkouts) {
  const filename = `examples/workouts/${workout.id}.wod.json`;
  const content = canonicalJson({ format: 'wodva.workout', formatVersion: 1, workout });
  if (process.argv.includes('--check')) {
    if (await readFile(filename, 'utf8') !== content) throw new Error(`${filename} is out of date. Run npm run schemas:generate.`);
  } else await writeFile(filename, content);
}
