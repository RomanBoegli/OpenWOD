import { readdir, readFile } from 'node:fs/promises';

for (const name of await readdir('dist/web/assets')) {
  if (name.endsWith('.js') && (await readFile(`dist/web/assets/${name}`, 'utf8')).includes('__openwodTest')) {
    throw new Error('Test clock/audio injection must not appear in a production bundle.');
  }
}
console.log('Production bundle excludes test injection.');

// Installable from a phone's home screen: the manifest, its icons and the Apple touch icon ship with the bundle (UI-16).
const manifest = JSON.parse(await readFile('dist/web/manifest.webmanifest', 'utf8'));
if (manifest.display !== 'standalone' || manifest.start_url !== './') throw new Error('manifest.webmanifest must open standalone at ./');
for (const icon of [...manifest.icons.map(icon => icon.src), 'icons/apple-touch-icon.png']) await readFile(`dist/web/${icon}`);
const html = await readFile('dist/web/index.html', 'utf8');
for (const needle of ['rel="manifest"', 'rel="apple-touch-icon"', 'apple-mobile-web-app-capable']) if (!html.includes(needle)) throw new Error(`index.html lacks ${needle}.`);
console.log('Production bundle is installable: manifest, icons and Apple tags present.');
