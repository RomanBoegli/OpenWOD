import { createServer } from './app';

const app = await createServer({ logger: true, ...(process.env.WEB_ROOT ? { webRoot: process.env.WEB_ROOT } : {}) });
const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().catch(error => { app.log.error(error); process.exitCode = 1; }); });
await app.listen({ host: process.env.HOST ?? '0.0.0.0', port });
