import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { WorkoutSchema } from '../packages/domain/src/schema';
import { publishedSchema, WorkoutFileSchemaV3 } from '../packages/domain/src/exchange';
import { WorkoutPackSchemaV1 } from '../packages/domain/src/pack';

const check = process.argv.includes('--check');
async function emit(filename: string, content: string) {
  if (!check) { await writeFile(filename, content); return; }
  if (await readFile(filename, 'utf8').catch(() => '') !== content) throw new Error(`${filename} is out of date. Run npm run schemas:generate.`);
}

// Only the current versions are published. Older envelopes are refused by the parser with a message, not kept as schemas.
await mkdir('schemas', { recursive: true });
for (const [name, schema] of Object.entries({ 'workout.v2': WorkoutSchema, 'workout-file.v3': WorkoutFileSchemaV3, 'workout-pack.v1': WorkoutPackSchemaV1 })) {
  await emit(`schemas/${name}.schema.json`, publishedSchema(schema));
}
