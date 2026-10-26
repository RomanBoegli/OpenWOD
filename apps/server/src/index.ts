import { appVersion, createServer } from './app';
import { readConfig } from './config';
import { SchemaNewerError } from './db';
import { Store } from './store';

let config: ReturnType<typeof readConfig>;
try {
  config = readConfig();
} catch (error) {
  // DEP-07: a misconfigured variable stops the container with one line naming it, not a stack trace.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const version = appVersion();
let opened: Awaited<ReturnType<typeof Store.open>>;
try {
  opened = await Store.open(config.databasePath, { appVersion: version });
} catch (error) {
  // DAT-08: never serve against a schema this build does not understand.
  console.error(error instanceof SchemaNewerError ? error.message : `Could not open the database at ${config.databasePath}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const { store, migration } = opened;
const app = await createServer({ logger: { level: config.logLevel }, trustProxy: config.trustProxy, store, scopes: config.testScopes, version, ...(config.webRoot ? { webRoot: config.webRoot } : {}), ...(config.https ? { https: config.https } : {}) });
if (migration.to !== migration.from) app.log.info({ from: migration.from, to: migration.to, backup: migration.backup }, 'Database migrated.');
app.log.info({ path: config.databasePath, schemaVersion: store.schemaVersion, version }, 'Datastore ready.');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => store.close()).catch(error => { app.log.error(error); process.exitCode = 1; }); });
await app.listen({ host: config.host, port: config.port });
