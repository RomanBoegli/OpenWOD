// The product was renamed from its working title; nothing outside the plan's history (AGENT.md) may still say it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SKIP = new Set(['node_modules', 'dist', '.git', '.cache', 'test-results', 'test-results-production', 'playwright-report', 'coverage', 'data', 'AGENT.md', 'cues']);
const hits = [];
const walk = dir => {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { walk(path); continue; }
    if (!/\.(ts|tsx|mjs|js|json|yaml|yml|md|html|css|example|txt)$/.test(name) && !name.startsWith('.env')) continue;
    const lines = readFileSync(path, 'utf8').split('\n');
    const legacy = new RegExp(['wod', 'va'].join(''), 'i');
    lines.forEach((line, index) => { if (legacy.test(line)) hits.push(`${path}:${index + 1}: ${line.trim().slice(0, 100)}`); });
  }
};
walk('.');
if (hits.length) { console.error(`The old product name is still used:\n${hits.join('\n')}`); process.exit(1); }
console.log('No legacy product name in the tree.');
