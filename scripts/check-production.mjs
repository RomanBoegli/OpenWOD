import { readdir, readFile } from 'node:fs/promises';

for (const name of await readdir('dist/web/assets')) {
  if (name.endsWith('.js') && (await readFile(`dist/web/assets/${name}`, 'utf8')).includes('__wodvaTest')) {
    throw new Error('Test clock/audio injection must not appear in a production bundle.');
  }
}
console.log('Production bundle excludes test injection.');
