import Fastify, { type FastifyRequest, type FastifyServerOptions } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { errorHandler } from './errors';
import { registerRoutes } from './routes';
import { Store } from './store';

export interface ServerOptions {
  logger?: boolean | { level: string };
  webRoot?: string;
  trustProxy?: boolean | string;
  /** PEM key and certificate: the server then listens on HTTPS instead of HTTP. */
  https?: { key: string; cert: string };
  /** The household datastore. Without one the API answers 503 and health/ready reports no persistence. */
  store?: Store;
  /** Test builds only: a fresh in-memory store per X-OpenWOD-Scope header, so parallel browser tests never share data. */
  scopes?: boolean;
  version?: string;
}

export function appVersion(): string {
  try { return (JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0'; } catch { return '0.0.0'; }
}

const SCOPE_LIMIT = 64;
const SCOPE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export async function createServer({ logger = false, webRoot = resolve('dist/web'), trustProxy = false, https, store, scopes = false, version = appVersion() }: ServerOptions = {}) {
  // One instance type for both protocols: Fastify's overloads would otherwise split the return type by server class, and nothing here depends on it.
  const app = Fastify({ logger, bodyLimit: 1_048_576, trustProxy, ...(https ? { https } : {}) } as FastifyServerOptions);
  app.setErrorHandler(errorHandler);
  const scoped = new Map<string, Store>();
  const storeOf = (request: FastifyRequest): Store | undefined => (request as FastifyRequest & { scopedStore?: Store }).scopedStore ?? store;
  if (scopes) {
    app.addHook('onRequest', async request => {
      const header = request.headers['x-openwod-scope'];
      const scope = Array.isArray(header) ? header[0] : header;
      if (!scope || !SCOPE_PATTERN.test(scope)) return;
      let scopedStore = scoped.get(scope);
      if (!scopedStore) {
        if (scoped.size >= SCOPE_LIMIT) { const [oldest] = scoped.keys(); scoped.get(oldest)?.close(); scoped.delete(oldest); }
        scopedStore = (await Store.open(':memory:', { appVersion: version })).store;
        scoped.set(scope, scopedStore);
      }
      (request as FastifyRequest & { scopedStore?: Store }).scopedStore = scopedStore;
    });
    app.addHook('onClose', async () => { for (const item of scoped.values()) item.close(); scoped.clear(); });
  }
  registerRoutes(app, { storeOf, version });
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
