/** Server configuration from the environment (DEP-07): every value validated, every default documented in docs/deploy.md. */
export interface ServerConfig {
  port: number;
  host: string;
  webRoot?: string;
  /** SQLite file; ':memory:' keeps everything in the process (tests). */
  databasePath: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  /** false, true, or a comma-separated list of trusted proxy addresses. */
  trustProxy: boolean | string;
  /** Test builds only: a per-request in-memory database selected by the X-OpenWOD-Scope header. */
  testScopes: boolean;
}

const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const logLevel = (env.LOG_LEVEL ?? 'info').toLowerCase();
  if (!(LEVELS as readonly string[]).includes(logLevel)) throw new Error(`LOG_LEVEL must be one of ${LEVELS.join(', ')}.`);
  const proxy = (env.TRUST_PROXY ?? 'false').trim();
  const trustProxy = proxy === '' || proxy.toLowerCase() === 'false' ? false : proxy.toLowerCase() === 'true' ? true : proxy;
  const databasePath = (env.DATABASE_PATH ?? '/data/app.sqlite').trim();
  if (!databasePath) throw new Error('DATABASE_PATH must be a file path or :memory:.');
  return {
    port,
    host: env.HOST?.trim() || '0.0.0.0',
    ...(env.WEB_ROOT ? { webRoot: env.WEB_ROOT } : {}),
    databasePath,
    logLevel: logLevel as ServerConfig['logLevel'],
    trustProxy,
    testScopes: env.OPENWOD_TEST_SCOPES === '1',
  };
}
