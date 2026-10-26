// Local development: `node scripts/dev.mjs server` runs the API on port 8787 against .data/app.sqlite,
// `node scripts/dev.mjs full` runs it beside the Vite dev server (which proxies /api to it).
import { spawn } from 'node:child_process';

const mode = process.argv[2] ?? 'full';
const env = { ...process.env, PORT: process.env.PORT ?? '8787', DATABASE_PATH: process.env.DATABASE_PATH ?? '.data/app.sqlite', LOG_LEVEL: process.env.LOG_LEVEL ?? 'info' };
const children = [];
const run = (command, args, extra = {}) => { const child = spawn(command, args, { stdio: 'inherit', env: { ...env, ...extra }, shell: process.platform === 'win32' }); children.push(child); child.on('exit', code => { if (code && code !== 0) process.exitCode = code; }); return child; };

run('npx', ['tsx', 'watch', 'apps/server/src/index.ts']);
if (mode === 'full') run('npx', ['vite', '--host', '127.0.0.1']);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { for (const child of children) child.kill(signal); });
