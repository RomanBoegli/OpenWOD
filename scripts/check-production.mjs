// Checks a production bundle: `node scripts/check-production.mjs [dist]`, dist/web by default (the server shape) or
// dist/static (the static site, which must work under any path prefix).
import { readdir, readFile } from 'node:fs/promises';

const dist = (process.argv[2] ?? 'dist/web').replace(/\/+$/, '');
const isStatic = dist.endsWith('static');

for (const name of await readdir(`${dist}/assets`)) {
  if (name.endsWith('.js') && (await readFile(`${dist}/assets/${name}`, 'utf8')).includes('__openwodTest')) {
    throw new Error('Test clock/audio injection must not appear in a production bundle.');
  }
}
console.log(`Production bundle in ${dist} excludes test injection.`);

// Installable from a phone's home screen: the manifest, its icons and the Apple touch icon ship with the bundle (UI-16).
const manifest = JSON.parse(await readFile(`${dist}/manifest.webmanifest`, 'utf8'));
if (manifest.display !== 'standalone' || manifest.start_url !== './') throw new Error('manifest.webmanifest must open standalone at ./');
for (const icon of [...manifest.icons.map(icon => icon.src), 'icons/apple-touch-icon.png']) await readFile(`${dist}/${icon}`);
const html = await readFile(`${dist}/index.html`, 'utf8');
for (const needle of ['rel="manifest"', 'rel="apple-touch-icon"', 'apple-mobile-web-app-capable']) if (!html.includes(needle)) throw new Error(`index.html lacks ${needle}.`);
console.log('Production bundle is installable: manifest, icons and Apple tags present.');

if (isStatic) {
  // One artifact for any host and prefix: nothing in the page may point at the site root.
  for (const needle of ['href="/', 'src="/']) if (html.includes(needle)) throw new Error(`${dist}/index.html has a root-relative ${needle}…; the static site must use relative paths.`);
  console.log('Static bundle uses relative paths only.');
  if (process.env.OPENWOD_REQUIRE_CUES === '1') {
    const packs = JSON.parse(await readFile(`${dist}/cues/packs.json`, 'utf8'));
    if (packs.length !== 5) throw new Error(`${dist}/cues/packs.json lists ${packs.length} voice packs; the release ships 5.`);
    console.log('Static bundle ships the five recorded voice packs.');
  }
}
