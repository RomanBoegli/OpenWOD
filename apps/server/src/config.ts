/** Server configuration from the environment (DEP-07): every value validated, every default documented in docs/deploy.md. */
import { readFileSync } from 'node:fs';

export interface ServerConfig {
  port: number;
  host: string;
  webRoot?: string;
  /** SQLite file; ':memory:' keeps everything in the process (tests). */
  databasePath: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  /** false, true, or a comma-separated list of trusted proxy addresses. */
  trustProxy: boolean | string;
  /** The key and certificate in PEM form when the server speaks HTTPS itself (DEP-14), otherwise it speaks HTTP for a proxy. */
  https?: { key: string; cert: string };
  /** Test builds only: a per-request in-memory database selected by the X-OpenWOD-Scope header. */
  testScopes: boolean;
}

const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** HTTPS_KEY and HTTPS_CERT follow Actual Budget's convention: the PEM text itself (with newlines written as \n where a line is all a stack allows) or the path of the file holding it. */
function pem(name: string, value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (text.includes('-----BEGIN')) return text.replace(/\\n/g, '\n');
  try { return readFileSync(text, 'utf8'); } catch (error) { throw new Error(`${name} names ${text}, which could not be read: ${error instanceof Error ? error.message : String(error)}`); }
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const logLevel = (env.LOG_LEVEL ?? 'info').toLowerCase();
  if (!(LEVELS as readonly string[]).includes(logLevel)) throw new Error(`LOG_LEVEL must be one of ${LEVELS.join(', ')}.`);
  const proxy = (env.TRUST_PROXY ?? 'false').trim();
  const trustProxy = proxy === '' || proxy.toLowerCase() === 'false' ? false : proxy.toLowerCase() === 'true' ? true : proxy;
  const databasePath = (env.DATABASE_PATH ?? '/data/app.sqlite').trim();
  if (!databasePath) throw new Error('DATABASE_PATH must be a file path or :memory:.');
  const key = pem('HTTPS_KEY', env.HTTPS_KEY);
  const cert = pem('HTTPS_CERT', env.HTTPS_CERT);
  if (Boolean(key) !== Boolean(cert)) throw new Error('HTTPS_KEY and HTTPS_CERT must be set together, each a PEM file path or the PEM text.');
  return {
    port,
    host: env.HOST?.trim() || '0.0.0.0',
    ...(env.WEB_ROOT ? { webRoot: env.WEB_ROOT } : {}),
    databasePath,
    logLevel: logLevel as ServerConfig['logLevel'],
    trustProxy,
    ...(key && cert ? { https: { key, cert } } : {}),
    testScopes: env.OPENWOD_TEST_SCOPES === '1',
  };
}
