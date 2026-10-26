import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export async function createServer({ logger = false, webRoot = resolve('dist/web') } = {}) {
  const app = Fastify({ logger, bodyLimit: 1_048_576, trustProxy: false });
  app.get('/api/v1/health/live', async () => ({ status: 'ok', version: '0.1.0' }));
  app.get('/api/v1/health/ready', async () => ({ status: 'ok', capabilities: ['timed-player'], persistence: false }));
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, {
      root: webRoot,
      setHeaders(response, filePath) {
        response.header('X-Content-Type-Options', 'nosniff');
        response.header('Referrer-Policy', 'same-origin');
        response.header('Cache-Control', filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : filePath.includes('/cues/') ? 'public, max-age=86400' : 'no-store');
      },
    });
  }
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: `No route for ${request.method} ${request.url.split('?')[0]}.` } }));
  return app;
}
