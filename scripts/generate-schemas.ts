import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { WorkoutSchema, WorkoutFileSchema } from '../packages/domain/src/schema';
import { canonicalJson, serialiseWorkoutFile, WorkoutFileSchemaV2 } from '../packages/domain/src/exchange';
import { fixtureWorkouts } from '../packages/domain/src/fixtures';

const check = process.argv.includes('--check');
async function emit(filename: string, content: string) {
  if (!check) { await writeFile(filename, content); return; }
  if (await readFile(filename, 'utf8').catch(() => '') !== content) throw new Error(`${filename} is out of date. Run npm run schemas:generate.`);
}

await mkdir('schemas', { recursive: true });
for (const [name, schema] of Object.entries({ 'workout.v1': WorkoutSchema, 'workout-file.v1': WorkoutFileSchema, 'workout-file.v2': WorkoutFileSchemaV2 })) {
  await emit(`schemas/${name}.schema.json`, canonicalJson({ $schema: 'http://json-schema.org/draft-07/schema#', ...schema }));
}

await mkdir('examples/workouts', { recursive: true });
for (const workout of fixtureWorkouts) await emit(`examples/workouts/${workout.id}.wod.yaml`, serialiseWorkoutFile(workout));
