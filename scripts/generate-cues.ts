// Renders the spoken cues and every bundled movement name with open-licensed Piper voices into
// apps/web/public/cues/<pack>/ (cues as <name>.mp3, movement names under names/<id>.mp3) plus packs.json and LICENSE.md.
// Names bundled workouts write differently from their record ("Plank rows") are recorded as written under
// names/text/<slug>.mp3, from packages/domain/src/generated/cue-phrases.json (scripts/bundle-workouts.ts writes it).
// Everything ships inside the Docker image, so a session never depends on the device's voices.
//   npm run cues:generate                      # every pack (locally through uv, which fetches piper-tts on demand)
//   CUE_PACKS=british npm run cues:generate    # one pack
//   CUES_OUT=dist/web/cues npm run cues:generate
//   PIPER_PYTHON=python3 ...                   # the Docker build: a Python with piper-tts installed
// Requires ffmpeg. Piper's English voices are British, American and Scottish; no other accents exist in that set.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { seedMovements } from '../packages/domain/src/movements';

/** Fixed cues, keyed as apps/web/src/audio.ts expects them. */
export const CUES: Record<string, string> = {
  'get-ready': 'Get ready.',
  go: 'Go!',
  rest: 'Rest.',
  switch: 'Switch!',
  three: 'Three.',
  two: 'Two.',
  one: 'One.',
  paused: 'Paused.',
  resume: 'Resume.',
  complete: 'Workout complete. Well done.',
  a: 'A.',
  b: 'B.',
  next: 'Next.',
  'last-interval': 'Last interval.',
  'a-waiting': 'A done. Waiting for B.',
  'b-waiting': 'B done. Waiting for A.',
  ended: 'Workout ended.',
};
/** Packs ship in this order; the first one is the default in the app. All English, two sexes, four accents. */
export const PACKS = [
  { id: 'british', label: 'British male (Alan)', voice: 'en_GB-alan-medium' },
  { id: 'american', label: 'American female (Amy)', voice: 'en_US-amy-medium' },
  { id: 'scottish', label: 'Scottish female (Alba)', voice: 'en_GB-alba-medium' },
  { id: 'northern', label: 'Northern English male', voice: 'en_GB-northern_english_male-medium' },
  { id: 'american-male', label: 'American male (Ryan)', voice: 'en_US-ryan-medium' },
];

/** Bump when the rendering changes (text, trimming, level): packs rendered with an older version are discarded, not resumed. */
const RENDER_VERSION = 2;

const outDir = resolve(process.env.CUES_OUT ?? 'apps/web/public/cues');
const PHRASES = 'packages/domain/src/generated/cue-phrases.json';
const wanted = (process.env.CUE_PACKS ?? '').split(',').map(item => item.trim()).filter(Boolean);
const packs = wanted.length ? PACKS.filter(pack => wanted.includes(pack.id)) : PACKS;
const voicesDir = resolve(process.env.PIPER_VOICES ?? '.cache/piper-voices');
mkdirSync(outDir, { recursive: true });
for (const pack of packs) {
  const packDir = join(outDir, pack.id);
  const marker = join(packDir, '.render-version');
  if (existsSync(packDir) && (!existsSync(marker) || readFileSync(marker, 'utf8').trim() !== String(RENDER_VERSION))) {
    console.log(`${pack.id}: rendered with an older version, rendering again`);
    rmSync(packDir, { recursive: true, force: true });
  }
}

const phrases = existsSync(PHRASES) ? JSON.parse(readFileSync(PHRASES, 'utf8')) as Record<string, string> : {};
const names = {
  ...Object.fromEntries(seedMovements.map(record => [record.id, `${record.spokenName ?? record.name}.`])),
  ...Object.fromEntries(Object.entries(phrases).map(([slug, text]) => [`text/${slug}`, `${text}.`])),
};
const specPath = join(outDir, '.render-spec.json');
writeFileSync(specPath, JSON.stringify({ renderVersion: RENDER_VERSION, outDir, voicesDir, packs: packs.map(({ id, voice }) => ({ id, voice })), clips: CUES, names }, null, 2));

const python = process.env.PIPER_PYTHON;
const result = python
  ? spawnSync(python, ['scripts/render-cues.py', specPath], { stdio: 'inherit' })
  : spawnSync('uv', ['run', '--with', 'piper-tts', 'python', 'scripts/render-cues.py', specPath], { stdio: 'inherit' });
if (result.status !== 0) { console.error('Rendering failed. Locally this needs uv and ffmpeg; see docs/development.md.'); process.exit(result.status ?? 1); }
for (const pack of packs) if (existsSync(join(outDir, pack.id))) writeFileSync(join(outDir, pack.id, '.render-version'), `${RENDER_VERSION}\n`);

// List every pack that is complete in the output, in canonical order, with how many movement names it carries.
const listed = PACKS.filter(pack => Object.keys(CUES).every(name => existsSync(join(outDir, pack.id, `${name}.mp3`)))).map(pack => {
  const namesDir = join(outDir, pack.id, 'names');
  return { id: pack.id, label: pack.label, voice: pack.voice, names: existsSync(namesDir) ? readdirSync(namesDir).filter(file => file.endsWith('.mp3')).length : 0 };
});
writeFileSync(join(outDir, 'packs.json'), JSON.stringify(listed, null, 2) + '\n');
writeFileSync(join(outDir, 'LICENSE.md'), `# Spoken clips\n\nGenerated by scripts/generate-cues.ts with Piper text-to-speech voices (https://github.com/rhasspy/piper): ${listed.map(pack => `\`${pack.voice}\``).join(', ')}. Piper voice models carry their own licences, recorded in each voice's MODEL_CARD on Hugging Face (rhasspy/piper-voices); the voices used here allow redistribution of generated audio. The clips follow this repository's licence.\n`);
console.log(`Packs ready in ${outDir}: ${listed.map(pack => `${pack.id} (${pack.names} names)`).join(', ') || 'none'}`);
