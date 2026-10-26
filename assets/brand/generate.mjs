/**
 * OpenWOD — Code × Training
 * Original, hand-constructed vector geometry based on the selected concept.
 * Lettering is outlined; no fonts, embedded rasters, filters or external assets.
 * Run: node assets/brand/generate.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const destination = dirname(fileURLToPath(import.meta.url));
await mkdir(destination, { recursive: true });

// Geometric cap height 128, x-height 100, descender 29.
const wordGlyphs = {
  O: { width: 90, d: 'M25 0H65Q90 0 90 25V103Q90 128 65 128H25Q0 128 0 103V25Q0 0 25 0ZM34 26Q30 26 30 30V98Q30 102 34 102H56Q60 102 60 98V30Q60 26 56 26Z' },
  p: { width: 82, d: 'M0 28H58Q82 28 82 52V104Q82 128 58 128H29V157H0ZM33 54Q29 54 29 58V98Q29 102 33 102H49Q53 102 53 98V58Q53 54 49 54Z' },
  e: { width: 82, d: 'M24 28H58Q82 28 82 52V86H28V99Q28 104 33 104H50Q55 104 55 99V94H82V104Q82 128 58 128H24Q0 128 0 104V52Q0 28 24 28ZM33 52Q28 52 28 57V66H55V57Q55 52 50 52Z' },
  n: { width: 82, d: 'M0 28H58Q82 28 82 52V128H53V60Q53 54 47 54H29V128H0Z' },
  W: { width: 136, d: 'M0 0H31L43 77L60 28H79L96 77L105 0H136L114 128H87L69 73L51 128H24Z' },
  D: { width: 96, d: 'M0 0H66Q96 0 96 30V98Q96 128 66 128H0ZM31 26V102H56Q65 102 65 93V35Q65 26 56 26Z' },
};

// A separate lighter set keeps the slogan's industrial character at small sizes.
const sloganGlyphs = {
  N: { width: 82, d: 'M0 100V0H22L60 65V0H82V100H60L22 35V100Z' },
  o: { width: 70, d: 'M16 25H54Q70 25 70 41V84Q70 100 54 100H16Q0 100 0 84V41Q0 25 16 25ZM24 44Q20 44 20 48V77Q20 81 24 81H46Q50 81 50 77V48Q50 44 46 44Z' },
  t: { width: 50, d: 'M12 0H32V25H50V43H32V77Q32 82 37 82H50V100H29Q12 100 12 83V43H0V25H12Z' },
  b: { width: 70, d: 'M0 0H20V25H54Q70 25 70 41V84Q70 100 54 100H0ZM24 44Q20 44 20 48V77Q20 81 24 81H46Q50 81 50 77V48Q50 44 46 44Z' },
  r: { width: 50, d: 'M0 25H50V45H27Q20 45 20 52V100H0Z' },
  n: { width: 70, d: 'M0 25H54Q70 25 70 41V100H50V49Q50 44 45 44H20V100H0Z' },
  '.': { width: 18, d: 'M0 82H18V100H0Z' },
  M: { width: 100, d: 'M0 100V0H22L50 48L78 0H100V100H78V37L50 84L22 37V100Z' },
  a: { width: 70, d: 'M16 25H54Q70 25 70 41V100H16Q0 100 0 84V73Q0 57 16 57H50V49Q50 44 45 44H7V25ZM24 74Q20 74 20 78V79Q20 83 24 83H50V74Z' },
  d: { width: 70, d: 'M50 0H70V100H16Q0 100 0 84V41Q0 25 16 25H50ZM24 44Q20 44 20 48V77Q20 81 24 81H46Q50 81 50 77V48Q50 44 46 44Z' },
  e: { width: 70, d: 'M16 25H54Q70 25 70 41V70H20V78Q20 82 24 82H46Q50 82 50 78V76H70V84Q70 100 54 100H16Q0 100 0 84V41Q0 25 16 25ZM24 43Q20 43 20 47V53H50V47Q50 43 46 43Z' },
};

function lettering(text, glyphs, { scaleX = 1, scaleY = scaleX, tracking = 0, gap = 10 } = {}) {
  let cursor = 0;
  const parts = [];
  for (const character of text) {
    if (character === ' ') { cursor += 45 * scaleX + tracking; continue; }
    const glyph = glyphs[character];
    if (!glyph) throw new Error(`Missing outline: ${character}`);
    parts.push(`    <path transform="translate(${Number(cursor.toFixed(3))} 0) scale(${scaleX} ${scaleY})" d="${glyph.d}"/>`);
    cursor += glyph.width * scaleX + gap + tracking;
  }
  return parts.join('\n');
}

// Open code brackets frame the plates and shaft of a deliberately simple barbell.
const leftBracket = 'M89 2H94Q99 2 99 7V38L45 90L99 142V173Q99 178 94 178H89Q83 178 78 173L9 108Q0 100 0 90Q0 80 9 72L78 7Q83 2 89 2Z';
const symbol = `    <path d="${leftBracket}"/>
    <path transform="translate(360 0) scale(-1 1)" d="${leftBracket}"/>
    <rect x="110" y="44" width="30" height="92" rx="5"/>
    <rect x="220" y="44" width="30" height="92" rx="5"/>
    <rect x="91" y="66" width="14" height="48" rx="3"/>
    <rect x="255" y="66" width="14" height="48" rx="3"/>
    <path d="M148 79H212V101H148Z"/>`;

const themes = {
  dark: { foreground: '#F4F4EC', accent: '#B9F27B', background: '#101714' },
  light: { foreground: '#101714', accent: '#6B962D', background: '#F7F6F0' },
};

function document({ title, description, width, height, body }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">${title}</title>
  <desc id="description">${description}</desc>
${body}
</svg>
`;
}

for (const [name, theme] of Object.entries(themes)) {
  const wordmark = `  <g fill="${theme.foreground}" fill-rule="evenodd" transform="translate(448 64)">
${lettering('OpenWOD', wordGlyphs, { gap: 8 })}
  </g>
  <g fill="${theme.accent}" fill-rule="evenodd" transform="translate(452 239)">
${lettering('Not born. Made.', sloganGlyphs, { scaleX: .55, scaleY: .44, tracking: 6, gap: 0 })}
  </g>`;
  const logo = document({
    title: `OpenWOD — ${name} theme`,
    description: `Code brackets form a barbell beside OpenWOD. Slogan: Not born. Made. Outlined vector artwork for ${name} backgrounds.`,
    width: 1200, height: 320,
    body: `  <g fill="${theme.accent}" transform="translate(32 42)">\n${symbol}\n  </g>\n${wordmark}`,
  });
  await writeFile(join(destination, `openwod-logo-${name}.svg`), logo);
  await writeFile(join(destination, `openwod-icon-${name}.svg`), document({
    title: `OpenWOD icon — ${name} theme`,
    description: 'Open angle brackets surrounding a barbell. OpenWOD Code × Training symbol.',
    width: 400, height: 400,
    body: `  <g fill="${theme.accent}" transform="translate(20 110)">\n${symbol}\n  </g>`,
  }));
}

// A presentation preview combines the exact deliverables on their intended backgrounds.
const previews = await Promise.all(Object.keys(themes).map(async name => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(join(destination, `openwod-logo-${name}.svg`), 'utf8');
  return source.replace(/^<\?xml[^>]+>\s*/, '')
    .replace('<svg ', `<svg x="80" y="${name === 'dark' ? 80 : 530}" `)
    .replace('width="1200" height="320"', 'width="1120" height="299"')
    .replace('role="img" aria-labelledby="title description"', 'aria-hidden="true"')
    .replace(/\s*<title[^>]*>.*?<\/title>\s*/, '\n')
    .replace(/\s*<desc[^>]*>.*?<\/desc>\s*/, '\n');
}));
await writeFile(join(destination, 'preview.svg'), document({
  title: 'OpenWOD logo — dark and light theme comparison',
  description: 'Top: lime and off-white logo on charcoal. Bottom: deeper green and charcoal logo on warm white.',
  width: 1280, height: 900,
  body: `  <path fill="${themes.dark.background}" d="M0 0H1280V450H0Z"/>\n  <path fill="${themes.light.background}" d="M0 450H1280V900H0Z"/>\n${previews.join('\n')}`,
}));

console.log('Generated OpenWOD dark/light logos, icons, and preview in assets/brand/.');
